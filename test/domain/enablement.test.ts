/**
 * The enablement predicates, which the golden replay does not reach and cannot.
 *
 * A replayer routes on the action the trace recorded and hands the decider its
 * picks; it never asks whether the action was enabled, because the golden's
 * existence is that guarantee. So every one of these predicates is unexercised
 * by the corpus, and the mutant they exist to catch — a guard that drifted from
 * the one the machine consults — is invisible to it. This suite is the whole of
 * their evidence.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  canArriveIn,
  dependableIn,
  depArtifacts,
  depsDoneIn,
  deliverableTaskIds,
  dispatchableIn,
  doneIn,
  draftsIn,
  holdingIn,
  isBlockedIn,
  isReadyIn,
  leaseFreeIn,
  leaseOf,
  readiesIn,
  reducibleEvalIn,
  reducibleWorkIn,
  resumeCharge,
  retryableIn,
  retryablesIn,
  revocableIn,
  revocablesIn,
  taskPhaseIn,
  waitsOn,
  wrapUpOutcomes,
  wrapUpStartableIn,
  wrapUpStartablesIn,
} from "../../src/domain/enablement.ts";
import { decideWrapUpResolve } from "../../src/domain/deciders.ts";
import { aSome, wNone } from "../../src/domain/wrapUp.ts";
import { budgetedInstance, retryFreeInstance } from "./configs.ts";
import {
  coreOf,
  evalRunning,
  evalTask,
  id,
  ticketOn,
  workRunning,
  workTask,
} from "./fixtures.ts";

const config = budgetedInstance;

test("room for one more arrival runs out exactly at the arrival bound", () => {
  const fleet = Array.from({ length: config.nTickets }, () =>
    ticketOn(config, 1),
  );
  assert.ok(canArriveIn(config, coreOf([])));
  assert.ok(canArriveIn(config, coreOf(fleet.slice(0, -1))));
  assert.ok(!canArriveIn(config, coreOf(fleet)));
});

test("an arrival may depend on anything but a tombstone", () => {
  const core = coreOf([
    ticketOn(config, 1, { phase: "PDraft" }),
    ticketOn(config, 1, { phase: "PRevoked" }),
    ticketOn(config, 1, {
      phase: "PEscalated",
      reason: "RsDependencyRevoked",
    }),
    ticketOn(config, 1, { phase: "PEscalated", reason: "RsWorkFailed" }),
  ]);
  assert.deepEqual(dependableIn(core), [id(1), id(4)]);
});

test("the only authoring phase is the only releasable set", () => {
  const core = coreOf([
    ticketOn(config, 1, { phase: "PDraft" }),
    ticketOn(config, 1, { phase: "PPending" }),
  ]);
  assert.deepEqual(draftsIn(core), [id(1)]);
});

test("the absorbing terminals are exactly the unrevocable phases", () => {
  const core = coreOf([
    ticketOn(config, 1, { phase: "PDraft" }),
    ticketOn(config, 1, { phase: "PEscalated", reason: "RsWorkFailed" }),
    ticketOn(config, 1, { phase: "PWrapUpHolding" }),
    ticketOn(config, 1, { phase: "PDone" }),
    ticketOn(config, 1, { phase: "PRevoked" }),
  ]);
  assert.deepEqual(revocablesIn(core), [id(1), id(2), id(3)]);
  assert.ok(!revocableIn(core, id(4)));
  assert.ok(!revocableIn(core, id(5)));
});

test("a dependency that is not Done blocks, unreleased ones included", () => {
  const blocked = coreOf([
    ticketOn(config, 1, { phase: "PDraft" }),
    ticketOn(config, 1, { phase: "PPending", deps: [id(1)] }),
  ]);
  assert.ok(isBlockedIn(blocked, id(2)));
  assert.ok(!isReadyIn(blocked, id(2)));
  assert.deepEqual(readiesIn(blocked), []);

  const released = coreOf([
    ticketOn(config, 1, { phase: "PDone" }),
    ticketOn(config, 1, { phase: "PPending", deps: [id(1)] }),
  ]);
  assert.ok(isReadyIn(released, id(2)));
  assert.ok(!isBlockedIn(released, id(2)));
  assert.ok(depsDoneIn(released, id(2)));
});

test("the dep gate reads Done-ness and never location", () => {
  const waiting = coreOf([
    ticketOn(config, 1, { phase: "PWrapUp" }),
    ticketOn(config, 2, { phase: "PPending", deps: [id(1)] }),
  ]);
  const landed = coreOf([
    ticketOn(config, 1, { phase: "PDone", artifact: aSome(2) }),
    ticketOn(config, 2, { phase: "PPending", deps: [id(1)] }),
  ]);
  assert.ok(isBlockedIn(waiting, id(2)));
  assert.ok(isReadyIn(landed, id(2)));
  assert.deepEqual(waitsOn(landed, id(2)), [id(1)]);
  assert.deepEqual(depArtifacts(landed, id(2)), [aSome(2)]);
});

test("the dispatcher needs a ready ticket with gas to charge", () => {
  const ready = coreOf([ticketOn(config, 1, { phase: "PPending" })]);
  const broke = coreOf([
    ticketOn(config, 1, { phase: "PPending", gasLeft: 0 }),
  ]);
  assert.ok(dispatchableIn(ready, id(1)));
  assert.ok(!dispatchableIn(broke, id(1)));
});

test("only the two task phases can receive a completion, and only a resolved set reduces", () => {
  const core = coreOf([
    ticketOn(config, 1, {
      phase: "PWorking",
      tasks: [workRunning(1), workTask(2, "TPassed")],
      spawned: 2,
    }),
    ticketOn(config, 1, {
      phase: "PEvaluating",
      tasks: [evalTask(1, 0, "TFailed")],
      spawned: 1,
    }),
    ticketOn(config, 1, { phase: "PWrapUp" }),
    ticketOn(config, 1, {
      phase: "PWorking",
      tasks: [workTask(1, "TPassed")],
      spawned: 1,
    }),
    ticketOn(config, 1, {
      phase: "PEvaluating",
      tasks: [evalRunning(1, 0)],
      spawned: 1,
    }),
  ]);
  assert.deepEqual(taskPhaseIn(core), [id(1), id(2), id(4), id(5)]);
  assert.deepEqual(reducibleWorkIn(core), [id(4)]);
  assert.deepEqual(reducibleEvalIn(core), [id(2)]);
});

test("an occupied gate refuses every same-project dequeue and no other project's", () => {
  const core = coreOf([
    ticketOn(config, 1, { phase: "PWrapUpHolding" }),
    ticketOn(config, 1, { phase: "PWrapUp" }),
    ticketOn(config, 2, { phase: "PWrapUp" }),
  ]);
  assert.ok(!leaseFreeIn(core, 1));
  assert.ok(leaseFreeIn(core, 2));
  assert.ok(!wrapUpStartableIn(core, id(2)));
  assert.ok(wrapUpStartableIn(core, id(3)));
  assert.ok(
    !wrapUpStartableIn(core, id(1)),
    "the occupant is holding the slot rather than queued for it",
  );
  assert.deepEqual(holdingIn(core), [id(1)]);
  assert.deepEqual(wrapUpStartablesIn(core), [id(3)]);
});

test("the refusal lifts in the post-state the occupant leaves, with nothing cleaning up", () => {
  const core = coreOf([
    ticketOn(config, 1, { phase: "PWrapUpHolding" }),
    ticketOn(config, 1, { phase: "PWrapUp" }),
  ]);
  const landed = decideWrapUpResolve(config, core, id(1), "WOk", true).post;
  assert.ok(wrapUpStartableIn(landed, id(2)));
  assert.deepEqual(doneIn(landed), [id(1)]);
});

test("a wrap-up that needs no lease answers a resource no universe contains", () => {
  const noLease = ticketOn(config, 1, { wrapUp: wNone });
  assert.equal(leaseOf(noLease), 0);
  assert.equal(leaseOf(ticketOn(config, 2)), 2);
  assert.ok(leaseFreeIn(coreOf([{ ...noLease, phase: "PWrapUpHolding" }]), 1));
});

test("the pre-work resume is free under both meterings and the pipeline resumes are not", () => {
  assert.equal(resumeCharge(config, "RPending"), 0);
  assert.equal(resumeCharge(retryFreeInstance, "RPending"), 0);
  assert.equal(resumeCharge(config, "RWorking"), 1);
  assert.equal(resumeCharge(retryFreeInstance, "RWorking"), 1);
  assert.equal(resumeCharge(config, "RWrapUp"), 1);
  assert.equal(resumeCharge(retryFreeInstance, "RWrapUp"), 0);
  assert.equal(resumeCharge(config, "REvaluating"), 1);
  assert.equal(resumeCharge(retryFreeInstance, "REvaluating"), 0);
});

test("a park is retryable when its resume exists and the ticket can afford it", () => {
  const parked = coreOf([
    ticketOn(config, 1, {
      phase: "PEscalated",
      resumeAt: "RPending",
      reason: "RsRevalidationFailed",
      gasLeft: 0,
    }),
    ticketOn(config, 1, {
      phase: "PEscalated",
      resumeAt: "RWrapUp",
      reason: "RsGasExhausted",
      gasLeft: 0,
    }),
    ticketOn(config, 1, {
      phase: "PEscalated",
      reason: "RsDependencyRevoked",
      gasLeft: 3,
    }),
  ]);
  assert.ok(retryableIn(config, parked, id(1)), "nothing was ever spent");
  assert.ok(retryableIn(retryFreeInstance, parked, id(1)));
  assert.ok(
    !retryableIn(config, parked, id(2)),
    "a charging resume at zero gas is the permanently-parked corner",
  );
  assert.ok(retryableIn(retryFreeInstance, parked, id(2)));
  assert.ok(
    !retryableIn(config, parked, id(3)),
    "the cascade wall has no modeled resume, so its only exit is a revoke",
  );
  assert.deepEqual(retryablesIn(config, parked), [id(1)]);
});

test("the delivery range an at-least-once fabric may name is the ticket's whole history", () => {
  const core = coreOf([
    ticketOn(config, 1, {
      phase: "PEvaluating",
      record: [workTask(1, "TPassed"), workTask(2, "TPassed")],
      tasks: [evalRunning(3, 0)],
      spawned: 3,
    }),
    ticketOn(config, 1, { phase: "PDraft" }),
  ]);
  assert.deepEqual(deliverableTaskIds(core, id(1)).map(Number), [1, 2, 3]);
  assert.deepEqual(deliverableTaskIds(core, id(2)), []);
});

test("a valid artifact has no failure to draw and an invalidated one is not forced to fail", () => {
  assert.deepEqual(wrapUpOutcomes(false), ["WOk"]);
  assert.deepEqual(wrapUpOutcomes(true), ["WOk", "WFailed"]);
  assert.ok(!wrapUpOutcomes(false).includes("WFailed"));
  assert.ok(wrapUpOutcomes(true).includes("WOk"));
});
