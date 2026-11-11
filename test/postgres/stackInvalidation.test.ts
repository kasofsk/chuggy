/**
 * A stack that stopped standing, against a real PostgreSQL: the finalizer finds
 * the evaluation over it, offers its invalidation through its own door once, and
 * marks the stack dead in the same transaction; the writer then abandons the
 * evaluation without counting a rework, and only the finalizer can offer it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresEvaluationStack } from "../../src/adapters/postgres/evaluationStack.ts";
import {
  ticketServiceRole,
  schedulerRole,
  apiRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import type { EvaluationStackStore } from "../../src/interpreter/evaluationStack.ts";
import { asRecoveryEpoch } from "../../src/interpreter/projectStore.ts";
import { stackInvalidations } from "../../src/interpreter/stackInvalidation.ts";
import {
  finalizerCommit,
  finalizerBriefLanding,
  finalizerBriefProposal,
  finalizerDeclareSource,
  finalizerAccept,
  finalizerDrain,
  finalizerEntering,
  finalizerEvaluation,
  finalizerPassedWork,
  finalizerPhase,
  finalizerTaskDone,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  landingTarget,
  recordStack,
  recordStackBeneathNobody,
} from "./evaluationStackLandings.ts";
import { postgresHarnessDenial, postgresHarnessRolePool } from "./harness.ts";

let rig: FinalizerRig;
let servicePool: pg.Pool;

const finalizerStore = (): EvaluationStackStore =>
  postgresEvaluationStack(rig.pool);
const serviceStore = (): EvaluationStackStore =>
  postgresEvaluationStack(servicePool);

before(async () => {
  servicePool = postgresHarnessRolePool(ticketServiceRole);
  rig = await finalizerRigOpen();
});
after(async () => {
  await rig.close();
  await servicePool.end();
});

/** A Stacked ticket evaluating over a stack whose one ticket beneath is nowhere in the queue, merging a proposal from `proposing` where named. */
async function evaluatingOverGone(
  label: string,
  proposing?: string,
): Promise<FinalizerProject> {
  const entering = await finalizerEntering(rig, label);
  const [pinned] = await rig.harness.query(
    `SELECT revision, digest FROM configuration_revision WHERE tenant=$1 AND project=$2`,
    [entering.partition.tenant, entering.partition.project],
  );
  const project: FinalizerProject = {
    partition: entering.partition,
    request: "",
    ticket: 1,
    authorizingSeq: 0,
    requestGeneration: 0,
    epoch: await rig.harness.store.currentRecoveryEpoch(),
    repository: entering.repository,
    configurationRevision: String(pinned?.["revision"]),
    configurationDigest: String(pinned?.["digest"]),
    memory: entering.memory,
  };
  await finalizerBriefLanding(
    rig,
    project.partition,
    project.ticket,
    "Stacked",
    project.repository,
  );
  if (proposing !== undefined)
    await finalizerBriefProposal(
      rig,
      project.partition,
      project.ticket,
      proposing,
    );
  const work = await finalizerPassedWork(rig, project, label, []);
  await finalizerDeclareSource(
    rig,
    project,
    work,
    "refs/heads/work",
    finalizerCommit(),
  );
  await recordStackBeneathNobody(rig.pool, project);
  return project;
}

async function ownEvaluating(project: FinalizerProject) {
  return (await finalizerStore().evaluating(256)).filter(
    (each) =>
      each.partition.tenant === project.partition.tenant &&
      each.partition.project === project.partition.project,
  );
}

async function rankOf(project: FinalizerProject): Promise<unknown> {
  const [row] = await rig.harness.query(
    `SELECT ticket_finalization_rank($1,$2,$3)::text AS rank`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  return row?.["rank"];
}

async function operationsOf(project: FinalizerProject) {
  return rig.harness.query(
    `SELECT operation, authority_kind, command_tag FROM operation
      WHERE tenant=$1 AND project=$2 AND command_tag='InvalidateEvaluation'`,
    [project.partition.tenant, project.partition.project],
  );
}

test("the sweep finds the evaluation over a stack that no longer stands, and offers it once", async () => {
  const project = await evaluatingOverGone("invalidate-once");
  const epoch = asRecoveryEpoch(project.epoch);
  const [found] = await ownEvaluating(project);
  assert.equal(found?.cycle, 1);
  assert.ok(found !== undefined);
  const queue = await finalizerStore().queue(
    project.partition,
    found.repository,
    found.target,
  );
  const dead = stackInvalidations([found], queue);
  assert.equal(dead.length, 1);

  assert.equal(
    await finalizerStore().invalidate(
      project.partition,
      found.ticket,
      1,
      epoch,
    ),
    "Submitted",
  );
  assert.equal(
    await finalizerStore().invalidate(
      project.partition,
      found.ticket,
      1,
      epoch,
    ),
    "AlreadySubmitted",
  );
  assert.equal((await operationsOf(project)).length, 1);
  assert.equal(
    (await operationsOf(project))[0]?.["authority_kind"],
    "Finalizer",
  );
  assert.deepEqual(
    await ownEvaluating(project),
    [],
    "a stack offered is not looked at again",
  );
  const marked = await serviceStore().dead(project.partition, found.ticket);
  assert.deepEqual([...marked.keys()], [1]);
  assert.ok((marked.get(1) ?? -1) >= 0);
});

test("an evaluation over a proposal's stack is read on the proposal's base, not its own branch", async () => {
  const project = await evaluatingOverGone(
    "invalidate-proposal",
    "refs/heads/invalidate-proposal",
  );
  const [found] = await ownEvaluating(project);
  assert.ok(found !== undefined);
  assert.equal(found.target, undefined, "the base it names none of");
});

test("the writer abandons the evaluation, opens a new cycle and counts no rework", async () => {
  const project = await evaluatingOverGone("invalidate-decided");
  const epoch = asRecoveryEpoch(project.epoch);
  assert.equal(await finalizerPhase(rig, project.partition), "Evaluation");
  await rig.harness.query(
    `INSERT INTO finalization_request
       (tenant, project, request, authorizing_seq, effect_position, ticket,
        ticket_version, request_generation, kind, work_cycle, finalization_generation)
     VALUES ($1,$2,'earlier-request',1,0,$3,1,1,'RunFinalizer',1,1)`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  const ranked = await rankOf(project);
  assert.equal(ranked, "1", "the ticket holds a rank to keep");
  assert.equal(
    await finalizerStore().invalidate(
      project.partition,
      asTicketId(project.ticket),
      1,
      epoch,
    ),
    "Submitted",
  );

  const drained = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );

  assert.deepEqual(drained.decided, ["Committed"]);
  assert.equal(await finalizerPhase(rig, project.partition), "Work");
  assert.equal(await rankOf(project), ranked, "the invalidation kept its rank");
  const [counted] = await rig.harness.query(
    `SELECT ticket_stacked_failures($1,$2,$3) AS failures`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  assert.equal(counted?.["failures"], "0");
  assert.equal(await lastEvent(project), "TicketEvaluationInvalidated");
});

test("a stack is refused under an epoch that is not current, and for a ticket that is not evaluating", async () => {
  const project = await evaluatingOverGone("invalidate-refused");
  const ticket = asTicketId(project.ticket);
  assert.equal(
    await finalizerStore().invalidate(
      project.partition,
      ticket,
      1,
      asRecoveryEpoch("not-the-epoch"),
    ),
    "Refused",
  );
  assert.equal(
    await finalizerStore().invalidate(
      project.partition,
      ticket,
      2,
      asRecoveryEpoch(project.epoch),
    ),
    "Refused",
    "a cycle with no stack record",
  );
  assert.equal((await operationsOf(project)).length, 0);
  assert.equal((await serviceStore().dead(project.partition, ticket)).size, 0);
});

test("a cycle that is not the ticket's current one writes no marker and consumes no key", async () => {
  const project = await evaluatingOverGone("invalidate-stale");
  const ticket = asTicketId(project.ticket);
  const epoch = asRecoveryEpoch(project.epoch);
  await recordStack(rig.pool, project.partition, {
    ticket,
    cycle: 2,
    repository: project.repository,
    target: landingTarget,
    tip: asGitObjectId(finalizerCommit()),
    beneath: [
      { ticket: asTicketId(999), commit: asGitObjectId(finalizerCommit()) },
    ],
    stackCommit: asGitObjectId(finalizerCommit()),
    stackTree: asGitObjectId(finalizerCommit()),
  });
  assert.equal(
    await finalizerStore().invalidate(project.partition, ticket, 2, epoch),
    "Refused",
  );
  assert.equal((await operationsOf(project)).length, 0);
  assert.equal((await serviceStore().dead(project.partition, ticket)).size, 0);
  assert.equal(
    await finalizerStore().invalidate(project.partition, ticket, 1, epoch),
    "Submitted",
    "the stale offer left the key of the cycle that stands",
  );
});

test("evaluations that never clear cannot hold the rest out of a bounded read", async () => {
  const projects = [];
  for (let at = 0; at < 3; at += 1)
    projects.push(await evaluatingOverGone(`rotate-${String(at)}`));
  const seen = new Set<string>();
  for (let rotation = 0; rotation < 200; rotation += 1) {
    for (const each of await finalizerStore().evaluating(1, rotation))
      seen.add(each.partition.project);
  }
  for (const project of projects)
    assert.ok(seen.has(project.partition.project));
});

test("only the finalizer opens the door, and the ticket service reads the marker and nothing more", async () => {
  const project = await evaluatingOverGone("invalidate-privileges");
  const partition = project.partition;
  const door = `SELECT * FROM submit_stack_invalidation('${partition.tenant}','${partition.project}',${String(project.ticket)},1,'${project.epoch}','operation-forged','chuggy_finalizer')`;
  for (const role of [apiRole, ticketServiceRole, schedulerRole]) {
    assert.match(
      (await rig.harness.attemptAs(role, door)) ?? "",
      postgresHarnessDenial("submit_stack_invalidation"),
      role,
    );
  }
  assert.equal(
    await rig.harness.attemptAs(
      ticketServiceRole,
      "SELECT * FROM evaluation_stack_dead LIMIT 1",
    ),
    undefined,
  );
  for (const statement of [
    "INSERT INTO evaluation_stack_dead (tenant,project,ticket,work_cycle,observed_seq) VALUES ('t','p',1,1,0)",
    "UPDATE evaluation_stack_dead SET observed_seq = 0",
    "DELETE FROM evaluation_stack_dead",
  ]) {
    for (const role of [
      ticketServiceRole,
      "chuggy_finalizer",
      schedulerRole,
      apiRole,
    ]) {
      assert.match(
        (await rig.harness.attemptAs(role, statement)) ?? "",
        postgresHarnessDenial("evaluation_stack_dead"),
        `${role}: ${statement}`,
      );
    }
  }
});

/** The type of the last event the project journaled. */
async function lastEvent(project: FinalizerProject): Promise<unknown> {
  const events = await rig.harness.query(
    `SELECT entry::jsonb->'event'->>'type' AS type FROM journal_entry
      WHERE tenant=$1 AND project=$2 ORDER BY seq DESC LIMIT 1`,
    [project.partition.tenant, project.partition.project],
  );
  return events[0]?.["type"];
}

async function failedVerdict(project: FinalizerProject): Promise<void> {
  const accepted = await finalizerAccept(
    rig.harness,
    project.partition,
    "failed-verdict",
    finalizerTaskDone(project.memory.graph, finalizerEvaluation(1), "Fail"),
  );
  assert.equal(accepted, "Accepted");
  const drained = await finalizerDrain(
    rig.harness,
    project.partition,
    project.memory,
  );
  assert.deepEqual(drained.decided, ["Committed"]);
}

test("a failed verdict on a cycle marked dead is no rework, and on any other it is one", async () => {
  const unmarked = await evaluatingOverGone("verdict-unmarked");
  await failedVerdict(unmarked);
  assert.equal(await lastEvent(unmarked), "TicketEvaluationReworkStarted");

  const marked = await evaluatingOverGone("verdict-marked");
  await rig.harness.query(
    `INSERT INTO evaluation_stack_dead (tenant,project,ticket,work_cycle,observed_seq)
     VALUES ($1,$2,$3,1,5)`,
    [marked.partition.tenant, marked.partition.project, marked.ticket],
  );
  await failedVerdict(marked);
  assert.equal(await lastEvent(marked), "TicketEvaluationFailureInvalidated");
  assert.equal(await finalizerPhase(rig, marked.partition), "Work");
});
