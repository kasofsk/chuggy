/**
 * The stack an evaluation runs over, as the finalizer prepares it and the ticket
 * service reads it: a cycle prepared once as a record or as the decision to
 * evaluate unstacked, only while it has not begun evaluating, found when it is
 * due, read and nothing else by the ticket service, and the stacks due to be
 * taken down.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import {
  postgresEvaluationStack,
  stackPrepareLockKey,
} from "../../src/adapters/postgres/evaluationStack.ts";
import { ticketServiceRole } from "../../src/adapters/postgres/schema/shared.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type {
  EvaluationStack,
  EvaluationStackStore,
} from "../../src/interpreter/evaluationStack.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import {
  finalizerCommit,
  finalizerDeclareSource,
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
  recordStack,
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

test("the finalizer reads the queue with its landings and the failures, and the ticket service reads what it prepared", async () => {
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
  assert.equal(
    await recordStack(rig.pool, project.partition, stack),
    "Written",
  );
  assert.deepEqual(
    await service.read(project.partition, stack.ticket, 1),
    stack,
  );
  assert.deepEqual(await service.decision(project.partition, stack.ticket, 1), {
    decided: "Stack",
    record: stack,
  });
  const [mine] = await finalizer.queue(
    project.partition,
    project.repository,
    undefined,
  );
  assert.equal(mine?.commit, own);
  assert.deepEqual(
    mine?.stack?.landings.map((one) => [one.ticket, one.commit]),
    [[7, c.a7]],
  );
  assert.equal(
    await finalizer.stackFailures(project.partition, stack.ticket),
    0,
  );
});

test("a cycle is prepared once, as a record or as none, and only while it has not begun evaluating", async () => {
  const { project } = await stackedSubject(rig, "service-prepare");
  const ticket = asTicketId(project.ticket);
  assert.equal(
    await finalizer.prepare(project.partition, {
      prepared: "Stack",
      stack: stackOf(project),
    }),
    "Evaluated",
    "the fixture's cycle 1 has an evaluation registered",
  );
  await finalizerSpawnTasks(rig, project, [2]);
  const none = {
    prepared: "Unstacked",
    ticket,
    cycle: 2,
    reason: "Conflicted",
  } as const;
  assert.equal(await finalizer.prepare(project.partition, none), "Written");
  assert.equal(await finalizer.prepare(project.partition, none), "Present");
  assert.equal(
    await finalizer.prepare(project.partition, {
      prepared: "Stack",
      stack: stackOf(project, finalizerCommit(), 2),
    }),
    "Present",
    "a cycle decided unstacked is not given a stack",
  );
  assert.deepEqual(await service.decision(project.partition, ticket, 2), {
    decided: "Unstacked",
    reason: "Conflicted",
  });
  assert.equal(await service.decision(project.partition, ticket, 3), undefined);
});

test("a cycle is prepared under a lock keyed on it, so a record and a decision never both stand", async () => {
  const { project } = await stackedSubject(rig, "service-prepare-race");
  const ticket = asTicketId(project.ticket);
  await finalizerSpawnTasks(rig, project, [2]);
  const holder = await rig.pool.connect();
  let settled = false;
  try {
    await holder.query("BEGIN");
    await holder.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [stackPrepareLockKey(project.partition, project.ticket, 2)],
    );
    const waiting = finalizer
      .prepare(project.partition, {
        prepared: "Unstacked",
        ticket,
        cycle: 2,
        reason: "Conflicted",
      })
      .finally(() => {
        settled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(settled, false, "a preparation waits on one in flight");
    await holder.query("COMMIT");
    assert.equal(await waiting, "Written");
  } finally {
    holder.release();
  }
});

test("a cycle of accepted work with nothing prepared and no evaluation is found until it is prepared", async () => {
  const { project } = await stackedSubject(rig, "service-unprepared");
  const ticket = asTicketId(project.ticket);
  const found = async () =>
    (await finalizer.unprepared(1000)).filter(
      (each) =>
        each.partition.project === project.partition.project &&
        each.ticket === ticket,
    );
  assert.deepEqual(await found(), [], "cycle 1 already evaluates");
  await finalizerSpawnTasks(rig, project, [2]);
  const work = await finalizerPassedWork(
    rig,
    project,
    "service-unprepared-2",
    [],
  );
  const accepted = finalizerCommit();
  await finalizerDeclareSource(rig, project, work, "refs/heads/work", accepted);
  await rig.harness.query(
    `UPDATE ticket_projection SET phase='Work'
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  assert.deepEqual(
    (await found()).map((each) => [each.cycle, each.commit, each.repository]),
    [[2, accepted, project.repository]],
  );
  await finalizer.prepare(project.partition, {
    prepared: "Unstacked",
    ticket,
    cycle: 2,
    reason: "Unchosen",
  });
  assert.deepEqual(await found(), []);
});

test("the ticket service holds no write, queue read or door of the stack", async () => {
  const { project } = await stackedSubject(rig, "service-denied");
  for (const statement of [
    "INSERT INTO evaluation_stack_none DEFAULT VALUES",
    "INSERT INTO evaluation_stack DEFAULT VALUES",
    "INSERT INTO evaluation_stack_removal DEFAULT VALUES",
    "UPDATE evaluation_stack_none SET reason = reason",
    "DELETE FROM evaluation_stack",
  ])
    assert.match(
      (await rig.harness.attemptAs(ticketServiceRole, statement)) ?? "",
      /permission denied/u,
      statement,
    );
  for (const statement of [
    "SELECT * FROM evaluation_stack LIMIT 1",
    "SELECT * FROM evaluation_stack_beneath LIMIT 1",
    "SELECT * FROM evaluation_stack_none LIMIT 1",
  ])
    assert.equal(
      await rig.harness.attemptAs(ticketServiceRole, statement),
      undefined,
      statement,
    );
  assert.match(
    (await rig.harness.attemptAs(
      ticketServiceRole,
      `SELECT * FROM ticket_finalization_rank('${project.partition.tenant}','${project.partition.project}',1)`,
    )) ?? "",
    /permission denied/u,
  );
  for (const statement of [
    "SELECT permit FROM commit_permit LIMIT 1",
    "SELECT verdict FROM finalization_reconciliation LIMIT 1",
    "SELECT merge FROM finalization_change_proposal LIMIT 1",
  ])
    assert.match(
      (await rig.harness.attemptAs(ticketServiceRole, statement)) ?? "",
      /permission denied/u,
      statement,
    );
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
  await recordStack(rig.pool, project.partition, stackOf(project));
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
    await recordStack(rig.pool, project.partition, stackOf(project));
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

/** Every project that the bounded read named at some rotation, one row at a time. */
async function seenAcrossRotations(
  read: (
    rotation: number,
  ) => Promise<readonly { partition: { project: string } }[]>,
): Promise<ReadonlySet<string>> {
  const seen = new Set<string>();
  for (let rotation = 0; rotation < 200; rotation += 1) {
    for (const row of await read(rotation)) seen.add(row.partition.project);
  }
  return seen;
}

test("rows that never clear cannot hold the rest out of a bounded read", async () => {
  const removable: string[] = [];
  const unprepared: string[] = [];
  for (let at = 0; at < 3; at += 1) {
    const done = await stackedSubject(rig, `rotate-removable-${String(at)}`);
    await recordStack(rig.pool, done.project.partition, stackOf(done.project));
    await rig.harness.query(
      `UPDATE ticket_projection SET phase='Done'
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        done.project.partition.tenant,
        done.project.partition.project,
        done.project.ticket,
      ],
    );
    removable.push(done.project.partition.project);

    const fresh = await stackedSubject(rig, `rotate-unprepared-${String(at)}`);
    await finalizerSpawnTasks(rig, fresh.project, [2]);
    const work = await finalizerPassedWork(
      rig,
      fresh.project,
      `rotate-unprepared-${String(at)}-2`,
      [],
    );
    await finalizerDeclareSource(
      rig,
      fresh.project,
      work,
      "refs/heads/work",
      finalizerCommit(),
    );
    await rig.harness.query(
      `UPDATE ticket_projection SET phase='Work'
        WHERE tenant=$1 AND project=$2 AND ticket=$3`,
      [
        fresh.project.partition.tenant,
        fresh.project.partition.project,
        fresh.project.ticket,
      ],
    );
    unprepared.push(fresh.project.partition.project);
  }
  const removed = await seenAcrossRotations((rotation) =>
    finalizer.removable(1, rotation),
  );
  const prepared = await seenAcrossRotations((rotation) =>
    finalizer.unprepared(1, rotation),
  );
  for (const project of removable) assert.ok(removed.has(project), project);
  for (const project of unprepared) assert.ok(prepared.has(project), project);
});
