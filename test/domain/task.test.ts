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
  runningCount,
  spawnTasks,
  taskPassed,
  tkEval,
  tkWork,
  tsResolved,
  tsRunning,
  type Task,
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
  rankDraft,
  rankHolding,
  rankSettled,
  isSettled,
  type Phase,
} from "../../src/domain/phase.ts";
import { combine } from "../../src/domain/program.ts";
import {
  spawnOn,
  retireLive,
  hasOpenHumanTask,
  completionsOf,
  type Ticket,
} from "../../src/domain/ticket.ts";
import { aNone, wNone } from "../../src/domain/wrapUp.ts";
import { asProjectId } from "../../src/domain/ids.ts";

const bare: Ticket = {
  phase: "PPending",
  deps: [],
  wrapUp: wNone,
  artifact: aNone,
  project: asProjectId(1),
  program: [],
  tasks: [],
  record: [],
  spawned: 0,
  reworkLeft: 0,
  wrapUpLeft: 0,
  gasLeft: 0,
  resumeAt: "RNone",
  reason: "RsNone",
};

test("a spawned set is running, contiguous and starts where it was told", () => {
  const tasks = spawnTasks(tkWork, asTaskId(3), 2);
  assert.deepEqual(
    tasks.map((t) => t.id),
    [3, 4],
  );
  assert.equal(runningCount(tasks), 2);
});

test("spawning zero tasks yields no tasks rather than a task", () => {
  assert.deepEqual(spawnTasks(tkWork, firstTaskId, 0), []);
});

test("the next id counts every id ever issued, retired or live", () => {
  assert.equal(nextTaskId(0, 0), firstTaskId);
  assert.equal(nextTaskId(3, 2), 6);
});

test("first write wins, so a duplicate delivery changes nothing", () => {
  const spawned = spawnTasks(tkWork, firstTaskId, 1);
  const once = resolveTask(spawned, firstTaskId, "TPassed");
  const twice = resolveTask(once, firstTaskId, "TFailed");
  assert.deepEqual(twice, once);
  const resolved = twice[0];
  assert.ok(resolved, "the fixture spawned one task");
  assert.ok(taskPassed(resolved));
});

test("resolving an id that is not there changes nothing", () => {
  const spawned = spawnTasks(tkWork, firstTaskId, 1);
  assert.deepEqual(resolveTask(spawned, asTaskId(99), "TPassed"), spawned);
});

test("retirement force-closes a running task as cancelled and leaves a resolved one alone", () => {
  const mixed: readonly Task[] = [
    { id: asTaskId(2), kind: tkWork, state: tsResolved("TPassed") },
    { id: asTaskId(1), kind: tkWork, state: tsRunning },
  ];
  const retired = retiredInIdOrder(mixed);
  assert.deepEqual(
    retired.map((t) => t.id),
    [1, 2],
    "retirement is in id order, not in the order the set happened to hold",
  );
  assert.deepEqual(retired[0]?.state, tsResolved("TCancelled"));
  assert.deepEqual(retired[1]?.state, tsResolved("TPassed"));
});

test("the eval stage is derived from the kind marks and is zero on a work set", () => {
  assert.equal(evalStage(spawnTasks(tkWork, firstTaskId, 2)), 0);
  assert.equal(evalStage(spawnTasks(tkEval(1), firstTaskId, 2)), 1);
  assert.equal(evalStage([]), 0);
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
    second.tasks.map((t) => t.id),
    [3, 4],
  );
  assert.equal(second.spawned, 4, "the ghost counts every task ever spawned");
  assert.equal(
    second.spawned,
    second.record.length + second.tasks.length,
    "which is exactly the equality idsAccounted checks",
  );
});

test("a desk task is open exactly while the ticket is parked", () => {
  const phases: readonly Phase[] = [
    "PDraft",
    "PPending",
    "PWorking",
    "PEvaluating",
    "PWrapUp",
    "PWrapUpHolding",
    "PDone",
    "PEscalated",
    "PRevoked",
  ];
  for (const phase of phases) {
    assert.equal(
      hasOpenHumanTask({ ...bare, phase }),
      phase === "PEscalated",
      phase,
    );
  }
});

test("the completion count is one at Done and zero everywhere else", () => {
  assert.equal(completionsOf({ ...bare, phase: "PDone" }), 1);
  assert.equal(completionsOf({ ...bare, phase: "PRevoked" }), 0);
  assert.equal(completionsOf({ ...bare, phase: "PWorking" }), 0);
});

test("the rank ladder is strictly ascending and the settled tier shares its floor", () => {
  assert.ok(rankSettled < rankHolding);
  assert.equal(rankCeiling, rankDraft);
  assert.equal(phaseRank("PDone"), rankSettled);
  assert.equal(phaseRank("PEscalated"), rankSettled);
  assert.equal(phaseRank("PRevoked"), rankSettled);
  assert.ok(
    isSettled("PDone") && isSettled("PEscalated") && isSettled("PRevoked"),
  );
  assert.ok(!isSettled("PWrapUpHolding"));
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
  const passed: readonly Task[] = [
    { id: asTaskId(1), kind: tkWork, state: tsResolved("TPassed") },
    { id: asTaskId(2), kind: tkWork, state: tsResolved("TFailed") },
  ];
  assert.equal(combine("CUnanimousPass", passed), false);
  assert.equal(combine("CAnyPass", passed), true);
  assert.equal(
    combine("CUnanimousPass", []),
    true,
    "vacuously, as forall does",
  );
  assert.equal(combine("CAnyPass", []), false);
});

test("a cancelled task fails both combinators, so a revoked set never passes", () => {
  const cancelled: readonly Task[] = [
    { id: asTaskId(1), kind: tkWork, state: tsResolved("TCancelled") },
  ];
  assert.equal(combine("CUnanimousPass", cancelled), false);
  assert.equal(combine("CAnyPass", cancelled), false);
});

test("an identifier outside the exactly representable range is refused, not truncated", () => {
  assert.throws(
    () => asSafeInteger(Number.MAX_SAFE_INTEGER + 2, "probe"),
    /a declared bound is wrong/,
  );
  assert.throws(() => asTicketId(0), /below the first id/);
  assert.throws(() => asTaskId(0), /below the first id/);
});
