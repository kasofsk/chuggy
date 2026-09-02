/**
 * The terminal half of the durable execution scheduler: the one indivisible
 * transaction that pins a verified result, records the terminal outcome,
 * releases the slot and submits the completion.
 *
 * IT REACHES THE MAILBOX THROUGH `submit_task_completion` AND NO OTHER DOOR.
 * The scheduler role holds no privilege at all on `operation`,
 * `decision_input`, `journal_entry` or `ticket_projection`, so there is no
 * direct insert here to be tempted by: the function is the authenticated
 * ingress issue #180 requires, and granting
 * execute on it to one workload identity is how that rule is enforced rather
 * than an exception to it. Everything the envelope says is built by the
 * function from durable rows; what this file passes is the binding it claims to
 * hold, which the function validates and may refuse.
 *
 * ONE TRANSACTION, NOT THREE. The manifest, the outcome, the released slot and
 * the completion operation commit together or not at all, so the crash window
 * between holding a verified result and telling anyone about it does not exist
 * — a recovery query for it would be an integrity check that must return
 * nothing. Its rows are taken in `./scheduler.ts`'s order — the authorizing
 * request, the execution, the project, the attempt — and the completion
 * boundary takes the execution and then the project inside that, so neither the
 * function nor a concurrent cancellation can deadlock against it.
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

import { sql } from "@ts-safeql/sql-tag";
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
import { executionRowLogical, type ExecutionRow } from "./schedulerRows.ts";
import { schedulerRole } from "./schema.ts";

/** The report a manifest a worker never produced is composed from. */
const exhaustedManifestText = JSON.stringify({
  version: resultManifestSchemaVersion,
  verdict: "Fail",
  report:
    "The safe retry budget was exhausted before a worker reported a result.",
  handoffs: [],
  diagnostics: [],
  source: null,
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
  TooManyTasks:
    "a registration declares more tasks than one request may materialize",
  NoReporter: "an exhausted execution has no attempt that could have reported",
  RefusedBinding:
    "the completion boundary refused a binding built from its own rows",
  ForeignManifest:
    "a manifest is bound to an execution other than the one reporting it",
} as const;

/**
 * What the completion boundary answered. Every column of a set-returning
 * function is nullable to the query checker, so the verdict admits a null; a
 * null is no verdict this file recognizes and takes the refused-binding arm.
 */
interface CompletionRow {
  readonly result: string | null;
  readonly operation: string | null;
}

/** Locks one registration and reads what it and the request that authorized it say. */
export async function schedulerLockExecution(
  client: pg.PoolClient,
  partition: Partition,
  execution: ExecutionId,
): Promise<LogicalExecution | undefined> {
  const found = await client.query<ExecutionRow>(
    sql`SELECT
          e.tenant, e.project, e.execution, e.ticket::text AS ticket,
          e.task::text AS task, t.kind AS task_kind, t.stage::text AS stage,
          e.source_request, q.input_bundle, q.input_bundle_digest,
          q.authorizing_seq::text AS source_seq,
          q.effect_position::text AS source_effect,
          q.ticket_version::text AS ticket_version, e.account, e.cluster,
          e.configuration_revision, e.configuration_digest,
          c.canonical AS configuration_canonical, e.requirement_identity,
          e.requirement_value::text AS requirement_value, e.requirement_digest, e.requirement_source,
          e.platform_default_version::text AS platform_default_version, e.status, e.outcome,
          e.result_manifest, e.completion_operation,
          (e.attempt_next - 1)::text AS attempts_opened,
          e.retries_spent::text AS retries_spent
        FROM execution e
        JOIN execution_request q
          ON q.tenant = e.tenant AND q.project = e.project
         AND q.request = e.source_request
        JOIN execution_request_task t
          ON t.tenant = e.tenant AND t.project = e.project
         AND t.request = e.source_request AND t.task = e.task
        JOIN configuration_revision c
          ON c.tenant = e.tenant AND c.project = e.project
         AND c.revision = e.configuration_revision AND c.digest = e.configuration_digest
        WHERE e.tenant = ${partition.tenant} AND e.project = ${partition.project}
          AND e.execution = ${execution}
        FOR UPDATE OF e`,
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
    sql`SELECT lifecycle FROM project
         WHERE tenant = ${partition.tenant} AND project = ${partition.project}
         FOR UPDATE`,
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
    sql`INSERT INTO scheduler_incident
         (tenant, project, incident, kind, execution, attempt, evidence)
       VALUES (${partition.tenant},${partition.project},${incident},${kind},
               ${subject.execution ?? null},${subject.attempt ?? null},
               ${evidence})`,
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
    sql`UPDATE execution_request q SET state = 'Fulfilled'
         WHERE q.tenant = ${partition.tenant} AND q.project = ${partition.project}
           AND q.request = ${request}
           AND q.state = 'Registered'
           AND NOT EXISTS (SELECT 1 FROM execution e
                            WHERE e.tenant = q.tenant AND e.project = q.project
                              AND e.source_request = q.request
                              AND e.status NOT IN ('Terminal', 'Cancelled'))`,
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
  const operation = `completion-${randomUUID()}`;
  const submitted = await client.query<CompletionRow>(
    sql`SELECT result, operation FROM submit_task_completion(
          ${execution.partition.tenant},${execution.partition.project},
          ${execution.execution},${execution.ticket},${execution.task},
          ${execution.sourceEffect},${outcome},${manifest?.id ?? null},
          ${manifest?.digest ?? null},${reason ?? null},${operation},
          ${schedulerRole})`,
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
  const taken = await client.query<{ ordinal: string | null }>(
    sql`UPDATE project SET manifest_next = manifest_next + 1
         WHERE tenant = ${partition.tenant} AND project = ${partition.project}
         RETURNING (manifest_next - 1)::text AS ordinal`,
  );
  const ordinal = taken.rows[0]?.ordinal;
  if (ordinal === undefined || ordinal === null) {
    throw new Error(
      `postgres scheduler: ${partition.tenant}/${partition.project} handed out no manifest ordinal`,
    );
  }
  return ordinal;
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
      sql`INSERT INTO execution_result_artifact
           (tenant, project, manifest, ordinal, role, path, digest, bytes)
         VALUES (${manifest.binding.partition.tenant},
                 ${manifest.binding.partition.project},${manifest.manifest},
                 ${ordinal},${role},${artifact.path},${artifact.digest},
                 ${artifact.bytes})`,
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
    sql`INSERT INTO execution_result
         (tenant, project, manifest, execution, attempt, manifest_ordinal,
          schema_version, digest, verdict)
       VALUES (${manifest.binding.partition.tenant},
               ${manifest.binding.partition.project},${manifest.manifest},
               ${manifest.binding.execution},${manifest.binding.attempt},
               ${ordinal}::bigint,${manifest.schemaVersion},${manifest.digest},
               ${manifest.verdict})`,
  );
  if (manifest.report !== undefined) {
    await client.query(
      sql`INSERT INTO execution_result_report(tenant,project,manifest,report)
          VALUES (${manifest.binding.partition.tenant},${manifest.binding.partition.project},
                  ${manifest.manifest},${manifest.report})`,
    );
  }
  if (manifest.source !== undefined) {
    await client.query(
      sql`INSERT INTO execution_result_source
           (tenant,project,manifest,repository,ref,commit,base,expected_base)
         SELECT e.tenant,e.project,${manifest.manifest},${manifest.source.repository},
                ${manifest.source.ref},${manifest.source.commit},${manifest.source.base},
                b.reference_id
           FROM execution e
           JOIN execution_request q
             ON q.tenant=e.tenant AND q.project=e.project AND q.request=e.source_request
           JOIN input_bundle_reference b
             ON b.tenant=q.tenant AND b.project=q.project AND b.bundle=q.input_bundle
                AND b.reference_kind='TargetCommit'
          WHERE e.tenant=${manifest.binding.partition.tenant}
            AND e.project=${manifest.binding.partition.project}
            AND e.execution=${manifest.binding.execution}`,
    );
  }
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
    sql`SELECT digest FROM execution_result
         WHERE tenant = ${execution.partition.tenant}
           AND project = ${execution.partition.project}
           AND manifest = ${execution.resultManifest}`,
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

/**
 * Ends the reporting attempt, which is the last thing it is permitted to do,
 * and says whether it was still entitled to. The move is the whole of the fence:
 * asking first and moving after would be two answers to one question, and the
 * one the answer was read from is not the one the row is written under.
 */
async function schedulerReporterReported(
  client: pg.PoolClient,
  report: AttemptReport,
): Promise<boolean> {
  const reported = await client.query(
    sql`UPDATE execution_attempt
           SET state = 'Reported', ended_at = now(),
               lease_owner = NULL, lease_expires_at = NULL
         WHERE tenant = ${report.partition.tenant}
           AND project = ${report.partition.project}
           AND execution = ${report.execution} AND attempt = ${report.attempt}
           AND generation = ${report.generation}
           AND state IN ('Placing', 'Running')`,
  );
  return reported.rowCount === 1;
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

/**
 * The state a registration is in before any terminal work is attempted against
 * it. `Retired` is this task's own end and `NotAdmitted` the project's, which
 * the completion boundary distinguishes and so does every caller here.
 */
type TerminalStanding =
  | { readonly standing: "Open"; readonly execution: LogicalExecution }
  | { readonly standing: "Settled"; readonly execution: LogicalExecution }
  | { readonly standing: "Retired" }
  | { readonly standing: "NotAdmitted" };

/**
 * Locks the request that authorized this registration, which the settlement
 * fulfills once every task under it has ended. It is taken before the
 * registration itself because a cancellation takes its ticket's requests before
 * the registrations under them, and two transactions taking one pair of rows in
 * two orders is the deadlock neither of them can see coming.
 */
async function schedulerLockSourceRequest(
  client: pg.PoolClient,
  partition: Partition,
  execution: ExecutionId,
): Promise<void> {
  await client.query<{ request: string }>(
    sql`SELECT q.request FROM execution_request q
          JOIN execution e ON e.tenant = q.tenant AND e.project = q.project
                          AND e.source_request = q.request
         WHERE e.tenant = ${partition.tenant} AND e.project = ${partition.project}
           AND e.execution = ${execution}
         FOR UPDATE OF q`,
  );
}

/** Locks the registration and the project, and says whether either has already ended this. */
async function schedulerTerminalStanding(
  client: pg.PoolClient,
  partition: Partition,
  execution: ExecutionId,
): Promise<TerminalStanding> {
  await schedulerLockSourceRequest(client, partition, execution);
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
    : { standing: "NotAdmitted" };
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
    case "NotAdmitted":
      return { terminalized: "NotAdmitted" };
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
  if (!(await schedulerReporterReported(client, report))) {
    return { terminalized: "Fenced" };
  }
  return schedulerSettle(client, standing.execution, report.manifest);
}

/** The highest-numbered attempt that was not fenced, which is what an exhausted budget leaves. */
async function schedulerLastReporter(
  client: pg.PoolClient,
  execution: LogicalExecution,
): Promise<string | undefined> {
  const found = await client.query<{ attempt: string }>(
    sql`SELECT attempt FROM execution_attempt
         WHERE tenant = ${execution.partition.tenant}
           AND project = ${execution.partition.project}
           AND execution = ${execution.execution}
           AND state <> 'Superseded'
         ORDER BY attempt_number DESC LIMIT 1`,
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
    case "NotAdmitted":
      return { terminalized: "NotAdmitted" };
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
    case "NotAdmitted":
      return { blocked: "NotAdmitted" };
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
  if (
    settled.terminalized === "Terminalized" ||
    settled.terminalized === "AlreadyTerminal"
  ) {
    return { blocked: "Blocked", operation: settled.operation };
  }
  if (settled.terminalized === "Conflicting") {
    return { blocked: "Conflicting", incident: settled.incident };
  }
  throw new Error(
    `postgres scheduler: blocking execution ${execution} under a locked open row answered ${settled.terminalized}`,
  );
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
