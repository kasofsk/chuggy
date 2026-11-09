/**
 * The stack an evaluation runs over, as the ticket service holds it: the queue
 * read with its landings and the record written under the ticket-service role,
 * whether a cycle has started evaluating, and the stacks due to be taken down
 * read as the finalizer.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresEvaluationStack } from "../../src/adapters/postgres/evaluationStack.ts";
import { ticketServiceRole } from "../../src/adapters/postgres/schema/shared.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type {
  EvaluationStack,
  EvaluationStackStore,
} from "../../src/interpreter/evaluationStack.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import {
  finalizerCommit,
  finalizerPassedWork,
  finalizerRigOpen,
  finalizerSpawnTasks,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";
import {
  landingCommits,
  landingTarget,
  landingWrite,
  stackedSubject,
} from "./evaluationStackLandings.ts";
import { postgresHarnessRolePool } from "./harness.ts";

let rig: FinalizerRig;
let servicePool: pg.Pool;
let service: EvaluationStackStore;
let finalizer: EvaluationStackStore;

before(async () => {
  rig = await finalizerRigOpen();
  servicePool = postgresHarnessRolePool(ticketServiceRole);
  service = postgresEvaluationStack(servicePool);
  finalizer = postgresEvaluationStack(rig.pool);
});
after(async () => {
  await servicePool.end();
  await rig.close();
});

function stackOf(
  project: FinalizerProject,
  tip = finalizerCommit(),
  cycle = 1,
): EvaluationStack {
  return {
    ticket: asTicketId(project.ticket),
    cycle,
    repository: project.repository,
    target: landingTarget,
    tip: asGitObjectId(tip),
    beneath: [
      { ticket: asTicketId(7), commit: asGitObjectId(finalizerCommit()) },
    ],
    stackCommit: asGitObjectId(finalizerCommit()),
    stackTree: asGitObjectId(finalizerCommit()),
  };
}

test("the ticket service reads the queue with its landings and the failures, and writes and reads a stack", async () => {
  const own = finalizerCommit();
  const { project, work } = await stackedSubject(rig, "service-reads", own);
  const c = landingCommits("tip", "first", "a7");
  await landingWrite(rig, project, work, "service-7", {
    ticket: 7,
    accepted: c.a7,
    onto: c.tip,
    candidate: c.first,
  });
  const stack = stackOf(project, c.tip);
  assert.equal(await service.record(project.partition, stack), "Written");
  assert.deepEqual(
    await service.read(project.partition, stack.ticket, 1),
    stack,
  );
  const [mine] = await service.queue(
    project.partition,
    project.repository,
    undefined,
  );
  assert.equal(mine?.commit, own);
  assert.deepEqual(
    mine?.stack?.landings.map((one) => [one.ticket, one.commit]),
    [[7, c.a7]],
  );
  assert.equal(await service.stackFailures(project.partition, stack.ticket), 0);
});

test("an evaluation is registered for the cycle it judges and no other", async () => {
  const { project } = await stackedSubject(rig, "service-evaluated");
  const ticket = asTicketId(project.ticket);
  assert.equal(await service.evaluated(project.partition, ticket, 1), true);
  assert.equal(await service.evaluated(project.partition, ticket, 2), false);
  await finalizerSpawnTasks(rig, project, [2]);
  assert.equal(await service.evaluated(project.partition, ticket, 2), false);
  await rig.harness.query(
    `INSERT INTO execution_request_task
       (tenant, project, request, task, kind, stage, cycle, generation, evaluator)
     SELECT $1,$2,request,500,'Evaluation',1,2,1,1
       FROM execution_request_task
      WHERE tenant=$1 AND project=$2 AND kind='Work' LIMIT 1`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(await service.evaluated(project.partition, ticket, 2), true);
});

test("a stack is due to be taken down once its ticket has begun a later cycle, and until it is noted", async () => {
  const { project } = await stackedSubject(rig, "service-removable");
  const ticket = asTicketId(project.ticket);
  await finalizer.record(project.partition, stackOf(project));
  const due = async () =>
    (await finalizer.removable(1000)).filter(
      (each) =>
        each.partition.project === project.partition.project &&
        each.ticket === ticket,
    );
  assert.deepEqual(await due(), []);
  await finalizerSpawnTasks(rig, project, [2]);
  assert.deepEqual(await due(), [], "a cycle not yet begun is no later cycle");
  await finalizerPassedWork(rig, project, "service-removable-2", []);
  assert.deepEqual(
    (await due()).map((each) => [each.cycle, each.repository]),
    [[1, project.repository]],
  );
  assert.equal(await finalizer.remove(project.partition, ticket, 1), "Removed");
  assert.deepEqual(await due(), []);
});

test("a stack of a Done or Revoked ticket is due to be taken down", async () => {
  for (const phase of ["Done", "Revoked"]) {
    const { project } = await stackedSubject(rig, `service-${phase}`);
    await finalizer.record(project.partition, stackOf(project));
    const due = async () =>
      (await finalizer.removable(1000)).filter(
        (each) => each.partition.project === project.partition.project,
      );
    assert.deepEqual(await due(), []);
    await rig.harness.query(
      `UPDATE ticket_projection SET phase=$4
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        project.partition.tenant,
        project.partition.project,
        project.ticket,
        phase,
      ],
    );
    assert.equal((await due()).length, 1, phase);
  }
});
