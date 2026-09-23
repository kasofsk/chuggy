/**
 * The decision transaction: the journal entry, the input outcome, the
 * projection and focused work, or none of them.
 *
 * THE CAUSE IS LOCKED AND READ BEFORE ANY FENCE IS CHECKED. A writer whose
 * commit was acknowledged by nobody retries with the head it held before that
 * commit, so asking the head first would answer `StaleHead` to the one caller
 * whose question is whether its own decision landed. Reading the operation
 * first is what
 * issue #180 means by resolving an
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
 * — which is the whole of what keeps approval out of `TicketGraph`.
 *
 * THE PROJECTION IS UPSERTED BY THE ROWS THE DECISION CHANGED. Its sequence is
 * the entry's, which is what lets a read say which decision it is looking at,
 * and a ticket the decision left alone keeps the sequence that last moved it.
 *
 * A SPAWN REQUEST PINS ITS CAPACITY ACCOUNT AND CONFIGURATION HERE, in the
 * transaction that authorizes it, because issue #180 has a spawn request name
 * the stable capacity account and pinned task-configuration revision a
 * consumer needs and forbids that consumer to reconstruct historical intent
 * from a moving ticket row. The account is the project, which is that record's
 * initial choice; the revision and digest are the same pin this transaction
 * writes onto the entry and the projection, so the three cannot disagree. A
 * cancellation request carries none of them: it retires work rather than
 * authorizing any, and a column it does not need is a column a later reader
 * would have to decide the meaning of.
 *
 * AND IT PINS THE BUNDLE ITS WORKERS CONSUME, WRITTEN IN THIS SAME TRANSACTION.
 * Issue #180 has the transaction that spawns a work set materialize that set's
 * input bundle from the exact references at that decision, and a decision
 * returning a ticket to `Work` after a finalization failed adds the
 * immutable evidence that failure named. So a worker forms its reconciliation
 * objective from the bundle rather than from current refs, finalizer logs or
 * the bare outcome.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { materialDigest } from "../../interpreter/ticketDefinition.ts";
import { assertNever } from "../../domain/assertNever.ts";
import type { TaskIdentity } from "../../domain/generated/modelTypes.ts";
import { eventTicket } from "../../domain/evolve.ts";
import type { ExecutionTaskKind } from "../../interpreter/executionScheduler.ts";
import {
  asCanonicalConfiguration,
  draftReleaseReadiness,
  type CanonicalConfiguration,
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
import {
  encodeDispatchProgram,
  type DispatchCandidate,
} from "../../interpreter/dispatchView.ts";
import {
  asInputBundleId,
  asRepositoryId,
} from "../../interpreter/finalizer.ts";
import { inputBundleReferencesOf } from "../../interpreter/decisionPlan.ts";
import {
  postgresInputBundleOf,
  postgresInputBundleWrite,
} from "./inputBundle.ts";
import { postgresJournalWrite } from "./journal.ts";
import {
  postgresOwnershipHonours,
  postgresOwnershipLockKnown,
} from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter, projectRowStanding } from "./rows.ts";
import { configurationRevisionDigest } from "./digest.ts";

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
    sql`SELECT state, outcome_code, decided_seq FROM decision_input
      WHERE tenant = ${partition.tenant} AND project = ${partition.project}
        AND input_kind = ${String(cause.kind)} AND input_id = ${cause.id}
      FOR UPDATE`,
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
    sql`UPDATE decision_input
        SET state = ${settled.settled === "Succeeded" ? "Journaled" : settled.settled},
            terminal_at = now(),
            settled_authority_kind = ${projectTicketWriterAuthorityKind},
            settled_authority_subject = ${lease.owner},
            decided_seq = ${succeeded ? settled.seq : null},
            outcome_code = ${settled.settled === "Refused" ? settled.code : null},
            refused_head = ${settled.settled === "Refused" ? (refusedAt?.head ?? null) : null},
            refused_lifecycle_generation = ${settled.settled === "Refused" ? (refusedAt?.lifecycleGeneration ?? null) : null}
      WHERE tenant = ${lease.partition.tenant} AND project = ${lease.partition.project}
        AND input_kind = ${String(cause.kind)} AND input_id = ${cause.id}`,
  );
}

/**
 * Upserts the rows this decision moved, each carrying the sequence that moved
 * it. Every column of a row comes from the one post-state
 * `projectionChanges` read, in this transaction, so the projection cannot
 * disagree with the entry beside it.
 */
async function decisionProject(
  client: pg.PoolClient,
  partition: Partition,
  seq: number,
  projection: readonly TicketProjection[],
  configuration: ConfigurationPin,
): Promise<void> {
  for (const row of projection) {
    await client.query(
      sql`INSERT INTO ticket_projection
       (tenant, project, ticket, phase, seq, dependable, escalation, escalation_evidence,
        configuration_revision, configuration_digest)
       VALUES (${partition.tenant}, ${partition.project}, ${row.ticket}, ${row.phase}, ${seq}, ${row.dependable},
               ${row.escalation}, ${row.escalationEvidence ?? null},
               ${configuration.configurationRevision}, ${configuration.configurationDigest})
       ON CONFLICT (tenant, project, ticket)
       DO UPDATE SET phase = EXCLUDED.phase, seq = EXCLUDED.seq, dependable = EXCLUDED.dependable,
                     escalation = EXCLUDED.escalation,
                     escalation_evidence = EXCLUDED.escalation_evidence`,
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
    sql`INSERT INTO dispatch_view
       (tenant,project,recovery_epoch,watermark,schema_version,digest)
     VALUES (${lease.partition.tenant},${lease.partition.project},${lease.recoveryEpoch},${watermark},1,${view.digest})
     ON CONFLICT (tenant,project) DO UPDATE SET
       recovery_epoch=EXCLUDED.recovery_epoch,watermark=EXCLUDED.watermark,
       schema_version=EXCLUDED.schema_version,digest=EXCLUDED.digest`,
  );
  await client.query(
    sql`DELETE FROM dispatch_candidate WHERE tenant=${lease.partition.tenant} AND project=${lease.partition.project}`,
  );
  for (const candidate of view.candidates) {
    await client.query(
      sql`INSERT INTO dispatch_candidate
       (tenant,project,ticket,ticket_version,program,
        configuration_revision,
        configuration_digest,configuration_canonical)
       VALUES (${lease.partition.tenant},${lease.partition.project},${candidate.ticket},
               ${candidate.ticketVersion},
               ${JSON.stringify(encodeDispatchProgram(candidate.program))},
               ${candidate.configurationRevision},
               ${candidate.configurationDigest},${candidate.configurationCanonical})`,
    );
    for (const dependency of candidate.dependencies)
      await client.query(
        sql`INSERT INTO dispatch_candidate_dependency
         (tenant,project,ticket,dependency)
         VALUES (${lease.partition.tenant},${lease.partition.project},${candidate.ticket},${dependency})`,
      );
  }
}

interface DecisionConfiguration extends ConfigurationPin {
  readonly canonical: CanonicalConfiguration;
}

async function decisionConfiguration(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
  release: Decision["draftRelease"],
): Promise<DecisionConfiguration> {
  if (release !== undefined)
    return {
      ...release,
      canonical: asCanonicalConfiguration(release.configurationCanonical),
    };
  const ticket = eventTicket(outcome.entry.event);
  const found = await client.query<{
    configuration_revision: string;
    configuration_digest: string;
    canonical: string;
  }>(
    sql`SELECT p.configuration_revision,p.configuration_digest,c.canonical
      FROM ticket_projection p
      JOIN configuration_revision c
        ON c.tenant=p.tenant AND c.project=p.project
       AND c.revision=p.configuration_revision AND c.digest=p.configuration_digest
      WHERE p.tenant=${partition.tenant} AND p.project=${partition.project} AND p.ticket=${ticket}`,
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error("journal decision has no retained ticket configuration");
  }
  return {
    configurationRevision: row.configuration_revision,
    configurationDigest: row.configuration_digest,
    canonical: asCanonicalConfiguration(row.canonical),
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
    const bundle =
      request.bundle === undefined
        ? undefined
        : postgresInputBundleOf(
            partition,
            asInputBundleId(request.bundle.bundle),
            inputBundleReferencesOf(configuration, request.bundle),
          );
    if (bundle !== undefined)
      await postgresInputBundleWrite(client, partition, bundle);
    await client.query(
      sql`INSERT INTO execution_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, kind, capacity_account, configuration_revision,
        configuration_digest, input_bundle, input_bundle_digest)
       VALUES (${partition.tenant},${partition.project},${request.request},${seq},
               ${request.effectPosition},${request.ticket},${request.ticketVersion},${request.kind},
               CASE WHEN ${request.kind}='CancelTicketWork' THEN NULL
                    ELSE project_capacity_account(${partition.tenant},${partition.project}) END,
               ${spawns ? configuration.configurationRevision : null},
               ${spawns ? configuration.configurationDigest : null},
               ${bundle?.bundle ?? null},${bundle?.digest ?? null})`,
    );
    for (const task of request.tasks) {
      const row = decisionTaskColumns(task.identity);
      await client.query(
        sql`INSERT INTO execution_request_task
         (tenant, project, request, task, kind, cycle, stage, generation, evaluator)
         VALUES (${partition.tenant},${partition.project},${request.request},${task.task},
                 ${row.kind},${row.cycle},${row.stage},${row.generation},${row.evaluator})`,
      );
    }
  }
}

/**
 * One identity as the relation spells it: the kind the wire names, the cycle
 * both arms carry, and the three an evaluation adds. The `Work` arm writes
 * nulls rather than leaving them out, because `execution_request_task_check`
 * states each arm whole and half an identity is refused at the insert.
 */
export function decisionTaskColumns(identity: TaskIdentity): {
  readonly kind: ExecutionTaskKind;
  readonly cycle: number;
  readonly stage: number | null;
  readonly generation: number | null;
  readonly evaluator: number | null;
} {
  if (identity.type === "WorkTask") {
    return {
      kind: "Work",
      cycle: identity.value.cycle,
      stage: null,
      generation: null,
      evaluator: null,
    };
  }
  return {
    kind: "Evaluation",
    cycle: identity.value.workCycle,
    stage: identity.value.stage,
    generation: identity.value.generation,
    evaluator: identity.value.evaluator,
  };
}

async function decisionFinalization(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
): Promise<void> {
  const seq = outcome.entry.seq;
  for (const ticket of outcome.materialization.fulfillFinalizationFor) {
    await client.query(
      sql`UPDATE finalization_request SET state='Fulfilled'
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND ticket=${ticket} AND state IN ('Open', 'Registered')`,
    );
  }
  for (const request of outcome.materialization.finalization) {
    await client.query(
      sql`INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation, kind)
       VALUES (${partition.tenant},${partition.project},${request.request},${seq},
               ${request.effectPosition},${request.ticket},${request.ticketVersion},
               ${request.requestGeneration},${request.kind})`,
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
  const changed = await client.query<{ action: string }>(
    sql`UPDATE native_action SET state='Resolved', resolution=${String(answer.resolution)}
      WHERE tenant=${partition.tenant} AND project=${partition.project}
        AND action=${answer.action} AND authorizing_seq=${answer.authorizingSeq}
        AND state='Open'
      RETURNING action`,
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
      sql`UPDATE native_action SET state='Withdrawn'
        WHERE tenant=${partition.tenant} AND project=${partition.project}
          AND ticket=${ticket} AND state='Open'`,
    );
  }
  for (const action of outcome.materialization.actions) {
    /** A desk answers no obligation, so it has no position; the column is NOT NULL for the approval rows that copy theirs. */
    await client.query(
      sql`INSERT INTO native_action
       (tenant, project, action, authorizing_seq, effect_position, ticket,
        action_version, kind, escalation, required_capability)
       VALUES (${partition.tenant},${partition.project},${action.action},${seq},
               0,${action.ticket},${action.version},
               ${action.kind},${action.escalation},${action.capability})`,
    );
    for (const resolution of action.resolutions) {
      await client.query(
        sql`INSERT INTO native_action_resolution
         (tenant, project, action, resolution)
         VALUES (${partition.tenant},${partition.project},${action.action},${resolution})`,
      );
    }
  }
  if (resolved !== undefined)
    await decisionAnswerAction(client, partition, resolved);
}

/**
 * The source a dispatch pinned, keyed by the reference its event carries, and
 * the same relation an accepted work result writes into — so a later spawn
 * reads the ticket's current source without knowing which decision put it
 * there. A row already present is tolerated because a reference is a fold of
 * the commit it names, so a second dispatch at the same commit writes the same
 * row.
 */
async function decisionTicketSource(
  client: pg.PoolClient,
  partition: Partition,
  outcome: JournaledOutcome,
): Promise<void> {
  const pinned = outcome.materialization.ticketSource;
  if (pinned === undefined) return;
  await client.query(
    sql`INSERT INTO ticket_source (tenant,project,ticket,source,repository,commit,ref)
       VALUES (${partition.tenant},${partition.project},${pinned.ticket},${pinned.source},
               ${pinned.repository ?? null},${pinned.commit ?? null},${pinned.ref ?? null})
       ON CONFLICT (tenant,project,ticket,source) DO NOTHING`,
  );
}

/**
 * What the release resolved, written beside the entry that journalled the
 * references folded from it. One row per ticket: a release happens once, and a
 * ticket runs at what that release froze.
 */
async function decisionTicketDefinition(
  client: pg.PoolClient,
  partition: Partition,
  draftRelease: Decision["draftRelease"],
): Promise<void> {
  const material = draftRelease?.definition;
  if (draftRelease === undefined || material === undefined) return;
  await client.query(
    sql`INSERT INTO ticket_definition (tenant,project,ticket,definition,digest)
       VALUES (${partition.tenant},${partition.project},${draftRelease.ticket},
               ${JSON.stringify(material)}::jsonb,${materialDigest(material)})`,
  );
}

async function decisionMaterialize(
  client: pg.PoolClient,
  lease: Lease,
  outcome: JournaledOutcome,
  configuration: DecisionConfiguration,
): Promise<void> {
  await decisionTicketSource(client, lease.partition, outcome);
  await decisionExecution(client, lease.partition, outcome, configuration);
  await decisionFinalization(client, lease.partition, outcome);
  await decisionActions(client, lease.partition, outcome);
}

async function publishNotification(
  client: pg.PoolClient,
  partition: Partition,
  kind: "Operation" | "Ticket" | "Draft",
  resource: string,
  projectSequence: number | null,
  authoringVersion: number | null,
): Promise<void> {
  await client.query<{ published: string | null }>(
    sql`SELECT publish_project_notification(${partition.tenant},${partition.project},${kind},${resource},${projectSequence},${authoringVersion})::text AS published`,
  );
}

async function decisionReleaseOutcome(
  client: pg.PoolClient,
  decision: Decision,
): Promise<DecisionOutcome> {
  const fence = decision.draftRelease;
  if (fence === undefined) return decision.outcome;
  const releaseFence = async (commit: boolean): Promise<boolean> => {
    const found = await client.query<{ matched: boolean | null }>(
      sql`SELECT release_draft_fenced(${decision.lease.partition.tenant},${decision.lease.partition.project},${fence.ticket},${fence.authoringVersion},${fence.configurationRevision},${fence.configurationDigest},${commit})::boolean AS matched`,
    );
    return found.rows[0]?.matched === true;
  };
  if (!(await releaseFence(false)))
    return { outcome: "Refused", code: "AuthoringChanged" };
  const configuration = await client.query<{
    canonical: string;
    digest: string;
    repository: string | null;
  }>(
    sql`SELECT c.canonical,c.digest,p.repository
      FROM configuration_revision c
      LEFT JOIN repository_configuration_provenance p
        ON p.tenant=c.tenant AND p.project=c.project AND p.revision=c.revision
      WHERE c.tenant=${decision.lease.partition.tenant}
        AND c.project=${decision.lease.partition.project}
        AND c.revision=${fence.configurationRevision}`,
  );
  const revision = configuration.rows[0];
  if (revision === undefined)
    throw new Error(
      "release configuration disappeared behind its retained fence",
    );
  const digest = configurationRevisionDigest(revision.canonical);
  if (digest !== revision.digest || digest !== fence.configurationDigest)
    throw new Error(
      "release configuration content contradicts its retained digest",
    );
  const canonical = asCanonicalConfiguration(revision.canonical);
  const readiness = draftReleaseReadiness(
    canonical,
    fence.brief,
    revision.repository === null
      ? undefined
      : asRepositoryId(revision.repository),
  );
  if (readiness.readiness === "Incomplete")
    return {
      outcome: "Refused",
      code:
        readiness.fault === "BriefNamesNoRepository"
          ? "BriefNamesNoRepository"
          : "ConfigurationInvalid",
    };
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
  if (outcome.entry.event.type !== "TicketCreated") return;
  await client.query(
    sql`UPDATE project SET ticket_next=greatest(ticket_next,${outcome.entry.event.value.id + 1})
      WHERE tenant=${partition.tenant} AND project=${partition.project}`,
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
  await decisionTicketDefinition(client, lease.partition, draftRelease);
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
    case "Deferred":
      await client.query(
        sql`UPDATE decision_input
            SET deferred_passes = deferred_passes + 1,
                deferred_since = coalesce(deferred_since, now())
          WHERE tenant=${lease.partition.tenant} AND project=${lease.partition.project}
            AND input_kind=${String(cause.kind)} AND input_id=${cause.id}`,
      );
      return { decided: "Deferred" };
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
