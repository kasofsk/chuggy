/**
 * The decision transaction: the journal entry, the input outcome, the
 * projection and focused work, or none of them.
 *
 * THE CAUSE IS LOCKED AND READ BEFORE ANY FENCE IS CHECKED. A writer whose
 * commit was acknowledged by nobody retries with the head it held before that
 * commit, so asking the head first would answer `StaleHead` to the one caller
 * whose question is whether its own decision landed. Reading the operation
 * first is what
 * `docs/design/006-durable-project-dispatch.md` means by resolving an
 * ambiguous commit from the durable record rather than assuming failure, and
 * a still-pending operation falls through to the fences and is decided again.
 *
 * THE PROJECT ROW IS LOCKED FIRST AND THE OPERATION SECOND, always. Acceptance
 * takes the project row and inserts an operation nobody else holds;
 * cancellation takes the operation row alone. No two of the three can wait on
 * each other in a cycle, which is what makes the order worth fixing rather
 * than the fastest order worth taking.
 *
 * A REFUSAL SETTLES AND ACKNOWLEDGES AND WRITES NOTHING ELSE. There is no
 * entry, so the head does not move and the projection is untouched; the
 * settling authority is recorded because a refusal has no entry to carry the
 * owner and the fencing epoch that produced it.
 *
 * AN ANSWERED ACTION IS THAT SAME SHAPE WITH ONE ROW MORE. An approval answer
 * names no domain command, so the transaction records which answer was given
 * and settles the input, and writes no entry, no projection and no focused work
 * — which is the whole of what keeps approval out of `Core`.
 *
 * THE PROJECTION IS UPSERTED BY THE ROWS THE DECISION CHANGED. Its sequence is
 * the entry's, which is what lets a read say which decision it is looking at,
 * and a ticket the decision left alone keeps the sequence that last moved it.
 *
 * A SPAWN REQUEST PINS ITS CAPACITY ACCOUNT AND CONFIGURATION HERE, in the
 * transaction that authorizes it, because 006 has a spawn request name the
 * stable capacity account and pinned task-configuration revision a consumer
 * needs and forbids that consumer to reconstruct historical intent from a
 * moving ticket row. The account is the project, which is 006's initial
 * choice; the revision and digest are the same pin this transaction writes
 * onto the entry and the projection, so the three cannot disagree. A
 * cancellation request carries none of them: it retires work rather than
 * authorizing any, and a column it does not need is a column a later reader
 * would have to decide the meaning of.
 */

import { createHash } from "node:crypto";
import type pg from "pg";

import { assertNever } from "../../domain/assertNever.ts";
import { decisionEventSubject } from "../../actor/decisionEvent.ts";
import {
  asCanonicalConfiguration,
  releaseConfigurationReadiness,
} from "../../interpreter/authoring.ts";
import {
  allRefusalCodes,
  projectTicketWriterAuthorityKind,
  type Decided,
  type ConfigurationPin,
  type Decision,
  type DecisionCause,
  type DecisionOutcome,
  type DecisionInputOutcome,
  type NativeActionAnswer,
  type RefusalCode,
  type TicketProjection,
} from "../../interpreter/projectDecision.ts";
import type { Lease, Partition } from "../../interpreter/projectStore.ts";
import type { DispatchCandidate } from "../../interpreter/dispatchView.ts";
import { postgresJournalWrite } from "./journal.ts";
import {
  postgresOwnershipHonours,
  postgresOwnershipLockKnown,
} from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter, projectRowStanding } from "./rows.ts";
import {
  accountIdentityFunction,
  continuationFunction,
  draftReleaseFunction,
  notificationPublishFunction,
} from "./schema.ts";

/** One decision-input row as the transaction reads it under its lock. */
interface DecisionCauseRow {
  readonly state: string;
  readonly outcome_code: string | null;
  readonly decided_seq: string | null;
}

/** Narrows an outcome code column to the closed set, refusing a value no decision can have written. */
function decisionRefusalCode(value: string): RefusalCode {
  const found = allRefusalCodes.find((code) => code === value);
  if (found === undefined) {
    throw new Error(
      `decision row: ${value} is not a refusal code this code knows`,
    );
  }
  return found;
}

/** What a settled input says about itself, refusing a row whose state and outcome disagree. */
function decisionOutcomeOf(row: DecisionCauseRow): DecisionInputOutcome {
  if (row.state === "Cancelled") return { settled: "Cancelled" };
  if (row.state === "Answered") return { settled: "Answered" };
  if (row.state === "Stale") return { settled: "Stale" };
  if (row.state === "Refused" && row.outcome_code !== null) {
    return { settled: "Refused", code: decisionRefusalCode(row.outcome_code) };
  }
  if (row.state === "Journaled" && row.decided_seq !== null) {
    return {
      settled: "Succeeded",
      seq: projectRowCounter(row.decided_seq, "decided sequence"),
    };
  }
  throw new Error(
    `decision row: a ${row.state} input carries no outcome, which no settlement writes`,
  );
}

/** Locks the cause and reads it, refusing a partition that has no such input. */
async function decisionLockCause(
  client: pg.PoolClient,
  partition: Partition,
  cause: DecisionCause,
): Promise<DecisionCauseRow> {
  const found = await client.query<DecisionCauseRow>(
    `SELECT state, outcome_code, decided_seq FROM decision_input
      WHERE tenant = $1 AND project = $2 AND input_kind = $3 AND input_id = $4
      FOR UPDATE`,
    [partition.tenant, partition.project, cause.kind, cause.id],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres decision: ${partition.tenant}/${partition.project} has no ${cause.kind} ${cause.id} to decide`,
    );
  }
  return row;
}

/** Settles the decision input with its terminal evidence. */
async function decisionSettle(
  client: pg.PoolClient,
  lease: Lease,
  cause: DecisionCause,
  settled: DecisionInputOutcome,
  refusedAt: {
    readonly head: number;
    readonly lifecycleGeneration: number;
  } | null,
): Promise<void> {
  const succeeded = settled.settled === "Succeeded";
  await client.query(
    `UPDATE decision_input
        SET state = $4, terminal_at = now(),
            settled_authority_kind = $5, settled_authority_subject = $6,
            decided_seq = $7, outcome_code = $8,
            refused_head = $9, refused_lifecycle_generation = $10
      WHERE tenant = $1 AND project = $2 AND input_kind = $3 AND input_id = $11`,
    [
      lease.partition.tenant,
      lease.partition.project,
      cause.kind,
      settled.settled === "Succeeded" ? "Journaled" : settled.settled,
      projectTicketWriterAuthorityKind,
      lease.owner,
      succeeded ? settled.seq : null,
      settled.settled === "Refused" ? settled.code : null,
      settled.settled === "Refused" ? refusedAt?.head : null,
      settled.settled === "Refused" ? refusedAt?.lifecycleGeneration : null,
      cause.id,
    ],
  );
}

/** Upserts the rows this decision moved, each carrying the sequence that moved it. */
async function decisionProject(
  client: pg.PoolClient,
  partition: Partition,
  seq: number,
  projection: readonly TicketProjection[],
  configuration: ConfigurationPin,
): Promise<void> {
  for (const row of projection) {
    await client.query(
      `INSERT INTO ticket_projection
       (tenant, project, ticket, phase, seq, configuration_revision, configuration_digest)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant, project, ticket)
       DO UPDATE SET phase = EXCLUDED.phase, seq = EXCLUDED.seq`,
      [
        partition.tenant,
        partition.project,
        row.ticket,
        row.phase,
        seq,
        configuration.configurationRevision,
        configuration.configurationDigest,
      ],
    );
  }
}

async function replaceDispatchView(
  client: pg.PoolClient,
  lease: Lease,
  watermark: number,
  view: {
    readonly digest: string;
    readonly candidates: readonly DispatchCandidate[];
  },
): Promise<void> {
  await client.query(
    `INSERT INTO dispatch_view
       (tenant,project,recovery_epoch,watermark,schema_version,digest)
     VALUES ($1,$2,$3,$4,1,$5)
     ON CONFLICT (tenant,project) DO UPDATE SET
       recovery_epoch=EXCLUDED.recovery_epoch,watermark=EXCLUDED.watermark,
       schema_version=EXCLUDED.schema_version,digest=EXCLUDED.digest`,
    [
      lease.partition.tenant,
      lease.partition.project,
      lease.recoveryEpoch,
      watermark,
      view.digest,
    ],
  );
  await client.query(
    `DELETE FROM dispatch_candidate WHERE tenant=$1 AND project=$2`,
    [lease.partition.tenant, lease.partition.project],
  );
  for (const candidate of view.candidates) {
    await client.query(
      `INSERT INTO dispatch_candidate
       (tenant,project,ticket,ticket_version,work_fanout,program,rework_policy,
        finalization_pricing,resume_pricing,finalizer,configuration_revision,
        configuration_digest,configuration_canonical)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        lease.partition.tenant,
        lease.partition.project,
        candidate.ticket,
        candidate.ticketVersion,
        candidate.workFanout,
        JSON.stringify(candidate.program),
        JSON.stringify(candidate.reworkPolicy),
        JSON.stringify(candidate.finalizationPricing),
        candidate.resumePricing,
        candidate.finalizer,
        candidate.configurationRevision,
        candidate.configurationDigest,
        candidate.configurationCanonical,
      ],
    );
    for (const dependency of candidate.dependencies)
      await client.query(
        `INSERT INTO dispatch_candidate_dependency
         (tenant,project,ticket,dependency) VALUES ($1,$2,$3,$4)`,
        [
          lease.partition.tenant,
          lease.partition.project,
          candidate.ticket,
          dependency,
        ],
      );
  }
}

async function decisionConfiguration(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
  release: Decision["draftRelease"],
): Promise<ConfigurationPin> {
  if (release !== undefined) return release;
  const ticket = decisionEventSubject(outcome.entry.event);
  const found = await client.query<{
    configuration_revision: string | null;
    configuration_digest: string | null;
  }>(
    `SELECT configuration_revision,configuration_digest FROM ticket_projection
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, ticket],
  );
  const row = found.rows[0];
  if (
    row?.configuration_revision === null ||
    row?.configuration_revision === undefined ||
    row.configuration_digest === null
  ) {
    throw new Error("journal decision has no retained ticket configuration");
  }
  return {
    configurationRevision: row.configuration_revision,
    configurationDigest: row.configuration_digest,
  };
}

type JournaledOutcome = Extract<
  DecisionOutcome,
  { readonly outcome: "Journaled" }
>;

async function decisionExecution(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
  configuration: ConfigurationPin,
): Promise<void> {
  const seq = outcome.entry.seq;
  for (const request of outcome.materialization.execution) {
    const spawns = request.kind !== "CancelTicketWork";
    await client.query(
      `INSERT INTO execution_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, kind, capacity_account, configuration_revision,
        configuration_digest)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,
               CASE WHEN $9::boolean THEN ${accountIdentityFunction}($1,$2) END,
               $10,$11)`,
      [
        partition.tenant,
        partition.project,
        request.request,
        seq,
        request.effectPosition,
        request.ticket,
        request.ticketVersion,
        request.kind,
        spawns,
        spawns ? configuration.configurationRevision : null,
        spawns ? configuration.configurationDigest : null,
      ],
    );
    for (const task of request.tasks) {
      await client.query(
        `INSERT INTO execution_request_task
         (tenant, project, request, task, kind, stage) VALUES ($1,$2,$3,$4,$5,$6)`,
        [
          partition.tenant,
          partition.project,
          request.request,
          task.task,
          task.kind,
          task.kind === "Evaluation" ? task.stage : null,
        ],
      );
    }
  }
}

async function decisionFinalization(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
): Promise<void> {
  const seq = outcome.entry.seq;
  for (const ticket of outcome.materialization.fulfillFinalizationFor) {
    await client.query(
      `UPDATE finalization_request SET state='Fulfilled'
        WHERE tenant=$1 AND project=$2 AND ticket=$3
          AND state IN ('Open', 'Registered')`,
      [partition.tenant, partition.project, ticket],
    );
  }
  for (const request of outcome.materialization.finalization) {
    await client.query(
      `INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        partition.tenant,
        partition.project,
        request.request,
        seq,
        request.effectPosition,
        request.ticket,
        request.ticketVersion,
        request.requestGeneration,
      ],
    );
  }
}

/**
 * Records which of the answers an open action offered was given, at the fence
 * that authorized it. A row that stopped being open is a fence the caller lost.
 */
async function decisionAnswerAction(
  client: pg.PoolClient,
  partition: Partition,
  answer: NativeActionAnswer,
): Promise<void> {
  const changed = await client.query(
    `UPDATE native_action SET state='Resolved', resolution=$5
      WHERE tenant=$1 AND project=$2 AND action=$3 AND authorizing_seq=$4 AND state='Open'
      RETURNING action`,
    [
      partition.tenant,
      partition.project,
      answer.action,
      answer.authorizingSeq,
      answer.resolution,
    ],
  );
  if (changed.rows.length !== 1)
    throw new Error("native action resolution fence failed");
}

async function decisionActions(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
): Promise<void> {
  const seq = outcome.entry.seq;
  const resolved = outcome.materialization.resolveAction;
  for (const ticket of outcome.materialization.withdrawActionsFor) {
    await client.query(
      `UPDATE native_action SET state='Withdrawn'
        WHERE tenant=$1 AND project=$2 AND ticket=$3 AND state='Open'`,
      [partition.tenant, partition.project, ticket],
    );
  }
  for (const action of outcome.materialization.actions) {
    await client.query(
      `INSERT INTO native_action
       (tenant, project, action, authorizing_seq, effect_position, ticket,
        action_version, kind, reason, required_capability)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        partition.tenant,
        partition.project,
        action.action,
        seq,
        action.effectPosition,
        action.ticket,
        action.version,
        action.kind,
        action.reason,
        action.capability,
      ],
    );
    for (const resolution of action.resolutions) {
      await client.query(
        `INSERT INTO native_action_resolution
         (tenant, project, action, resolution) VALUES ($1,$2,$3,$4)`,
        [partition.tenant, partition.project, action.action, resolution],
      );
    }
  }
  if (resolved !== undefined)
    await decisionAnswerAction(client, partition, resolved);
}

async function decisionContinuation(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
): Promise<void> {
  const seq = outcome.entry.seq;
  const continuation = outcome.materialization.continuation;
  if (continuation !== undefined) {
    const allocated = await client.query<{ ordinal: string }>(
      `UPDATE project SET ingress_next=ingress_next+1
        WHERE tenant=$1 AND project=$2 RETURNING (ingress_next-1)::text AS ordinal`,
      [partition.tenant, partition.project],
    );
    const ordinal = allocated.rows[0]?.ordinal;
    if (ordinal === undefined)
      throw new Error("continuation project disappeared");
    await client.query(
      `INSERT INTO project_continuation
       (tenant, project, continuation, kind, authorizing_seq, effect_position,
        ticket, expected_ticket_version, expected_phase, task_set_generation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        partition.tenant,
        partition.project,
        continuation.continuation,
        continuation.kind,
        seq,
        outcome.entry.rec.effects.length,
        continuation.ticket,
        continuation.expectedTicketVersion,
        continuation.expectedPhase,
        continuation.taskSetGeneration,
      ],
    );
    await client.query(`SELECT ${continuationFunction}($1,$2,$3,$4)`, [
      partition.tenant,
      partition.project,
      ordinal,
      continuation.continuation,
    ]);
    await client.query(
      `INSERT INTO project_readiness (tenant, project, ready, generation)
       VALUES ($1,$2,true,1) ON CONFLICT (tenant,project)
       DO UPDATE SET ready=true, generation=project_readiness.generation+1`,
      [partition.tenant, partition.project],
    );
  }
}

async function decisionMaterialize(
  client: pg.PoolClient,
  lease: Lease,
  outcome: JournaledOutcome,
  configuration: ConfigurationPin,
): Promise<void> {
  await decisionExecution(client, lease.partition, outcome, configuration);
  await decisionFinalization(client, lease.partition, outcome);
  await decisionActions(client, lease.partition, outcome);
  await decisionContinuation(client, lease.partition, outcome);
}

async function publishNotification(
  client: pg.PoolClient,
  partition: Partition,
  kind: "Operation" | "Ticket" | "Draft",
  resource: string,
  projectSequence: number | null,
  authoringVersion: number | null,
): Promise<void> {
  await client.query(
    `SELECT ${notificationPublishFunction}($1,$2,$3,$4,$5,$6)`,
    [
      partition.tenant,
      partition.project,
      kind,
      resource,
      projectSequence,
      authoringVersion,
    ],
  );
}

async function decisionReleaseOutcome(
  client: pg.PoolClient,
  decision: Decision,
): Promise<DecisionOutcome> {
  const fence = decision.draftRelease;
  if (fence === undefined) return decision.outcome;
  const releaseFence = async (commit: boolean): Promise<boolean> => {
    const found = await client.query<{ matched: boolean }>(
      `SELECT ${draftReleaseFunction}($1,$2,$3,$4,$5,$6,$7) AS matched`,
      [
        decision.lease.partition.tenant,
        decision.lease.partition.project,
        fence.ticket,
        fence.authoringVersion,
        fence.configurationRevision,
        fence.configurationDigest,
        commit,
      ],
    );
    return found.rows[0]?.matched === true;
  };
  if (!(await releaseFence(false)))
    return { outcome: "Refused", code: "AuthoringChanged" };
  const configuration = await client.query<{
    canonical: string;
    digest: string;
  }>(
    `SELECT canonical,digest FROM configuration_revision
      WHERE tenant=$1 AND project=$2 AND revision=$3`,
    [
      decision.lease.partition.tenant,
      decision.lease.partition.project,
      fence.configurationRevision,
    ],
  );
  const revision = configuration.rows[0];
  if (revision === undefined)
    throw new Error(
      "release configuration disappeared behind its retained fence",
    );
  const digest = createHash("sha256").update(revision.canonical).digest("hex");
  if (digest !== revision.digest || digest !== fence.configurationDigest)
    throw new Error(
      "release configuration content contradicts its retained digest",
    );
  const canonical = asCanonicalConfiguration(revision.canonical);
  if (releaseConfigurationReadiness(canonical).readiness === "Incomplete")
    return { outcome: "Refused", code: "ConfigurationInvalid" };
  if (decision.outcome.outcome === "Journaled" && !(await releaseFence(true)))
    throw new Error(
      "release fence changed while held by its deciding transaction",
    );
  if (decision.outcome.outcome === "Journaled")
    await publishNotification(
      client,
      decision.lease.partition,
      "Draft",
      String(fence.ticket),
      null,
      fence.authoringVersion,
    );
  return decision.outcome;
}

async function notifyDecision(
  client: pg.PoolClient,
  partition: Partition,
  cause: DecisionCause,
  outcome: DecisionOutcome,
): Promise<void> {
  if (cause.kind === "Operation")
    await publishNotification(
      client,
      partition,
      "Operation",
      cause.id,
      outcome.outcome === "Journaled" ? outcome.entry.seq : null,
      null,
    );
  if (outcome.outcome === "Journaled")
    for (const row of outcome.projection)
      await publishNotification(
        client,
        partition,
        "Ticket",
        String(row.ticket),
        outcome.entry.seq,
        null,
      );
}

async function decisionAdvanceTicketIdentity(
  client: pg.PoolClient,
  partition: Partition,
  outcome: Extract<DecisionOutcome, { outcome: "Journaled" }>,
): Promise<void> {
  if (outcome.entry.event.type !== "ReleaseTicket") return;
  await client.query(
    `UPDATE project SET ticket_next=greatest(ticket_next,$3)
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project, outcome.entry.event.value.ticket + 1],
  );
}

async function decisionApplyJournaled(
  client: pg.PoolClient,
  lease: Lease,
  cause: DecisionCause,
  outcome: JournaledOutcome,
  draftRelease: Decision["draftRelease"],
): Promise<Decided> {
  const seq = outcome.entry.seq;
  const configuration = await decisionConfiguration(
    client,
    lease.partition,
    outcome,
    draftRelease,
  );
  await postgresJournalWrite(
    client,
    lease,
    outcome.entry,
    cause,
    configuration,
  );
  await decisionAdvanceTicketIdentity(client, lease.partition, outcome);
  await decisionSettle(
    client,
    lease,
    cause,
    { settled: "Succeeded", seq },
    null,
  );
  await decisionProject(
    client,
    lease.partition,
    seq,
    outcome.projection,
    configuration,
  );
  if (outcome.dispatchView !== undefined)
    await replaceDispatchView(
      client,
      lease,
      outcome.entry.seq,
      outcome.dispatchView,
    );
  await decisionMaterialize(client, lease, outcome, configuration);
  await notifyDecision(client, lease.partition, cause, outcome);
  return { decided: "Committed", lease: { ...lease, head: seq } };
}

/** Writes everything the decision asks for, and answers with the lease its commit advanced. */
async function decisionApply(
  client: pg.PoolClient,
  lease: Lease,
  cause: DecisionCause,
  outcome: DecisionOutcome,
  standing: ReturnType<typeof projectRowStanding>,
  draftRelease: Decision["draftRelease"],
): Promise<Decided> {
  switch (outcome.outcome) {
    case "Stale":
      await client.query(
        `UPDATE decision_input SET state='Stale', terminal_at=now(),
          settled_authority_kind=$5, settled_authority_subject=$6
         WHERE tenant=$1 AND project=$2 AND input_kind=$3 AND input_id=$4`,
        [
          lease.partition.tenant,
          lease.partition.project,
          cause.kind,
          cause.id,
          projectTicketWriterAuthorityKind,
          lease.owner,
        ],
      );
      return { decided: "Stale" };
    case "Refused":
      await decisionSettle(
        client,
        lease,
        cause,
        {
          settled: "Refused",
          code: outcome.code,
        },
        {
          head: standing.head,
          lifecycleGeneration: standing.lifecycleGeneration,
        },
      );
      await notifyDecision(client, lease.partition, cause, outcome);
      return { decided: "Refused" };
    case "Answered":
      await decisionAnswerAction(client, lease.partition, outcome.answer);
      await decisionSettle(client, lease, cause, { settled: "Answered" }, null);
      await notifyDecision(client, lease.partition, cause, outcome);
      return { decided: "Answered" };
    case "Journaled":
      return decisionApplyJournaled(
        client,
        lease,
        cause,
        outcome,
        draftRelease,
      );
    default:
      return assertNever(outcome);
  }
}

/** Commits one decision under the locked partition row, or names the fence that stopped it. */
export async function postgresDecisionCommit(
  pool: pg.Pool,
  decision: Decision,
): Promise<Decided> {
  const lease = decision.lease;
  return postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    const cause = await decisionLockCause(
      client,
      lease.partition,
      decision.cause,
    );
    if (cause.state !== "Pending") {
      return { decided: "AlreadyTerminal", outcome: decisionOutcomeOf(cause) };
    }
    const standing = projectRowStanding(row);
    if (standing.lifecycle !== "Active") {
      return { decided: "NotActive", lifecycle: standing.lifecycle };
    }
    if (!(await postgresOwnershipHonours(client, row, lease))) {
      return { decided: "Fenced", fencingEpoch: standing.fencingEpoch };
    }
    if (standing.head !== lease.head) {
      return { decided: "StaleHead", head: standing.head };
    }
    const outcome = await decisionReleaseOutcome(client, decision);
    return decisionApply(
      client,
      lease,
      decision.cause,
      outcome,
      standing,
      decision.draftRelease,
    );
  });
}

export async function postgresDispatchViewRebuild(
  pool: pg.Pool,
  lease: Lease,
  view: {
    readonly digest: string;
    readonly candidates: readonly DispatchCandidate[];
  },
): Promise<void> {
  await postgresTransaction(pool, async (client) => {
    const row = await postgresOwnershipLockKnown(client, lease.partition);
    const standing = projectRowStanding(row);
    if (!(await postgresOwnershipHonours(client, row, lease)))
      throw new Error("dispatch view rebuild was fenced");
    if (standing.head !== lease.head)
      throw new Error("dispatch view rebuild observed a stale head");
    await replaceDispatchView(client, lease, lease.head, view);
  });
}
