/**
 * The stack an evaluation ran over, against a real PostgreSQL as the finalizer:
 * a record written once and never changed, one beneath-ticket once per stack
 * and no deeper than the depth, the failures counted from the journal, and
 * and, in `evaluationStackStanding.test.ts`, standing read from landings that
 * really happened.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { postgresEvaluationStack } from "../../src/adapters/postgres/evaluationStack.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type {
  EvaluationStack,
  EvaluationStackStore,
} from "../../src/interpreter/evaluationStack.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
import {
  stackDepthMax,
  type StackMember,
} from "../../src/interpreter/stackChoice.ts";
import {
  finalizerCommit,
  finalizerProject,
  finalizerRigOpen,
  type FinalizerProject,
  type FinalizerRig,
} from "./finalizerHarness.ts";

let rig: FinalizerRig;
let store: EvaluationStackStore;

before(async () => {
  rig = await finalizerRigOpen();
  store = postgresEvaluationStack(rig.pool);
});
after(async () => {
  await rig.close();
});

const target = "refs/heads/main";

function member(ticket: number): StackMember {
  return {
    ticket: asTicketId(ticket),
    commit: asGitObjectId(finalizerCommit()),
  };
}

function stackOf(
  project: FinalizerProject,
  beneath: readonly StackMember[],
  over: Partial<EvaluationStack> = {},
): EvaluationStack {
  return {
    ticket: asTicketId(project.ticket),
    cycle: 1,
    repository: project.repository,
    target,
    tip: asGitObjectId(finalizerCommit()),
    beneath,
    stackCommit: asGitObjectId(finalizerCommit()),
    stackTree: asGitObjectId(finalizerCommit()),
    ...over,
  };
}

const tables = [
  "evaluation_stack",
  "evaluation_stack_beneath",
  "evaluation_stack_removal",
] as const;

test("a stack is written once and read back as it was written", async () => {
  const project = await finalizerProject(rig, "stack-once");
  const stack = stackOf(project, [member(7), member(8)]);
  assert.equal(await store.record(project.partition, stack), "Written");
  assert.deepEqual(await store.read(project.partition, stack.ticket, 1), stack);
  assert.equal(
    await store.record(project.partition, {
      ...stack,
      beneath: [member(9)],
      tip: asGitObjectId(finalizerCommit()),
    }),
    "Present",
  );
  assert.deepEqual(await store.read(project.partition, stack.ticket, 1), stack);
  assert.equal(await store.read(project.partition, stack.ticket, 2), undefined);
});

test("a stack removal is noted once", async () => {
  const project = await finalizerProject(rig, "stack-removal");
  const stack = stackOf(project, [member(7)]);
  await store.record(project.partition, stack);
  assert.equal(
    await store.remove(project.partition, stack.ticket, 1),
    "Removed",
  );
  assert.equal(await store.remove(project.partition, stack.ticket, 1), "Gone");
  const missing = await rig.refusal(
    `INSERT INTO evaluation_stack_removal (tenant, project, ticket, work_cycle)
     VALUES ($1,$2,$3,2)`,
    [project.partition.tenant, project.partition.project, project.ticket],
  );
  assert.match(missing, /evaluation_stack_removal_names_a_stack/u);
});

test("no role changes or deletes a stack, a beneath ticket or a removal", async () => {
  const project = await finalizerProject(rig, "stack-immutable");
  const stack = stackOf(project, [member(7)]);
  await store.record(project.partition, stack);
  await store.remove(project.partition, stack.ticket, 1);
  for (const table of tables) {
    const keys = [project.partition.tenant, project.partition.project];
    for (const statement of [
      `UPDATE ${table} SET work_cycle = work_cycle WHERE tenant=$1 AND project=$2`,
      `DELETE FROM ${table} WHERE tenant=$1 AND project=$2`,
    ]) {
      assert.match(await rig.refusal(statement, keys), /permission denied/u);
      assert.match(
        await rig.ownerRefusal(statement, keys),
        /rows are immutable/u,
        `${table}: ${statement}`,
      );
    }
  }
});

test("a beneath ticket is in a stack once, at a depth the stack's bound allows", async () => {
  const project = await finalizerProject(rig, "stack-beneath");
  await store.record(project.partition, stackOf(project, [member(7)]));
  const keys = [
    project.partition.tenant,
    project.partition.project,
    project.ticket,
  ];
  const beneath = (depth: number, ticket: number) =>
    rig.refusal(
      `INSERT INTO evaluation_stack_beneath
         (tenant, project, ticket, work_cycle, depth, beneath_ticket, beneath_commit)
       VALUES ($1,$2,$3,1,$4,$5,$6)`,
      [...keys, depth, ticket, finalizerCommit()],
    );
  assert.match(await beneath(2, 7), /evaluation_stack_beneath_is_once/u);
  assert.match(await beneath(1, 8), /evaluation_stack_beneath_pkey/u);
  assert.match(await beneath(0, 8), /depth_is_bounded/u);
  assert.match(await beneath(stackDepthMax + 1, 8), /depth_is_bounded/u);
  assert.match(await beneath(2, project.ticket), /is_another_ticket/u);
  const orphan = await rig.refusal(
    `INSERT INTO evaluation_stack_beneath
       (tenant, project, ticket, work_cycle, depth, beneath_ticket, beneath_commit)
     VALUES ($1,$2,$3,2,1,8,$4)`,
    [...keys, finalizerCommit()],
  );
  assert.match(orphan, /names_a_stack/u);
});

test("a stack of none or of more than the depth is refused before any row is written", async () => {
  const project = await finalizerProject(rig, "stack-bounds");
  for (const count of [0, stackDepthMax + 1]) {
    const beneath = Array.from({ length: count }, (_, at) => member(at + 7));
    await assert.rejects(
      store.record(project.partition, stackOf(project, beneath)),
      RangeError,
    );
  }
  assert.equal(
    await store.read(project.partition, asTicketId(project.ticket), 1),
    undefined,
  );
  const full = Array.from({ length: stackDepthMax }, (_, at) => member(at + 7));
  assert.equal(
    await store.record(project.partition, stackOf(project, full)),
    "Written",
  );
});

test("the failure cap counts the reworks of cycles that ran over a stack, and no others", async () => {
  const project = await finalizerProject(rig, "stack-failures", undefined, 1);
  const ticket = asTicketId(project.ticket);
  const reworked = await rig.harness.query(
    `SELECT count(*)::int AS held FROM journal_entry
      WHERE tenant=$1 AND project=$2
        AND entry::jsonb->'event'->>'type' = 'TicketEvaluationReworkStarted'`,
    [project.partition.tenant, project.partition.project],
  );
  assert.equal(reworked[0]?.["held"], 1, "the fixture reworked once");
  assert.equal(await store.stackFailures(project.partition, ticket), 0);
  await store.record(
    project.partition,
    stackOf(project, [member(7)], { cycle: 2 }),
  );
  assert.equal(
    await store.stackFailures(project.partition, ticket),
    0,
    "a cycle that was not sent back is no failure",
  );
  await store.record(
    project.partition,
    stackOf(project, [member(7)], { cycle: 1 }),
  );
  assert.equal(await store.stackFailures(project.partition, ticket), 1);
  assert.equal(
    await store.stackFailures(
      project.partition,
      asTicketId(project.ticket + 1),
    ),
    0,
    "another ticket's failures are its own",
  );
});
