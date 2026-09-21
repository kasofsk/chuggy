/**
 * The decider arms the golden corpus does not reach.
 *
 * THE REPLAY IS THE STRONGER EVIDENCE AND THIS SUITE IS NOT A SECOND COPY OF
 * IT. Every shape the corpus does reach is already pinned by exact equality on
 * the whole record and the whole post-state, so restating one here would be a
 * weaker assertion about the same step. What is left over is the arms no
 * committed trace fires — the finish that needs no finalizer, the duplicate and
 * stale completions, an execution blocked from the phase with no resume, the
 * guarded unreachable resume, and a cascade deeper than the corpus happens to
 * build.
 */

import type { Core, Stage } from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultProgram } from "../../src/domain/config.ts";
import { ticketAt } from "../../src/domain/core.ts";
import {
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
import { tasksInIdOrder } from "../../src/domain/task.ts";
import { modelInstance } from "./configs.ts";
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

const config = modelInstance;

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
  finalizer: "ManagedFinalizer" as const,
};

test("a release arrives already Pending, having spawned nothing", () => {
  const born = freshTicket(authoring);
  assert.equal(born.phase, "Pending");
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
  const released = decideReleaseTicket(empty, asTicketId(5), authoring);
  assert.equal(released.rec.label, "ticket-released");
  assert.deepEqual(released.rec.transitions, []);
  assert.deepEqual(
    released.rec.effects,
    [],
    "the ticket exists because the journal says so; nothing is asked of the world",
  );
  assert.deepEqual([...released.post.tickets.keys()], [asTicketId(5)]);
});

test("a dispatch spawns the ticket's own authored width", () => {
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
  assert.equal(dispatched.spawned, 1);
  assert.deepEqual(liveShape(decision.post, id(1)), [
    { id: asTaskId(1), kind: "Work", state: "Outstanding" },
  ]);
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
});

test("a failed work set parks resumable at Working, retiring what failed", () => {
  const failedWork = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workTask(1, "Passed"), workTask(2, "Failed")]),
      spawned: 2,
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
      }),
    ]);
  assert.equal(
    decideEvalStageReduce(
      evaluating(["Passed", "Failed"]),
      id(1),
      "ReworkEvaluationFailure",
    ).rec.label,
    "eval-passed",
  );
  assert.equal(
    decideEvalStageReduce(
      evaluating(["Failed", "Failed"]),
      id(1),
      "ReworkEvaluationFailure",
    ).rec.label,
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
    }),
  ]);
  const decision = decideEvalStageReduce(
    passing,
    id(1),
    "ReworkEvaluationFailure",
  );
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
});

test("one failing stage, two edges, and the disposition is the whole difference", () => {
  const failing = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Evaluating",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalTask(3, 0, "Failed"), evalTask(4, 0, "Failed")]),
      spawned: 4,
      artifact: { type: "ProducedArtifact", value: 2 },
    }),
  ]);
  const reworked = decideEvalStageReduce(
    failing,
    id(1),
    "ReworkEvaluationFailure",
  );
  assert.equal(reworked.rec.label, "rework-started eval_failure");
  assert.deepEqual(reworked.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(reworked.post, id(1)).phase, "Working");
  assert.deepEqual(
    liveShape(reworked.post, id(1)).map((t) => t.id),
    [asTaskId(5), asTaskId(6)],
    "the rework cycle's work set spawns above the retired stage",
  );

  const escalated = decideEvalStageReduce(
    failing,
    id(1),
    "EscalateEvaluationFailure",
  );
  assert.equal(escalated.rec.label, "ticket-escalated rework_budget_exhausted");
  assert.deepEqual(escalated.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(escalated.post, id(1));
  assert.equal(parked.reason, "ReworkBudgetExhausted");
  assert.equal(parked.resumeAt, "ResumeReworking");
  assert.equal(parked.tasks.size, 0);
  assert.ok(retryableIn(escalated.post, id(1)));
});

/** A ticket running its finalizer, nothing outstanding, its artifact stamped. */
const finalizing = (): Core =>
  coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Finalizing",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      spawned: 2,
      artifact: { type: "ProducedArtifact", value: 2 },
    }),
  ]);

test("a successful finalization is the ticket's one completion", () => {
  const decision = decideFinalizationResult(
    finalizing(),
    id(1),
    "FinalizationSucceeded",
  );
  assert.equal(decision.rec.label, "ticket-done");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(1), from: "Finalizing", to: "Done" },
  ]);
  assert.deepEqual(decision.rec.effects, []);
  assert.equal(ticketAt(decision.post, id(1)).completions, 1);
});

test("a failed finalization re-enters work, and does so every time", () => {
  const first = decideFinalizationResult(
    finalizing(),
    id(1),
    "FinalizationFailed",
  );
  assert.equal(first.rec.label, "rework-started finalization_failed");
  assert.deepEqual(first.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(first.post, id(1)).phase, "Working");
  assert.deepEqual(
    liveShape(first.post, id(1)).map((t) => t.id),
    [asTaskId(3), asTaskId(4)],
    "the wrap-up rework is a fresh incarnation at fresh ids",
  );

  const again = decideFinalizationResult(
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Finalizing",
        record: [
          workTask(1, "Passed"),
          workTask(2, "Passed"),
          evalTask(3, 0, "Passed"),
          evalTask(4, 0, "Passed"),
        ],
        spawned: 4,
        artifact: { type: "ProducedArtifact", value: 4 },
      }),
    ]),
    id(1),
    "FinalizationFailed",
  );
  assert.equal(
    again.rec.label,
    "rework-started finalization_failed",
    "there is no wall on this edge: a finalizer that keeps failing keeps buying cycles",
  );
  assert.equal(ticketAt(again.post, id(1)).phase, "Working");
});

test("a blocked execution resumes where the work was, and spends nothing", () => {
  const running = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workOutstanding(1), workOutstanding(2)]),
      spawned: 2,
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
  assert.equal(
    ticketAt(
      decideExecutionBlocked(
        finalizing(),
        id(1),
        "RequiredCapabilityUnavailable",
      ).post,
      id(1),
    ).resumeAt,
    "NoResume",
  );
});

test("every resume re-enters where its wall said it would", () => {
  const parkedAt = (
    at: "ResumeWorking" | "ResumeEvaluating" | "ResumeFinalizing",
  ): Core =>
    coreOf([
      ticketOn(config, "ManagedFinalizer", {
        phase: "Escalated",
        resumeAt: at,
        reason: "TicketConfigIncompatible",
        record: [workTask(1, "Passed"), workTask(2, "Passed")],
        spawned: 2,
      }),
    ]);
  const work = decideResumeTicket(parkedAt("ResumeWorking"), id(1));
  assert.equal(work.rec.label, "ticket-resumed");
  assert.deepEqual(work.rec.transitions, [
    { ticket: id(1), from: "Escalated", to: "Working" },
  ]);
  assert.deepEqual(work.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(work.post, id(1)).reason, "NoReason");
  assert.equal(ticketAt(work.post, id(1)).resumeAt, "NoResume");

  const evaluate = decideResumeTicket(parkedAt("ResumeEvaluating"), id(1));
  assert.deepEqual(evaluate.rec.effects, ["SpawnEvalTasks"]);
  assert.deepEqual(
    liveShape(evaluate.post, id(1)).map((t) => t.id),
    [asTaskId(3), asTaskId(4)],
    "the retried tasks are new records; the failed ones stay retired in the log",
  );

  const finalize = decideResumeTicket(parkedAt("ResumeFinalizing"), id(1));
  assert.deepEqual(finalize.rec.effects, ["RunFinalizer"]);
  assert.equal(ticketAt(finalize.post, id(1)).phase, "Finalizing");
});

test("the evaluation wall's resume buys a work cycle above an intact record", () => {
  const walled = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Escalated",
      resumeAt: "ResumeReworking",
      reason: "ReworkBudgetExhausted",
      record: [workTask(1, "Passed"), evalTask(2, 0, "Failed")],
      spawned: 2,
    }),
  ]);
  const resumed = decideResumeTicket(walled, id(1));
  assert.equal(resumed.rec.label, "ticket-resumed");
  assert.deepEqual(resumed.rec.transitions, [
    { ticket: id(1), from: "Escalated", to: "Working" },
  ]);
  assert.deepEqual(resumed.rec.effects, ["SpawnWorkTasks"]);
  const post = ticketAt(resumed.post, id(1));
  assert.deepEqual(
    tasksInIdOrder(post.tasks).map((t) => t.id),
    [asTaskId(3), asTaskId(4)],
    "fresh work ids above an intact record",
  );
  assert.deepEqual(post.record, ticketAt(walled, id(1)).record);
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
    }),
  ]);
  const revoked = decideRevoke(config, running, id(1));
  assert.deepEqual(revoked.rec.transitions, [
    { ticket: id(1), from: "Working", to: "Revoked" },
  ]);
  assert.deepEqual(revoked.rec.effects, ["CancelTicketWork"]);
  const settled = ticketAt(revoked.post, id(1));
  assert.equal(settled.completions, 0);
  assert.equal(settled.reason, "NoReason");
  assert.equal(settled.resumeAt, "NoResume");
  assert.equal(settled.record.length, 2);
  assert.equal(settled.tasks.size, 0);
});

/** A chain 1 <- 2 <- 3 under sparse, numerically reversed ids, which the corpus never builds. */
const chain: Core = {
  tickets: new Map([
    [id(6), ticketOn(config, "ManagedFinalizer", { phase: "Pending" })],
    [
      id(4),
      ticketOn(config, "ManagedFinalizer", {
        phase: "Pending",
        deps: depsOf(6),
      }),
    ],
    [
      id(1),
      ticketOn(config, "ManagedFinalizer", {
        phase: "Pending",
        deps: depsOf(4),
      }),
    ],
  ]),
};
const cascaded = decideRevoke(config, chain, id(6)).post;

test("the cascade parks every transitive dependent in the one decision", () => {
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
  }
  assert.equal(ticketAt(cascaded, id(6)).reason, "NoReason");
});

test("a desk revoke settles one ticket and re-parks nobody", () => {
  const settled = decideRevoke(config, cascaded, id(4));
  assert.deepEqual(settled.rec.transitions, [
    { ticket: id(4), from: "Escalated", to: "Revoked" },
  ]);
  assert.deepEqual(settled.rec.effects, ["CancelTicketWork"]);
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

test("every fixture this suite builds is a shape the machine could have reached", () => {
  const live = coreOf([
    ticketOn(config, "ManagedFinalizer", {
      phase: "Working",
      tasks: new Set([workOutstanding(1)]),
      workFanout: 1,
      spawned: 1,
    }),
  ]);
  for (const core of [chain, cascaded, live, finalizing()]) {
    assert.ok(
      accountsForAll(core),
      "a fixture accounts for all of its ids or none",
    );
  }
});
