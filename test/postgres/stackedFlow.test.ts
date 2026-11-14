/**
 * Two Stacked tickets on one reference, against a real PostgreSQL and a real
 * repository: A ranked ahead, and B, whose stack the finalizer chooses from the
 * queue as it stands and mints over A. Where A lands, B lands by its merge
 * being the stack's tree and is never re-checked; where A's evaluation fails
 * instead, B's stack stops standing and B is re-checked at its rank, at the
 * front of the queue. Where B evaluated unstacked behind A pending, B is sent
 * back to Work to re-stack over A, and lands after A the same way.
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

import { postgresEvaluationStack } from "../../src/adapters/postgres/evaluationStack.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { ledgerAt } from "../../src/domain/ledger.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import { evaluationFailureReworksStarted } from "../../src/domain/ticket.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import type { TaskIdentity } from "../../src/domain/generated/modelTypes.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import {
  asForgeBindingId,
  asForgeCredentialReference,
  asProposalDisplayUrl,
  asProposalNumber,
  asProposalRemoteIdentity,
  type ChangeProposalForges,
  type ChangeProposalPort,
  type ChangeProposalRequest,
} from "../../src/interpreter/changeProposal.ts";
import {
  stackRefOf,
  type EvaluationStack,
} from "../../src/interpreter/evaluationStack.ts";
import { stackPrepared } from "../../src/interpreter/evaluationStacking.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
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
import type { FinalizerPassReport } from "../../src/interpreter/finalizerRun.ts";
import {
  finalizerBriefLanding,
  finalizerBriefProposal,
  finalizerAccept,
  finalizerDeclareSource,
  finalizerDrain,
  finalizerEvaluation,
  finalizerExpireClaim,
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
  finalizerTaskDone,
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
});

test("B evaluates over a stack holding A, and once A's evaluation fails B is re-checked at its rank and the front", async () => {
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

/** The proposal a fixture forge answers with, which is the request's own fields, open and mergeable. */
function proposalOpened(request: ChangeProposalRequest) {
  return {
    identity: {
      forge: request.binding.forge,
      remote: asProposalRemoteIdentity("proposal-flow"),
      number: asProposalNumber(1),
    },
    repository: request.repository,
    marker: request.marker,
    head: request.head,
    base: request.base,
    title: request.title,
    body: request.body,
    status: "Open" as const,
    mergeability: "Mergeable" as const,
    url: asProposalDisplayUrl("https://forge.invalid/proposals/1"),
  };
}

/**
 * A forge that opens what it is asked for and merges it into the base as a
 * commit recording `tree`, over the base's tip and the head it was asked to
 * merge, which is what a forge's merge leaves on the remote.
 */
function forgeMergingAt(
  origin: string,
  tree: () => string,
): ChangeProposalForges {
  const refused = (what: string) => () => {
    throw new Error(`the pass asked this forge to ${what}`);
  };
  const port: ChangeProposalPort = {
    create: (request) =>
      Promise.resolve({
        created: "Created",
        evidence: proposalOpened(request),
      }),
    readByMarker: () => Promise.resolve({ read: "Absent" }),
    readByNumber: refused("read a proposal by number"),
    merge: (request) => {
      const base = finalizerGitVerb(origin, "rev-parse", landingTarget);
      const merged = finalizerGitVerb(
        origin,
        "-c",
        "user.name=forge",
        "-c",
        "user.email=forge@example.test",
        "commit-tree",
        tree(),
        "-p",
        base,
        "-p",
        request.headCommit,
        "-m",
        "merge",
      );
      finalizerGitVerb(origin, "update-ref", landingTarget, merged, base);
      return Promise.resolve({
        merged: "Merged",
        mergeCommit: asGitObjectId(merged),
      });
    },
    updateBranch: refused("update a proposal"),
    readQueue: refused("read a merge queue"),
    enqueue: refused("queue a proposal"),
    dequeue: refused("dequeue a proposal"),
  };
  const binding = {
    forge: asForgeBindingId("forge-flow"),
    credential: asForgeCredentialReference("forge-flow-proposals"),
  };
  return { selector: { select: () => port }, bindingOf: () => binding };
}

/** B, prepared over A's merge, taken through its push, its proposal and the merge `forges` makes, and what the pass after that merge reported. */
async function bProposalMerged(
  pair: Pair,
  label: string,
  forges: ChangeProposalForges,
): Promise<FinalizerPassReport | undefined> {
  let report: FinalizerPassReport | undefined;
  for (const step of ["push", "open", "merge", "conclude"]) {
    await finalizerExpireClaim(rig, pair.b);
    report = await finalizerPassOnce(
      rig,
      pair.b,
      finalizerRemotePort(rig),
      `${label}-${step}`,
      forges,
    );
  }
  return report;
}

test("B's proposal stacked over A's, merged into the base at a commit recording the stack's tree, lands", async () => {
  const label = "flow-proposal-lands";
  const pair = await pairOpened(label, "Evaluation", true);
  const stack = await bStacked(pair);
  await aProposalMerged(pair, label);
  await finalizerPassOnce(rig, pair.b, finalizerRemotePort(rig), label);

  const concluding = await bProposalMerged(
    pair,
    label,
    forgeMergingAt(pair.remote.origin, () => stack.stackTree),
  );

  assert.equal(concluding?.conclusions, 1, "B's merge concludes its landing");
  assert.deepEqual(
    (await bAttempts(pair)).map((attempt) => attempt["failure_kind"]),
    [null],
    "B is never sent back",
  );
});

test("B's proposal stacked over A's, merged into the base at a commit recording another tree, is re-checked at its accepted commit", async () => {
  const label = "flow-proposal-differs";
  const pair = await pairOpened(label, "Evaluation", true);
  await bStacked(pair);
  await aProposalMerged(pair, label);
  await finalizerPassOnce(rig, pair.b, finalizerRemotePort(rig), label);

  const concluding = await bProposalMerged(
    pair,
    label,
    forgeMergingAt(pair.remote.origin, () =>
      finalizerGitVerb(
        pair.remote.origin,
        "rev-parse",
        `${pair.aCommit}^{tree}`,
      ),
    ),
  );

  assert.equal(concluding?.conclusions, 0, "B's merge concludes nothing");
  const rechecked = (await bAttempts(pair)).filter(
    (attempt) => attempt["failure_kind"] !== null,
  );
  assert.equal(rechecked.length, 1);
  assert.equal(rechecked[0]?.["failure_kind"], "RecheckRequired");
  assert.equal(rechecked[0]?.["recheck_commit"], pair.bCommit);
});

async function bRestacks(pair: Pair) {
  return rig.as(
    `SELECT outcome, failure_kind, recheck_commit,
            restack_tickets::text[] AS restack_tickets, restack_commits
       FROM finalization_attempt WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(pair.b, pair.b.ticket)],
  );
}

test("B pending unstacked behind A pending is sent back to re-stack over A on the next pass, keeping its rank, and its next claim concludes it", async () => {
  const pair = await pairOpened("flow-restack", "Finalization");
  assert.deepEqual(await queued(pair), [
    [pair.aTicket, "Pending"],
    [pair.b.ticket, "Pending"],
  ]);
  const rank = await rankOf(pair.b, pair.b.ticket);

  await finalizerPassOnce(
    rig,
    pair.b,
    finalizerRemotePort(rig),
    "flow-restack",
  );

  const [attempt, ...rest] = await bRestacks(pair);
  assert.deepEqual(rest, []);
  assert.equal(attempt?.["outcome"], "Failed");
  assert.equal(attempt?.["failure_kind"], "Restack");
  assert.equal(attempt?.["recheck_commit"], pair.bCommit);
  assert.deepEqual(attempt?.["restack_tickets"], [String(pair.aTicket)]);
  assert.deepEqual(attempt?.["restack_commits"], [pair.aCommit]);
  assert.equal(await rankOf(pair.b, pair.b.ticket), rank, "B keeps its rank");

  const operations = async () => {
    const [row] = await rig.harness.query(
      `SELECT count(*)::int AS operations FROM operation WHERE tenant=$1 AND project=$2`,
      [pair.b.partition.tenant, pair.b.partition.project],
    );
    return Number(row?.["operations"]);
  };
  const before = await operations();
  await finalizerExpireClaim(rig, pair.b);
  const concluded = await finalizerPassOnce(
    rig,
    pair.b,
    finalizerRemotePort(rig),
    "flow-restack-concluded",
  );
  assert.ok(concluded.conclusions >= 1, "the waiting request is drawn");
  assert.equal(await operations(), before + 1, "and its conclusion submitted");
  assert.equal((await bRestacks(pair)).length, 1, "nothing more is attempted");
});

test("B already stacked over A is not sent back to re-stack", async () => {
  const pair = await pairOpened("flow-restack-stacked", "Finalization");
  await bStacked(pair);
  await finalizerPassOnce(
    rig,
    pair.b,
    finalizerRemotePort(rig),
    "flow-restack-stacked",
  );
  assert.deepEqual(
    (await bRestacks(pair)).map((row) => row["failure_kind"]),
    [],
  );
});

/** B's phase as the writer's projection holds it. */
async function bPhase(pair: Pair): Promise<unknown> {
  const [row] = await rig.harness.query(
    `SELECT phase FROM ticket_projection WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [...keysOf(pair.b, pair.b.ticket)],
  );
  return row?.["phase"];
}

/** How many reworks the rework cap counts against B in this memory. */
function bReworks(pair: Pair, memory: ProjectMemory): number {
  return evaluationFailureReworksStarted(
    ticketAt(memory.graph, asTicketId(pair.b.ticket)),
    ledgerAt(memory.ledgers, pair.b.ticket),
  );
}

/** Offers one of B's tasks passed and decides everything that enqueues. */
async function bPassed(
  pair: Pair,
  memory: ProjectMemory,
  label: string,
  task: TaskIdentity,
): Promise<ProjectMemory> {
  assert.equal(
    await finalizerAccept(
      rig.harness,
      pair.b.partition,
      label,
      finalizerTaskDone(memory.graph, task),
    ),
    "Accepted",
  );
  const drained = await finalizerDrain(rig.harness, pair.b.partition, memory);
  assert.deepEqual(drained.decided, ["Committed"]);
  return drained.memory;
}

test("B sent back to re-stack re-reports its accepted commit, stacks over A, and once A lands B lands with no re-check and no rework counted", async () => {
  const label = "flow-restack-lands";
  const pair = await pairOpened(label, "Finalization");
  const reworksBefore = bReworks(pair, pair.b.memory);
  const port = finalizerRemotePort(rig);

  await finalizerPassOnce(rig, pair.b, port, label);
  await finalizerExpireClaim(rig, pair.b);
  await finalizerPassOnce(rig, pair.b, port, `${label}-concluded`);
  const sentBack = await finalizerDrain(
    rig.harness,
    pair.b.partition,
    pair.b.memory,
  );
  assert.deepEqual(sentBack.decided, ["Committed"]);
  assert.equal(await bPhase(pair), "Work");
  assert.equal(
    bReworks(pair, sentBack.memory),
    reworksBefore,
    "the send-back is no rework",
  );
  const [recheck] = await rig.harness.query(
    `SELECT r.reference_id FROM execution_request q
       JOIN input_bundle_reference r
         ON r.tenant = q.tenant AND r.project = q.project AND r.bundle = q.input_bundle
      WHERE q.tenant=$1 AND q.project=$2 AND q.ticket=$3 AND q.kind='SpawnWork'
        AND r.reference_kind='Recheck'`,
    [...keysOf(pair.b, pair.b.ticket)],
  );
  assert.equal(
    recheck?.["reference_id"],
    pair.bCommit,
    "the new cycle re-reports B's accepted commit",
  );

  const bRef = `refs/heads/chuggy/tickets/${String(pair.b.ticket)}/attempts/b`;
  const rework = await finalizerPassedWork(rig, pair.b, `${label}-work`, []);
  await finalizerDeclareSource(
    rig,
    pair.b,
    rework,
    bRef,
    pair.bCommit,
    pair.tip,
  );
  await finalizerPassOnce(rig, pair.b, port, `${label}-stack`);
  const stack = await postgresEvaluationStack(rig.pool).read(
    pair.b.partition,
    asTicketId(pair.b.ticket),
    2,
  );
  assert.deepEqual(
    stack?.beneath,
    [{ ticket: pair.aTicket, commit: pair.aCommit }],
    "the new cycle stacks over A",
  );

  const worked = await bPassed(
    pair,
    sentBack.memory,
    `${label}-worked`,
    workTaskIdentity(1, 2),
  );
  const evaluated = await bPassed(
    pair,
    worked,
    `${label}-evaluated`,
    finalizerEvaluation(2),
  );
  assert.equal(await bPhase(pair), "Finalization");
  assert.equal(bReworks(pair, evaluated), reworksBefore);

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
    `${label}-a`,
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
  await finalizerPassOnce(rig, pair.b, port, `${label}-lands`);

  assert.deepEqual(
    (await bAttempts(pair)).map((row) => [row["outcome"], row["failure_kind"]]),
    [
      ["Failed", "Restack"],
      ["Prepared", null],
    ],
    "B is never re-checked",
  );
  assert.equal(
    finalizerGitVerb(
      pair.remote.origin,
      "merge-tree",
      "--write-tree",
      landingTarget,
      pair.bCommit,
    ),
    stack?.stackTree,
    "what B lands on A is the tree it was re-evaluated over",
  );
});
