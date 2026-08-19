/**
 * The task plumbing, the effect vocabulary and the rank ladder, at the level
 * the golden corpus cannot reach: a boundary condition it never happens to
 * produce is still a boundary condition.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evalStage,
  nextTaskId,
  resolveTask,
  retiredInIdOrder,
  outstandingCount,
  spawnTasks,
  tasksInIdOrder,
  taskPassed,
  tkEval,
  tkWork,
  tsResolved,
  tsOutstanding,
} from "../../src/domain/task.ts";
import {
  asTaskId,
  asTicketId,
  asSafeInteger,
  firstTaskId,
} from "../../src/domain/ids.ts";
import {
  allEffects,
  effectFromLabel,
  effectLabel,
} from "../../src/domain/effect.ts";
import {
  phaseRank,
  rankCeiling,
  rankFinalizing,
  rankPending,
  rankSettled,
  isSettled,
} from "../../src/domain/phase.ts";
import { combine } from "../../src/domain/program.ts";
import {
  spawnOn,
  retireLive,
  hasOpenHumanTask,
} from "../../src/domain/ticket.ts";
import type {
  Phase,
  Task,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";

const bare: Ticket = {
  phase: "Pending",
  deps: new Set(),
  finalizer: "NoFinalizer",
  artifact: "NoArtifact",
  workFanout: 1,
  reworkPolicy: { type: "BudgetedRework", value: 0 },
  finalizationPricing: "DeadlineOnly",
  resumePricing: "RetryCharged",
  program: [],
  tasks: new Set(),
  record: [],
  spawned: 0,
  reworkLeft: 0,
  finalizationLeft: 0,
  gasLeft: 0,
  resumeAt: "NoResume",
  reason: "NoReason",
  completions: 0,
};

test("a spawned set is outstanding, contiguous and starts where it was told", () => {
  const tasks = spawnTasks(tkWork, asTaskId(3), 2);
  assert.deepEqual(
    tasksInIdOrder(tasks).map((t) => t.id),
    [3, 4],
  );
  assert.equal(outstandingCount(tasks), 2);
});

test("spawning zero tasks yields no tasks rather than a task", () => {
  assert.equal(spawnTasks(tkWork, firstTaskId, 0).size, 0);
});

test("the next id counts every id ever issued, retired or live", () => {
  assert.equal(nextTaskId(0, 0), firstTaskId);
  assert.equal(nextTaskId(3, 2), 6);
});

test("first write wins, so a duplicate delivery changes nothing", () => {
  const spawned = spawnTasks(tkWork, firstTaskId, 1);
  const once = resolveTask(spawned, firstTaskId, "Passed");
  const twice = resolveTask(once, firstTaskId, "Failed");
  assert.deepEqual([...twice], [...once]);
  const resolved = tasksInIdOrder(twice)[0];
  assert.ok(resolved, "the fixture spawned one task");
  assert.ok(taskPassed(resolved));
});

test("resolving an id that is not there changes nothing", () => {
  const spawned = spawnTasks(tkWork, firstTaskId, 1);
  assert.deepEqual(
    [...resolveTask(spawned, asTaskId(99), "Passed")],
    [...spawned],
  );
});

test("retirement force-closes an outstanding task as cancelled and leaves a resolved one alone", () => {
  const mixed: ReadonlySet<Task> = new Set([
    { id: asTaskId(2), kind: tkWork, state: tsResolved("Passed") },
    { id: asTaskId(1), kind: tkWork, state: tsOutstanding },
  ]);
  const retired = retiredInIdOrder(mixed);
  assert.deepEqual(
    retired.map((t) => t.id),
    [1, 2],
    "retirement is in id order, not in the order the set happened to hold",
  );
  assert.deepEqual(retired[0]?.state, tsResolved("Cancelled"));
  assert.deepEqual(retired[1]?.state, tsResolved("Passed"));
});

test("the eval stage is derived from the kind marks and is zero on a work set", () => {
  assert.equal(evalStage(spawnTasks(tkWork, firstTaskId, 2)), 0);
  assert.equal(evalStage(spawnTasks(tkEval(1), firstTaskId, 2)), 1);
  assert.equal(evalStage(new Set()), 0);
});

test("spawnOn refuses a ticket that still holds live tasks", () => {
  const live = spawnOn(bare, tkWork, 2);
  assert.equal(live.spawned, 2);
  assert.throws(() => spawnOn(live, tkWork, 1), /must retire first/);
});

test("retiring then spawning continues the id sequence rather than restarting it", () => {
  const first = spawnOn(bare, tkWork, 2);
  const second = spawnOn(retireLive(first), tkEval(0), 2);
  assert.deepEqual(
    tasksInIdOrder(second.tasks).map((t) => t.id),
    [3, 4],
  );
  assert.equal(second.spawned, 4, "the ghost counts every task ever spawned");
  assert.equal(
    second.spawned,
    second.record.length + second.tasks.size,
    "which is exactly the equality idsAccounted checks",
  );
});

test("a desk task is open exactly while the ticket is parked", () => {
  const phases: readonly Phase[] = [
    "Pending",
    "Working",
    "Evaluating",
    "Finalizing",
    "Done",
    "Escalated",
    "Revoked",
  ];
  for (const phase of phases) {
    assert.equal(
      hasOpenHumanTask({ ...bare, phase }),
      phase === "Escalated",
      phase,
    );
  }
});

test("the rank ladder is strictly ascending and the settled tier shares its floor", () => {
  assert.ok(rankSettled < rankFinalizing);
  assert.equal(rankCeiling, rankPending);
  assert.equal(phaseRank("Done"), rankSettled);
  assert.equal(phaseRank("Escalated"), rankSettled);
  assert.equal(phaseRank("Revoked"), rankSettled);
  assert.ok(
    isSettled("Done") && isSettled("Escalated") && isSettled("Revoked"),
  );
  assert.ok(!isSettled("Finalizing"));
});

test("every effect renders to a label and reads back to itself", () => {
  assert.equal(
    allEffects.length,
    new Set(allEffects).size,
    "the roster repeats a constructor",
  );
  for (const effect of allEffects) {
    assert.equal(effectFromLabel(effectLabel(effect)), effect);
  }
});

test("a string that is not one of this machine's effects is refused", () => {
  assert.throws(
    () => effectFromLabel("LaunchMissiles"),
    /not one of this machine's effects/,
  );
});

test("the combinators are what the model says they are", () => {
  const passed: ReadonlySet<Task> = new Set([
    { id: asTaskId(1), kind: tkWork, state: tsResolved("Passed") },
    { id: asTaskId(2), kind: tkWork, state: tsResolved("Failed") },
  ]);
  assert.equal(combine("UnanimousPass", passed), false);
  assert.equal(combine("AnyPass", passed), true);
  assert.equal(
    combine("UnanimousPass", new Set()),
    true,
    "vacuously, as forall does",
  );
  assert.equal(combine("AnyPass", new Set()), false);
});

test("a cancelled task fails both combinators, so a revoked set never passes", () => {
  const cancelled: ReadonlySet<Task> = new Set([
    { id: asTaskId(1), kind: tkWork, state: tsResolved("Cancelled") },
  ]);
  assert.equal(combine("UnanimousPass", cancelled), false);
  assert.equal(combine("AnyPass", cancelled), false);
});

test("an identifier outside the exactly representable range is refused, not truncated", () => {
  assert.throws(
    () => asSafeInteger(Number.MAX_SAFE_INTEGER + 2, "probe"),
    /a declared bound is wrong/,
  );
  assert.throws(() => asTicketId(0), /below the first id/);
  assert.throws(() => asTaskId(0), /below the first id/);
});
