/**
 * The decider arms the golden corpus does not reach, and the measure
 * classifications a per-step record cannot carry.
 *
 * THE REPLAY IS THE STRONGER EVIDENCE AND THIS SUITE IS NOT A SECOND COPY OF
 * IT. Every shape the corpus does reach is already pinned by exact equality on
 * the whole record and the whole post-state, so restating one here would be a
 * weaker assertion about the same step. What is left over is the arms no
 * committed trace fires — the gated promotion, both wrap-up gas walls, the
 * gas-only gate pricing, the resume into the queue, the guarded unreachable
 * resume, a revoke out of either wrap-up phase, a cascade deeper than the
 * corpus happens to build — and the descent-set classification, which lives in
 * the measure rather than in the record a golden compares.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { boundsOf, defaultProgram } from "../../src/domain/config.ts";
import { ticketAt, type Core } from "../../src/domain/core.ts";
import {
  decideArrive,
  decideDequeue,
  decideEvalStageReduce,
  decideOpRetry,
  decideRelease,
  decideRevalFail,
  decideRevoke,
  decideWrapUpResolve,
  decideWrapUpStart,
} from "../../src/domain/deciders.ts";
import { leaseFreeIn, wrapUpStartableIn } from "../../src/domain/enablement.ts";
import { asProjectId } from "../../src/domain/ids.ts";
import { sysMeasure } from "../../src/domain/measure.ts";
import { completionsOf } from "../../src/domain/ticket.ts";
import { wExclusive, woAttempt, woNone } from "../../src/domain/wrapUp.ts";
import {
  budgetedInstance,
  deadlineOnlyInstance,
  retryFreeInstance,
} from "./configs.ts";
import {
  accountsForAll,
  coreOf,
  depsOf,
  evalTask,
  id,
  ticketOn,
  workRunning,
} from "./fixtures.ts";

const config = budgetedInstance;

/** The fleet's measure at the reference instance's bounds. */
const measure = (core: Core): number => sysMeasure(boundsOf(config), core);

/** A ticket holding its project's gate slot, with both accounts part-spent. */
const gated = coreOf([
  ticketOn(config, 2, { phase: "PWrapUpHolding", wrapUpLeft: 1, gasLeft: 2 }),
]);
/** The same ticket enqueued rather than holding, which is where a quiet dequeue resolves. */
const queued = coreOf([
  ticketOn(config, 2, { phase: "PWrapUp", wrapUpLeft: 1, gasLeft: 2 }),
]);

test("both wrap-up successes emit the one effect and differ only in the phase they resolve from", () => {
  const held = decideWrapUpResolve(config, gated, id(1), "WOk", true);
  const quiet = decideWrapUpResolve(config, queued, id(1), "WOk", false);
  assert.equal(held.rec.label, "ticket-done");
  assert.deepEqual(held.rec.transitions, [
    { ticket: id(1), from: "PWrapUpHolding", to: "PDone" },
  ]);
  assert.deepEqual(held.rec.effects, ["Complete"]);
  assert.deepEqual(held.rec.attempt, woAttempt(asProjectId(2), true));
  assert.deepEqual(quiet.rec.transitions, [
    { ticket: id(1), from: "PWrapUp", to: "PDone" },
  ]);
  assert.deepEqual(quiet.rec.effects, ["Complete"]);
  assert.deepEqual(quiet.rec.attempt, woAttempt(asProjectId(2), false));
  assert.equal(completionsOf(ticketAt(held.post, id(1))), 1);
  assert.ok(measure(held.post) < measure(gated));
});

test("the dequeue's two branches are the two deciders, not a composition beside them", () => {
  assert.deepEqual(
    decideDequeue(config, queued, id(1), true),
    decideWrapUpStart(queued, id(1)),
  );
  assert.deepEqual(
    decideDequeue(config, queued, id(1), false),
    decideWrapUpResolve(config, queued, id(1), "WOk", false),
  );
  const opened = decideDequeue(config, queued, id(1), true);
  assert.equal(opened.rec.label, "wrapup-started");
  assert.deepEqual(opened.rec.effects, ["OpenGate"]);
  assert.deepEqual(opened.rec.attempt, woNone);
  assert.equal(ticketAt(opened.post, id(1)).gasLeft, 2);
  assert.equal(
    decideDequeue(config, queued, id(1), false).rec.label,
    "ticket-done",
  );
});

test("each budgeted wrap-up wall carries its own name and the attempt's attribution", () => {
  const spent = coreOf([
    ticketOn(config, 2, { phase: "PWrapUpHolding", wrapUpLeft: 0, gasLeft: 2 }),
  ]);
  const dry = coreOf([
    ticketOn(config, 2, { phase: "PWrapUpHolding", wrapUpLeft: 1, gasLeft: 0 }),
  ]);
  const budgetWall = decideWrapUpResolve(config, spent, id(1), "WFailed", true);
  const gasWall = decideWrapUpResolve(config, dry, id(1), "WFailed", true);
  assert.equal(
    budgetWall.rec.label,
    "ticket-escalated wrapup_budget_exhausted",
  );
  assert.equal(
    ticketAt(budgetWall.post, id(1)).reason,
    "RsWrapUpBudgetExhausted",
  );
  assert.equal(ticketAt(budgetWall.post, id(1)).resumeAt, "RWrapUp");
  assert.deepEqual(budgetWall.rec.attempt, woAttempt(asProjectId(2), true));
  assert.equal(gasWall.rec.label, "ticket-escalated gas_exhausted");
  assert.equal(ticketAt(gasWall.post, id(1)).reason, "RsGasExhausted");
  assert.deepEqual(gasWall.rec.attempt, woAttempt(asProjectId(2), true));
  assert.ok(measure(budgetWall.post) < measure(spent));
  assert.ok(measure(gasWall.post) < measure(dry));
});

test("gas alone meters the gate loop under deadline-only pricing", () => {
  const deadline = deadlineOnlyInstance;
  const held = coreOf([
    ticketOn(deadline, 1, { phase: "PWrapUpHolding", gasLeft: 2 }),
  ]);
  const dry = coreOf([
    ticketOn(deadline, 1, { phase: "PWrapUpHolding", gasLeft: 0 }),
  ]);
  const rework = decideWrapUpResolve(deadline, held, id(1), "WFailed", true);
  assert.equal(rework.rec.label, "rework-started wrapup_failure");
  assert.equal(ticketAt(rework.post, id(1)).phase, "PWorking");
  assert.equal(ticketAt(rework.post, id(1)).gasLeft, 1);
  assert.equal(
    ticketAt(rework.post, id(1)).wrapUpLeft,
    0,
    "this pricing grants no gate account, so there is none to spend",
  );
  assert.deepEqual(rework.rec.effects, ["SpawnWorkTasks"]);
  const wall = decideWrapUpResolve(deadline, dry, id(1), "WFailed", true);
  assert.equal(wall.rec.label, "ticket-escalated gas_exhausted");
  assert.deepEqual(wall.rec.attempt, woAttempt(asProjectId(1), true));
});

test("the wrap-up resume re-enqueues, and its price is the whole of the metering parameter", () => {
  const parked = coreOf([
    ticketOn(config, 1, {
      phase: "PEscalated",
      resumeAt: "RWrapUp",
      reason: "RsGasExhausted",
      gasLeft: 2,
    }),
  ]);
  const charged = decideOpRetry(config, parked, id(1));
  const free = decideOpRetry(retryFreeInstance, parked, id(1));
  assert.equal(charged.rec.label, "operator-retry");
  assert.deepEqual(charged.rec.transitions, [
    { ticket: id(1), from: "PEscalated", to: "PWrapUp" },
  ]);
  assert.deepEqual(charged.rec.effects, ["EnqueueWrapUp"]);
  assert.equal(ticketAt(charged.post, id(1)).gasLeft, 1);
  assert.equal(ticketAt(charged.post, id(1)).reason, "RsNone");
  assert.ok(measure(charged.post) < measure(parked));
  assert.equal(ticketAt(free.post, id(1)).gasLeft, 2);
  assert.ok(
    measure(free.post) > measure(parked),
    "a free pipeline resume is the churn arm the descent argument exempts",
  );
});

test("a park with no modeled resume is the guarded no-op its enablement refuses", () => {
  const walled = coreOf([
    ticketOn(config, 1, { phase: "PEscalated", reason: "RsDependencyRevoked" }),
  ]);
  const decision = decideOpRetry(config, walled, id(1));
  assert.equal(decision.rec.label, "operator-retry-unreachable");
  assert.deepEqual(decision.rec.transitions, []);
  assert.deepEqual(decision.rec.effects, []);
  assert.deepEqual(decision.post, walled);
});

test("revoking out of either wrap-up phase settles without completing and frees the slot", () => {
  const occupied = coreOf([
    ticketOn(config, 1, { phase: "PWrapUpHolding", gasLeft: 2 }),
    ticketOn(config, 1, { phase: "PWrapUp", gasLeft: 2 }),
  ]);
  const revoked = decideRevoke(occupied, id(1));
  assert.deepEqual(revoked.rec.transitions, [
    { ticket: id(1), from: "PWrapUpHolding", to: "PRevoked" },
  ]);
  assert.deepEqual(revoked.rec.effects, ["Revoke"]);
  assert.equal(completionsOf(ticketAt(revoked.post, id(1))), 0);
  assert.equal(ticketAt(revoked.post, id(1)).gasLeft, 2);
  assert.ok(
    leaseFreeIn(revoked.post, 1),
    "occupancy is a phase, so leaving it is the whole of the release",
  );
  assert.ok(wrapUpStartableIn(revoked.post, id(2)));
  const fromQueue = decideRevoke(occupied, id(2));
  assert.deepEqual(fromQueue.rec.effects, ["Revoke"]);
  assert.equal(completionsOf(ticketAt(fromQueue.post, id(2))), 0);
  assert.ok(measure(revoked.post) < measure(occupied));
});

/** A chain 1 <- 2 <- 3, released as far as the corpus never builds it: a Draft behind a Pending. */
const chain = coreOf([
  ticketOn(config, 1, { phase: "PPending", gasLeft: 2 }),
  ticketOn(config, 1, { phase: "PPending", deps: [id(1)], gasLeft: 2 }),
  ticketOn(config, 1, { deps: [id(2)], gasLeft: 2 }),
]);
const cascaded = decideRevoke(chain, id(1)).post;

test("the cascade parks every transitive dependent in the one decision, spending nothing", () => {
  const decision = decideRevoke(chain, id(1));
  assert.equal(decision.rec.label, "ticket-revoked");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(1), from: "PPending", to: "PRevoked" },
    { ticket: id(2), from: "PPending", to: "PEscalated" },
    { ticket: id(3), from: "PDraft", to: "PEscalated" },
  ]);
  assert.deepEqual(decision.rec.effects, [
    "Revoke",
    "OpenHumanTask",
    "OpenHumanTask",
  ]);
  for (const parked of [id(2), id(3)]) {
    assert.equal(ticketAt(cascaded, parked).reason, "RsDependencyRevoked");
    assert.equal(ticketAt(cascaded, parked).resumeAt, "RNone");
    assert.equal(ticketAt(cascaded, parked).gasLeft, 2);
  }
  assert.equal(ticketAt(cascaded, id(1)).reason, "RsNone");
  assert.ok(measure(cascaded) < measure(chain));
});

test("a desk revoke is flat, and it re-parks nobody", () => {
  const settled = decideRevoke(cascaded, id(2));
  assert.deepEqual(settled.rec.transitions, [
    { ticket: id(2), from: "PEscalated", to: "PRevoked" },
  ]);
  assert.deepEqual(settled.rec.effects, ["Revoke"]);
  assert.equal(
    measure(settled.post),
    measure(cascaded),
    "settling a parked ticket from the desk is the bounded authoring arm the descent argument exempts",
  );
  assert.equal(ticketAt(settled.post, id(3)).phase, "PEscalated");
  assert.equal(ticketAt(settled.post, id(3)).reason, "RsDependencyRevoked");
});

test("the stage's own combinator decides, so a program is not always-pass", () => {
  const anyPass = [{ fanout: 2, combinator: "CAnyPass" as const }];
  const passes = coreOf([
    ticketOn(config, 1, {
      phase: "PEvaluating",
      program: anyPass,
      tasks: [evalTask(1, 0, "TPassed"), evalTask(2, 0, "TFailed")],
      spawned: 2,
      gasLeft: 2,
    }),
  ]);
  const walls = coreOf([
    ticketOn(config, 1, {
      phase: "PEvaluating",
      program: anyPass,
      tasks: [evalTask(1, 0, "TFailed"), evalTask(2, 0, "TFailed")],
      spawned: 2,
      gasLeft: 2,
    }),
  ]);
  assert.equal(
    decideEvalStageReduce(config, passes, id(1)).rec.label,
    "eval-passed",
  );
  assert.equal(
    decideEvalStageReduce(config, walls, id(1)).rec.label,
    "rework-started eval_failure",
  );
});

test("arrival is the authoring climber, and release descends off it", () => {
  const empty = coreOf([]);
  const arrived = decideArrive(
    config,
    empty,
    depsOf(),
    defaultProgram(config),
    asProjectId(2),
    wExclusive(2),
  ).post;
  assert.ok(
    measure(arrived) > measure(empty),
    "a fresh Draft's whole measure arrives with it, which is the arm the descent argument exempts",
  );
  assert.equal(ticketAt(arrived, id(1)).project, asProjectId(2));
  assert.ok(measure(decideRelease(arrived, id(1)).post) < measure(arrived));
});

test("the pre-work park costs nothing and its resume climbs back, charging nothing either", () => {
  const ready = coreOf([ticketOn(config, 1, { phase: "PPending" })]);
  const parked = decideRevalFail(ready, id(1));
  assert.equal(parked.rec.label, "ticket-escalated revalidation_failed");
  assert.equal(ticketAt(parked.post, id(1)).resumeAt, "RPending");
  assert.ok(measure(parked.post) < measure(ready));
  const resumed = decideOpRetry(config, parked.post, id(1));
  assert.equal(ticketAt(resumed.post, id(1)).gasLeft, config.gas);
  assert.deepEqual(resumed.rec.effects, []);
  assert.ok(measure(resumed.post) > measure(parked.post));
});

test("every fixture this suite builds is a shape the machine could have reached", () => {
  const live = coreOf([
    ticketOn(config, 1, {
      phase: "PWorking",
      tasks: [workRunning(1)],
      spawned: 1,
    }),
  ]);
  for (const core of [gated, queued, chain, cascaded, live]) {
    assert.ok(
      accountsForAll(core),
      "a fixture accounts for all of its ids or none",
    );
  }
});
