/**
 * Discovery: the readiness rows a fleet reads, the decision inputs an activation
 * verifies against, and the clearing an idle owner is allowed to do.
 *
 * DISCOVERY READS READINESS AND NOTHING ELSE. issue #180
 * limits fleet discovery to durable project-readiness metadata, never another
 * project's journal or ticket contents — so the query here selects a partition
 * key and a generation, and any replica may act on the result without having
 * read a row it does not own.
 *
 * READINESS IS AN INDEX AND THE INBOX IS THE AUTHORITY. A ready project whose
 * items were all consumed costs one wasted activation; an unready project
 * holding a consumable item is work nobody finds. That asymmetry is why
 * clearing has to prove the inbox empty and why a repair scan is optional
 * rather than load-bearing.
 *
 * A SUBMISSION IS FENCED BEFORE A SEMANTIC EVENT IS BUILT. A native-action
 * resolution and a finalization result each name a durable row that authorized
 * them, so the source for one is assembled from that row rather than from the
 * command's own claims, and a row that has settled, whose generation has moved
 * or whose epoch a restore superseded is carried closed for the writer to
 * refuse.
 *
 * AN APPROVAL ANSWER RESOLVES TO NO EVENT. `Approve` and `Decline` name no
 * domain command, so the source built for one carries the answer and no
 * `resolvedEvent`, and the join onto the offered resolutions is what proves the
 * action asked that question rather than the other one.
 *
 * NO WAKE-UP IS ERASED, AND THE READINESS ROW LOCK IS WHAT ORDERS THE TWO
 * TRANSACTIONS. An acceptance writes its decision input and its readiness upsert
 * together, so either it commits before the clearing takes that lock — leaving
 * a raised generation and a visible item for the checks below to refuse on — or
 * it has not reached the upsert and blocks there. In that second branch the
 * emptiness proof correctly finds nothing consumable and the clear commits;
 * what keeps the wake-up is the blocked upsert raising `ready` again behind it.
 * There is no third position, because an item invisible to the proof is an
 * uncommitted one whose transaction has still to pass through that lock.
 *
 * THE GENERATION IS FOR THE OBSERVATION TAKEN OUTSIDE THAT TRANSACTION. An
 * owner clears against a readiness it read at some earlier moment, and the
 * generation is what refuses a clear whose evidence predates an acceptance —
 * including the case where everything accepted since was cancelled and the
 * inbox really is empty again, where clearing would in fact have been correct.
 * That refusal is conservative and costs one retry, which is why both checks
 * stay: each is independently red on deletion.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  asOperationId,
  allPriorityClasses,
  type PriorityClass,
} from "../../interpreter/operationInbox.ts";
import type {
  DecisionInput,
  Readiness,
  ReadinessCleared,
} from "../../interpreter/projectDiscovery.ts";
import { parseStoredTicketCommand } from "../../interpreter/wire.ts";
import {
  isApprovalResolution,
  type FinalizationSubmission,
  type TicketCommand,
} from "../../interpreter/ticketCommand.ts";
import { parseDraftAuthoring } from "../../interpreter/authoring.ts";
import { asBriefFinalization } from "../../interpreter/ticketBrief.ts";
import {
  allInputBundleReferenceKinds,
  asFinalizationAttemptId,
  asGitObjectId,
  inputBundleReferencesMax,
} from "../../interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  type FinalizationEvidence,
} from "../../interpreter/finalizerPreparation.ts";
import { finalizerRowValue } from "./finalizerRows.ts";
import {
  finalizationResultEvent,
  releaseTicketEvent,
} from "../../actor/decisionEvent.ts";
import { asTicketId } from "../../domain/ids.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import {
  observe,
  silentTicketServiceMetrics,
  type TicketServiceMetrics,
} from "../../interpreter/ticketService.ts";

/** One readiness row as PostgreSQL returns it. */
interface ReadinessRow {
  readonly tenant: string;
  readonly project: string;
  readonly generation: string;
}

/** One inbox row as PostgreSQL returns it, with the command its operation carries. */
interface InboxRow {
  readonly ordinal: string;
  readonly input_kind: string;
  readonly input_id: string;
  readonly base_priority: string;
  readonly command: string | null;
  readonly continuation_kind: string | null;
  readonly ticket: string | null;
  readonly expected_ticket_version: string | null;
  readonly expected_phase: string | null;
  readonly task_set_generation: string | null;
}

function priorityOf(value: string): PriorityClass {
  const found = allPriorityClasses.find((candidate) => candidate === value);
  if (found === undefined)
    throw new Error(`decision input: unknown priority ${value}`);
  return found;
}

async function releaseDraftSource(
  pool: pg.Pool,
  partition: Partition,
  operation: string,
  command: Extract<TicketCommand, { readonly command: "ReleaseDraft" }>,
): Promise<DecisionInput["source"]> {
  const revision = await pool.query<{
    authoring: string;
    digest: string;
    canonical: string;
    finalization_mode: string | null;
    finalization_target: string | null;
  }>(
    sql`SELECT r.authoring,c.digest,c.canonical,
           b.finalization_mode,b.finalization_target
      FROM draft_revision r
       JOIN configuration_revision c
         ON c.tenant=r.tenant AND c.project=r.project
        AND c.revision=r.configuration_revision
       LEFT JOIN draft_brief b
         ON b.tenant=r.tenant AND b.project=r.project AND b.ticket=r.ticket
      WHERE r.tenant=${partition.tenant} AND r.project=${partition.project}
        AND r.ticket=${command.ticket}
        AND r.authoring_version=${command.authoringVersion}
        AND r.configuration_revision=${command.configurationRevision}`,
  );
  const found = revision.rows[0];
  if (found === undefined)
    throw new Error(
      `release draft ${String(command.ticket)} has no retained revision`,
    );
  return {
    kind: "Operation",
    operation: asOperationId(operation),
    command,
    resolvedEvent: releaseTicketEvent(
      asTicketId(command.ticket),
      parseDraftAuthoring(found.authoring),
    ),
    draftRelease: {
      ticket: command.ticket,
      authoringVersion: command.authoringVersion,
      configurationRevision: command.configurationRevision,
      configurationDigest: found.digest,
      configurationCanonical: found.canonical,
      ...(found.finalization_mode === null
        ? {}
        : {
            briefFinalization: asBriefFinalization({
              mode: found.finalization_mode,
              ...(found.finalization_target === null
                ? {}
                : { target: found.finalization_target }),
            }),
          }),
    },
  };
}

/** One failed attempt's row, with the bundle the preparation it belongs to pinned. */
interface FinalizationAttemptRow {
  readonly attempt_digest: string;
  readonly target_commit: string;
  readonly conflict_manifest: string | null;
  readonly conflict_manifest_digest: string | null;
  readonly input_bundle: string;
  readonly repository: string;
  readonly candidate_commit: string | null;
  readonly configuration_revision: string;
  readonly configuration_digest: string;
}

/**
 * The immutable evidence a failed result concluded on, read from the attempt
 * the submission pinned rather than from the request's latest one. A succeeded
 * result spawns no work, so nothing is gathered for one.
 */
async function finalizationEvidenceOf(
  pool: pg.Pool,
  partition: Partition,
  command: FinalizationSubmission,
): Promise<FinalizationEvidence | undefined> {
  if (command.outcome !== "FinalizationFailed") return undefined;
  const found = await pool.query<FinalizationAttemptRow>(
    sql`SELECT a.attempt_digest, a.target_commit, a.conflict_manifest,
            a.conflict_manifest_digest, a.input_bundle, a.repository,
            a.candidate_commit, a.configuration_revision, a.configuration_digest
       FROM finalization_attempt a
      WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
        AND a.attempt=${command.attempt} AND a.request=${command.request}`,
  );
  const attempt = found.rows[0];
  if (attempt === undefined)
    throw new Error(
      `finalization attempt ${command.attempt} does not answer this request`,
    );
  const pinned = await pool.query<{
    reference_kind: string;
    reference_id: string;
    reference_digest: string | null;
  }>(
    sql`SELECT reference_kind, reference_id, reference_digest
       FROM input_bundle_reference
      WHERE tenant=${partition.tenant} AND project=${partition.project}
        AND bundle=${attempt.input_bundle}
      ORDER BY ordinal LIMIT ${inputBundleReferencesMax}`,
  );
  return {
    attempt: asFinalizationAttemptId(command.attempt),
    attemptDigest: attempt.attempt_digest,
    targetCommit: asGitObjectId(attempt.target_commit),
    ...(attempt.conflict_manifest === null
      ? {}
      : { conflictManifest: asProjectArtifactId(attempt.conflict_manifest) }),
    ...(attempt.conflict_manifest_digest === null
      ? {}
      : { conflictManifestDigest: attempt.conflict_manifest_digest }),
    preparation: pinned.rows.map((row) => ({
      kind: finalizerRowValue(
        allInputBundleReferenceKinds,
        row.reference_kind,
        "bundle reference kind",
      ),
      reference: row.reference_id,
      ...(row.reference_digest === null
        ? {}
        : { digest: row.reference_digest }),
    })),
  };
}

/**
 * The `RunFinalizer` request a submitted result claims to answer, and whether it
 * is still the request that authorizes it. A result whose request has settled,
 * whose generation has moved or whose epoch a restore superseded is carried
 * closed, and the writer refuses it at its serialized position.
 */
async function finalizationRequestSource(
  pool: pg.Pool,
  partition: Partition,
  operation: string,
  command: FinalizationSubmission,
): Promise<DecisionInput["source"]> {
  const found = await pool.query<{
    ticket: string;
    state: string;
    request_generation: string;
    epoch_is_current: boolean | null;
  }>(
    sql`SELECT f.ticket::text, f.state, f.request_generation::text,
            (${command.recoveryEpoch} = (SELECT e.epoch FROM recovery_epoch e
                    ORDER BY e.ordinal DESC LIMIT 1)) AS epoch_is_current
       FROM finalization_request f
      WHERE f.tenant=${partition.tenant} AND f.project=${partition.project}
        AND f.request=${command.request}`,
  );
  const request = found.rows[0];
  if (request === undefined)
    throw new Error(
      `finalization request ${command.request} does not authorize this result`,
    );
  const ticket = projectRowCounter(request.ticket, "finalization ticket");
  const evidence = await finalizationEvidenceOf(pool, partition, command);
  const acceptedPromotion =
    command.outcome === "PromotionAccepted"
      ? await finalizationAcceptedPromotion(pool, partition, command)
      : undefined;
  return {
    kind: "Operation",
    operation: asOperationId(operation),
    command,
    resolvedEvent: finalizationResultEvent(asTicketId(ticket), command.outcome),
    finalizationRequest: {
      request: command.request,
      requestGeneration: command.requestGeneration,
      open:
        request.epoch_is_current === true &&
        (request.state === "Open" || request.state === "Registered") &&
        projectRowCounter(
          request.request_generation,
          "finalization request generation",
        ) === command.requestGeneration,
      ...(evidence === undefined ? {} : { evidence }),
      ...(acceptedPromotion === undefined ? {} : { acceptedPromotion }),
    },
  };
}

async function finalizationAcceptedPromotion(
  pool: pg.Pool,
  partition: Partition,
  command: FinalizationSubmission,
): Promise<
  NonNullable<
    Extract<
      DecisionInput["source"],
      { readonly kind: "Operation" }
    >["finalizationRequest"]
  >["acceptedPromotion"]
> {
  const found = await pool.query<FinalizationAttemptRow>(
    sql`SELECT a.attempt_digest, a.target_commit, a.conflict_manifest,
            a.conflict_manifest_digest, a.input_bundle, a.repository,
            a.candidate_commit, a.configuration_revision, a.configuration_digest
       FROM finalization_attempt a
      WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
        AND a.attempt=${command.attempt} AND a.request=${command.request}`,
  );
  const attempt = found.rows[0];
  if (
    attempt?.candidate_commit === null ||
    attempt?.candidate_commit === undefined
  )
    throw new Error("accepted promotion has no immutable candidate");
  return {
    repository: attempt.repository,
    commit: attempt.candidate_commit,
    configurationRevision: attempt.configuration_revision,
    configurationDigest: attempt.configuration_digest,
  };
}

async function nativeActionSource(
  pool: pg.Pool,
  partition: Partition,
  operation: string,
  command: Extract<TicketCommand, { readonly command: "ResolveNativeAction" }>,
): Promise<DecisionInput["source"]> {
  const action = await pool.query<{ ticket: string; state: string }>(
    sql`SELECT a.ticket::text, a.state FROM native_action a
      JOIN native_action_resolution r USING (tenant, project, action)
     WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
       AND a.action=${command.action}
       AND a.authorizing_seq=${command.authorizingSeq}
       AND r.resolution=${String(command.resolution)}`,
  );
  const open = action.rows[0];
  if (open === undefined)
    throw new Error(
      `native action ${command.action} is not open at the requested fence`,
    );
  const ticket = projectRowCounter(open.ticket, "native action ticket");
  const answered = {
    kind: "Operation" as const,
    operation: asOperationId(operation),
    command,
    nativeAction: {
      action: command.action,
      authorizingSeq: command.authorizingSeq,
      resolution: command.resolution,
      open: open.state === "Open",
    },
  };
  if (isApprovalResolution(command.resolution)) return answered;
  return {
    ...answered,
    resolvedEvent:
      command.resolution === "Resume" || command.resolution === "RetryHandoff"
        ? { type: "ResumeTicket", value: ticket }
        : command.resolution === "AbandonHandoff"
          ? { type: "AbandonHandoff", value: ticket }
          : { type: "Revoke", value: ticket },
  };
}

async function operationSource(
  pool: pg.Pool,
  partition: Partition,
  row: InboxRow,
): Promise<DecisionInput["source"]> {
  if (row.command === null)
    throw new Error(`operation ${row.input_id} has no command`);
  const parsed = parseStoredTicketCommand(row.command);
  if (parsed.parsed === "Refused")
    throw new Error(`stored operation is unreadable: ${parsed.why}`);
  const command = parsed.value;
  if (command.command === "SubmitFinalizationResult") {
    return finalizationRequestSource(pool, partition, row.input_id, command);
  }
  if (command.command === "Decide") {
    /**
     * A completion reaches here with no join because `accept_operation` answers
     * `InvalidCommand` for its tag, which leaves `submit_task_completion` the
     * only writer of one — and that builds the event from the execution, request
     * and result rows it locked and checked the binding against. Every other
     * `Decide` is a public command, whose event is the whole of what its
     * principal offered.
     */
    return {
      kind: "Operation",
      operation: asOperationId(row.input_id),
      command,
      resolvedEvent: command.event,
    };
  }
  if (command.command === "ReleaseDraft") {
    return releaseDraftSource(pool, partition, row.input_id, command);
  }
  if (
    command.command === "ManualDispatch" ||
    command.command === "ProposeDispatch"
  ) {
    return {
      kind: "Operation",
      operation: asOperationId(row.input_id),
      command,
      resolvedEvent: { type: "Dispatch", value: command.ticket },
    };
  }
  return nativeActionSource(pool, partition, row.input_id, command);
}

function continuationSource(row: InboxRow): DecisionInput["source"] {
  if (
    row.continuation_kind === null ||
    row.ticket === null ||
    row.expected_ticket_version === null ||
    row.expected_phase === null ||
    row.task_set_generation === null
  ) {
    throw new Error(`continuation ${row.input_id} has incomplete fences`);
  }
  const ticket = projectRowCounter(row.ticket, "continuation ticket");
  return {
    kind: "Continuation",
    continuation: row.input_id,
    command:
      row.continuation_kind === "ReduceWork"
        ? { type: "WorkReduce", value: ticket }
        : { type: "EvalReduce", value: ticket },
    expectedTicketVersion: projectRowCounter(
      row.expected_ticket_version,
      "expected ticket version",
    ),
    expectedPhase: row.expected_phase,
    taskSetGeneration: projectRowCounter(
      row.task_set_generation,
      "task-set generation",
    ),
  };
}

/** Refuses a bound a caller left open, because an unbounded page is an unbounded read. */
function readinessBounded(limit: number, what: string): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`${what}: ${String(limit)} is not a positive bound`);
  }
  return limit;
}

/** At most `partitionsMax` projects with work waiting, in a deterministic order that is not a priority. */
export async function postgresReadinessReady(
  pool: pg.Pool,
  partitionsMax: number,
): Promise<readonly Readiness[]> {
  const found = await pool.query<ReadinessRow>(
    sql`SELECT tenant, project, generation FROM project_readiness
      WHERE ready ORDER BY tenant, project
      LIMIT ${readinessBounded(partitionsMax, "ready partitions")}`,
  );
  return found.rows.map((row) => ({
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    generation: projectRowCounter(row.generation, "readiness generation"),
  }));
}

/** At most `itemsMax` consumable items in ordinal order, which is what an activation verifies. */
export async function postgresReadinessConsumable(
  pool: pg.Pool,
  partition: Partition,
  agingIntervalSeconds = 300,
  metrics: TicketServiceMetrics = silentTicketServiceMetrics,
): Promise<DecisionInput | undefined> {
  if (!Number.isFinite(agingIntervalSeconds) || agingIntervalSeconds <= 0) {
    throw new RangeError("aging interval must be positive");
  }
  const found = await pool.query<InboxRow>(
    sql`WITH heads AS (
       SELECT DISTINCT ON (d.base_priority)
         d.ordinal, d.input_kind, d.input_id, d.base_priority, d.created_at
       FROM decision_input d
       WHERE d.tenant=${partition.tenant} AND d.project=${partition.project} AND d.state='Pending'
       ORDER BY d.base_priority, d.ordinal
     )
     SELECT h.ordinal, h.input_kind, h.input_id, h.base_priority,
            o.command, c.kind AS continuation_kind, c.ticket::text,
            c.expected_ticket_version::text, c.expected_phase,
            c.task_set_generation::text
       FROM heads h
       LEFT JOIN operation o ON h.input_kind='Operation' AND o.tenant=${partition.tenant} AND o.project=${partition.project} AND o.operation=h.input_id
       LEFT JOIN project_continuation c ON h.input_kind='Continuation' AND c.tenant=${partition.tenant} AND c.project=${partition.project} AND c.continuation=h.input_id
      ORDER BY greatest(0,
        CASE h.base_priority WHEN 'Safety' THEN 0 WHEN 'Completion' THEN 1 WHEN 'Continuation' THEN 2 ELSE 3 END
        - floor(extract(epoch FROM (statement_timestamp()-h.created_at))/${agingIntervalSeconds})::integer), h.ordinal
      LIMIT 1`,
  );
  const row = found.rows[0];
  const depths = await pool.query<{
    base_priority: string;
    depth: string;
    oldest_seconds: string;
  }>(
    sql`SELECT base_priority, count(*)::text AS depth,
            coalesce(extract(epoch FROM statement_timestamp()-min(created_at)),0)::text AS oldest_seconds
       FROM decision_input
      WHERE tenant=${partition.tenant} AND project=${partition.project} AND state='Pending'
      GROUP BY base_priority`,
  );
  for (const depth of depths.rows) {
    observe(() => {
      metrics.mailbox(
        priorityOf(depth.base_priority),
        Number(depth.depth),
        Number(depth.oldest_seconds),
      );
    });
  }
  if (row === undefined) return undefined;
  const source =
    row.input_kind === "Operation"
      ? await operationSource(pool, partition, row)
      : row.input_kind === "Continuation"
        ? continuationSource(row)
        : undefined;
  if (source === undefined)
    throw new Error(`decision input ${row.input_id} has unknown kind`);
  return {
    partition,
    ordinal: projectRowCounter(row.ordinal, "inbox ordinal"),
    priority: priorityOf(row.base_priority),
    source,
  };
}

/** Whether the partition still holds an item a writer could consume. */
async function readinessWorkRemains(
  client: pg.PoolClient,
  partition: Partition,
): Promise<boolean> {
  const remaining = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM decision_input
      WHERE tenant = ${partition.tenant} AND project = ${partition.project}
        AND state = 'Pending' LIMIT 1`,
  );
  return remaining.rows.length > 0;
}

/** Clears readiness only at the generation the owner observed and only over an empty inbox. */
export async function postgresReadinessClear(
  pool: pg.Pool,
  readiness: Readiness,
): Promise<ReadinessCleared> {
  return postgresTransaction(pool, async (client) => {
    const locked = await client.query<ReadinessRow>(
      sql`SELECT tenant, project, generation FROM project_readiness
        WHERE tenant = ${readiness.partition.tenant}
          AND project = ${readiness.partition.project} FOR UPDATE`,
    );
    const row = locked.rows[0];
    if (row === undefined) {
      throw new Error(
        `postgres readiness: ${readiness.partition.tenant}/${readiness.partition.project} has never been made ready`,
      );
    }
    const generation = projectRowCounter(
      row.generation,
      "readiness generation",
    );
    if (generation !== readiness.generation) {
      return { cleared: "Superseded", generation };
    }
    if (await readinessWorkRemains(client, readiness.partition)) {
      return { cleared: "WorkRemains" };
    }
    await client.query(
      sql`UPDATE project_readiness SET ready = false
        WHERE tenant = ${readiness.partition.tenant}
          AND project = ${readiness.partition.project}`,
    );
    return { cleared: "Cleared" };
  });
}
