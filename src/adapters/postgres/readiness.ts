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
 * AN INPUT WHOSE DEFERRALS ARE SPENT IS NOT PROMOTED BY AGE. Its next pass
 * either decides it, if its source has become readable, or refuses it, so
 * aging it past the classes above would only put that pass in front of work
 * that can be decided.
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
import { blockedReasons, type BlockedReason } from "../../contract/rosters.ts";
import { parseStoredTicketCommand } from "../../interpreter/wire.ts";
import {
  isApprovalResolution,
  isSchedulerCompletion,
  type ApprovalResolution,
  type FinalizationSubmission,
  type NativeActionResolution,
  type TicketCommand,
} from "../../interpreter/ticketCommand.ts";
import {
  asCanonicalConfiguration,
  draftReleaseReadiness,
  parseDraftAuthoring,
} from "../../interpreter/authoring.ts";
import {
  releasedTicketDefinition,
  ticketDefinitionMaterial,
} from "../../interpreter/ticketDefinition.ts";
import { draftBriefOf } from "./ticketBrief.ts";
import {
  allInputBundleReferenceKinds,
  asFinalizationAttemptId,
  asGitObjectId,
  asRepositoryId,
  inputBundleReferencesMax,
} from "../../interpreter/finalizer.ts";
import {
  asProjectArtifactId,
  type FinalizationEvidence,
} from "../../interpreter/finalizerPreparation.ts";
import { finalizerRowValue } from "./finalizerRows.ts";
import { digestFold } from "../../interpreter/resultManifest.ts";
import {
  finalizationResultEvent,
  releaseTicketEvent,
  type DecisionEvent,
} from "../../actor/decisionEvent.ts";
import { assertNever } from "../../domain/assertNever.ts";
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
  sourceDeferralPassesMax,
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
  /**
   * Which wall the execution this operation settled was blocked at, null for
   * every operation that settled none. `submit_task_completion` writes it to
   * the execution in the transaction that inserts the decision input, so it is
   * durable by the time this read can see the item.
   */
  readonly blocked_reason: string | null;
  readonly deferred_passes: number;
}

function priorityOf(value: string): PriorityClass {
  const found = allPriorityClasses.find((candidate) => candidate === value);
  if (found === undefined)
    throw new Error(`decision input: unknown priority ${value}`);
  return found;
}

/**
 * The wall an execution recorded, narrowed against the roster its own CHECK
 * declares. A value outside it is this layer and the database disagreeing, and
 * it raises rather than becoming evidence no reader can spell.
 */
function inboxBlockedReason(value: string): BlockedReason {
  const wall = blockedReasons.find((candidate) => candidate === value);
  if (wall === undefined)
    throw new Error(`decision input: unknown blocked reason ${value}`);
  return wall;
}

/** The retained revision one release names: its authoring, its configuration and its brief. */
interface ReleaseDraftRow {
  readonly authoring: string;
  readonly digest: string;
  readonly canonical: string;
  readonly provenance_repository: string | null;
  readonly title: string | null;
  readonly intent: string | null;
  readonly branch: string | null;
  readonly finalization_mode: string | null;
  readonly finalization_target: string | null;
  readonly repository: string | null;
  readonly links: string[] | null;
  readonly checks: string[] | null;
}

/** The row one release command names, refusing a command whose revision was not retained. */
async function releaseDraftRow(
  pool: pg.Pool,
  partition: Partition,
  command: Extract<TicketCommand, { readonly command: "ReleaseDraft" }>,
): Promise<ReleaseDraftRow> {
  const revision = await pool.query<ReleaseDraftRow>(
    sql`SELECT r.authoring,c.digest,c.canonical,p.repository AS provenance_repository,
           b.title,b.intent,b.branch,b.finalization_mode,b.finalization_target,b.repository,
           (SELECT array_agg(l.url ORDER BY l.ordinal) FROM draft_brief_link l
             WHERE l.tenant=r.tenant AND l.project=r.project AND l.ticket=r.ticket) AS links,
           (SELECT array_agg(k.command ORDER BY k.ordinal) FROM draft_brief_check k
             WHERE k.tenant=r.tenant AND k.project=r.project AND k.ticket=r.ticket) AS checks
      FROM draft_revision r
       JOIN configuration_revision c
         ON c.tenant=r.tenant AND c.project=r.project
        AND c.revision=r.configuration_revision
       LEFT JOIN repository_configuration_provenance p
         ON p.tenant=c.tenant AND p.project=c.project AND p.revision=c.revision
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
  return found;
}

/**
 * The release's own resolution, from the draft's authoring, the configuration
 * revision the command pinned, the brief as it stands and the provenance the
 * pair is weighed against — resolved HERE AND NOWHERE ELSE, so the material is
 * computed once, carried into the transaction that journals the event, and
 * stored beside it. A pair that contradicts itself resolves nothing and carries
 * no event, because the deciding transaction re-reads the same revision behind
 * the same fence and names the precise fault this refusal only stands in for.
 */
async function releaseDraftSource(
  pool: pg.Pool,
  partition: Partition,
  operation: string,
  command: Extract<TicketCommand, { readonly command: "ReleaseDraft" }>,
): Promise<DecisionInput["source"]> {
  const found = await releaseDraftRow(pool, partition, command);
  const brief = draftBriefOf(found);
  const authoring = parseDraftAuthoring(found.authoring);
  const readiness = draftReleaseReadiness(
    asCanonicalConfiguration(found.canonical),
    brief,
    found.provenance_repository === null
      ? undefined
      : asRepositoryId(found.provenance_repository),
  );
  const material =
    readiness.readiness === "Ready"
      ? ticketDefinitionMaterial({
          authoring,
          configuration: readiness.configuration,
          ...(brief === undefined ? {} : { brief }),
        })
      : undefined;
  return {
    kind: "Operation",
    operation: asOperationId(operation),
    command,
    ...(material === undefined
      ? {}
      : {
          resolvedEvent: releaseTicketEvent(
            releasedTicketDefinition(
              asTicketId(command.ticket),
              authoring,
              material,
            ),
          ),
        }),
    draftRelease: {
      ticket: command.ticket,
      authoringVersion: command.authoringVersion,
      configurationRevision: command.configurationRevision,
      configurationDigest: found.digest,
      configurationCanonical: found.canonical,
      ...(brief === undefined ? {} : { brief }),
      ...(material === undefined ? {} : { definition: material }),
    },
  };
}

/** The attempt a submission concluded on, with the bundle the preparation it belongs to pinned. */
interface FinalizationAttemptRow {
  readonly attempt_digest: string;
  readonly target_commit: string;
  readonly conflict_manifest: string | null;
  readonly conflict_manifest_digest: string | null;
  readonly input_bundle: string;
}

/** The attempt the submission pinned, read rather than the request's latest one. */
async function finalizationAttemptOf(
  pool: pg.Pool,
  partition: Partition,
  command: FinalizationSubmission,
  attempted: string,
): Promise<FinalizationAttemptRow> {
  const found = await pool.query<FinalizationAttemptRow>(
    sql`SELECT a.attempt_digest, a.target_commit, a.conflict_manifest,
            a.conflict_manifest_digest, a.input_bundle
       FROM finalization_attempt a
      WHERE a.tenant=${partition.tenant} AND a.project=${partition.project}
        AND a.attempt=${attempted} AND a.request=${command.request}`,
  );
  const attempt = found.rows[0];
  if (attempt === undefined)
    throw new Error(
      `finalization attempt ${attempted} does not answer this request`,
    );
  return attempt;
}

/**
 * The immutable evidence a failed result concluded on, read from the attempt
 * the submission pinned. The other two outcomes carry none: a success spawns
 * no work for evidence to be about, and an unavailable result reached no
 * attempt to read — what held it is recorded on the request, which is where
 * the desk reads it and not something a decision has to carry.
 */
async function finalizationEvidenceOf(
  pool: pg.Pool,
  partition: Partition,
  attempted: string,
  attempt: FinalizationAttemptRow,
): Promise<FinalizationEvidence> {
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
    attempt: asFinalizationAttemptId(attempted),
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
 * What a finalization result carries as its evidence reference: the fold of
 * the digest of the attempt it settled on, and where it settled on none — a
 * brief that lands nothing, or a finalization that reached no result — the
 * generation of the request it answers, the one positive reference such a
 * result names.
 */
function finalizationResultEvidence(
  command: FinalizationSubmission,
  attempt: FinalizationAttemptRow | undefined,
): number {
  return attempt === undefined
    ? command.requestGeneration
    : digestFold(attempt.attempt_digest);
}

/** The attempt a submission settled on, and what a failed one carries forward. */
async function finalizationSettledOn(
  pool: pg.Pool,
  partition: Partition,
  command: FinalizationSubmission,
): Promise<{
  readonly reference: number;
  readonly evidence?: FinalizationEvidence;
}> {
  const attempted = command.attempt;
  if (attempted === undefined) {
    if (command.outcome === "FinalizationNeedsWork")
      throw new Error(
        `finalization request ${command.request} failed on no attempt`,
      );
    return { reference: finalizationResultEvidence(command, undefined) };
  }
  const attempt = await finalizationAttemptOf(
    pool,
    partition,
    command,
    attempted,
  );
  return {
    reference: finalizationResultEvidence(command, attempt),
    ...(command.outcome === "FinalizationNeedsWork"
      ? {
          evidence: await finalizationEvidenceOf(
            pool,
            partition,
            attempted,
            attempt,
          ),
        }
      : {}),
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
  const settled = await finalizationSettledOn(pool, partition, command);
  const evidence = settled.evidence;
  return {
    kind: "Operation",
    operation: asOperationId(operation),
    command,
    resolvedEvent: finalizationResultEvent(
      asTicketId(ticket),
      command.outcome,
      settled.reference,
    ),
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
    },
  };
}

/**
 * The domain command one answer names, exhaustive over the answers that name
 * one. A resolution added to the roster is a compile error here rather than an
 * answer that silently becomes a revocation.
 */
function nativeActionResolvedEvent(
  resolution: Exclude<NativeActionResolution, ApprovalResolution>,
  ticket: number,
): DecisionEvent {
  switch (resolution) {
    case "Resume":
      return { type: "ResumeTicket", value: ticket };
    case "Revoke":
      return { type: "Revoke", value: ticket };
    default:
      return assertNever(resolution);
  }
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
  const resolution = command.resolution;
  if (isApprovalResolution(resolution)) return answered;
  return {
    ...answered,
    resolvedEvent: nativeActionResolvedEvent(resolution, ticket),
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
    throw new Error(
      `stored operation ${row.input_id} is unreadable: ${parsed.why}`,
    );
  const command = parsed.value;
  if (command.command === "SubmitFinalizationResult") {
    return finalizationRequestSource(pool, partition, row.input_id, command);
  }
  if (isSchedulerCompletion(command)) {
    /**
     * A completion needs no join because `accept_operation` answers
     * `InvalidCommand` for its tag, leaving `submit_task_completion` — which
     * builds the settled fact from rows it locked — the only writer of one.
     * What the join beside it answers is the wall that same function wrote to
     * the execution and left out of the report.
     */
    return {
      kind: "Operation",
      operation: asOperationId(row.input_id),
      command,
      resolvedEvent: command.event,
      ...(row.blocked_reason === null
        ? {}
        : { executionBlockedBy: inboxBlockedReason(row.blocked_reason) }),
    };
  }
  if (command.command === "Decide") {
    /**
     * Every other `Decide` is a public command whose event is what its
     * principal offered, so there is nothing to resolve it against.
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
    /**
     * A dispatch resolves to no event here. The source it carries is read at
     * the remote by the writer, which is the only place that reads one, so the
     * command reaches the writer naming its ticket and nothing else.
     */
    return {
      kind: "Operation",
      operation: asOperationId(row.input_id),
      command,
    };
  }
  return nativeActionSource(pool, partition, row.input_id, command);
}

/** Refuses a bound a caller left open, because an unbounded page is an unbounded read. */
function readinessBounded(limit: number, what: string): number {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`${what}: ${String(limit)} is not a positive bound`);
  }
  return limit;
}

/**
 * At most `partitionsMax` projects with work waiting, in a deterministic order
 * that is not a priority, beginning after `after` when a caller resumes there.
 */
export async function postgresReadinessReady(
  pool: pg.Pool,
  partitionsMax: number,
  after?: Partition,
): Promise<readonly Readiness[]> {
  const limit = readinessBounded(partitionsMax, "ready partitions");
  const found =
    after === undefined
      ? await pool.query<ReadinessRow>(
          sql`SELECT tenant, project, generation FROM project_readiness
            WHERE ready ORDER BY tenant, project
            LIMIT ${limit}`,
        )
      : await pool.query<ReadinessRow>(
          sql`SELECT tenant, project, generation FROM project_readiness
            WHERE ready AND (tenant, project) > (${after.tenant}, ${after.project})
            ORDER BY tenant, project
            LIMIT ${limit}`,
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
         d.ordinal, d.input_kind, d.input_id, d.base_priority, d.created_at,
         d.deferred_passes
       FROM decision_input d
       WHERE d.tenant=${partition.tenant} AND d.project=${partition.project} AND d.state='Pending'
       ORDER BY d.base_priority, d.ordinal
     )
     SELECT h.ordinal, h.input_kind, h.input_id, h.base_priority,
            o.command, x.blocked_reason, h.deferred_passes
       FROM heads h
       LEFT JOIN operation o ON h.input_kind='Operation' AND o.tenant=${partition.tenant} AND o.project=${partition.project} AND o.operation=h.input_id
       LEFT JOIN execution x ON h.input_kind='Operation' AND x.tenant=${partition.tenant} AND x.project=${partition.project} AND x.completion_operation=h.input_id
      ORDER BY greatest(0,
        CASE h.base_priority WHEN 'Safety' THEN 0 WHEN 'Completion' THEN 1 ELSE 3 END
        - CASE WHEN h.deferred_passes >= ${sourceDeferralPassesMax} THEN 0
               ELSE floor(extract(epoch FROM (statement_timestamp()-h.created_at))/${agingIntervalSeconds})::integer END), h.ordinal
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
  if (row.input_kind !== "Operation")
    throw new Error(`decision input ${row.input_id} has unknown kind`);
  const source = await operationSource(pool, partition, row);
  return {
    partition,
    ordinal: projectRowCounter(row.ordinal, "inbox ordinal"),
    priority: priorityOf(row.base_priority),
    deferredPasses: row.deferred_passes,
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
