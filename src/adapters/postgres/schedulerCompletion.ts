/**
 * The terminal half of the durable execution scheduler: the one indivisible
 * transaction that pins a verified result, records the terminal outcome,
 * releases the slot and submits the completion.
 *
 * IT REACHES THE MAILBOX THROUGH `submit_task_completion` AND NO OTHER DOOR.
 * The scheduler role holds no privilege at all on `operation`,
 * `decision_input`, `journal_entry` or `ticket_projection`, so there is no
 * direct insert here to be tempted by: the function is the authenticated
 * ingress `docs/design/006-durable-project-dispatch.md` requires, and granting
 * execute on it to one workload identity is how that rule is enforced rather
 * than an exception to it. Everything the envelope says is built by the
 * function from durable rows; what this file passes is the binding it claims to
 * hold, which the function validates and may refuse.
 *
 * ONE TRANSACTION, NOT THREE. The manifest, the outcome, the released slot and
 * the completion operation commit together or not at all, so the crash window
 * between holding a verified result and telling anyone about it does not exist
 * — a recovery query for it would be an integrity check that must return
 * nothing. The execution row is locked first and the project row second, which
 * is the order the function itself takes them in, so the two cannot deadlock.
 *
 * ABSORPTION IS DECIDED UNDER THE LOCK AND BELOW THE JOURNAL. A redelivery of
 * the manifest already recorded yields the operation already recorded; a report
 * for cancelled or retired work makes no durable move; a second terminal claim
 * that contradicts the first leaves the first standing and raises an integrity
 * incident. None of the three submits a second completion, so no second project
 * input exists for the domain to no-op on.
 *
 * A FENCED REPORTER SETTLES NOTHING. Every durable move takes the claimed
 * generation with the identity, and the terminal transaction requires the named
 * attempt to still be the current unfenced one at the moment the row is locked.
 * A worker that checked its own generation first would be checking a value it
 * read before the takeover it is being fenced by, and the server refuses a
 * fenced attempt's manifest again underneath.
 *
 * THE EXHAUSTED-RETRY MANIFEST IS AUTHORED HERE AND IS A REAL MANIFEST. When
 * the safe retry budget is spent there is no worker text to read, so this file
 * composes the explicit empty manifest — no handoffs, no diagnostics, a failed
 * verdict — and puts it through the same acceptance and the same digest every
 * reported one goes through. Writing the row directly would be a result that
 * skipped validation, which is the one thing the sealed type exists to prevent.
 */

import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

import { assertNever } from "../../domain/assertNever.ts";
import {
  asAttemptId,
  type Blocked,
  type BlockedReason,
  type ExecutionId,
  type ExecutionOutcome,
  type AttemptReport,
  type LogicalExecution,
  type SchedulerIncidentKind,
  type Terminalized,
} from "../../interpreter/executionScheduler.ts";
import { asOperationId } from "../../interpreter/operationInbox.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import {
  acceptResultManifest,
  asResultManifestId,
  resultManifestSchemaVersion,
  type ArtifactRole,
  type ArtifactRow,
  type ResultManifest,
} from "../../interpreter/resultManifest.ts";
import {
  executionRowColumns,
  executionRowFrom,
  executionRowLogical,
  type ExecutionRow,
} from "./schedulerRows.ts";
import { completionFunction, schedulerRole } from "./schema.ts";

/** The report a manifest a worker never produced is composed from. */
const exhaustedManifestText = JSON.stringify({
  version: resultManifestSchemaVersion,
  verdict: "Fail",
  handoffs: [],
  diagnostics: [],
});

/**
 * The bounded evidence an incident carries. Each names the rule that was
 * reached and nothing correlatable; the subject is the execution and attempt
 * columns beside it.
 */
export const schedulerEvidence = {
  ConflictingResult:
    "a second terminal result contradicts the one already recorded",
  ConflictingRegistration:
    "a logical task is already registered under another spawn request",
  PartialRegistration:
    "a registration left fewer executions than its request declares",
  NoReporter: "an exhausted execution has no attempt that could have reported",
  RefusedBinding:
    "the completion boundary refused a binding built from its own rows",
  ForeignManifest:
    "a manifest is bound to an execution other than the one reporting it",
} as const;

/** What the completion boundary answered. */
interface CompletionRow {
  readonly result: string;
  readonly operation: string | null;
}

/** Locks one registration and reads what it and the request that authorized it say. */
export async function schedulerLockExecution(
  client: pg.PoolClient,
  partition: Partition,
  execution: ExecutionId,
): Promise<LogicalExecution | undefined> {
  const found = await client.query<ExecutionRow>(
    `SELECT ${executionRowColumns} FROM ${executionRowFrom}
      WHERE e.tenant = $1 AND e.project = $2 AND e.execution = $3
      FOR UPDATE OF e`,
    [partition.tenant, partition.project, execution],
  );
  const row = found.rows[0];
  return row === undefined ? undefined : executionRowLogical(row);
}

/** Whether the project still admits a completion, taken under its own row lock. */
async function schedulerProjectAdmits(
  client: pg.PoolClient,
  partition: Partition,
): Promise<boolean> {
  const found = await client.query<{ lifecycle: string }>(
    "SELECT lifecycle FROM project WHERE tenant = $1 AND project = $2 FOR UPDATE",
    [partition.tenant, partition.project],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${partition.tenant}/${partition.project} was never provisioned`,
    );
  }
  return row.lifecycle !== "Retention";
}

/** Records one durable integrity incident and answers with its identity. */
export async function schedulerRecordIncident(
  client: pg.PoolClient,
  partition: Partition,
  kind: SchedulerIncidentKind,
  evidence: string,
  subject: { readonly execution?: string; readonly attempt?: string } = {},
): Promise<string> {
  const incident = `incident-${randomUUID()}`;
  await client.query(
    `INSERT INTO scheduler_incident
       (tenant, project, incident, kind, execution, attempt, evidence)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      partition.tenant,
      partition.project,
      incident,
      kind,
      subject.execution ?? null,
      subject.attempt ?? null,
      evidence,
    ],
  );
  return incident;
}

/**
 * Marks every request whose registrations have all settled as owing nothing
 * further, which is the second of the two delivery moves 006 gives a request.
 */
export async function schedulerFulfilRequest(
  client: pg.PoolClient,
  partition: Partition,
  request: string,
): Promise<void> {
  await client.query(
    `UPDATE execution_request q SET state = 'Fulfilled'
      WHERE q.tenant = $1 AND q.project = $2 AND q.request = $3
        AND q.state = 'Registered'
        AND NOT EXISTS (SELECT 1 FROM execution e
                         WHERE e.tenant = q.tenant AND e.project = q.project
                           AND e.source_request = q.request
                           AND e.status NOT IN ('Terminal', 'Cancelled'))`,
    [partition.tenant, partition.project, request],
  );
}

/** Offers one completion to the boundary, which validates the binding and builds the envelope. */
async function schedulerSubmit(
  client: pg.PoolClient,
  execution: LogicalExecution,
  outcome: ExecutionOutcome,
  manifest: { readonly id: string; readonly digest: string } | undefined,
  reason: BlockedReason | undefined,
): Promise<CompletionRow> {
  const submitted = await client.query<CompletionRow>(
    `SELECT result, operation FROM ${completionFunction}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [
      execution.partition.tenant,
      execution.partition.project,
      execution.execution,
      execution.ticket,
      execution.task,
      execution.sourceEffect,
      outcome,
      manifest?.id ?? null,
      manifest?.digest ?? null,
      reason ?? null,
      `completion-${randomUUID()}`,
      schedulerRole,
    ],
  );
  const row = submitted.rows[0];
  if (row === undefined) {
    throw new Error(
      "postgres scheduler: the completion boundary returned no verdict at all",
    );
  }
  return row;
}

/** Allocates the project-local manifest ordinal, which reads the counter it advances. */
async function schedulerManifestOrdinal(
  client: pg.PoolClient,
  partition: Partition,
): Promise<string> {
  const taken = await client.query<{ ordinal: string }>(
    `UPDATE project SET manifest_next = manifest_next + 1
      WHERE tenant = $1 AND project = $2
      RETURNING (manifest_next - 1)::text AS ordinal`,
    [partition.tenant, partition.project],
  );
  const row = taken.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${partition.tenant}/${partition.project} handed out no manifest ordinal`,
    );
  }
  return row.ordinal;
}

/** Writes one artifact list, continuing the manifest-local ordinal the previous list left. */
async function schedulerWriteArtifacts(
  client: pg.PoolClient,
  manifest: ResultManifest,
  rows: readonly ArtifactRow[],
  role: ArtifactRole,
  from: number,
): Promise<number> {
  let ordinal = from;
  for (const artifact of rows) {
    await client.query(
      `INSERT INTO execution_result_artifact
         (tenant, project, manifest, ordinal, role, path, digest, bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        manifest.binding.partition.tenant,
        manifest.binding.partition.project,
        manifest.manifest,
        ordinal,
        role,
        artifact.path,
        artifact.digest,
        artifact.bytes,
      ],
    );
    ordinal += 1;
  }
  return ordinal;
}

/** Retains one verified manifest and every artifact it declares, written once and never edited. */
async function schedulerWriteManifest(
  client: pg.PoolClient,
  manifest: ResultManifest,
  ordinal: string,
): Promise<void> {
  await client.query(
    `INSERT INTO execution_result
       (tenant, project, manifest, execution, attempt, manifest_ordinal,
        schema_version, digest, verdict)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      manifest.binding.partition.tenant,
      manifest.binding.partition.project,
      manifest.manifest,
      manifest.binding.execution,
      manifest.binding.attempt,
      ordinal,
      manifest.schemaVersion,
      manifest.digest,
      manifest.verdict,
    ],
  );
  const handoffs = await schedulerWriteArtifacts(
    client,
    manifest,
    manifest.handoffs,
    "Handoff",
    1,
  );
  await schedulerWriteArtifacts(
    client,
    manifest,
    manifest.diagnostics,
    "Diagnostic",
    handoffs,
  );
}

/** The terminal outcome one verified verdict settles the logical task as. */
function schedulerOutcomeOf(manifest: ResultManifest): ExecutionOutcome {
  return manifest.verdict === "Pass" ? "Passed" : "Failed";
}

/** Turns the boundary's answer into the outcome a caller must handle. */
async function schedulerTerminalized(
  client: pg.PoolClient,
  execution: LogicalExecution,
  outcome: ExecutionOutcome,
  submitted: CompletionRow,
): Promise<Terminalized> {
  if (
    submitted.result === "Submitted" ||
    submitted.result === "AlreadySubmitted"
  ) {
    if (submitted.operation === null) {
      throw new Error(
        "postgres scheduler: the completion boundary submitted without naming an operation",
      );
    }
    await schedulerFulfilRequest(
      client,
      execution.partition,
      execution.sourceRequest,
    );
    return {
      terminalized:
        submitted.result === "Submitted" ? "Terminalized" : "AlreadyTerminal",
      outcome,
      operation: asOperationId(submitted.operation),
    };
  }
  return {
    terminalized: "Conflicting",
    incident: await schedulerRecordIncident(
      client,
      execution.partition,
      "ImpossibleState",
      schedulerEvidence.RefusedBinding,
      { execution: execution.execution },
    ),
  };
}

/** Whether the manifest offered is the one already recorded against a settled execution. */
async function schedulerManifestAlreadyStands(
  client: pg.PoolClient,
  execution: LogicalExecution,
  offered: ResultManifest,
): Promise<boolean> {
  if (execution.resultManifest !== offered.manifest) return false;
  const stored = await client.query<{ digest: string }>(
    `SELECT digest FROM execution_result
      WHERE tenant = $1 AND project = $2 AND manifest = $3`,
    [
      execution.partition.tenant,
      execution.partition.project,
      execution.resultManifest,
    ],
  );
  return stored.rows[0]?.digest === offered.digest;
}

/** What a report about an execution that has already settled is worth. */
async function schedulerAbsorb(
  client: pg.PoolClient,
  execution: LogicalExecution,
  offered: ResultManifest,
): Promise<Terminalized> {
  const outcome = execution.outcome;
  const operation = execution.completionOperation;
  if (
    outcome !== undefined &&
    operation !== undefined &&
    (await schedulerManifestAlreadyStands(client, execution, offered))
  ) {
    return { terminalized: "AlreadyTerminal", outcome, operation };
  }
  return {
    terminalized: "Conflicting",
    incident: await schedulerRecordIncident(
      client,
      execution.partition,
      "ConflictingResult",
      schedulerEvidence.ConflictingResult,
      { execution: execution.execution, attempt: offered.binding.attempt },
    ),
  };
}

/** Whether the attempt named is still the current unfenced reporter at the claimed generation. */
async function schedulerReporterIsCurrent(
  client: pg.PoolClient,
  report: AttemptReport,
): Promise<boolean> {
  const found = await client.query(
    `SELECT 1 FROM execution_attempt
      WHERE tenant = $1 AND project = $2 AND execution = $3 AND attempt = $4
        AND generation = $5 AND state IN ('Placing', 'Running')`,
    [
      report.partition.tenant,
      report.partition.project,
      report.execution,
      report.attempt,
      report.generation,
    ],
  );
  return found.rows.length === 1;
}

/** Whether the sealed manifest is bound to exactly the attempt that is reporting it. */
function schedulerManifestBinds(report: AttemptReport): boolean {
  const binding = report.manifest.binding;
  return (
    binding.partition.tenant === report.partition.tenant &&
    binding.partition.project === report.partition.project &&
    binding.execution === report.execution &&
    binding.attempt === report.attempt
  );
}

/** Ends the reporting attempt, which is the last thing it is permitted to do. */
async function schedulerReporterReported(
  client: pg.PoolClient,
  report: AttemptReport,
): Promise<void> {
  await client.query(
    `UPDATE execution_attempt
        SET state = 'Reported', ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE tenant = $1 AND project = $2 AND execution = $3 AND attempt = $4
        AND generation = $5 AND state IN ('Placing', 'Running')`,
    [
      report.partition.tenant,
      report.partition.project,
      report.execution,
      report.attempt,
      report.generation,
    ],
  );
}

/** Retains the manifest and submits the completion it settles, in the transaction already open. */
async function schedulerSettle(
  client: pg.PoolClient,
  execution: LogicalExecution,
  manifest: ResultManifest,
): Promise<Terminalized> {
  const ordinal = await schedulerManifestOrdinal(client, execution.partition);
  await schedulerWriteManifest(client, manifest, ordinal);
  const outcome = schedulerOutcomeOf(manifest);
  const submitted = await schedulerSubmit(
    client,
    execution,
    outcome,
    { id: manifest.manifest, digest: manifest.digest },
    undefined,
  );
  return schedulerTerminalized(client, execution, outcome, submitted);
}

/** The state a registration is in before any terminal work is attempted against it. */
type TerminalStanding =
  | { readonly standing: "Open"; readonly execution: LogicalExecution }
  | { readonly standing: "Settled"; readonly execution: LogicalExecution }
  | { readonly standing: "Retired" };

/** Locks the registration and the project, and says whether either has already ended this. */
async function schedulerTerminalStanding(
  client: pg.PoolClient,
  partition: Partition,
  execution: ExecutionId,
): Promise<TerminalStanding> {
  const found = await schedulerLockExecution(client, partition, execution);
  if (found === undefined) {
    throw new Error(
      `postgres scheduler: ${partition.tenant}/${partition.project} has no execution ${execution} to settle`,
    );
  }
  if (found.status === "Cancelled") return { standing: "Retired" };
  if (found.status === "Terminal") {
    return { standing: "Settled", execution: found };
  }
  return (await schedulerProjectAdmits(client, partition))
    ? { standing: "Open", execution: found }
    : { standing: "Retired" };
}

/** Settles one logical task from a verified report, or says which absorption applied instead. */
export async function schedulerTerminalize(
  client: pg.PoolClient,
  report: AttemptReport,
): Promise<Terminalized> {
  const standing = await schedulerTerminalStanding(
    client,
    report.partition,
    report.execution,
  );
  switch (standing.standing) {
    case "Retired":
      return { terminalized: "Cancelled" };
    case "Settled":
      return schedulerAbsorb(client, standing.execution, report.manifest);
    case "Open":
      break;
    default:
      return assertNever(standing);
  }
  if (!schedulerManifestBinds(report)) {
    return {
      terminalized: "Conflicting",
      incident: await schedulerRecordIncident(
        client,
        report.partition,
        "CrossProjectReference",
        schedulerEvidence.ForeignManifest,
        { execution: report.execution, attempt: report.attempt },
      ),
    };
  }
  if (!(await schedulerReporterIsCurrent(client, report))) {
    return { terminalized: "Fenced" };
  }
  await schedulerReporterReported(client, report);
  return schedulerSettle(client, standing.execution, report.manifest);
}

/** The highest-numbered attempt that was not fenced, which is what an exhausted budget leaves. */
async function schedulerLastReporter(
  client: pg.PoolClient,
  execution: LogicalExecution,
): Promise<string | undefined> {
  const found = await client.query<{ attempt: string }>(
    `SELECT attempt FROM execution_attempt
      WHERE tenant = $1 AND project = $2 AND execution = $3
        AND state <> 'Superseded'
      ORDER BY attempt_number DESC LIMIT 1`,
    [
      execution.partition.tenant,
      execution.partition.project,
      execution.execution,
    ],
  );
  return found.rows[0]?.attempt;
}

/** The explicit empty manifest an exhausted budget settles under, sealed like any other. */
function schedulerEmptyManifest(
  execution: LogicalExecution,
  attempt: string,
): ResultManifest {
  const accepted = acceptResultManifest(
    {
      partition: execution.partition,
      execution: execution.execution,
      attempt: asAttemptId(attempt),
    },
    asResultManifestId(`manifest-${randomUUID()}`),
    exhaustedManifestText,
    (canonical) => createHash("sha256").update(canonical).digest("hex"),
  );
  if (accepted.accepted === "Rejected") {
    throw new Error(
      `postgres scheduler: the empty manifest this adapter composes was refused as ${accepted.code}`,
    );
  }
  return accepted.manifest;
}

/** Settles one logical task whose safe retry budget is spent as a single failed completion. */
export async function schedulerRetriesExhausted(
  client: pg.PoolClient,
  partition: Partition,
  execution: ExecutionId,
): Promise<Terminalized> {
  const standing = await schedulerTerminalStanding(
    client,
    partition,
    execution,
  );
  switch (standing.standing) {
    case "Retired":
      return { terminalized: "Cancelled" };
    case "Settled":
      return schedulerSettledAlready(standing.execution);
    case "Open":
      break;
    default:
      return assertNever(standing);
  }
  const reporter = await schedulerLastReporter(client, standing.execution);
  if (reporter === undefined) {
    return {
      terminalized: "Conflicting",
      incident: await schedulerRecordIncident(
        client,
        partition,
        "ImpossibleState",
        schedulerEvidence.NoReporter,
        { execution },
      ),
    };
  }
  return schedulerSettle(
    client,
    standing.execution,
    schedulerEmptyManifest(standing.execution, reporter),
  );
}

/** What a settled registration already says, for a caller that offered no manifest to compare. */
function schedulerSettledAlready(execution: LogicalExecution): Terminalized {
  const outcome = execution.outcome;
  const operation = execution.completionOperation;
  if (outcome === undefined || operation === undefined) {
    throw new Error(
      `postgres scheduler: execution ${execution.execution} is terminal and names no outcome`,
    );
  }
  return { terminalized: "AlreadyTerminal", outcome, operation };
}

/** Retires one registration that definitively cannot run, releasing its slot as it settles. */
export async function schedulerBlockExecution(
  client: pg.PoolClient,
  partition: Partition,
  execution: ExecutionId,
  reason: BlockedReason,
): Promise<Blocked> {
  const standing = await schedulerTerminalStanding(
    client,
    partition,
    execution,
  );
  switch (standing.standing) {
    case "Retired":
      return { blocked: "Cancelled" };
    case "Settled":
      return schedulerBlockedAlready(standing.execution);
    case "Open":
      break;
    default:
      return assertNever(standing);
  }
  const submitted = await schedulerSubmit(
    client,
    standing.execution,
    "Blocked",
    undefined,
    reason,
  );
  const settled = await schedulerTerminalized(
    client,
    standing.execution,
    "Blocked",
    submitted,
  );
  return settled.terminalized === "Terminalized" ||
    settled.terminalized === "AlreadyTerminal"
    ? { blocked: "Blocked", operation: settled.operation }
    : { blocked: "Cancelled" };
}

/** What a settled registration says to a second denial under the same ticket. */
function schedulerBlockedAlready(execution: LogicalExecution): Blocked {
  const settled = schedulerSettledAlready(execution);
  if (settled.terminalized !== "AlreadyTerminal") {
    throw new Error(
      `postgres scheduler: execution ${execution.execution} settled without an outcome`,
    );
  }
  return settled.outcome === "Blocked"
    ? { blocked: "AlreadyBlocked", operation: settled.operation }
    : { blocked: "AlreadyTerminal", outcome: settled.outcome };
}
