/**
 * The decider arms the golden corpus does not reach, and `evolve` on the
 * events nothing owes.
 *
 * THE REPLAY IS THE STRONGER EVIDENCE AND THIS SUITE IS NOT A SECOND COPY OF
 * IT. Every shape the corpus does reach is already pinned by exact equality on
 * the whole decision and the whole post-state, so restating one here would be
 * a weaker assertion about the same step. What is left over is the arms no
 * committed trace fires — a wall in the phase with no resume, a revoke inside
 * a dependency chain the corpus never builds — and the one property no trace
 * can carry: an event applied to a state that no longer owes it changes
 * nothing.
 */

import type {
  Escalation,
  EvaluationFailureDisposition,
  FinalizationResult,
  Obligation,
  ReleasedTicket,
  SuccessfulTicketDecision,
  TaskIdentity,
  TaskTerminalReport,
  TicketDecision,
  TicketEvent,
  TicketGraph,
} from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  aDispatchSource,
  aFinalizationEvidence,
  anAcceptedSource,
  defaultPlan,
  releasedTicketOf,
  revisedTicketOf,
} from "../../src/domain/config.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
import {
  alwaysPolicy,
  decideCreate,
  decideDispatch,
  decideFinalizationResult,
  decideResume,
  decideRevoke,
  decideTaskTerminal,
  decideUpdate,
  freshTicket,
} from "../../src/domain/deciders.ts";
import { evolve } from "../../src/domain/evolve.ts";
import { graphEquals } from "../../src/domain/equality.ts";
import { retryableIn } from "../../src/domain/enablement.ts";
import {
  artifactOf,
  liveTasks,
  resumeOf,
  workTaskObligation,
} from "../../src/domain/ticket.ts";
import { asTicketId, type TicketId } from "../../src/domain/ids.ts";
import { evaluationTaskOf, workTaskOf } from "../../src/domain/task.ts";
import { modelInstance } from "./configs.ts";
import {
  acceptedOf,
  accountsForAll,
  blockedInstance,
  carriedAt,
  graphOf,
  depsOf,
  id,
  judgedInstance,
  judgedReport,
  obligationFor,
  producedReport,
  runningInstance,
  stoppedReport,
  rosterOf,
  ticketOn,
  workResultOf,
} from "./fixtures.ts";

const config = modelInstance;
const plan = defaultPlan(config);
const roster = rosterOf(plan);

/** A decision and the state its event evolves the graph it was taken at into. */
interface Taken {
  readonly decision: SuccessfulTicketDecision;
  readonly post: TicketGraph;
}

/** Decide, then evolve: the machine's step. */
function take(pre: TicketGraph, decision: TicketDecision): Taken {
  const taken = acceptedOf(decision);
  return { decision: taken, post: evolve(pre, taken.event) };
}

/** What the ticket is owed, which is exactly what a completion may name. */
const owed = (graph: TicketGraph, at: TicketId): readonly TaskIdentity[] =>
  liveTasks(ticketAt(graph, at));

/** The arms a decision owes, in order. */
const arms = (taken: Taken): readonly Obligation["type"][] =>
  taken.decision.obligations.map((obligation) => obligation.type);

/** A completion's decision under the policy that takes one edge whatever failed. */
function reported(
  pre: TicketGraph,
  report: TaskTerminalReport,
  disposition: EvaluationFailureDisposition = "ReworkEvaluationFailure",
): TicketDecision {
  return decideTaskTerminal(pre, report, alwaysPolicy(disposition));
}

/** The same, taken. */
function completed(
  pre: TicketGraph,
  report: TaskTerminalReport,
  disposition: EvaluationFailureDisposition = "ReworkEvaluationFailure",
): Taken {
  return take(pre, reported(pre, report, disposition));
}

/** The refusal a report for `task` meets on ticket 1 when nothing owes it. */
const notCurrent = (task: TaskIdentity): TicketDecision => ({
  type: "TicketRefused",
  value: { type: "TaskNotCurrent", value: { ticket: 1, task } },
});

/** The work obligation the ticket's `cycle` is asked under, as an ExecuteTask. */
const executeWorkOf = (graph: TicketGraph, cycle: number): Obligation => ({
  type: "ExecuteTask",
  value: {
    ticket: 1,
    task: workTaskObligation(ticketAt(graph, id(1)), cycle),
  },
});

/** The definition a release freezes, every value on it drawn from a universe. */
const definition = releasedTicketOf(5, depsOf(), defaultPlan(config));

test("a release arrives already Pending, having spawned nothing", () => {
  const born = freshTicket(definition);
  assert.equal(born.phase, "Pending");
  assert.equal(born.spawned, 0);
  assert.equal(born.completions, 0);
  assert.equal(born.finalizationGeneration, 0);
  assert.equal(artifactOf(born), "NoArtifact");
  assert.equal(born.escalation, "NoEscalation");
  assert.deepEqual(liveTasks(born), []);
  assert.deepEqual(born.evaluations, []);
});

test("the release owes nothing, and takes the sparse id it was handed", () => {
  const empty = graphOf([]);
  const released = take(empty, decideCreate(empty, definition));
  assert.deepEqual(released.decision.event, {
    type: "TicketCreated",
    value: definition,
  });
  assert.deepEqual(
    released.decision.obligations,
    [],
    "the ticket exists because the journal says so; nothing is asked of the world",
  );
  assert.deepEqual([...released.post.tickets.keys()], [asTicketId(5)]);
});

test("a dispatch owes the cycle's one work task, at the source it observed", () => {
  const ready = graphOf([ticketOn(config, { phase: "Pending" })]);
  const dispatched = take(
    ready,
    decideDispatch(ready, { ticket: 1, source: aDispatchSource }),
  );
  assert.deepEqual(dispatched.decision.event, {
    type: "TicketDispatched",
    value: { ticket: 1, source: aDispatchSource },
  });
  assert.deepEqual(dispatched.decision.obligations, [executeWorkOf(ready, 1)]);
  const ticket = ticketAt(dispatched.post, id(1));
  assert.equal(ticket.phase, "Work");
  assert.equal(ticket.spawned, 1);
  assert.equal(ticket.source, aDispatchSource);
  assert.deepEqual(owed(dispatched.post, id(1)), [workTaskOf(1, 1)]);
});

/** A ticket judging its first cycle, no evaluator yet answered. */
const judgingFirst = (): TicketGraph =>
  graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      source: anAcceptedSource,
      evaluations: [runningInstance(1, 1, plan, new Set())],
      workCyclesStarted: 1,
      spawned: 1 + roster,
    }),
  ]);

test("first write wins, and an identity nothing is waiting on moves nothing", () => {
  const running = judgingFirst();
  const judging = evaluationTaskOf(1, 1, 1, 1, 1);
  const first = completed(running, judgedReport(judging, "EvaluatorPass"));
  assert.equal(first.decision.event.type, "TicketEvaluationProgressed");
  assert.deepEqual(first.decision.obligations, []);
  assert.deepEqual(
    owed(first.post, id(1)),
    [evaluationTaskOf(1, 1, 1, 1, 2)],
    "the stage owes its remaining evaluator and no longer owes the one that answered",
  );
  assert.deepEqual(
    reported(first.post, judgedReport(judging, "EvaluatorFail")),
    notCurrent(judging),
    "a duplicate delivery for an evaluator that answered is refused",
  );
  assert.deepEqual(
    reported(first.post, producedReport(workTaskOf(1, 1))),
    notCurrent(workTaskOf(1, 1)),
    "an identity from an earlier phase is owed by nothing, so it is refused",
  );
  const owedJudge = obligationFor(judging);
  assert.deepEqual(
    reported(
      running,
      carriedAt(judging, {
        ...owedJudge,
        contextRef: owedJudge.contextRef + 1,
      }),
    ),
    notCurrent(judging),
    "and an answer for a spawn this stage never made is not its to record",
  );
});

/** A ticket working its first cycle, dispatched at a source. */
const workingFirst = (): TicketGraph =>
  graphOf([
    ticketOn(config, {
      phase: "Work",
      workCyclesStarted: 1,
      spawned: 1,
      source: aDispatchSource,
    }),
  ]);

test("a produced work result is accepted in one step, owing the first stage's evaluators", () => {
  const working = workingFirst();
  const report = producedReport(workTaskOf(1, 1));
  assert.equal(report.type, "WorkResultReport");
  const accepted = completed(working, report);
  assert.deepEqual(accepted.decision.event, {
    type: "TicketWorkResultAccepted",
    value: {
      ticket: 1,
      result: report.value.result,
      acceptedSourceRef: report.value.acceptedSourceRef,
    },
  });
  assert.deepEqual(
    accepted.decision.obligations.map((obligation) =>
      obligation.type === "ExecuteTask" ? obligation.value.task.task : null,
    ),
    [evaluationTaskOf(1, 1, 1, 1, 1), evaluationTaskOf(1, 1, 1, 1, 2)],
  );
  for (const obligation of accepted.decision.obligations)
    assert.equal(
      obligation.type === "ExecuteTask" && obligation.value.task.contextRef,
      workResultOf(1, 1),
      "an evaluator is asked under the result it judges",
    );
  const evaluating = ticketAt(accepted.post, id(1));
  assert.equal(evaluating.phase, "Evaluation");
  assert.deepEqual(artifactOf(evaluating), {
    type: "ProducedArtifact",
    value: workResultOf(1, 1),
  });
  assert.notEqual(
    workResultOf(1, 1),
    1,
    "the reported reference is not the cycle, so a derivation cannot pass for it",
  );
  assert.equal(
    evaluating.evaluations[0]?.input.workResult,
    workResultOf(1, 1),
    "the judgement is opened over the result, not over the cycle",
  );
  assert.equal(evaluating.source, report.value.acceptedSourceRef);
  assert.equal(evaluating.spawned, 1 + roster);
  assert.deepEqual(owed(accepted.post, id(1)), [
    evaluationTaskOf(1, 1, 1, 1, 1),
    evaluationTaskOf(1, 1, 1, 1, 2),
  ]);
});

test("a failed work task parks resumable at Work in the same step", () => {
  const working = workingFirst();
  const work = workTaskOf(1, 1);
  const failed = completed(working, stoppedReport(work, "ProcessFailure"));
  assert.deepEqual(failed.decision.event, {
    type: "TicketWorkProcessFailed",
    value: { ticket: 1, task: work, evidence: 1 },
  });
  assert.deepEqual(failed.decision.obligations, []);
  const parked = ticketAt(failed.post, id(1));
  assert.equal(parked.phase, "Escalated");
  assert.equal(parked.escalation, "WorkFailureEscalated");
  assert.deepEqual(owed(failed.post, id(1)), []);
  assert.deepEqual(
    parked.evaluations,
    [],
    "a cycle that produced nothing opens no judgement",
  );
  assert.equal(parked.spawned, 1);
  assert.equal(artifactOf(parked), "NoArtifact");
});

/** A ticket whose stage has heard from evaluator one and still owes evaluator two. */
const halfJudged = (first: "EvaluatorPass" | "EvaluatorFail"): TicketGraph => {
  const judging = evaluationTaskOf(1, 1, 1, 1, 1);
  return completed(judgingFirst(), judgedReport(judging, first)).post;
};

/** The second evaluator answering, which is the step that concludes the stage. */
const concluding = (
  at: TicketGraph,
  second: "EvaluatorPass" | "EvaluatorFail",
  disposition: EvaluationFailureDisposition,
): Taken => {
  const last = evaluationTaskOf(1, 1, 1, 1, 2);
  return completed(at, judgedReport(last, second), disposition);
};

test("a stage passes only when every evaluator in it did, so one dissent sinks it", () => {
  const passed = concluding(
    halfJudged("EvaluatorPass"),
    "EvaluatorPass",
    "ReworkEvaluationFailure",
  );
  assert.equal(passed.decision.event.type, "TicketEvaluationPassed");
  assert.deepEqual(arms(passed), ["FinalizeTicket"]);
  assert.equal(ticketAt(passed.post, id(1)).phase, "Finalization");
  assert.equal(ticketAt(passed.post, id(1)).finalizationGeneration, 1);
  assert.equal(
    concluding(
      halfJudged("EvaluatorPass"),
      "EvaluatorFail",
      "ReworkEvaluationFailure",
    ).decision.event.type,
    "TicketEvaluationReworkStarted",
  );
  assert.equal(
    concluding(
      halfJudged("EvaluatorFail"),
      "EvaluatorPass",
      "ReworkEvaluationFailure",
    ).decision.event.type,
    "TicketEvaluationReworkStarted",
    "a dissent already recorded sinks the stage whatever the last evaluator says",
  );
});

test("one failing stage, two edges, and the policy is the whole difference", () => {
  const failing = halfJudged("EvaluatorFail");
  const reworked = concluding(
    failing,
    "EvaluatorFail",
    "ReworkEvaluationFailure",
  );
  assert.equal(reworked.decision.event.type, "TicketEvaluationReworkStarted");
  assert.deepEqual(reworked.decision.obligations, [executeWorkOf(failing, 2)]);
  const event = reworked.decision.event;
  assert.ok(event.type === "TicketEvaluationReworkStarted");
  assert.deepEqual(
    event.value.evidence.map((entry) => entry.evaluator),
    [1, 2],
    "the rework carries every failed evaluator's result as its cause",
  );
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
    escalated.decision.event.type,
    "TicketEvaluationFailureEscalated",
  );
  assert.deepEqual(escalated.decision.obligations, []);
  const parked = ticketAt(escalated.post, id(1));
  assert.equal(parked.escalation, "EvaluationFailureEscalated");
  assert.deepEqual(owed(escalated.post, id(1)), []);
  assert.ok(retryableIn(escalated.post, id(1)));

  const revoked = take(escalated.post, decideRevoke(escalated.post, 1));
  assert.deepEqual(revoked.decision.event, {
    type: "TicketRevoked",
    value: 1,
  });
  assert.deepEqual(
    revoked.decision.obligations,
    [],
    "a parked ticket runs nothing, so there is nothing to cancel",
  );
  const settled = ticketAt(revoked.post, id(1));
  assert.equal(settled.phase, "Revoked");
  assert.equal(settled.escalation, "NoEscalation");
  assert.equal(
    retryableIn(revoked.post, id(1)),
    false,
    "revoking a parked ticket clears its wall along with its desk task",
  );
});

/** A ticket running its finalizer, its judgement passed, on its first attempt. */
const finalizing = (): TicketGraph =>
  graphOf([
    ticketOn(config, {
      phase: "Finalization",
      source: anAcceptedSource,
      evaluations: [judgedInstance(1, 1, plan)],
      workCyclesStarted: 1,
      spawned: 1 + roster,
      finalizationGeneration: 1,
    }),
  ]);

/** The finalizer's report on the attempt the ticket is on. */
const finalized = (
  pre: TicketGraph,
  result: FinalizationResult["type"],
): Taken => {
  const ticket = ticketAt(pre, id(1));
  return take(
    pre,
    decideFinalizationResult(pre, {
      ticket: 1,
      workCycle: ticket.workCyclesStarted,
      generation: ticket.finalizationGeneration,
      result: { type: result, value: aFinalizationEvidence },
    }),
  );
};

test("a successful finalization is the ticket's one completion", () => {
  const done = finalized(finalizing(), "FinalizationSucceeded");
  assert.deepEqual(done.decision.event, {
    type: "TicketFinalizationSucceeded",
    value: {
      ticket: 1,
      workCycle: 1,
      generation: 1,
      evidence: aFinalizationEvidence,
    },
  });
  assert.deepEqual(done.decision.obligations, []);
  assert.equal(ticketAt(done.post, id(1)).phase, "Done");
  assert.equal(ticketAt(done.post, id(1)).completions, 1);
});

test("a failed finalization owes a new work cycle, and does so every time", () => {
  const first = finalized(finalizing(), "FinalizationNeedsWork");
  assert.equal(first.decision.event.type, "TicketFinalizationNeedsWork");
  assert.deepEqual(first.decision.obligations, [
    executeWorkOf(finalizing(), 2),
  ]);
  assert.equal(ticketAt(first.post, id(1)).phase, "Work");
  assert.equal(ticketAt(first.post, id(1)).finalizationGeneration, 0);
  assert.deepEqual(
    owed(first.post, id(1)),
    [workTaskOf(1, 2)],
    "the wrap-up rework is a fresh cycle, named as one",
  );

  const again = finalized(
    graphOf([
      ticketOn(config, {
        phase: "Finalization",
        source: anAcceptedSource,
        evaluations: [judgedInstance(1, 1, plan), judgedInstance(1, 2, plan)],
        workCyclesStarted: 2,
        spawned: 2 * (1 + roster),
        finalizationGeneration: 1,
      }),
    ]),
    "FinalizationNeedsWork",
  );
  assert.equal(
    again.decision.event.type,
    "TicketFinalizationNeedsWork",
    "there is no wall on this edge: a finalizer that keeps failing keeps buying cycles",
  );
  assert.equal(ticketAt(again.post, id(1)).phase, "Work");
});

test("a finalization that reached no result parks, and its resume owes the next attempt", () => {
  const before = finalizing();
  const walled = finalized(before, "FinalizationResultUnavailable");
  assert.equal(walled.decision.event.type, "TicketFinalizationUnavailable");
  assert.deepEqual(walled.decision.obligations, []);
  const parked = ticketAt(walled.post, id(1));
  assert.equal(parked.phase, "Escalated");
  assert.equal(parked.escalation, "FinalizationUnavailableEscalated");
  assert.deepEqual(
    artifactOf(parked),
    artifactOf(ticketAt(before, id(1))),
    "the artifact the finalizer could not commit is untouched: it was never the obstacle",
  );
  assert.deepEqual(owed(walled.post, id(1)), []);

  const resumed = take(walled.post, decideResume(walled.post, 1));
  assert.deepEqual(resumed.decision.event, {
    type: "TicketFinalizationResumed",
    value: 1,
  });
  assert.deepEqual(resumed.decision.obligations, [
    {
      type: "FinalizeTicket",
      value: {
        ticket: 1,
        finalization: {
          workCycle: 1,
          generation: 2,
          input: workResultOf(1, 1),
          source: anAcceptedSource,
        },
        configuration: ticketAt(before, id(1)).definition
          .finalizationConfiguration,
      },
    },
  ]);
  assert.equal(ticketAt(resumed.post, id(1)).phase, "Finalization");
  assert.equal(ticketAt(resumed.post, id(1)).finalizationGeneration, 2);
});

test("a work task infrastructure never ran parks at once, there being no sibling to wait for", () => {
  const work = workTaskOf(1, 1);
  const blocked = completed(
    workingFirst(),
    stoppedReport(work, "ExecutionUnavailableFailure"),
  );
  assert.equal(blocked.decision.event.type, "TicketWorkExecutionUnavailable");
  assert.deepEqual(blocked.decision.obligations, []);
  const parked = ticketAt(blocked.post, id(1));
  assert.equal(parked.escalation, "WorkExecutionUnavailableEscalated");
  assert.deepEqual(owed(blocked.post, id(1)), []);
});

test("a stopped evaluator leaves the stage running, and the stage parks once it concludes", () => {
  const stopped = evaluationTaskOf(1, 1, 1, 1, 1);
  const walled = completed(
    judgingFirst(),
    stoppedReport(stopped, "ExecutionUnavailableFailure"),
  );
  assert.equal(
    walled.decision.event.type,
    "TicketEvaluationProgressed",
    "a wall is not a verdict, and its siblings are still judging",
  );
  assert.deepEqual(owed(walled.post, id(1)), [evaluationTaskOf(1, 1, 1, 1, 2)]);
  const blocked = concluding(
    walled.post,
    "EvaluatorPass",
    "ReworkEvaluationFailure",
  );
  assert.equal(blocked.decision.event.type, "TicketEvaluationBlocked");
  assert.deepEqual(blocked.decision.obligations, []);
  const parked = ticketAt(blocked.post, id(1));
  assert.equal(parked.escalation, "EvaluationBlockedEscalated");
  assert.equal(resumeOf(parked.escalation), "ResumeEvaluation");
  const resumed = take(blocked.post, decideResume(blocked.post, 1));
  assert.equal(resumed.decision.event.type, "TicketEvaluationResumed");
  assert.deepEqual(
    resumed.decision.obligations.map((obligation) =>
      obligation.type === "ExecuteTask" ? obligation.value.task.task : null,
    ),
    [evaluationTaskOf(1, 1, 1, 2, 1)],
    "the resume re-asks the stopped evaluator alone, at the next generation",
  );
  assert.equal(ticketAt(resumed.post, id(1)).phase, "Evaluation");
  assert.deepEqual(owed(resumed.post, id(1)), [
    evaluationTaskOf(1, 1, 1, 2, 1),
  ]);
  assert.equal(
    ticketAt(resumed.post, id(1)).spawned,
    1 + 2 * roster,
    "and claims the stage's whole roster for the generation it opened",
  );
});

test("every resume re-enters where its wall implies, and the event names which", () => {
  const parkedAt = (wall: Escalation): TicketGraph =>
    graphOf([
      ticketOn(config, {
        phase: "Escalated",
        escalation: wall,
        source: anAcceptedSource,
        evaluations:
          wall === "EvaluationBlockedEscalated"
            ? [blockedInstance(1, 1, plan, new Set([1]))]
            : wall === "FinalizationUnavailableEscalated"
              ? [judgedInstance(1, 1, plan)]
              : [],
        workCyclesStarted: 1,
        spawned: wall === "WorkExecutionUnavailableEscalated" ? 1 : 1 + roster,
        finalizationGeneration:
          wall === "FinalizationUnavailableEscalated" ? 1 : 0,
      }),
    ]);
  const expected: readonly (readonly [
    Escalation,
    TicketEvent["type"],
    readonly Obligation["type"][],
    string,
  ])[] = [
    ["WorkFailureEscalated", "TicketWorkResumed", ["ExecuteTask"], "Work"],
    [
      "WorkExecutionUnavailableEscalated",
      "TicketWorkResumed",
      ["ExecuteTask"],
      "Work",
    ],
    [
      "EvaluationFailureEscalated",
      "TicketWorkResumed",
      ["ExecuteTask"],
      "Work",
    ],
    [
      "EvaluationBlockedEscalated",
      "TicketEvaluationResumed",
      ["ExecuteTask"],
      "Evaluation",
    ],
    [
      "FinalizationUnavailableEscalated",
      "TicketFinalizationResumed",
      ["FinalizeTicket"],
      "Finalization",
    ],
  ];
  for (const [wall, event, owes, phase] of expected) {
    const parked = parkedAt(wall);
    const resumed = take(parked, decideResume(parked, 1));
    assert.equal(resumed.decision.event.type, event, wall);
    assert.deepEqual(arms(resumed), owes, wall);
    assert.equal(ticketAt(resumed.post, id(1)).phase, phase, wall);
    assert.equal(
      ticketAt(resumed.post, id(1)).escalation,
      "NoEscalation",
      wall,
    );
  }
});

test("the evaluation wall's resume buys a work cycle above an intact history", () => {
  const walled = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "EvaluationFailureEscalated",
      source: anAcceptedSource,
      evaluations: [judgedInstance(1, 1, plan, () => "EvaluatorFail")],
      workCyclesStarted: 1,
      spawned: 1 + roster,
    }),
  ]);
  const resumed = take(walled, decideResume(walled, 1));
  assert.deepEqual(resumed.decision.event, {
    type: "TicketWorkResumed",
    value: 1,
  });
  assert.deepEqual(resumed.decision.obligations, [executeWorkOf(walled, 2)]);
  const post = ticketAt(resumed.post, id(1));
  assert.deepEqual(
    owed(resumed.post, id(1)),
    [workTaskOf(1, 2)],
    "a fresh work cycle above an intact record",
  );
  assert.deepEqual(post.evaluations, ticketAt(walled, id(1)).evaluations);
});

test("a resume of a ticket that was never parked is refused, naming the ticket", () => {
  const pending = graphOf([ticketOn(config, { phase: "Pending" })]);
  assert.deepEqual(decideResume(pending, 1), {
    type: "TicketRefused",
    value: { type: "TicketNotResumable", value: 1 },
  });
});

/** Pending tickets side by side, each at its first revision and depending on nothing. */
const twoPending: TicketGraph = graphOf([
  ticketOn(config, { phase: "Pending" }),
  ticketOn(config, { phase: "Pending" }),
]);

/**
 * THE UPDATE'S REFUSALS COME IN THE PACKAGE'S ORDER. Each command fails every
 * check after the one it is named for as well, so only the order decides which
 * refusal it meets; a trace carries one fault per command and cannot see it.
 */
test("an update failing several checks is refused by the first of them", () => {
  const wrongEverything = revisedTicketOf(2, 2, depsOf(2), plan);
  const staleAndRewired = revisedTicketOf(1, 2, depsOf(2), plan);
  const refusal = (
    graph: TicketGraph,
    ticket: number,
    expectedRevision: number,
    revised: ReleasedTicket,
  ): TicketDecision =>
    decideUpdate(graph, { ticket, expectedRevision, definition: revised });
  const cases: readonly [TicketDecision, TicketDecision][] = [
    [
      refusal(twoPending, 9, 5, revisedTicketOf(9, 2, depsOf(2), plan)),
      { type: "TicketRefused", value: { type: "TicketNotFound", value: 9 } },
    ],
    [
      refusal(workingFirst(), 1, 5, wrongEverything),
      { type: "TicketRefused", value: { type: "TicketNotPending", value: 1 } },
    ],
    [
      refusal(twoPending, 1, 5, wrongEverything),
      {
        type: "TicketRefused",
        value: { type: "TicketIdentityMismatch", value: 1 },
      },
    ],
    [
      refusal(twoPending, 1, 5, staleAndRewired),
      {
        type: "TicketRefused",
        value: {
          type: "TicketRevisionStale",
          value: { ticket: 1, expected: 5, current: 1 },
        },
      },
    ],
    [
      refusal(twoPending, 1, 1, staleAndRewired),
      {
        type: "TicketRefused",
        value: { type: "TicketDependenciesChanged", value: 1 },
      },
    ],
  ];
  for (const [decided, expected] of cases) assert.deepEqual(decided, expected);
});

test("a revoke owes a cancellation for every task that was running", () => {
  const working = workingFirst();
  const fromWork = take(working, decideRevoke(working, 1));
  assert.deepEqual(fromWork.decision.obligations, [
    { type: "CancelTask", value: { ticket: 1, task: workTaskOf(1, 1) } },
  ]);
  const settled = ticketAt(fromWork.post, id(1));
  assert.equal(settled.phase, "Revoked");
  assert.equal(settled.completions, 0);
  assert.equal(settled.escalation, "NoEscalation");
  assert.deepEqual(settled.evaluations, []);
  assert.deepEqual(owed(fromWork.post, id(1)), []);

  const judging = judgingFirst();
  const fromEvaluation = take(judging, decideRevoke(judging, 1));
  assert.deepEqual(
    fromEvaluation.decision.obligations.map((obligation) =>
      obligation.type === "CancelTask" ? obligation.value.task : null,
    ),
    [evaluationTaskOf(1, 1, 1, 1, 1), evaluationTaskOf(1, 1, 1, 1, 2)],
    "every evaluator the stage still owes is stopped",
  );
  assert.deepEqual(
    ticketAt(fromEvaluation.post, id(1)).evaluations,
    ticketAt(judging, id(1)).evaluations,
    "the judgement is kept as it stood: provenance survives the settlement",
  );
});

/** A chain 1 <- 2 <- 3 under sparse, numerically reversed ids, which the corpus never builds. */
const chain: TicketGraph = {
  tickets: new Map([
    [id(6), ticketOn(config, { phase: "Pending" })],
    [id(4), ticketOn(config, { phase: "Pending", dependencies: depsOf(6) })],
    [id(1), ticketOn(config, { phase: "Pending", dependencies: depsOf(4) })],
  ]),
};
const stranded = evolve(chain, acceptedOf(decideRevoke(chain, 6)).event);

test("a revoke deep in a chain moves its own ticket and nobody else", () => {
  const decision = acceptedOf(decideRevoke(chain, 6));
  assert.deepEqual(decision.event, { type: "TicketRevoked", value: 6 });
  assert.deepEqual(decision.obligations, []);
  assert.equal(ticketAt(stranded, id(6)).phase, "Revoked");
  for (const waiting of [id(1), id(4)]) {
    assert.equal(ticketAt(stranded, waiting).phase, "Pending");
    assert.equal(ticketAt(stranded, waiting).escalation, "NoEscalation");
  }
  assert.equal(ticketAt(stranded, id(6)).escalation, "NoEscalation");
});

test("a revoke of the ticket in the middle leaves the one behind it waiting", () => {
  const settled = take(stranded, decideRevoke(stranded, 4));
  assert.equal(ticketAt(settled.post, id(4)).phase, "Revoked");
  assert.equal(ticketAt(settled.post, id(1)).phase, "Pending");
});

/**
 * AN EVENT APPLIED TO A STATE THAT NO LONGER OWES IT IS THE IDENTITY. No golden
 * can carry this, because the machine never decides such an event; the
 * journal's legality check is what meets one, and it refuses the row because
 * this holds.
 */
test("an event nothing owes any more falls through evolve", () => {
  const working = workingFirst();
  const work = workTaskOf(1, 1);
  const accepted = completed(working, producedReport(work));
  assert.ok(
    graphEquals(evolve(accepted.post, accepted.decision.event), accepted.post),
    "a duplicate acceptance: the cycle it accepted is no longer in Work",
  );

  const judging = evaluationTaskOf(1, 1, 1, 1, 1);
  const progressed = completed(
    judgingFirst(),
    judgedReport(judging, "EvaluatorPass"),
  );
  assert.ok(
    graphEquals(
      evolve(progressed.post, progressed.decision.event),
      progressed.post,
    ),
    "a stale evaluator report: the run no longer awaits that evaluator",
  );

  const walled = finalized(finalizing(), "FinalizationResultUnavailable");
  const resumed = take(walled.post, decideResume(walled.post, 1));
  const superseded = finalized(finalizing(), "FinalizationSucceeded");
  assert.ok(
    graphEquals(evolve(resumed.post, superseded.decision.event), resumed.post),
    "a finalization result for the generation a resume superseded",
  );

  const reworked = finalized(finalizing(), "FinalizationNeedsWork");
  const earlier: TicketEvent = {
    type: "TicketWorkProcessFailed",
    value: { ticket: 1, task: workTaskOf(1, 1), evidence: 1 },
  };
  assert.equal(ticketAt(reworked.post, id(1)).workCyclesStarted, 2);
  assert.ok(
    graphEquals(evolve(reworked.post, earlier), reworked.post),
    "a work failure for a cycle the ticket has moved past",
  );

  assert.ok(
    graphEquals(
      evolve(working, {
        type: "TicketDispatched",
        value: { ticket: 1, source: aDispatchSource },
      }),
      working,
    ),
    "a dispatch of a ticket already working",
  );
  const released = evolve(graphOf([]), {
    type: "TicketCreated",
    value: definition,
  });
  assert.ok(
    graphEquals(
      evolve(released, { type: "TicketCreated", value: definition }),
      released,
    ),
    "a release of an id the fleet already holds",
  );
  assert.ok(
    graphEquals(evolve(working, { type: "TicketRevoked", value: 9 }), working),
    "an event about a ticket the fleet does not hold",
  );
  const done = finalized(finalizing(), "FinalizationSucceeded").post;
  assert.ok(
    graphEquals(evolve(done, { type: "TicketRevoked", value: 1 }), done),
    "a revoke of a ticket already Done",
  );
});

test("every fixture this suite builds is a shape the machine could have reached", () => {
  for (const graph of [
    chain,
    stranded,
    twoPending,
    workingFirst(),
    judgingFirst(),
    finalizing(),
  ]) {
    assert.ok(
      accountsForAll(graph),
      "a fixture accounts for all of its ids or none",
    );
  }
});
