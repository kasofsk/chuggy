/**
 * The decider arms the golden corpus does not reach.
 *
 * THE REPLAY IS THE STRONGER EVIDENCE AND THIS SUITE IS NOT A SECOND COPY OF
 * IT. Every shape the corpus does reach is already pinned by exact equality on
 * the whole record and the whole post-state, so restating one here would be a
 * weaker assertion about the same step. What is left over is the arms no
 * committed trace fires — the duplicate and stale completions, a wall in the
 * phase with no resume, the guarded unreachable resume, and a revoke inside a
 * dependency chain the corpus never builds.
 */

import type {
  Escalation,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultProgram } from "../../src/domain/config.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  decideDispatch,
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
import { liveTasks, resumeOf } from "../../src/domain/ticket.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  evaluationTaskOf,
  tasksInEvaluatorKeyOrder,
  workTaskOf,
} from "../../src/domain/task.ts";
import { modelInstance } from "./configs.ts";
import {
  accountsForAll,
  blockedInstance,
  graphOf,
  depsOf,
  id,
  judgedInstance,
  judgedReport,
  producedReport,
  runningInstance,
  stoppedReport,
  rosterOf,
  ticketOn,
  workOutstanding,
  workTask,
} from "./fixtures.ts";

const config = modelInstance;
const program = defaultProgram(config);
const roster = rosterOf(program);

/** What the ticket is owed, which is exactly what a completion may name. */
const owed = (graph: TicketGraph, at: ReturnType<typeof id>) =>
  liveTasks(ticketAt(graph, at));

/** The live set as a trace reads it: identities and states, by evaluator key. */
const liveShape = (graph: TicketGraph, at: ReturnType<typeof id>) =>
  tasksInEvaluatorKeyOrder(ticketAt(graph, at).tasks).map((t) => ({
    identity: t.identity,
    state: t.state,
  }));

/** The authoring a release carries, which every value on it is drawn from a universe. */
const authoring = {
  deps: depsOf(),
  program: defaultProgram(config),
};

test("a release arrives already Pending, having spawned nothing", () => {
  const born = freshTicket(authoring);
  assert.equal(born.phase, "Pending");
  assert.equal(born.spawned, 0);
  assert.equal(born.completions, 0);
  assert.equal(born.artifact, "NoArtifact");
  assert.equal(born.escalation, "NoEscalation");
  assert.equal(born.tasks.size, 0);
  assert.deepEqual(born.evaluations, []);
});

test("the release records no transition, and takes the sparse id it was handed", () => {
  const empty = graphOf([]);
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

test("a dispatch spawns the cycle's one work task", () => {
  const ready = graphOf([ticketOn(config, { phase: "Pending" })]);
  const decision = decideDispatch(ready, id(1));
  assert.equal(decision.rec.label, "dispatch");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(1), from: "Pending", to: "Work" },
  ]);
  assert.deepEqual(decision.rec.effects, ["SpawnWorkTasks"]);
  const dispatched = ticketAt(decision.post, id(1));
  assert.equal(dispatched.spawned, 1);
  assert.deepEqual(liveShape(decision.post, id(1)), [
    { identity: workTaskOf(1, 1), state: "Outstanding" },
  ]);
});

test("first write wins, and an identity nothing is waiting on matches nothing owed", () => {
  const running = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [runningInstance(1, 1, 1, program, new Set())],
      workCyclesStarted: 1,
      spawned: 1 + roster,
    }),
  ]);
  const judging = evaluationTaskOf(1, 1, 1, 1, 1);
  const first = decideTaskDone(
    running,
    id(1),
    judging,
    judgedReport(judging, "EvaluatorPass"),
    "ReworkEvaluationFailure",
  );
  assert.equal(first.rec.label, "task-done");
  assert.deepEqual(first.rec.transitions, []);
  assert.deepEqual(first.rec.effects, []);
  assert.deepEqual(
    owed(first.post, id(1)),
    [evaluationTaskOf(1, 1, 1, 1, 2)],
    "the stage owes its remaining evaluator and no longer owes the one that answered",
  );
  const again = decideTaskDone(
    first.post,
    id(1),
    judging,
    judgedReport(judging, "EvaluatorFail"),
    "ReworkEvaluationFailure",
  );
  assert.deepEqual(
    ticketAt(again.post, id(1)).evaluations,
    ticketAt(first.post, id(1)).evaluations,
    "a duplicate delivery for an evaluator that answered changes nothing",
  );
  const stale = decideTaskDone(
    first.post,
    id(1),
    workTaskOf(1, 1),
    producedReport(workTaskOf(1, 1)),
    "ReworkEvaluationFailure",
  );
  assert.deepEqual(
    ticketAt(stale.post, id(1)).evaluations,
    ticketAt(first.post, id(1)).evaluations,
    "an identity from an earlier phase is owed by nothing, so it no-ops",
  );
  assert.deepEqual(owed(stale.post, id(1)), owed(first.post, id(1)));
});

test("a passing work task stamps the artifact its own accounting names", () => {
  const settledWork = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workTask(1, 1, "Passed")]),
      workCyclesStarted: 1,
      spawned: 1,
    }),
  ]);
  const decision = decideWorkReduce(settledWork, id(1));
  assert.equal(decision.rec.label, "work-passed");
  assert.deepEqual(decision.rec.effects, ["SpawnEvalTasks"]);
  const evaluating = ticketAt(decision.post, id(1));
  assert.deepEqual(evaluating.artifact, {
    type: "ProducedArtifact",
    value: 1,
  });
  assert.equal(evaluating.evaluations.length, 1);
  assert.equal(evaluating.tasks.size, 0, "the work task is retired, not kept");
  assert.deepEqual(owed(decision.post, id(1)), [
    evaluationTaskOf(1, 1, 1, 1, 1),
    evaluationTaskOf(1, 1, 1, 1, 2),
  ]);
});

test("a failed work task parks resumable at Work, retiring what failed", () => {
  const failedWork = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workTask(1, 1, "Failed")]),
      workCyclesStarted: 1,
      spawned: 1,
    }),
  ]);
  const decision = decideWorkReduce(failedWork, id(1));
  assert.equal(decision.rec.label, "ticket-escalated work_failure_escalated");
  assert.deepEqual(decision.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(decision.post, id(1));
  assert.equal(parked.escalation, "WorkFailureEscalated");
  assert.equal(parked.tasks.size, 0);
  assert.deepEqual(
    parked.evaluations,
    [],
    "a cycle that produced nothing opens no judgement",
  );
  assert.equal(parked.spawned, 1);
  assert.equal(parked.artifact, "NoArtifact");
});

/** A ticket whose stage has heard from evaluator one and still owes evaluator two. */
const halfJudged = (first: "EvaluatorPass" | "EvaluatorFail"): TicketGraph => {
  const judging = evaluationTaskOf(1, 1, 1, 1, 1);
  const running = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [runningInstance(1, 1, 1, program, new Set())],
      workCyclesStarted: 1,
      spawned: 1 + roster,
      artifact: { type: "ProducedArtifact", value: 1 },
    }),
  ]);
  return decideTaskDone(
    running,
    id(1),
    judging,
    judgedReport(judging, first),
    "ReworkEvaluationFailure",
  ).post;
};

/** The second evaluator answering, which is the step that concludes the stage. */
const concluding = (
  at: TicketGraph,
  second: "EvaluatorPass" | "EvaluatorFail",
  onFailure: "ReworkEvaluationFailure" | "EscalateEvaluationFailure",
) => {
  const last = evaluationTaskOf(1, 1, 1, 1, 2);
  return decideTaskDone(at, id(1), last, judgedReport(last, second), onFailure);
};

test("a stage passes only when every evaluator in it did, so one dissent sinks it", () => {
  assert.equal(
    concluding(
      halfJudged("EvaluatorPass"),
      "EvaluatorPass",
      "ReworkEvaluationFailure",
    ).rec.label,
    "eval-passed",
  );
  assert.equal(
    concluding(
      halfJudged("EvaluatorPass"),
      "EvaluatorFail",
      "ReworkEvaluationFailure",
    ).rec.label,
    "rework-started eval_failure",
  );
  assert.equal(
    concluding(
      halfJudged("EvaluatorFail"),
      "EvaluatorPass",
      "ReworkEvaluationFailure",
    ).rec.label,
    "rework-started eval_failure",
    "a dissent already recorded sinks the stage whatever the last evaluator says",
  );
});

test("one failing stage, two edges, and the disposition is the whole difference", () => {
  const failing = halfJudged("EvaluatorFail");
  const reworked = concluding(
    failing,
    "EvaluatorFail",
    "ReworkEvaluationFailure",
  );
  assert.equal(reworked.rec.label, "rework-started eval_failure");
  assert.deepEqual(reworked.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(reworked.post, id(1)).phase, "Work");
  assert.deepEqual(
    owed(reworked.post, id(1)),
    [workTaskOf(1, 2)],
    "the rework cycle's work task names the cycle after the one that failed",
  );

  const escalated = concluding(
    failing,
    "EvaluatorFail",
    "EscalateEvaluationFailure",
  );
  assert.equal(
    escalated.rec.label,
    "ticket-escalated evaluation_failure_escalated",
  );
  assert.deepEqual(escalated.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(escalated.post, id(1));
  assert.equal(parked.escalation, "EvaluationFailureEscalated");
  assert.equal(parked.tasks.size, 0);
  assert.ok(retryableIn(escalated.post, id(1)));

  const revoked = decideRevoke(escalated.post, id(1));
  assert.deepEqual(revoked.rec.transitions, [
    { ticket: id(1), from: "Escalated", to: "Revoked" },
  ]);
  const settled = ticketAt(revoked.post, id(1));
  assert.equal(settled.escalation, "NoEscalation");
  assert.equal(
    retryableIn(revoked.post, id(1)),
    false,
    "revoking a parked ticket clears its wall along with its desk task",
  );
});

/** A ticket running its finalizer, its judgement passed and its artifact stamped. */
const finalizing = (): TicketGraph =>
  graphOf([
    ticketOn(config, {
      phase: "Finalization",
      evaluations: [judgedInstance(1, 1, 1, program)],
      workCyclesStarted: 1,
      spawned: 1 + roster,
      artifact: { type: "ProducedArtifact", value: 1 },
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
    { ticket: id(1), from: "Finalization", to: "Done" },
  ]);
  assert.deepEqual(decision.rec.effects, []);
  assert.equal(ticketAt(decision.post, id(1)).completions, 1);
});

test("a failed finalization re-enters work, and does so every time", () => {
  const first = decideFinalizationResult(
    finalizing(),
    id(1),
    "FinalizationNeedsWork",
  );
  assert.equal(first.rec.label, "rework-started finalization_needs_work");
  assert.deepEqual(first.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(first.post, id(1)).phase, "Work");
  assert.deepEqual(
    owed(first.post, id(1)),
    [workTaskOf(1, 2)],
    "the wrap-up rework is a fresh cycle, named as one",
  );

  const again = decideFinalizationResult(
    graphOf([
      ticketOn(config, {
        phase: "Finalization",
        evaluations: [
          judgedInstance(1, 1, 1, program),
          judgedInstance(1, 2, 2, program),
        ],
        workCyclesStarted: 2,
        spawned: 2 * (1 + roster),
        artifact: { type: "ProducedArtifact", value: 1 },
      }),
    ]),
    id(1),
    "FinalizationNeedsWork",
  );
  assert.equal(
    again.rec.label,
    "rework-started finalization_needs_work",
    "there is no wall on this edge: a finalizer that keeps failing keeps buying cycles",
  );
  assert.equal(ticketAt(again.post, id(1)).phase, "Work");
});

test("a finalization that reached no result parks at the finalizer's own resume", () => {
  const before = finalizing();
  const walled = decideFinalizationResult(
    before,
    id(1),
    "FinalizationResultUnavailable",
  );
  assert.equal(
    walled.rec.label,
    "ticket-escalated finalization_unavailable_escalated",
  );
  assert.deepEqual(walled.rec.transitions, [
    { ticket: id(1), from: "Finalization", to: "Escalated" },
  ]);
  assert.deepEqual(walled.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(walled.post, id(1));
  assert.equal(parked.escalation, "FinalizationUnavailableEscalated");
  assert.equal(
    parked.artifact,
    ticketAt(before, id(1)).artifact,
    "the artifact the finalizer could not commit is untouched: it was never the obstacle",
  );
  assert.deepEqual(owed(walled.post, id(1)), []);

  const resumed = decideResumeTicket(walled.post, id(1));
  assert.equal(ticketAt(resumed.post, id(1)).phase, "Finalization");
  assert.deepEqual(resumed.rec.effects, ["RunFinalizer"]);
});

test("a work task infrastructure never ran parks at once, there being no sibling to wait for", () => {
  const running = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workOutstanding(1, 1)]),
      workCyclesStarted: 1,
      spawned: 1,
    }),
  ]);
  const work = workTaskOf(1, 1);
  const blocked = decideTaskDone(
    running,
    id(1),
    work,
    stoppedReport(work, "ExecutionUnavailableFailure"),
    "ReworkEvaluationFailure",
  );
  assert.equal(
    blocked.rec.label,
    "ticket-escalated work_execution_unavailable_escalated",
  );
  assert.deepEqual(blocked.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(blocked.post, id(1));
  assert.equal(parked.escalation, "WorkExecutionUnavailableEscalated");
  assert.equal(parked.tasks.size, 0, "the live task is retired, not dropped");
});

test("a stopped evaluator leaves the stage running, and the stage parks once it concludes", () => {
  const stopped = evaluationTaskOf(1, 1, 1, 1, 1);
  const running = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      evaluations: [runningInstance(1, 1, 1, program, new Set())],
      workCyclesStarted: 1,
      spawned: 1 + roster,
    }),
  ]);
  const walled = decideTaskDone(
    running,
    id(1),
    stopped,
    stoppedReport(stopped, "ExecutionUnavailableFailure"),
    "ReworkEvaluationFailure",
  );
  assert.equal(
    walled.rec.label,
    "task-done",
    "a wall is not a verdict, and its siblings are still judging",
  );
  assert.deepEqual(owed(walled.post, id(1)), [evaluationTaskOf(1, 1, 1, 1, 2)]);
  const blocked = concluding(
    walled.post,
    "EvaluatorPass",
    "ReworkEvaluationFailure",
  );
  assert.equal(
    blocked.rec.label,
    "ticket-escalated evaluation_blocked_escalated",
  );
  const parked = ticketAt(blocked.post, id(1));
  assert.equal(parked.escalation, "EvaluationBlockedEscalated");
  assert.equal(resumeOf(parked.escalation), "ResumeEvaluation");
  const resumed = decideResumeTicket(blocked.post, id(1));
  assert.equal(ticketAt(resumed.post, id(1)).phase, "Evaluation");
  assert.deepEqual(
    owed(resumed.post, id(1)),
    [evaluationTaskOf(1, 1, 1, 2, 1)],
    "the resume re-asks the stopped evaluator alone, at the next generation",
  );
  assert.equal(
    ticketAt(resumed.post, id(1)).spawned,
    1 + 2 * roster,
    "and claims the stage's whole roster for the generation it opened",
  );
});

test("every resume re-enters where its wall implies", () => {
  const parkedAt = (wall: Escalation): TicketGraph =>
    graphOf([
      ticketOn(config, {
        phase: "Escalated",
        escalation: wall,
        evaluations:
          wall === "EvaluationBlockedEscalated"
            ? [blockedInstance(1, 1, 1, program, new Set([1]))]
            : [],
        workCyclesStarted: 1,
        spawned: wall === "EvaluationBlockedEscalated" ? 1 + roster : 1,
      }),
    ]);
  const work = decideResumeTicket(
    parkedAt("WorkExecutionUnavailableEscalated"),
    id(1),
  );
  assert.equal(work.rec.label, "ticket-resumed");
  assert.deepEqual(work.rec.transitions, [
    { ticket: id(1), from: "Escalated", to: "Work" },
  ]);
  assert.deepEqual(work.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(work.post, id(1)).escalation, "NoEscalation");

  const rework = decideResumeTicket(
    parkedAt("EvaluationFailureEscalated"),
    id(1),
  );
  assert.deepEqual(rework.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(
    ticketAt(rework.post, id(1)).phase,
    "Work",
    "a verdict has no re-judge to offer, so the evaluation wall buys a new artifact",
  );

  const evaluate = decideResumeTicket(
    parkedAt("EvaluationBlockedEscalated"),
    id(1),
  );
  assert.deepEqual(evaluate.rec.effects, ["SpawnEvalTasks"]);
  assert.deepEqual(
    owed(evaluate.post, id(1)),
    [evaluationTaskOf(1, 1, 1, 2, 1)],
    "only the stopped evaluator is re-asked, and the one that judged keeps what it said",
  );

  const finalize = decideResumeTicket(
    parkedAt("FinalizationUnavailableEscalated"),
    id(1),
  );
  assert.deepEqual(finalize.rec.effects, ["RunFinalizer"]);
  assert.equal(ticketAt(finalize.post, id(1)).phase, "Finalization");
});

test("the evaluation wall's resume buys a work cycle above an intact history", () => {
  const walled = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "EvaluationFailureEscalated",
      evaluations: [judgedInstance(1, 1, 1, program, () => "EvaluatorFail")],
      workCyclesStarted: 1,
      spawned: 1 + roster,
    }),
  ]);
  const resumed = decideResumeTicket(walled, id(1));
  assert.equal(resumed.rec.label, "ticket-resumed");
  assert.deepEqual(resumed.rec.transitions, [
    { ticket: id(1), from: "Escalated", to: "Work" },
  ]);
  assert.deepEqual(resumed.rec.effects, ["SpawnWorkTasks"]);
  const post = ticketAt(resumed.post, id(1));
  assert.deepEqual(
    tasksInEvaluatorKeyOrder(post.tasks).map((t) => t.identity),
    [workTaskOf(1, 2)],
    "a fresh work cycle above an intact record",
  );
  assert.deepEqual(post.evaluations, ticketAt(walled, id(1)).evaluations);
});

test("a resume of a ticket that was never parked is the guarded no-op its enablement refuses", () => {
  const walled = graphOf([ticketOn(config, { phase: "Pending" })]);
  const decision = decideResumeTicket(walled, id(1));
  assert.equal(decision.rec.label, "ticket-resume-refused");
  assert.deepEqual(decision.rec.transitions, []);
  assert.deepEqual(decision.rec.effects, []);
  assert.deepEqual(decision.post, walled);
});

test("a revoke retires what was running and settles without completing", () => {
  const running = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workOutstanding(1, 1)]),
      workCyclesStarted: 1,
      spawned: 1,
    }),
  ]);
  const revoked = decideRevoke(running, id(1));
  assert.deepEqual(revoked.rec.transitions, [
    { ticket: id(1), from: "Work", to: "Revoked" },
  ]);
  assert.deepEqual(revoked.rec.effects, ["CancelTicketWork"]);
  const settled = ticketAt(revoked.post, id(1));
  assert.equal(settled.completions, 0);
  assert.equal(settled.escalation, "NoEscalation");
  assert.deepEqual(settled.evaluations, []);
  assert.equal(settled.tasks.size, 0);
});

/** A chain 1 <- 2 <- 3 under sparse, numerically reversed ids, which the corpus never builds. */
const chain: TicketGraph = {
  tickets: new Map([
    [id(6), ticketOn(config, { phase: "Pending" })],
    [id(4), ticketOn(config, { phase: "Pending", deps: depsOf(6) })],
    [id(1), ticketOn(config, { phase: "Pending", deps: depsOf(4) })],
  ]),
};
const stranded = decideRevoke(chain, id(6)).post;

test("a revoke deep in a chain transitions its own ticket and nobody else", () => {
  const decision = decideRevoke(chain, id(6));
  assert.equal(decision.rec.label, "ticket-revoked");
  assert.deepEqual(decision.rec.transitions, [
    { ticket: id(6), from: "Pending", to: "Revoked" },
  ]);
  assert.deepEqual(decision.rec.effects, ["CancelTicketWork"]);
  for (const waiting of [id(1), id(4)]) {
    assert.equal(ticketAt(stranded, waiting).phase, "Pending");
    assert.equal(ticketAt(stranded, waiting).escalation, "NoEscalation");
  }
  assert.equal(ticketAt(stranded, id(6)).escalation, "NoEscalation");
});

test("a revoke of the ticket in the middle leaves the one behind it waiting", () => {
  const settled = decideRevoke(stranded, id(4));
  assert.deepEqual(settled.rec.transitions, [
    { ticket: id(4), from: "Pending", to: "Revoked" },
  ]);
  assert.deepEqual(settled.rec.effects, ["CancelTicketWork"]);
  assert.equal(ticketAt(settled.post, id(1)).phase, "Pending");
});

test("the quiet fleet's stutter records that nothing moved", () => {
  assert.deepEqual(settledRecord(), {
    label: "settled",
    transitions: [],
    effects: [],
  });
});

test("every fixture this suite builds is a shape the machine could have reached", () => {
  const live = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workOutstanding(1, 1)]),
      workCyclesStarted: 1,
      spawned: 1,
    }),
  ]);
  for (const graph of [chain, stranded, live, finalizing()]) {
    assert.ok(
      accountsForAll(graph),
      "a fixture accounts for all of its ids or none",
    );
  }
});
