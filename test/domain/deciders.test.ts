/**
 * The decider arms the golden corpus does not reach, and the measure
 * classifications a per-step record cannot carry.
 *
 * THE REPLAY IS THE STRONGER EVIDENCE AND THIS SUITE IS NOT A SECOND COPY OF
 * IT. Every shape the corpus does reach is already pinned by exact equality on
 * the whole record and the whole post-state, so restating one here would be a
 * weaker assertion about the same step. What is left over is the arms no
 * committed trace fires — the finish that needs no finalizer, the duplicate and
 * stale completions, an execution blocked from the phase with no resume, the
 * guarded unreachable resume, a cascade deeper than the corpus happens to
 * build — and the descent-set classification, which lives in the measure rather
 * than in the record a golden compares.
 */

import type {
  Core,
  Stage,
  Ticket,
} from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import { boundsOf, defaultProgram } from "../../src/domain/config.ts";
import { ticketAt } from "../../src/domain/core.ts";
import {
  decideAbandonHandoff,
  decideDispatch,
  decideEvalStageReduce,
  decideExecutionBlocked,
  decideFinalizationResult,
  decideReleaseTicket,
  decideResumeTicket,
  decideRevoke,
  decideTaskDone,
  decideWorkReduce,
  freshTicket,
  settledRecord,
} from "../../src/domain/deciders.ts";
import { retryableIn } from "../../src/domain/enablement.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { sysMeasure } from "../../src/domain/measure.ts";
import {
  budgeted,
  reworkBudget,
  reworkBudgetOf,
} from "../../src/domain/pricing.ts";
import { tasksInIdOrder } from "../../src/domain/task.ts";
import {
  budgetedInstance,
  deadlineOnlyInstance,
  retryFreeInstance,
} from "./configs.ts";
import {
  accountsForAll,
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

/** The fleet's measure at the reference instance's bounds. */
const measure = (core: Core): number => sysMeasure(boundsOf(config), core);

/** The live set as a trace reads it: ids and states, in id order. */
const liveShape = (core: Core, at: ReturnType<typeof id>) =>
  tasksInIdOrder(ticketAt(core, at).tasks).map((t) => ({
    id: t.id,
    kind: t.kind,
    state: t.state,
  }));

/** The authoring a release carries, which every value on it is drawn from a universe. */
const authoring = {
  deps: depsOf(),
  program: defaultProgram(config),
  workFanout: config.nTasks,
  reworkPolicy: config.reworkPolicy,
  finalizationPricing: config.finalizationPricing,
  resumePricing: "RetryCharged" as const,
  finalizer: "ManagedFinalizer" as const,
};

test("a release arrives already Pending, with every account at its grant", () => {
  const born = freshTicket({ ...authoring, gas: config.gas });
  assert.equal(born.phase, "Pending");
  assert.equal(born.gasLeft, config.gas);
  assert.equal(born.reworkLeft, 1);
  assert.equal(born.finalizationLeft, 1);
  assert.equal(born.spawned, 0);
  assert.equal(born.completions, 0);
  assert.equal(born.artifact, "NoArtifact");
  assert.equal(born.resumeAt, "NoResume");
  assert.equal(born.reason, "NoReason");
  assert.equal(born.tasks.size, 0);
  assert.deepEqual(born.record, []);
});

test("the release records no transition, and takes the sparse id it was handed", () => {
  const empty = coreOf([]);
  const released = decideReleaseTicket(config, empty, asTicketId(5), authoring);
  assert.equal(released.rec.label, "ticket-released");
  assert.deepEqual(released.rec.transitions, []);
  assert.deepEqual(
    released.rec.effects,
    [],
    "the ticket exists because the journal says so; nothing is asked of the world",
  );
  assert.deepEqual([...released.post.tickets.keys()], [asTicketId(5)]);
  assert.ok(
    measure(released.post) > measure(empty),
    "a fresh Pending's whole measure arrives with it, which is the arm the descent argument exempts",
  );
});

test("a dispatch charges gas and spawns the ticket's own authored width", () => {
  const ready = coreOf([
    ticketOn(config, "ManagedFinalizer", { phase: "Pending", workFanout: 1 }),
  ]);
  const decision = decideDispatch(ready, id(1));
  assert.equal(decision.rec.label, "dispatch");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(1), from: "Pending", to: "Working" },
  ]);
  assert.deepEqual(decision.rec.effects, ["SpawnWorkTasks"]);
  const dispatched = ticketAt(decision.post, id(1));
  assert.equal(dispatched.gasLeft, config.gas - 1);
  assert.equal(dispatched.spawned, 1);
  assert.deepEqual(liveShape(decision.post, id(1)), [
    { id: asTaskId(1), kind: "Work", state: "Outstanding" },
  ]);
  assert.ok(measure(decision.post) < measure(ready));
});

test("first write wins, and an id already retired matches nothing live", () => {
  const running = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Evaluating",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalOutstanding(3, 0), evalOutstanding(4, 0)]),
      spawned: 4,
    }),
  ]);
  const first = decideTaskDone(running, id(1), asTaskId(3), "Pass");
  assert.equal(first.rec.label, "task-done");
  assert.deepEqual(first.rec.transitions, []);
  assert.deepEqual(first.rec.effects, []);
  const again = decideTaskDone(first.post, id(1), asTaskId(3), "Fail");
  assert.deepEqual(
    liveShape(again.post, id(1)),
    liveShape(first.post, id(1)),
    "a duplicate delivery for a resolved task changes nothing",
  );
  const stale = decideTaskDone(first.post, id(1), asTaskId(1), "Fail");
  assert.deepEqual(
    ticketAt(stale.post, id(1)).record,
    ticketAt(first.post, id(1)).record,
    "an id from an earlier incarnation is already retired, so it no-ops by identity",
  );
  assert.deepEqual(liveShape(stale.post, id(1)), liveShape(first.post, id(1)));
});

test("a passing work set stamps the artifact its own accounting names", () => {
  const settledWork = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workTask(1, "Passed"), workTask(2, "Passed")]),
      spawned: 2,
      gasLeft: 2,
    }),
  ]);
  const decision = decideWorkReduce(settledWork, id(1));
  assert.equal(decision.rec.label, "work-passed");
  assert.deepEqual(decision.rec.effects, ["SpawnEvalTasks"]);
  const evaluating = ticketAt(decision.post, id(1));
  assert.deepEqual(evaluating.artifact, {
    type: "ProducedArtifact",
    value: 2,
  });
  assert.equal(evaluating.record.length, 2);
  assert.deepEqual(liveShape(decision.post, id(1)), [
    {
      id: asTaskId(3),
      kind: { type: "Evaluation", value: 0 },
      state: "Outstanding",
    },
    {
      id: asTaskId(4),
      kind: { type: "Evaluation", value: 0 },
      state: "Outstanding",
    },
  ]);
  assert.equal(
    evaluating.gasLeft,
    2,
    "the reduce spends nothing; gas meters entries to Working",
  );
});

test("a failed work set parks resumable at Working, retiring what failed", () => {
  const failedWork = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workTask(1, "Passed"), workTask(2, "Failed")]),
      spawned: 2,
      gasLeft: 2,
    }),
  ]);
  const decision = decideWorkReduce(failedWork, id(1));
  assert.equal(decision.rec.label, "ticket-escalated work_failed");
  assert.deepEqual(decision.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(decision.post, id(1));
  assert.equal(parked.reason, "WorkFailed");
  assert.equal(parked.resumeAt, "ResumeWorking");
  assert.equal(parked.tasks.size, 0);
  assert.equal(parked.record.length, 2);
  assert.equal(parked.spawned, 2);
  assert.equal(parked.artifact, "NoArtifact");
});

test("the stage's own combinator decides, so a program is not always-pass", () => {
  const anyPass: readonly Stage[] = [{ fanout: 2, combinator: "AnyPass" }];
  const evaluating = (
    outcomes: readonly ["Passed" | "Failed", "Passed" | "Failed"],
  ) =>
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Evaluating",
        program: anyPass,
        tasks: new Set([
          evalTask(1, 0, outcomes[0]),
          evalTask(2, 0, outcomes[1]),
        ]),
        spawned: 2,
        gasLeft: 2,
      }),
    ]);
  assert.equal(
    decideEvalStageReduce(evaluating(["Passed", "Failed"]), id(1)).rec.label,
    "eval-passed",
  );
  assert.equal(
    decideEvalStageReduce(evaluating(["Failed", "Failed"]), id(1)).rec.label,
    "rework-started eval_failure",
  );
});

test("a ticket authored without a finalizer completes out of evaluation, holding no live set", () => {
  const passing = coreOf([
    ticketOn(config, "NoFinalizer", {
      phase: "Evaluating",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalTask(3, 0, "Passed"), evalTask(4, 0, "Passed")]),
      spawned: 4,
      artifact: { type: "ProducedArtifact", value: 2 },
      gasLeft: 2,
    }),
  ]);
  const decision = decideEvalStageReduce(passing, id(1));
  assert.equal(decision.rec.label, "ticket-done");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(1), from: "Evaluating", to: "Done" },
  ]);
  assert.deepEqual(
    decision.rec.effects,
    [],
    "entering Done is transactional with the journal, so nothing is left for the world to do",
  );
  const done = ticketAt(decision.post, id(1));
  assert.equal(done.completions, 1);
  assert.equal(
    done.tasks.size,
    0,
    "the passing stage is retired on the way out, not carried into the terminal",
  );
  assert.equal(done.record.length, 4);
  assert.ok(measure(decision.post) < measure(passing));
});

test("a rework cycle spends both the rework account and gas, and each wall names itself", () => {
  const failing = (overrides: Partial<Ticket>) =>
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Evaluating",
        record: [workTask(1, "Passed"), workTask(2, "Passed")],
        tasks: new Set([evalTask(3, 0, "Failed"), evalTask(4, 0, "Failed")]),
        spawned: 4,
        artifact: { type: "ProducedArtifact", value: 2 },
        ...overrides,
      }),
    ]);
  const rich = failing({ reworkLeft: 1, gasLeft: 2 });
  const reworked = decideEvalStageReduce(rich, id(1));
  assert.equal(reworked.rec.label, "rework-started eval_failure");
  assert.deepEqual(reworked.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(reworked.post, id(1)).reworkLeft, 0);
  assert.equal(ticketAt(reworked.post, id(1)).gasLeft, 1);
  assert.equal(ticketAt(reworked.post, id(1)).phase, "Working");
  assert.ok(measure(reworked.post) < measure(rich));

  const spent = failing({ reworkLeft: 0, gasLeft: 2 });
  const budgetWall = decideEvalStageReduce(spent, id(1));
  assert.equal(
    budgetWall.rec.label,
    "ticket-escalated rework_budget_exhausted",
  );
  assert.equal(
    ticketAt(budgetWall.post, id(1)).reason,
    "ReworkBudgetExhausted",
  );
  assert.equal(ticketAt(budgetWall.post, id(1)).resumeAt, "ResumeReworking");

  const declined = failing({
    reworkLeft: 0,
    gasLeft: 2,
    reworkPolicy: reworkBudgetOf(0),
  });
  const declinedWall = decideEvalStageReduce(declined, id(1));
  assert.equal(
    ticketAt(declinedWall.post, id(1)).resumeAt,
    "NoResume",
    "an author who bought no rework budget gets a revoke-only park",
  );
  assert.equal(retryableIn(declinedWall.post, id(1)), false);

  const dry = failing({ reworkLeft: 1, gasLeft: 0 });
  const gasWall = decideEvalStageReduce(dry, id(1));
  assert.equal(gasWall.rec.label, "ticket-escalated gas_exhausted");
  assert.equal(ticketAt(gasWall.post, id(1)).reason, "GasExhausted");
  assert.equal(
    ticketAt(gasWall.post, id(1)).reworkLeft,
    1,
    "the gas wall spends no rework, which is what makes the two walls distinguishable",
  );
});

/** A ticket running its finalizer, with both accounts at the caller's sizes. */
const finalizing = (
  instance: typeof config,
  overrides: { finalizationLeft?: number; gasLeft: number },
): Core =>
  coreOf([
    ticketOn(instance, "ManagedFinalizer", {
      phase: "Finalizing",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      spawned: 2,
      artifact: { type: "ProducedArtifact", value: 2 },
      ...overrides,
    }),
  ]);

test("a successful finalization is the ticket's one completion", () => {
  const pre = finalizing(config, { gasLeft: 2 });
  const decision = decideFinalizationResult(
    pre,
    id(1),
    "FinalizationSucceeded",
  );
  assert.equal(decision.rec.label, "ticket-done");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(1), from: "Finalizing", to: "Done" },
  ]);
  assert.deepEqual(decision.rec.effects, []);
  assert.equal(ticketAt(decision.post, id(1)).completions, 1);
  assert.ok(measure(decision.post) < measure(pre));
});

test("accepted promotion can only publish, retry publication, succeed, or abandon", () => {
  const pre = finalizing(config, { gasLeft: 2 });
  const promoted = decideFinalizationResult(pre, id(1), "PromotionAccepted");
  assert.equal(ticketAt(promoted.post, id(1)).phase, "PublishingHandoff");
  assert.deepEqual(promoted.rec.effects, ["PublishHandoff"]);

  const blocked = decideFinalizationResult(
    promoted.post,
    id(1),
    "HandoffPublicationUnproven",
  );
  assert.equal(ticketAt(blocked.post, id(1)).phase, "HandoffBlocked");
  assert.equal(
    ticketAt(blocked.post, id(1)).resumeAt,
    "ResumePublishingHandoff",
  );

  const retried = decideResumeTicket(blocked.post, id(1));
  assert.equal(ticketAt(retried.post, id(1)).phase, "PublishingHandoff");
  assert.deepEqual(retried.rec.effects, ["PublishHandoff"]);
  const succeeded = decideFinalizationResult(
    retried.post,
    id(1),
    "FinalizationSucceeded",
  );
  assert.equal(ticketAt(succeeded.post, id(1)).phase, "Done");

  const abandoned = decideAbandonHandoff(blocked.post, id(1));
  assert.equal(ticketAt(abandoned.post, id(1)).phase, "Abandoned");
  assert.equal(ticketAt(abandoned.post, id(1)).completions, 0);
  assert.ok(measure(abandoned.post) < measure(blocked.post));
});

test("handoff abandonment atomically settles every transitive pending dependent", () => {
  const fleet = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "HandoffBlocked",
      resumeAt: "ResumePublishingHandoff",
    }),
    ticketOn(config, "NoFinalizer", { phase: "Pending", deps: depsOf(1) }),
    ticketOn(config, "NoFinalizer", { phase: "Pending", deps: depsOf(2) }),
  ]);
  const abandoned = decideAbandonHandoff(fleet, id(1));
  assert.deepEqual(
    abandoned.rec.transitions,
    [1, 2, 3].map((ticket) => ({
      ticket: id(ticket),
      from: ticket === 1 ? "HandoffBlocked" : "Pending",
      to: "Abandoned" as const,
    })),
  );
  for (const ticket of [1, 2, 3]) {
    assert.equal(ticketAt(abandoned.post, id(ticket)).phase, "Abandoned");
    assert.equal(ticketAt(abandoned.post, id(ticket)).completions, 0);
  }
  assert.ok(measure(abandoned.post) < measure(fleet));
});

test("a failed finalization spends the account its ticket was authored with", () => {
  const budgetedTicket = finalizing(config, {
    finalizationLeft: 1,
    gasLeft: 2,
  });
  const reworked = decideFinalizationResult(
    budgetedTicket,
    id(1),
    "FinalizationFailed",
  );
  assert.equal(reworked.rec.label, "rework-started finalization_failed");
  assert.deepEqual(reworked.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(reworked.post, id(1)).finalizationLeft, 0);
  assert.equal(ticketAt(reworked.post, id(1)).gasLeft, 1);
  assert.equal(ticketAt(reworked.post, id(1)).phase, "Working");

  const deadline = deadlineOnlyInstance;
  const unbudgeted = decideFinalizationResult(
    finalizing(deadline, { gasLeft: 2 }),
    id(1),
    "FinalizationFailed",
  );
  assert.equal(unbudgeted.rec.label, "rework-started finalization_failed");
  assert.equal(ticketAt(unbudgeted.post, id(1)).gasLeft, 1);
  assert.equal(
    ticketAt(unbudgeted.post, id(1)).finalizationLeft,
    0,
    "this pricing grants no finalization account, so there is none to spend",
  );
});

test("each finalization wall carries its own name, and the pricing decides which exists", () => {
  const budgetWall = decideFinalizationResult(
    finalizing(config, { finalizationLeft: 0, gasLeft: 2 }),
    id(1),
    "FinalizationFailed",
  );
  assert.equal(
    budgetWall.rec.label,
    "ticket-escalated finalization_budget_exhausted",
  );
  assert.equal(
    ticketAt(budgetWall.post, id(1)).reason,
    "FinalizationBudgetExhausted",
  );
  assert.equal(ticketAt(budgetWall.post, id(1)).resumeAt, "ResumeFinalizing");

  const gasWall = decideFinalizationResult(
    finalizing(config, { finalizationLeft: 1, gasLeft: 0 }),
    id(1),
    "FinalizationFailed",
  );
  assert.equal(gasWall.rec.label, "ticket-escalated gas_exhausted");
  assert.equal(ticketAt(gasWall.post, id(1)).reason, "GasExhausted");

  const deadlineWall = decideFinalizationResult(
    finalizing(deadlineOnlyInstance, { gasLeft: 0 }),
    id(1),
    "FinalizationFailed",
  );
  assert.equal(deadlineWall.rec.label, "ticket-escalated gas_exhausted");
  assert.equal(
    ticketAt(deadlineWall.post, id(1)).reason,
    "GasExhausted",
    "gas alone meters this loop, so gas is the only wall it can reach",
  );
});

test("a blocked execution resumes where the work was, and spends nothing", () => {
  const running = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workOutstanding(1), workOutstanding(2)]),
      spawned: 2,
      gasLeft: 2,
    }),
  ]);
  const blocked = decideExecutionBlocked(
    running,
    id(1),
    "ExecutionProfileUnavailable",
  );
  assert.equal(blocked.rec.label, "ticket-escalated execution_blocked");
  assert.deepEqual(blocked.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(blocked.post, id(1));
  assert.equal(parked.reason, "ExecutionProfileUnavailable");
  assert.equal(parked.resumeAt, "ResumeWorking");
  assert.equal(parked.gasLeft, 2);
  assert.equal(parked.reworkLeft, 1);
  assert.equal(parked.finalizationLeft, 1);
  assert.deepEqual(
    parked.record.map((t) => t.state),
    [
      { type: "Resolved", value: "Cancelled" },
      { type: "Resolved", value: "Cancelled" },
    ],
    "the outstanding set is retired as cancelled rather than dropped",
  );
});

test("a block from the phase that holds no task set stamps no resume", () => {
  const evaluating = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Evaluating",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalOutstanding(3, 0), evalOutstanding(4, 0)]),
      spawned: 4,
    }),
  ]);
  assert.equal(
    ticketAt(
      decideExecutionBlocked(evaluating, id(1), "RuntimeVersionUnsupported")
        .post,
      id(1),
    ).resumeAt,
    "ResumeEvaluating",
  );
  const finalizingCore = finalizing(config, { gasLeft: 2 });
  assert.equal(
    ticketAt(
      decideExecutionBlocked(
        finalizingCore,
        id(1),
        "RequiredCapabilityUnavailable",
      ).post,
      id(1),
    ).resumeAt,
    "NoResume",
  );
});

test("every resume re-enters where its wall said, priced by the ticket's own policy", () => {
  const parkedAt = (
    at: "ResumeWorking" | "ResumeEvaluating" | "ResumeFinalizing",
    resumePricing: "RetryCharged" | "RetryFree",
  ): Core =>
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Escalated",
        resumeAt: at,
        reason: "GasExhausted",
        resumePricing,
        record: [workTask(1, "Passed"), workTask(2, "Passed")],
        spawned: 2,
        gasLeft: 2,
      }),
    ]);
  const work = decideResumeTicket(
    parkedAt("ResumeWorking", "RetryFree"),
    id(1),
  );
  assert.equal(work.rec.label, "ticket-resumed");
  assert.deepEqual(work.rec.transitions, [
    { ticket: id(1), from: "Escalated", to: "Working" },
  ]);
  assert.deepEqual(work.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(
    ticketAt(work.post, id(1)).gasLeft,
    1,
    "entry to Working meters even where retries are free",
  );
  assert.equal(ticketAt(work.post, id(1)).reason, "NoReason");
  assert.equal(ticketAt(work.post, id(1)).resumeAt, "NoResume");

  const evaluate = decideResumeTicket(
    parkedAt("ResumeEvaluating", "RetryCharged"),
    id(1),
  );
  assert.deepEqual(evaluate.rec.effects, ["SpawnEvalTasks"]);
  assert.equal(ticketAt(evaluate.post, id(1)).gasLeft, 1);
  assert.deepEqual(
    liveShape(evaluate.post, id(1)).map((t) => t.id),
    [asTaskId(3), asTaskId(4)],
    "the retried tasks are new records; the failed ones stay retired in the log",
  );

  const freePipeline = parkedAt("ResumeFinalizing", "RetryFree");
  const finalize = decideResumeTicket(freePipeline, id(1));
  assert.deepEqual(finalize.rec.effects, ["RunFinalizer"]);
  assert.equal(ticketAt(finalize.post, id(1)).gasLeft, 2);
  assert.ok(
    measure(finalize.post) > measure(freePipeline),
    "a free pipeline resume is the churn arm the descent argument exempts",
  );
});

test("the rework wall's resume refills the account and buys a work cycle", () => {
  const walled = (resumePricing: "RetryCharged" | "RetryFree"): Core =>
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Escalated",
        resumeAt: "ResumeReworking",
        reason: "ReworkBudgetExhausted",
        resumePricing,
        record: [workTask(1, "Passed"), evalTask(2, 0, "Failed")],
        spawned: 2,
        reworkLeft: 0,
        gasLeft: 2,
      }),
    ]);
  for (const pricing of ["RetryCharged", "RetryFree"] as const) {
    const pre = walled(pricing);
    const resumed = decideResumeTicket(pre, id(1));
    assert.equal(resumed.rec.label, "ticket-resumed");
    assert.deepEqual(resumed.rec.transitions, [
      { ticket: id(1), from: "Escalated", to: "Working" },
    ]);
    assert.deepEqual(resumed.rec.effects, ["SpawnWorkTasks"]);
    const post = ticketAt(resumed.post, id(1));
    assert.equal(post.reworkLeft, reworkBudget(post.reworkPolicy));
    assert.equal(
      post.gasLeft,
      1,
      "entry to Working meters even where retries are free",
    );
    assert.deepEqual(
      tasksInIdOrder(post.tasks).map((t) => t.id),
      [asTaskId(3), asTaskId(4)],
      "fresh work ids above an intact record",
    );
    assert.deepEqual(post.record, ticketAt(pre, id(1)).record);
    assert.ok(
      measure(resumed.post) < measure(pre),
      "a refill bought with gas descends; it is in no churn set",
    );
  }
});

test("a park with no modeled resume is the guarded no-op its enablement refuses", () => {
  const walled = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      reason: "DependencyRevoked",
    }),
  ]);
  const decision = decideResumeTicket(walled, id(1));
  assert.equal(decision.rec.label, "ticket-resume-refused");
  assert.deepEqual(decision.rec.transitions, []);
  assert.deepEqual(decision.rec.effects, []);
  assert.deepEqual(decision.post, walled);
});

test("a revoke retires what was running and settles without completing", () => {
  const running = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workOutstanding(1), workOutstanding(2)]),
      spawned: 2,
      gasLeft: 2,
    }),
  ]);
  const revoked = decideRevoke(config, running, id(1));
  assert.deepEqual(revoked.rec.transitions, [
    { ticket: id(1), from: "Working", to: "Revoked" },
  ]);
  assert.deepEqual(revoked.rec.effects, ["CancelTicketWork"]);
  const settled = ticketAt(revoked.post, id(1));
  assert.equal(settled.completions, 0);
  assert.equal(
    settled.gasLeft,
    2,
    "a revoke charges nothing in either direction",
  );
  assert.equal(settled.reason, "NoReason");
  assert.equal(settled.resumeAt, "NoResume");
  assert.equal(settled.record.length, 2);
  assert.equal(settled.tasks.size, 0);
  assert.ok(measure(revoked.post) < measure(running));
});

/** A chain 1 <- 2 <- 3 under sparse, numerically reversed ids, which the corpus never builds. */
const chain: Core = {
  tickets: new Map([
    [
      id(6),
      ticketOn(config, "ManagedFinalizer", { phase: "Pending", gasLeft: 2 }),
    ],
    [
      id(4),
      ticketOn(config, "ManagedFinalizer", {
        phase: "Pending",
        deps: depsOf(6),
        gasLeft: 2,
      }),
    ],
    [
      id(1),
      ticketOn(config, "ManagedFinalizer", {
        phase: "Pending",
        deps: depsOf(4),
        gasLeft: 2,
      }),
    ],
  ]),
};
const cascaded = decideRevoke(config, chain, id(6)).post;

test("the cascade parks every transitive dependent in the one decision, spending nothing", () => {
  const decision = decideRevoke(config, chain, id(6));
  assert.equal(decision.rec.label, "ticket-revoked");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(6), from: "Pending", to: "Revoked" },
    { ticket: id(1), from: "Pending", to: "Escalated" },
    { ticket: id(4), from: "Pending", to: "Escalated" },
  ]);
  assert.deepEqual(decision.rec.effects, [
    "CancelTicketWork",
    "OpenHumanTask",
    "OpenHumanTask",
  ]);
  for (const parked of [id(1), id(4)]) {
    assert.equal(ticketAt(cascaded, parked).reason, "DependencyRevoked");
    assert.equal(ticketAt(cascaded, parked).resumeAt, "NoResume");
    assert.equal(ticketAt(cascaded, parked).gasLeft, 2);
  }
  assert.equal(ticketAt(cascaded, id(6)).reason, "NoReason");
  assert.ok(measure(cascaded) < measure(chain));
});

test("a desk revoke is flat, and it re-parks nobody", () => {
  const settled = decideRevoke(config, cascaded, id(4));
  assert.deepEqual(settled.rec.transitions, [
    { ticket: id(4), from: "Escalated", to: "Revoked" },
  ]);
  assert.deepEqual(settled.rec.effects, ["CancelTicketWork"]);
  assert.equal(
    measure(settled.post),
    measure(cascaded),
    "settling a parked ticket from the desk is the flat arm the descent argument exempts",
  );
  assert.equal(ticketAt(settled.post, id(1)).phase, "Escalated");
  assert.equal(ticketAt(settled.post, id(1)).reason, "DependencyRevoked");
});

test("the quiet fleet's stutter records that nothing moved", () => {
  assert.deepEqual(settledRecord(), {
    label: "settled",
    transitions: [],
    effects: [],
  });
});

test("a ticket authored poorer than its fleet is metered by what it carries", () => {
  const poor = coreOf([
    ticketOn(retryFreeInstance, "ManagedFinalizer", {
      phase: "Evaluating",
      reworkPolicy: reworkBudgetOf(0),
      reworkLeft: 0,
      finalizationPricing: budgeted(0),
      finalizationLeft: 0,
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalTask(3, 0, "Failed"), evalTask(4, 0, "Failed")]),
      spawned: 4,
      artifact: { type: "ProducedArtifact", value: 2 },
      gasLeft: 2,
    }),
  ]);
  assert.equal(
    decideEvalStageReduce(poor, id(1)).rec.label,
    "ticket-escalated rework_budget_exhausted",
    "a ticket with no rework grant walls on its first eval failure, however rich the fleet is",
  );
});

test("every fixture this suite builds is a shape the machine could have reached", () => {
  const live = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workOutstanding(1)]),
      workFanout: 1,
      spawned: 1,
    }),
  ]);
  for (const core of [
    chain,
    cascaded,
    live,
    finalizing(config, { gasLeft: 2 }),
  ]) {
    assert.ok(
      accountsForAll(core),
      "a fixture accounts for all of its ids or none",
    );
  }
});
