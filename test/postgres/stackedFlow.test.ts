/**
 * Two Stacked tickets on one reference, against a real PostgreSQL and a real
 * repository: A ranked ahead, and B, whose stack the finalizer chooses from the
 * queue as it stands and mints over A. Where A lands, B lands by its merge
 * being the stack's tree and is never re-checked; where A's evaluation fails
 * instead, B's stack stops standing and B is re-checked at its rank, at the
 * front of the queue, with nothing counted toward its re-check cap.
 *
 * B IS THE TICKET THE WRITER AND THE FINALIZER DRIVE, AND A IS WRITTEN BY HAND.
 * The harness drives one ticket through the writer, so A's definition, phase
 * and the request it is ranked by are rows a case places directly, its landing
 * is the rows `evaluationStackLandings.ts` writes, and its entry in the queue
 * is the case's own, beside the entries the store reads, as
 * `evaluationStackStanding.test.ts` gives the tickets beneath. A's evaluation
 * failing is A leaving the queue: it is back in Work, and the request its rank
 * was taken at is gone, which is what the rework's journal entry does to the
 * derived rank. B's evaluation has passed before its stack is recorded, so the
 * record is written as the finalizer role writes it; that a spawn reads it is
 * `evaluationStackDecision.test.ts`'s.
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
  type StackPhase,
} from "../../src/interpreter/stackChoice.ts";
import { postgresTicketBrief } from "../../src/adapters/postgres/ticketBrief.ts";
import {
  landingTarget,
  landingWrite,
  recordStack,
} from "./evaluationStackLandings.ts";
import {
  finalizerBriefLanding,
  finalizerDeclareSource,
  finalizerGitVerb,
  finalizerIdentity,
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

/** Writes A beside B in `phase`, released with B's brief and ranked ahead of it by a request of its own. */
async function aPlaced(
  project: FinalizerProject,
  ticket: number,
  phase: string,
  label: string,
): Promise<string> {
  const [brief] = await rig.harness.query(
    `SELECT brief FROM ticket_definition WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(project, project.ticket)],
  );
  await finalizerStoreReleasedBrief(
    (sql, values) => rig.harness.query(sql, [...values]),
    [...keysOf(project, ticket)],
    brief?.["brief"] as Record<string, unknown>,
  );
  await rig.harness.query(
    `INSERT INTO ticket_projection (tenant, project, ticket, phase, seq)
     VALUES ($1,$2,$3,$4,$5)`,
    [...keysOf(project, ticket), phase, project.authorizingSeq + 100],
  );
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
async function pairOpened(label: string, phase: string): Promise<Pair> {
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
  const aCommit = finalizerRemoteAttempt(
    remote,
    "a.txt",
    "a\n",
    `refs/heads/chuggy/tickets/${String(aTicket)}/attempts/a`,
  );
  const aRequest = await aPlaced(project, aTicket, phase, label);
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

/** A's entry in the queue, in `phase` at the commit it was accepted at. */
function aEntry(pair: Pair, phase: StackPhase): StackEntry {
  return {
    ticket: asTicketId(pair.aTicket),
    policy: "Stacked",
    phase,
    rank: pair.aRank,
    commit: asGitObjectId(pair.aCommit),
    stack: undefined,
  };
}

/** The queue of B's reference as the store reads it, with A's entry where it is in one. */
async function queueOf(
  pair: Pair,
  a: StackEntry | undefined,
): Promise<readonly StackEntry[]> {
  const read = await postgresEvaluationStack(rig.pool).queue(
    pair.b.partition,
    pair.b.repository,
    undefined,
  );
  return a === undefined ? read : [a, ...read];
}

/** Chooses and mints B's stack from the queue A is in, and records it. */
async function bStacked(pair: Pair, a: StackEntry): Promise<EvaluationStack> {
  const stacks = postgresEvaluationStack(rig.pool);
  const prepared = await stackPrepared(
    {
      store: { ...stacks, queue: () => queueOf(pair, a) },
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

/** The queue with A's entry where it is in one, and whether the stack B was evaluated over stands over it. */
async function bStanding(pair: Pair, a: StackEntry | undefined) {
  const queue = await queueOf(pair, a);
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

function bClaim(pair: Pair): FinalizationClaim {
  return {
    partition: pair.b.partition,
    ticket: pair.b.ticket,
  } as FinalizationClaim;
}

test("B evaluates over a stack holding A, and once A lands B lands as its merge is the stack's tree, with no re-check", async () => {
  const pair = await pairOpened("flow-lands", "Finalization");

  const stack = await bStacked(pair, aEntry(pair, "Pending"));

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
  assert.equal(
    (await bStanding(pair, undefined)).stands,
    true,
    "A landed as stacked",
  );

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

  const stack = await bStacked(pair, aEntry(pair, "Evaluation"));

  assert.deepEqual(stack.beneath, [
    { ticket: pair.aTicket, commit: pair.aCommit },
  ]);
  const rank = await rankOf(pair.b, pair.b.ticket);
  assert.ok(pair.aRank < Number(rank), "A is ranked ahead of B");

  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Work' WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(pair.b, pair.aTicket)],
  );
  await rig.harness.query(
    `DELETE FROM finalization_request WHERE tenant=$1 AND project=$2 AND request=$3`,
    [pair.b.partition.tenant, pair.b.partition.project, pair.aRequest],
  );
  const standing = await bStanding(pair, aEntry(pair, "Work"));
  assert.equal(standing.stands, false, "B's stack died with A's evaluation");
  assert.deepEqual(
    (await queueOf(pair, undefined)).map((entry) => entry.ticket),
    [pair.b.ticket],
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
    (await queueOf(pair, undefined)).map((entry) => entry.ticket),
    [pair.b.ticket],
    "and the front",
  );
});
