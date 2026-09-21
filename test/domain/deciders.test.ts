/**
 * The decider arms the golden corpus does not reach.
 *
 * THE REPLAY IS THE STRONGER EVIDENCE AND THIS SUITE IS NOT A SECOND COPY OF
 * IT. Every shape the corpus does reach is already pinned by exact equality on
 * the whole record and the whole post-state, so restating one here would be a
 * weaker assertion about the same step. What is left over is the arms no
 * committed trace fires — the duplicate and stale completions, an execution
 * blocked from the phase with no resume, the guarded unreachable resume, and a
 * revoke inside a dependency chain the corpus never builds.
 */

import type {
  Escalation,
  TicketGraph,
  StageDefinition,
} from "../../src/domain/generated/modelTypes.ts";
import { test } from "node:test";
import assert from "node:assert/strict";

import { defaultProgram } from "../../src/domain/config.ts";
import { ticketAt } from "../../src/domain/ticketGraph.ts";
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
import { resumeOf } from "../../src/domain/ticket.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import { tasksInIdOrder } from "../../src/domain/task.ts";
import { modelInstance } from "./configs.ts";
import {
  accountsForAll,
  graphOf,
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
const liveShape = (graph: TicketGraph, at: ReturnType<typeof id>) =>
  tasksInIdOrder(ticketAt(graph, at).tasks).map((t) => ({
    id: t.id,
    kind: t.kind,
    state: t.state,
  }));

/** The authoring a release carries, which every value on it is drawn from a universe. */
const authoring = {
  deps: depsOf(),
  program: defaultProgram(config),
  workFanout: config.nTasks,
};

test("a release arrives already Pending, having spawned nothing", () => {
  const born = freshTicket(authoring);
  assert.equal(born.phase, "Pending");
  assert.equal(born.spawned, 0);
  assert.equal(born.completions, 0);
  assert.equal(born.artifact, "NoArtifact");
  assert.equal(born.escalation, "NoEscalation");
  assert.equal(born.tasks.size, 0);
  assert.deepEqual(born.record, []);
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
    { id: asTaskId(1), kind: "WorkTask", state: "Outstanding" },
  ]);
});

test("first write wins, and an id already retired matches nothing live", () => {
  const running = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
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

test("a passing work task stamps the artifact its own accounting names", () => {
  const settledWork = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workTask(1, "Passed")]),
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
  assert.equal(evaluating.record.length, 1);
  assert.deepEqual(liveShape(decision.post, id(1)), [
    {
      id: asTaskId(2),
      kind: { type: "EvaluationTask", value: 0 },
      state: "Outstanding",
    },
    {
      id: asTaskId(3),
      kind: { type: "EvaluationTask", value: 0 },
      state: "Outstanding",
    },
  ]);
});

test("a failed work task parks resumable at Work, retiring what failed", () => {
  const failedWork = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workTask(1, "Failed")]),
      spawned: 1,
    }),
  ]);
  const decision = decideWorkReduce(failedWork, id(1));
  assert.equal(decision.rec.label, "ticket-escalated work_failure_escalated");
  assert.deepEqual(decision.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(decision.post, id(1));
  assert.equal(parked.escalation, "WorkFailureEscalated");
  assert.equal(parked.tasks.size, 0);
  assert.equal(parked.record.length, 1);
  assert.equal(parked.spawned, 1);
  assert.equal(parked.artifact, "NoArtifact");
});

test("a stage passes only when every task in it did, so one failure sinks it", () => {
  const wide: readonly StageDefinition[] = [{ fanout: 2 }];
  const evaluating = (
    outcomes: readonly ["Passed" | "Failed", "Passed" | "Failed"],
  ) =>
    graphOf([
      ticketOn(config, {
        phase: "Evaluation",
        program: wide,
        tasks: new Set([
          evalTask(1, 0, outcomes[0]),
          evalTask(2, 0, outcomes[1]),
        ]),
        spawned: 2,
      }),
    ]);
  assert.equal(
    decideEvalStageReduce(
      evaluating(["Passed", "Passed"]),
      id(1),
      "ReworkEvaluationFailure",
    ).rec.label,
    "eval-passed",
  );
  assert.equal(
    decideEvalStageReduce(
      evaluating(["Passed", "Failed"]),
      id(1),
      "ReworkEvaluationFailure",
    ).rec.label,
    "rework-started eval_failure",
  );
});

test("one failing stage, two edges, and the disposition is the whole difference", () => {
  const failing = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      record: [workTask(1, "Passed")],
      tasks: new Set([evalTask(2, 0, "Failed"), evalTask(3, 0, "Failed")]),
      spawned: 3,
      artifact: { type: "ProducedArtifact", value: 1 },
    }),
  ]);
  const reworked = decideEvalStageReduce(
    failing,
    id(1),
    "ReworkEvaluationFailure",
  );
  assert.equal(reworked.rec.label, "rework-started eval_failure");
  assert.deepEqual(reworked.rec.effects, ["SpawnWorkTasks"]);
  assert.equal(ticketAt(reworked.post, id(1)).phase, "Work");
  assert.deepEqual(
    liveShape(reworked.post, id(1)).map((t) => t.id),
    [asTaskId(4)],
    "the rework cycle's work task spawns above the retired stage",
  );

  const escalated = decideEvalStageReduce(
    failing,
    id(1),
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

/** A ticket running its finalizer, nothing outstanding, its artifact stamped. */
const finalizing = (): TicketGraph =>
  graphOf([
    ticketOn(config, {
      phase: "Finalization",
      record: [workTask(1, "Passed"), evalTask(2, 0, "Passed")],
      spawned: 2,
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
    liveShape(first.post, id(1)).map((t) => t.id),
    [asTaskId(3)],
    "the wrap-up rework is a fresh incarnation at a fresh id",
  );

  const again = decideFinalizationResult(
    graphOf([
      ticketOn(config, {
        phase: "Finalization",
        record: [
          workTask(1, "Passed"),
          evalTask(2, 0, "Passed"),
          evalTask(3, 0, "Passed"),
        ],
        spawned: 3,
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
  assert.deepEqual(liveShape(walled.post, id(1)), []);

  const resumed = decideResumeTicket(walled.post, id(1));
  assert.equal(ticketAt(resumed.post, id(1)).phase, "Finalization");
  assert.deepEqual(resumed.rec.effects, ["RunFinalizer"]);
});

test("a blocked execution resumes where the work was, and spends nothing", () => {
  const running = graphOf([
    ticketOn(config, {
      phase: "Work",
      tasks: new Set([workOutstanding(1), workOutstanding(2)]),
      spawned: 2,
    }),
  ]);
  const blocked = decideExecutionBlocked(running, id(1));
  assert.equal(
    blocked.rec.label,
    "ticket-escalated work_execution_unavailable_escalated",
  );
  assert.deepEqual(blocked.rec.effects, ["OpenHumanTask"]);
  const parked = ticketAt(blocked.post, id(1));
  assert.equal(parked.escalation, "WorkExecutionUnavailableEscalated");
  assert.deepEqual(
    parked.record.map((t) => t.state),
    [
      { type: "Resolved", value: "Cancelled" },
      { type: "Resolved", value: "Cancelled" },
    ],
    "the outstanding set is retired as cancelled rather than dropped",
  );
});

test("a blocked evaluation is its own wall, because its resume is its own", () => {
  const evaluating = graphOf([
    ticketOn(config, {
      phase: "Evaluation",
      record: [workTask(1, "Passed"), workTask(2, "Passed")],
      tasks: new Set([evalOutstanding(3, 0), evalOutstanding(4, 0)]),
      spawned: 4,
    }),
  ]);
  const blocked = decideExecutionBlocked(evaluating, id(1));
  assert.equal(
    blocked.rec.label,
    "ticket-escalated evaluation_blocked_escalated",
  );
  const parked = ticketAt(blocked.post, id(1));
  assert.equal(parked.escalation, "EvaluationBlockedEscalated");
  assert.equal(resumeOf(parked.escalation), "ResumeEvaluation");
  assert.equal(
    ticketAt(decideResumeTicket(blocked.post, id(1)).post, id(1)).phase,
    "Evaluation",
  );
});

test("every resume re-enters where its wall implies", () => {
  const parkedAt = (wall: Escalation): TicketGraph =>
    graphOf([
      ticketOn(config, {
        phase: "Escalated",
        escalation: wall,
        record: [workTask(1, "Passed"), workTask(2, "Passed")],
        spawned: 2,
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
    liveShape(evaluate.post, id(1)).map((t) => t.id),
    [asTaskId(3), asTaskId(4)],
    "the retried tasks are new records; the failed ones stay retired in the log",
  );

  const finalize = decideResumeTicket(
    parkedAt("FinalizationUnavailableEscalated"),
    id(1),
  );
  assert.deepEqual(finalize.rec.effects, ["RunFinalizer"]);
  assert.equal(ticketAt(finalize.post, id(1)).phase, "Finalization");
});

test("the evaluation wall's resume buys a work cycle above an intact record", () => {
  const walled = graphOf([
    ticketOn(config, {
      phase: "Escalated",
      escalation: "EvaluationFailureEscalated",
      record: [workTask(1, "Passed"), evalTask(2, 0, "Failed")],
      spawned: 2,
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
    tasksInIdOrder(post.tasks).map((t) => t.id),
    [asTaskId(3)],
    "a fresh work id above an intact record",
  );
  assert.deepEqual(post.record, ticketAt(walled, id(1)).record);
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
      tasks: new Set([workOutstanding(1), workOutstanding(2)]),
      spawned: 2,
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
  assert.equal(settled.record.length, 2);
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
      tasks: new Set([workOutstanding(1)]),
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
