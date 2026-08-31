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
  canReleaseIn,
  dependableIn,
  depArtifacts,
  depsDoneIn,
  dispatchableIn,
  doneIn,
  executionBlockedReasons,
  finalizableIn,
  finalizationOutcomes,
  finalizingIn,
  isBlockedIn,
  isReadyIn,
  outstandingTaskIdsIn,
  outstandingTaskIn,
  quietIn,
  readiesIn,
  releasableAuthoring,
  releasableIdsIn,
  reducibleEvalIn,
  reducibleWorkIn,
  resumeCharge,
  retryableIn,
  retryablesIn,
  revocableIn,
  revocablesIn,
  taskPhaseIn,
  waitsOn,
} from "../../src/domain/enablement.ts";
import { defaultProgram } from "../../src/domain/config.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { budgeted, reworkBudgetOf } from "../../src/domain/pricing.ts";
import type { Core, Ticket } from "../../src/domain/generated/modelTypes.ts";
import { budgetedInstance } from "./configs.ts";
import {
  coreOf,
  depsOf,
  evalOutstanding,
  evalTask,
  id,
  ticketOn,
  workOutstanding,
  workTask,
} from "./fixtures.ts";

const config = budgetedInstance;

/** An artifact mark, as a ticket that ran carries one. */
const produced = (value: number) =>
  ({ type: "ProducedArtifact", value }) as const;

/** A fleet under the sparse ids a release actually draws, which dense fixtures never build. */
function sparseCore(entries: readonly [number, Ticket][]): Core {
  return { tickets: new Map(entries.map(([at, t]) => [id(at), t])) };
}

test("room for one more release runs out exactly at the fleet bound", () => {
  const fleet = Array.from({ length: config.nTickets }, () => ticketOn(config));
  assert.ok(canReleaseIn(config, coreOf([]), id(1)));
  assert.ok(canReleaseIn(config, coreOf(fleet.slice(0, -1)), id(3)));
  assert.ok(!canReleaseIn(config, coreOf(fleet), id(4)));
});

test("an id is claimable once: not outside the universe, and never again after", () => {
  const held = sparseCore([
    [2, ticketOn(config)],
    [5, ticketOn(config, "ManagedFinalizer", { phase: "Done" })],
  ]);
  assert.ok(canReleaseIn(config, held, id(4)));
  assert.ok(
    !canReleaseIn(config, held, asTicketId(config.nTickets * 2 + 1)),
    "the universe is finite, and a release draws from it",
  );
  assert.ok(!canReleaseIn(config, held, id(2)));
  assert.ok(
    !canReleaseIn(config, held, id(5)),
    "an id is never reused, so a settled ticket still holds its own",
  );
  assert.deepEqual(releasableIdsIn(config, held), [1, 3, 4, 6].map(id));
  assert.deepEqual(
    releasableIdsIn(
      config,
      coreOf([ticketOn(config), ticketOn(config), ticketOn(config)]),
    ),
    [],
    "a fleet at its bound offers nothing, whatever the universe still holds",
  );
});

test("a release may depend on anything but a tombstone", () => {
  const core = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "DependencyRevoked",
    }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
  ]);
  assert.deepEqual(dependableIn(core), [id(1), id(4)]);
});

test("the absorbing terminals and the point of no return are the unrevocable phases", () => {
  const core = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "WorkFailed",
      resumeAt: "ResumeWorking",
    }),
    ticketOn(config, "ManagedFinalizer", { phase: "Working" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Done" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Finalizing" }),
  ]);
  assert.deepEqual(revocablesIn(core), [id(1), id(2), id(3)]);
  assert.ok(!revocableIn(core, id(4)));
  assert.ok(!revocableIn(core, id(5)));
  assert.ok(
    !revocableIn(core, id(6)),
    "the finalizer is running, and nothing recalls it",
  );
});

test("a dependency that is not Done blocks, whatever else it is doing", () => {
  const blocked = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Working" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(isBlockedIn(blocked, id(2)));
  assert.ok(!isReadyIn(blocked, id(2)));
  assert.deepEqual(readiesIn(blocked), []);

  const landed = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Done",
      artifact: produced(2),
    }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", deps: depsOf(1) }),
  ]);
  assert.ok(isReadyIn(landed, id(2)));
  assert.ok(!isBlockedIn(landed, id(2)));
  assert.ok(depsDoneIn(landed, id(2)));
  assert.deepEqual(readiesIn(landed), [id(2)]);
});

test("what a ticket waits on is what its dependencies produced, read in id order", () => {
  const core = sparseCore([
    [
      1,
      ticketOn(config, "ManagedFinalizer", {
        phase: "Done",
        artifact: produced(2),
      }),
    ],
    [
      4,
      ticketOn(config, "ManagedFinalizer", {
        phase: "Done",
        artifact: produced(5),
      }),
    ],
    [
      6,
      ticketOn(config, "ManagedFinalizer", {
        phase: "Pending",
        deps: depsOf(4, 1),
      }),
    ],
  ]);
  assert.deepEqual(
    [...waitsOn(core, id(6))].sort((a, b) => a - b),
    [1, 4],
  );
  assert.deepEqual(
    depArtifacts(core, id(6)),
    [produced(2), produced(5)],
    "the read is ordered by dependency id, so it does not inherit a set's iteration order",
  );
});

test("the ticket writer needs a ready ticket with gas to charge", () => {
  const ready = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
  ]);
  const broke = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", gasLeft: 0 }),
  ]);
  assert.ok(dispatchableIn(ready, id(1)));
  assert.ok(!dispatchableIn(broke, id(1)));
});

test("only the two task phases can receive a completion, and only a resolved set reduces", () => {
  const core = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workOutstanding(1), workTask(2, "Passed")]),
      spawned: 2,
    }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Evaluating",
      tasks: new Set([evalTask(1, 0, "Failed")]),
      spawned: 1,
    }),
    ticketOn(config, "ManagedFinalizer", { phase: "Finalizing" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workTask(1, "Passed")]),
      spawned: 1,
    }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Evaluating",
      tasks: new Set([evalOutstanding(1, 0)]),
      spawned: 1,
    }),
  ]);
  assert.deepEqual(taskPhaseIn(core), [id(1), id(2), id(4), id(5)]);
  assert.deepEqual(reducibleWorkIn(core), [id(4)]);
  assert.deepEqual(reducibleEvalIn(core), [id(2)]);
});

test("the phase holding the finalizer obligation is the only one a result resolves from", () => {
  const core = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Finalizing" }),
    ticketOn(config, "ManagedFinalizer", { phase: "Evaluating" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Done",
      artifact: produced(2),
      completions: 1,
    }),
  ]);
  assert.deepEqual(finalizingIn(core), [id(1)]);
  assert.ok(finalizableIn(core, id(1)));
  assert.ok(!finalizableIn(core, id(2)));
  assert.ok(
    !finalizableIn(core, asTicketId(9)),
    "a result for a ticket the fleet never held is refused rather than looked up",
  );
  assert.deepEqual(doneIn(core), [id(3)]);
});

test("the fabric may still report on exactly the tasks a ticket has outstanding", () => {
  const core = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Evaluating",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalOutstanding(4, 0), evalTask(3, 0, "Passed")]),
      spawned: 4,
    }),
    ticketOn(config, "ManagedFinalizer", { phase: "Pending" }),
  ]);
  assert.deepEqual(outstandingTaskIdsIn(core, id(1)), [4]);
  assert.ok(outstandingTaskIn(core, id(1), 4));
  assert.ok(
    !outstandingTaskIn(core, id(1), 3),
    "a duplicate for a resolved task matches nothing outstanding",
  );
  assert.ok(
    !outstandingTaskIn(core, id(1), 1),
    "a stale delivery names an id already retired into the record",
  );
  assert.deepEqual(outstandingTaskIdsIn(core, id(2)), []);
});

test("entry to Working always meters, and every other resume is priced by the ticket", () => {
  const charged = ticketOn(config, "ManagedFinalizer", {
    resumePricing: "RetryCharged",
  });
  const free = ticketOn(config, "ManagedFinalizer", {
    resumePricing: "RetryFree",
  });
  assert.equal(resumeCharge(charged, "ResumeWorking"), 1);
  assert.equal(
    resumeCharge(free, "ResumeWorking"),
    1,
    "the account that makes the graph valid is charged under both pricings",
  );
  assert.equal(resumeCharge(charged, "ResumeReworking"), 1);
  assert.equal(
    resumeCharge(free, "ResumeReworking"),
    1,
    "the rework wall's resume enters Working, so it meters under both too",
  );
  assert.equal(resumeCharge(charged, "ResumeEvaluating"), 1);
  assert.equal(resumeCharge(free, "ResumeEvaluating"), 0);
  assert.equal(resumeCharge(charged, "ResumeFinalizing"), 1);
  assert.equal(resumeCharge(free, "ResumeFinalizing"), 0);
});

test("a park is retryable when its resume exists and the ticket can afford it", () => {
  const parked = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      resumeAt: "ResumeFinalizing",
      reason: "GasExhausted",
      resumePricing: "RetryCharged",
      gasLeft: 0,
    }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      resumeAt: "ResumeFinalizing",
      reason: "GasExhausted",
      resumePricing: "RetryFree",
      gasLeft: 0,
    }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "DependencyRevoked",
      gasLeft: config.gas,
    }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      resumeAt: "ResumeWorking",
      reason: "WorkFailed",
      gasLeft: 1,
    }),
  ]);
  assert.ok(
    !retryableIn(parked, id(1)),
    "a charging resume at zero gas is the permanently-parked corner",
  );
  assert.ok(retryableIn(parked, id(2)));
  assert.ok(
    !retryableIn(parked, id(3)),
    "the cascade wall has no modeled resume, so its only exit is a revoke",
  );
  assert.ok(retryableIn(parked, id(4)));
  assert.deepEqual(retryablesIn(parked), [id(2), id(4)]);
});

test("a running ticket is not parked, so nothing about it is retryable", () => {
  const running = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      resumeAt: "ResumeWorking",
    }),
  ]);
  assert.ok(!retryableIn(running, id(1)));
});

test("the finalizer reports every lifecycle result, and a block names an execution reason", () => {
  assert.deepEqual(finalizationOutcomes, [
    "FinalizationSucceeded",
    "FinalizationFailed",
    "PromotionAccepted",
    "HandoffPublicationUnproven",
  ]);
  assert.ok(
    !executionBlockedReasons.includes("WorkFailed"),
    "a blocked execution is not failed work, so no work wall is drawable here",
  );
  for (const reason of executionBlockedReasons) {
    assert.ok(
      reason !== "NoReason" && reason !== "DependencyRevoked",
      `${reason} is not something infrastructure reports`,
    );
  }
});

test("a release draws every authored value from a universe, and is refused outside one", () => {
  const authoring = {
    prog: defaultProgram(config),
    workFanout: config.nTasks,
    reworkPolicy: config.reworkPolicy,
    finalizationPricing: config.finalizationPricing,
    resumePricing: "RetryCharged" as const,
    finalizer: "ManagedFinalizer" as const,
  };
  assert.ok(releasableAuthoring(config, authoring));
  assert.ok(
    releasableAuthoring(config, {
      ...authoring,
      reworkPolicy: reworkBudgetOf(0),
      finalizationPricing: "DeadlineOnly",
      workFanout: 1,
      resumePricing: "RetryFree",
      finalizer: "NoFinalizer",
    }),
    "a ticket may be authored poorer than its fleet",
  );
  assert.ok(!releasableAuthoring(config, { ...authoring, prog: [] }));
  assert.ok(!releasableAuthoring(config, { ...authoring, workFanout: 0 }));
  assert.ok(
    !releasableAuthoring(config, {
      ...authoring,
      workFanout: config.nTasks + 1,
    }),
  );
  assert.ok(
    !releasableAuthoring(config, {
      ...authoring,
      reworkPolicy: reworkBudgetOf(99),
    }),
    "no ticket is authored richer than its fleet grants",
  );
  assert.ok(
    !releasableAuthoring(config, {
      ...authoring,
      finalizationPricing: budgeted(99),
    }),
  );
});

test("the stutter is enabled exactly on a fully-released fleet of terminals", () => {
  const settled = [
    ticketOn(config, "ManagedFinalizer", {
      phase: "Done",
      artifact: produced(2),
      completions: 1,
    }),
    ticketOn(config, "ManagedFinalizer", { phase: "Revoked" }),
    ticketOn(config, "ManagedFinalizer", {
      phase: "Done",
      artifact: produced(2),
      completions: 1,
    }),
  ];
  assert.ok(quietIn(config, coreOf(settled)));
  assert.ok(
    !quietIn(config, coreOf(settled.slice(0, -1))),
    "room for a release means the author can still act",
  );
  assert.ok(
    !quietIn(
      config,
      coreOf([
        ...settled.slice(0, -1),
        ticketOn(config, "ManagedFinalizer", { phase: "Working" }),
      ]),
    ),
    "a live ticket means some other action is enabled",
  );
  assert.ok(
    !quietIn(
      config,
      coreOf([
        ...settled.slice(0, -1),
        ticketOn(config, "ManagedFinalizer", {
          phase: "Escalated",
          reason: "WorkFailed",
          resumeAt: "ResumeWorking",
        }),
      ]),
    ),
    "a parked ticket is still revocable, so the desk can act",
  );
});
