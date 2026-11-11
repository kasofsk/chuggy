/**
 * Two Stacked tickets on one reference, against a real PostgreSQL and a real
 * repository: A ranked ahead, and B, whose stack the finalizer chooses from the
 * queue as it stands and mints over A. Where A lands, B lands by its merge
 * being the stack's tree and is never re-checked; where A's evaluation fails
 * instead, B's stack stops standing and B is re-checked at its rank, at the
 * front of the queue, with nothing counted toward its re-check cap.
 *
 * B IS THE TICKET THE WRITER AND THE FINALIZER DRIVE, AND A IS WRITTEN BY HAND.
 * The harness drives one ticket through the writer, so A's definition, phase,
 * the request it is ranked by, its passed work and its started evaluation are
 * rows a case places directly, and its landing is the rows
 * `evaluationStackLandings.ts` writes. The queue both tickets are in is the
 * one the store reads. A's evaluation failing is A back in Work, and the
 * `TicketEvaluationReworkStarted` entry journaled after its request, which is
 * what releases its derived rank. B's evaluation has passed before its stack
 * is recorded, so the record is written as the finalizer role writes it; that
 * a spawn reads it is `evaluationStackDecision.test.ts`'s.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresFinalizer } from "../../src/adapters/postgres/finalizer.ts";
import { postgresEvaluationStack } from "../../src/adapters/postgres/evaluationStack.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  stackRefOf,
  type EvaluationStack,
} from "../../src/interpreter/evaluationStack.ts";
import { stackPrepared } from "../../src/interpreter/evaluationStacking.ts";
import {
  asGitObjectId,
  type FinalizationClaim,
} from "../../src/interpreter/finalizer.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import {
  stackStands,
  type StackEntry,
} from "../../src/interpreter/stackChoice.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import {
  landingTarget,
  landingWrite,
  recordStack,
} from "./evaluationStackLandings.ts";
import { releasedEvaluatorDefinition } from "./migrationHarness.ts";
import { seedJournalEntry } from "./nativeActionFixture.ts";
import {
  finalizerBriefLanding,
  finalizerBriefProposal,
  finalizerDeclareSource,
  finalizerRemoteCommit,
  finalizerGitVerb,
  finalizerIdentity,
  finalizerPassedWork,
  finalizerPassOnce,
  finalizerRemoteAttempt,
  finalizerRemotePort,
  finalizerRigOpen,
  finalizerStoreReleasedBrief,
  finalizerSubject,
  type FinalizerProject,
  type FinalizerRemote,
  type FinalizerRig,
  type FinalizerWork,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;

before(async () => {
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
});

/** The pair on one reference: B driven for real, A beside it with the request and accepted commit it holds its rank by. */
interface Pair {
  readonly b: FinalizerProject;
  readonly bWork: FinalizerWork;
  readonly remote: FinalizerRemote;
  readonly tip: string;
  readonly aCommit: string;
  readonly aRequest: string;
  readonly aTicket: number;
  /** The rank A's request gives it, ahead of B's. */
  readonly aRank: number;
  readonly bCommit: string;
}

function keysOf(project: FinalizerProject, ticket: number) {
  return [project.partition.tenant, project.partition.project, ticket] as const;
}

/** A's own tasks, numbered apart from B's work task, which `landingWrite` copies onto A. */
const aWorkTask = 3;
const aEvaluationTask = 4;

/**
 * A spawn request of A's, copied from B's spawn of the same kind at an effect
 * position past B's, holding the one task it names.
 */
async function aSpawn(
  project: FinalizerProject,
  ticket: number,
  kind: "SpawnWork" | "SpawnEvaluation",
  task: { readonly task: number; readonly kind: "Work" | "Evaluation" },
  label: string,
): Promise<string> {
  const request = finalizerIdentity(`spawn-a-${kind}-${label}`);
  const copied = await rig.harness.query(
    `INSERT INTO execution_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, kind, state, capacity_account, configuration_revision,
        configuration_digest, input_bundle, input_bundle_digest)
     SELECT tenant, project, $4, authorizing_seq, effect_position + 100, $5,
            ticket_version, kind, 'Fulfilled', capacity_account,
            configuration_revision, configuration_digest, input_bundle,
            input_bundle_digest
       FROM execution_request
      WHERE tenant=$1 AND project=$2 AND ticket=$3 AND kind=$6
      ORDER BY authorizing_seq LIMIT 1
     RETURNING request`,
    [...keysOf(project, project.ticket), request, ticket, kind],
  );
  assert.equal(copied.length, 1, `B has a ${kind} request to copy`);
  const evaluation = task.kind === "Evaluation";
  await rig.harness.query(
    `INSERT INTO execution_request_task
       (tenant, project, request, task, kind, stage, cycle, generation, evaluator)
     VALUES ($1,$2,$3,$4,$5,$6,1,$6,$6)`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      task.task,
      task.kind,
      evaluation ? 1 : null,
    ],
  );
  return request;
}

/** A's evaluation of its first cycle, started and not yet reported, which is what the store reads as evaluating. */
async function aEvaluating(
  project: FinalizerProject,
  ticket: number,
  label: string,
): Promise<void> {
  const task = aEvaluationTask;
  const request = await aSpawn(
    project,
    ticket,
    "SpawnEvaluation",
    { task, kind: "Evaluation" },
    label,
  );
  await rig.harness.query(
    `INSERT INTO execution
       (tenant, project, execution, ticket, task, source_request, account, cluster,
        configuration_revision, configuration_digest, status)
     SELECT r.tenant, r.project, $4, r.ticket, $5, r.request, a.account, a.cluster,
            r.configuration_revision, r.configuration_digest, 'Running'
       FROM execution_request r
       JOIN capacity_account a ON a.account = r.capacity_account
      WHERE r.tenant=$1 AND r.project=$2 AND r.request=$3`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      finalizerIdentity(`evaluation-a-${label}`),
      task,
    ],
  );
}

/**
 * Writes A beside B in `phase`, released with B's brief, its work passed at
 * `commit` off `tip` and its evaluation started where `phase` is Evaluation,
 * and ranked ahead of B by a request of its own.
 */
async function aPlaced(
  project: FinalizerProject,
  ticket: number,
  phase: string,
  label: string,
  source: {
    readonly ref: string;
    readonly commit: string;
    readonly tip: string;
  },
  branch?: string,
): Promise<string> {
  const [brief] = await rig.harness.query(
    `SELECT brief FROM ticket_definition WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(project, project.ticket)],
  );
  await finalizerStoreReleasedBrief(
    (sql, values) => rig.harness.query(sql, [...values]),
    [...keysOf(project, ticket)],
    {
      ...(brief?.["brief"] as Record<string, unknown>),
      ...(branch === undefined ? {} : { branch }),
    },
  );
  await rig.harness.query(
    `INSERT INTO ticket_projection (tenant, project, ticket, phase, seq)
     VALUES ($1,$2,$3,$4,$5)`,
    [...keysOf(project, ticket), phase, project.authorizingSeq + 100],
  );
  await aSpawn(
    project,
    ticket,
    "SpawnWork",
    { task: aWorkTask, kind: "Work" },
    label,
  );
  const a = { ...project, ticket };
  const work = await finalizerPassedWork(rig, a, `a-${label}`, []);
  await finalizerDeclareSource(
    rig,
    a,
    work,
    source.ref,
    source.commit,
    source.tip,
  );
  if (phase === "Evaluation") await aEvaluating(project, ticket, label);
  const request = finalizerIdentity(`request-a-${label}`);
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation, kind, state, work_cycle,
        finalization_generation)
     VALUES ($1,$2,$3,$4,1,$5,$4,1,'RunFinalizer','Fulfilled',1,1)`,
    [
      project.partition.tenant,
      project.partition.project,
      request,
      project.authorizingSeq - 1,
      ticket,
    ],
  );
  return request;
}

/**
 * B, accepted at a commit of its own off the reference's tip, and A ranked
 * ahead of it in `phase`, accepted at another, each touching a file of its own.
 */
async function pairOpened(
  label: string,
  phase: string,
  proposing = false,
): Promise<Pair> {
  const { project, remote, work } = await finalizerSubject(rig, label, []);
  const tip = finalizerGitVerb(remote.origin, "rev-parse", "refs/heads/main");
  const ticket = project.ticket;
  const bRef = `refs/heads/chuggy/tickets/${String(ticket)}/attempts/b`;
  const bCommit = finalizerRemoteAttempt(remote, "b.txt", "b\n", bRef);
  await finalizerDeclareSource(rig, project, work, bRef, bCommit, tip);
  await finalizerBriefLanding(
    rig,
    project.partition,
    ticket,
    "Stacked",
    project.repository,
  );
  const aTicket = ticket + 1;
  const aRef = `refs/heads/chuggy/tickets/${String(aTicket)}/attempts/a`;
  const aCommit = finalizerRemoteAttempt(remote, "a.txt", "a\n", aRef);
  if (proposing)
    await finalizerBriefProposal(
      rig,
      project.partition,
      ticket,
      `refs/heads/${label}-b`,
    );
  const aRequest = await aPlaced(
    project,
    aTicket,
    phase,
    label,
    { ref: aRef, commit: aCommit, tip },
    proposing ? `refs/heads/${label}-a` : undefined,
  );
  return {
    b: project,
    bWork: work,
    remote,
    tip,
    aCommit,
    aRequest,
    aTicket,
    aRank: Number(await rankOf(project, aTicket)),
    bCommit,
  };
}

/** The queue of B's reference as the store reads it. */
function queueOf(pair: Pair): Promise<readonly StackEntry[]> {
  return postgresEvaluationStack(rig.pool).queue(
    pair.b.partition,
    pair.b.repository,
    undefined,
  );
}

/** The queue's tickets in rank order, and each one's phase. */
async function queued(pair: Pair) {
  return [...(await queueOf(pair))]
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => [entry.ticket, entry.phase]);
}

/** Chooses and mints B's stack from the queue the store reads, and records it. */
async function bStacked(pair: Pair): Promise<EvaluationStack> {
  const prepared = await stackPrepared(
    {
      store: postgresEvaluationStack(rig.pool),
      briefs: postgresTicketBrief(rig.pool),
      git: finalizerRemotePort(rig),
    },
    asRecoveryEpoch(pair.b.epoch),
    {
      partition: pair.b.partition,
      ticket: asTicketId(pair.b.ticket),
      cycle: 1,
      repository: pair.b.repository,
      commit: asGitObjectId(pair.bCommit),
    },
  );
  assert.equal(prepared?.prepared, "Stack");
  if (prepared?.prepared !== "Stack") throw new Error("B was not stacked");
  assert.equal(
    await recordStack(rig.pool, pair.b.partition, prepared.stack),
    "Written",
  );
  return prepared.stack;
}

/** The queue, and whether the stack B was evaluated over stands over it. */
async function bStanding(pair: Pair) {
  const queue = await queueOf(pair);
  const entry = queue.find((each) => each.ticket === pair.b.ticket);
  assert.ok(entry?.stack !== undefined, "B's stack is read with the queue");
  return { queue, stands: stackStands(entry.stack, queue) };
}

/** The rank the store derives for one ticket of the project. */
async function rankOf(
  project: FinalizerProject,
  ticket: number,
): Promise<unknown> {
  const [row] = await rig.as(
    `SELECT ticket_finalization_rank($1,$2,$3)::text AS rank`,
    [...keysOf(project, ticket)],
  );
  return row?.["rank"];
}

async function bAttempts(pair: Pair) {
  return rig.as(
    `SELECT outcome, failure_kind, candidate_commit, recheck_commit
       FROM finalization_attempt WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(pair.b, pair.b.ticket)],
  );
}

/** A's evaluation sending it back to rework, journaled after the request its rank was taken at. */
async function aReworked(pair: Pair, label: string): Promise<void> {
  const [last] = await rig.harness.query(
    `SELECT max(seq)::int AS seq FROM journal_entry WHERE tenant=$1 AND project=$2`,
    [pair.b.partition.tenant, pair.b.partition.project],
  );
  const obligation = {
    task: {
      type: "EvaluationTask",
      value: {
        ticket: pair.aTicket,
        workCycle: 1,
        stage: 1,
        generation: 1,
        evaluator: 1,
      },
    },
    definition: releasedEvaluatorDefinition,
    contextRef: 1,
  };
  await seedJournalEntry(
    rig.harness,
    pair.b.partition,
    `rework-a-${label}`,
    Number(last?.["seq"]) + 1,
    {
      type: "TicketEvaluationReworkStarted",
      value: {
        ticket: pair.aTicket,
        report: {
          type: "EvaluationResultReport",
          value: {
            ticket: pair.aTicket,
            result: { obligation, resultRef: 1 },
            verdict: "EvaluatorFail",
          },
        },
        evidence: [{ evaluator: 1, resultRef: 1 }],
      },
    },
  );
}

function bClaim(pair: Pair): FinalizationClaim {
  return {
    partition: pair.b.partition,
    ticket: pair.b.ticket,
  } as FinalizationClaim;
}

test("B evaluates over a stack holding A, and once A lands B lands as its merge is the stack's tree, with no re-check", async () => {
  const pair = await pairOpened("flow-lands", "Finalization");

  assert.deepEqual(await queued(pair), [
    [pair.aTicket, "Pending"],
    [pair.b.ticket, "Pending"],
  ]);
  const stack = await bStacked(pair);

  assert.deepEqual(stack.beneath, [
    { ticket: pair.aTicket, commit: pair.aCommit },
  ]);
  assert.equal(stack.tip, pair.tip);
  assert.equal(
    finalizerGitVerb(
      pair.remote.origin,
      "rev-parse",
      stackRefOf(pair.b.ticket, 1),
    ),
    stack.stackCommit,
  );

  finalizerGitVerb(
    pair.remote.origin,
    "update-ref",
    landingTarget,
    pair.aCommit,
    pair.tip,
  );
  await landingWrite(
    rig,
    { ...pair.b, request: pair.aRequest },
    pair.bWork,
    "flow-lands-a",
    {
      ticket: pair.aTicket,
      accepted: pair.aCommit,
      onto: pair.tip,
      candidate: pair.aCommit,
    },
  );
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Done' WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(pair.b, pair.aTicket)],
  );
  assert.equal((await bStanding(pair)).stands, true, "A landed as stacked");

  await finalizerPassOnce(rig, pair.b, finalizerRemotePort(rig), "flow-lands");

  const [attempt, ...rest] = await bAttempts(pair);
  assert.deepEqual(rest, []);
  assert.equal(attempt?.["outcome"], "Prepared");
  assert.equal(attempt?.["failure_kind"], null);
  assert.equal(
    finalizerGitVerb(
      pair.remote.origin,
      "merge-tree",
      "--write-tree",
      landingTarget,
      pair.bCommit,
    ),
    stack.stackTree,
    "what B lands on A is the tree it was evaluated over",
  );
  assert.equal(
    await postgresFinalizer(rig.pool).ticketRecheckFailures(bClaim(pair)),
    0,
  );
});

test("B evaluates over a stack holding A, and once A's evaluation fails B is re-checked at its rank and the front, counting nothing", async () => {
  const pair = await pairOpened("flow-fails", "Evaluation");

  assert.deepEqual(await queued(pair), [
    [pair.aTicket, "Evaluation"],
    [pair.b.ticket, "Pending"],
  ]);
  const stack = await bStacked(pair);

  assert.deepEqual(stack.beneath, [
    { ticket: pair.aTicket, commit: pair.aCommit },
  ]);
  const rank = await rankOf(pair.b, pair.b.ticket);
  assert.ok(pair.aRank < Number(rank), "A is ranked ahead of B");

  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Work' WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(pair.b, pair.aTicket)],
  );
  await aReworked(pair, "flow-fails");
  assert.equal(
    await rankOf(pair.b, pair.aTicket),
    null,
    "A's rank is released",
  );
  const standing = await bStanding(pair);
  assert.equal(standing.stands, false, "B's stack died with A's evaluation");
  assert.deepEqual(
    await queued(pair),
    [[pair.b.ticket, "Pending"]],
    "B is the front of its queue once A's rank is released",
  );

  await finalizerPassOnce(rig, pair.b, finalizerRemotePort(rig), "flow-fails");

  const attempts = await bAttempts(pair);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.["outcome"], "Failed");
  assert.equal(attempts[0]?.["failure_kind"], "RecheckRequired");
  assert.equal(attempts[0]?.["recheck_commit"], pair.bCommit);
  assert.equal(
    await postgresFinalizer(rig.pool).ticketRecheckFailures(bClaim(pair)),
    0,
    "a re-check a dead stack forced counts nothing toward the cap",
  );
  assert.equal(await rankOf(pair.b, pair.b.ticket), rank, "B keeps its rank");
  assert.deepEqual(
    await queued(pair),
    [[pair.b.ticket, "Pending"]],
    "and the front",
  );
});

/** A's proposal, from its own branch, merged into the reference at A's commit. */
async function aProposalMerged(pair: Pair, label: string): Promise<void> {
  finalizerGitVerb(
    pair.remote.origin,
    "update-ref",
    landingTarget,
    pair.aCommit,
    pair.tip,
  );
  await landingWrite(
    rig,
    { ...pair.b, request: pair.aRequest },
    pair.bWork,
    label,
    {
      ticket: pair.aTicket,
      accepted: pair.aCommit,
      onto: pair.tip,
      candidate: pair.aCommit,
      proposal: { head: `refs/heads/${label}-a`, merged: pair.aCommit },
    },
  );
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Done' WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(pair.b, pair.aTicket)],
  );
}

test("B proposing from its own branch is stacked over A proposing from another while A is evaluated, on the base's tip, and lands on the stack's tree once A merges", async () => {
  const pair = await pairOpened("flow-proposals", "Evaluation", true);

  assert.deepEqual(await queued(pair), [
    [pair.aTicket, "Evaluation"],
    [pair.b.ticket, "Pending"],
  ]);
  const stack = await bStacked(pair);
  assert.deepEqual(stack.beneath, [
    { ticket: pair.aTicket, commit: pair.aCommit },
  ]);
  assert.equal(stack.target, landingTarget, "minted on the base");
  assert.equal(stack.tip, pair.tip);

  await aProposalMerged(pair, "flow-proposals");
  assert.equal((await bStanding(pair)).stands, true, "A merged as stacked");

  await finalizerPassOnce(
    rig,
    pair.b,
    finalizerRemotePort(rig),
    "flow-proposals",
  );
  const [attempt, ...rest] = await bAttempts(pair);
  assert.deepEqual(rest, []);
  assert.equal(attempt?.["outcome"], "Prepared");
  assert.equal(attempt?.["failure_kind"], null);
});

test("B proposing over A is re-checked where the base moved past A's merge, its landing not the stack's tree", async () => {
  const pair = await pairOpened("flow-proposals-moved", "Evaluation", true);
  await bStacked(pair);
  await aProposalMerged(pair, "flow-proposals-moved");
  finalizerGitVerb(pair.remote.seed, "fetch", "-q", pair.remote.origin, "main");
  finalizerGitVerb(pair.remote.seed, "reset", "-q", "--hard", "FETCH_HEAD");
  finalizerRemoteCommit(pair.remote, "other.txt", "other\n", "other");

  await finalizerPassOnce(
    rig,
    pair.b,
    finalizerRemotePort(rig),
    "flow-proposals-moved",
  );
  const attempts = await bAttempts(pair);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0]?.["failure_kind"], "RecheckRequired");
  assert.equal(attempts[0]?.["recheck_commit"], pair.bCommit);
});
