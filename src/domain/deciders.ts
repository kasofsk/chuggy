/**
 * The deciders: one pure function per decision the machine can make.
 *
 * A decider takes an observed `TicketGraph` and the decision's own arguments and
 * returns the transitions it performs, the effects it asks the world for, and
 * the state after it. IT NEVER PERFORMS ONE. That is what lets a golden trace
 * be replayed through these functions with no world to stub, and what lets the
 * same functions serve any runtime shape.
 *
 * Everything a decision needs is already in the `TicketGraph` it is handed. A decider
 * that acquired a read would acquire an await, and then a mock, and then it
 * would no longer be a function.
 */

import { ticketAt, withTicket, type Decision } from "./ticketGraph.ts";
import type {
  TicketGraph,
  Escalation,
  EvaluationFailureDisposition,
  FinalizationOutcome,
  Phase,
  StageDefinition,
  Ticket,
  Verdict,
} from "./generated/modelTypes.ts";
import type { TaskId, TicketId } from "./ids.ts";
import { combine } from "./program.ts";
import { evalStage, resolveTask, tkEval } from "./task.ts";
import { resumeOf, retireLive, spawnOn, spawnWork } from "./ticket.ts";

/**
 * Both ways a failing evaluation can be taken. The choice is an input to the
 * reduce rather than a field on the ticket: what a failed evaluation means is
 * the evaluation's own report, not something the release settled in advance.
 */
export const dispositionChoices: readonly EvaluationFailureDisposition[] = [
  "ReworkEvaluationFailure",
  "EscalateEvaluationFailure",
];

/** One phase change and the record that reports it — the shape most deciders return. */
function move(
  graph: TicketGraph,
  id: TicketId,
  to: Phase,
  label: string,
  effects: readonly string[],
): Decision {
  const from = ticketAt(graph, id).phase;
  return {
    rec: { label, transitions: [{ ticket: id, from, to }], effects },
    post: withTicket(graph, id, { ...ticketAt(graph, id), phase: to }),
  };
}

/** A ticket as a release leaves it: Pending, with nothing yet spawned. */
export function freshTicket(authoring: {
  readonly deps: ReadonlySet<number>;
  readonly program: readonly StageDefinition[];
}): Ticket {
  return {
    phase: "Pending",
    deps: authoring.deps,
    program: authoring.program,
    artifact: "NoArtifact",
    tasks: new Set(),
    record: [],
    spawned: 0,
    escalation: "NoEscalation",
    completions: 0,
  };
}

/**
 * Release: the ticket enters the fleet already Pending, carrying every value
 * that will affect its behaviour. There is no draft phase and no second step —
 * authoring happens outside this machine, and what arrives is frozen.
 */
export function decideReleaseTicket(
  graph: TicketGraph,
  id: TicketId,
  authoring: {
    readonly deps: ReadonlySet<number>;
    readonly program: readonly StageDefinition[];
  },
): Decision {
  const tickets = new Map(graph.tickets);
  tickets.set(id, freshTicket(authoring));
  return {
    rec: { label: "ticket-released", transitions: [], effects: [] },
    post: { tickets },
  };
}

/**
 * Park a ticket on the desk, naming the wall and retiring the failed set into
 * the record rather than dropping it; where a resume puts it back is the
 * wall's own (`resumeOf`). The open desk task is derived from the phase, and
 * `OpenHumanTask` is its visible effect.
 */
function escalate(
  graph: TicketGraph,
  id: TicketId,
  wall: Escalation,
  label: string,
): Decision {
  const parked = withTicket(graph, id, {
    ...retireLive(ticketAt(graph, id)),
    escalation: wall,
  });
  return move(parked, id, "Escalated", label, ["OpenHumanTask"]);
}

/**
 * Revoke settles the ticket its author named and moves nothing else. A
 * dependent behind it stays Pending, where a dependency that is not Done
 * blocks it, and its own author settles it the same way.
 */
export function decideRevoke(graph: TicketGraph, id: TicketId): Decision {
  return {
    rec: {
      label: "ticket-revoked",
      transitions: [
        { ticket: id, from: ticketAt(graph, id).phase, to: "Revoked" },
      ],
      effects: ["CancelTicketWork"],
    },
    post: withTicket(graph, id, {
      ...retireLive(ticketAt(graph, id)),
      phase: "Revoked",
      escalation: "NoEscalation",
    }),
  };
}

/**
 * Ready to Work. Which Ready ticket runs next is an agentic pick rather than
 * a queue position, so it arrives as an argument and the recorded step IS the
 * ticket writer's decision.
 */
export function decideDispatch(graph: TicketGraph, id: TicketId): Decision {
  const ticket = ticketAt(graph, id);
  return move(
    withTicket(graph, id, spawnWork(ticket)),
    id,
    "Work",
    "dispatch",
    ["SpawnWorkTasks"],
  );
}

/**
 * A task completion, first write wins: resolving a task that is not outstanding
 * changes nothing, which is the idempotence an at-least-once fabric demands.
 * Ids are unique across the ticket's history, so a stale completion names one
 * already retired and matches nothing live.
 */
export function decideTaskDone(
  graph: TicketGraph,
  id: TicketId,
  taskId: TaskId,
  verdict: Verdict,
): Decision {
  const ticket = ticketAt(graph, id);
  return {
    rec: { label: "task-done", transitions: [], effects: [] },
    post: withTicket(graph, id, {
      ...ticket,
      tasks: resolveTask(
        ticket.tasks,
        taskId,
        verdict === "Pass" ? "Passed" : "Failed",
      ),
    }),
  };
}

/**
 * The work set has settled. Unanimous pass moves into evaluation and stamps
 * the artifact the dependents will read; anything else parks, resumable at
 * Work.
 */
export function decideWorkReduce(graph: TicketGraph, id: TicketId): Decision {
  const ticket = ticketAt(graph, id);
  const retired = retireLive(ticket);
  const allPassed = [...ticket.tasks].every(
    (t) => t.state !== "Outstanding" && t.state.value === "Passed",
  );
  if (!allPassed) {
    return escalate(
      graph,
      id,
      "WorkFailureEscalated",
      "ticket-escalated work_failure_escalated",
    );
  }
  const stage = retired.program[0];
  if (stage === undefined)
    throw new Error("work-reduce: an empty program reached a reduce");
  return move(
    withTicket(graph, id, {
      ...spawnOn(retired, tkEval(0), stage.fanout),
      artifact: { type: "ProducedArtifact", value: retired.spawned },
    }),
    id,
    "Evaluation",
    "work-passed",
    ["SpawnEvalTasks"],
  );
}

/**
 * One eval stage has settled. A passing stage advances, or finishes the
 * program; a failing one short-circuits — the later stages are never created —
 * and is taken the way `onFailure` says, which is the only place that choice is
 * read.
 */
export function decideEvalStageReduce(
  graph: TicketGraph,
  id: TicketId,
  onFailure: EvaluationFailureDisposition,
): Decision {
  const ticket = ticketAt(graph, id);
  const stageIndex = evalStage(ticket.tasks);
  const retired = retireLive(ticket);
  const stage = ticket.program[stageIndex];
  if (stage === undefined)
    throw new Error("eval-reduce: the live stage indexes outside the program");

  if (combine(ticket.tasks)) {
    const next = retired.program[stageIndex + 1];
    if (next !== undefined) {
      return move(
        withTicket(
          graph,
          id,
          spawnOn(retired, tkEval(stageIndex + 1), next.fanout),
        ),
        id,
        "Evaluation",
        "eval-stage-passed",
        ["SpawnEvalTasks"],
      );
    }
    return move(
      withTicket(graph, id, retired),
      id,
      "Finalization",
      "eval-passed",
      ["RunFinalizer"],
    );
  }

  switch (onFailure) {
    case "ReworkEvaluationFailure":
      return move(
        withTicket(graph, id, spawnWork(retired)),
        id,
        "Work",
        "rework-started eval_failure",
        ["SpawnWorkTasks"],
      );
    case "EscalateEvaluationFailure":
      return escalate(
        graph,
        id,
        "EvaluationFailureEscalated",
        "ticket-escalated evaluation_failure_escalated",
      );
  }
}

/**
 * Completion emits no effect. Entering Done IS the completion, recorded in the
 * same journal entry as the decision, so there is nothing left for the world
 * to be asked to do.
 */
function completeTicket(graph: TicketGraph, id: TicketId): Decision {
  const ticket = ticketAt(graph, id);
  return {
    rec: {
      label: "ticket-done",
      transitions: [{ ticket: id, from: ticket.phase, to: "Done" }],
      effects: [],
    },
    post: withTicket(graph, id, {
      ...ticket,
      phase: "Done",
      completions: ticket.completions + 1,
    }),
  };
}

/**
 * A failed finalization re-enters work with a fresh work task. There is no wall
 * on this edge: a finalizer that keeps reporting failure keeps buying cycles,
 * which is the finalizer's problem rather than the machine's.
 */
function finalizerFailure(graph: TicketGraph, id: TicketId): Decision {
  const ticket = ticketAt(graph, id);
  return move(
    withTicket(graph, id, spawnWork(ticket)),
    id,
    "Work",
    "rework-started finalization_needs_work",
    ["SpawnWorkTasks"],
  );
}

/**
 * The finalizer service's one report: success completes the ticket, failure
 * reworks it, and no result at all parks it at the resume that runs the
 * finalizer again — nothing about the ticket has to change for the next
 * attempt to differ, what stood in the way never being the ticket. Without
 * that edge a finalization that cannot conclude sits in a phase that is
 * neither revocable nor retryable until the environment moves under it.
 */
export function decideFinalizationResult(
  graph: TicketGraph,
  id: TicketId,
  outcome: FinalizationOutcome,
): Decision {
  switch (outcome) {
    case "FinalizationSucceeded":
      return completeTicket(graph, id);
    case "FinalizationNeedsWork":
      return finalizerFailure(graph, id);
    case "FinalizationResultUnavailable":
      return escalate(
        graph,
        id,
        "FinalizationUnavailableEscalated",
        "ticket-escalated finalization_unavailable_escalated",
      );
  }
}

/**
 * Infrastructure cannot run an intact contract, which is not failed work: it
 * names the wall of the phase it interrupted, and which refusal it was is
 * evidence the adapter records beside the execution. The two phases get two
 * walls because they resume differently — an evaluation park still has an
 * intact judgement to make, where a work park buys a new artifact.
 */
export function decideExecutionBlocked(
  graph: TicketGraph,
  id: TicketId,
): Decision {
  return ticketAt(graph, id).phase === "Evaluation"
    ? escalate(
        graph,
        id,
        "EvaluationBlockedEscalated",
        "ticket-escalated evaluation_blocked_escalated",
      )
    : escalate(
        graph,
        id,
        "WorkExecutionUnavailableEscalated",
        "ticket-escalated work_execution_unavailable_escalated",
      );
}

/**
 * A parked ticket rejoins the pipeline where its wall implies it would
 * (`resumeOf`), and an unparked one refuses and records that it did.
 *
 * The walls whose resume is work take the same exit: an evaluation failure was
 * reached by a verdict, which has no re-judge to offer, so it buys a new
 * artifact rather than a second opinion on the old one.
 */
export function decideResumeTicket(graph: TicketGraph, id: TicketId): Decision {
  const ticket = ticketAt(graph, id);
  const resumed: Ticket = { ...ticket, escalation: "NoEscalation" };
  switch (resumeOf(ticket.escalation)) {
    case "ResumeWork":
    case "ResumeRework":
      return move(
        withTicket(graph, id, spawnWork(resumed)),
        id,
        "Work",
        "ticket-resumed",
        ["SpawnWorkTasks"],
      );
    case "ResumeEvaluation": {
      const stage = ticket.program[0];
      if (stage === undefined)
        throw new Error("resume: an empty program reached an eval resume");
      return move(
        withTicket(graph, id, spawnOn(resumed, tkEval(0), stage.fanout)),
        id,
        "Evaluation",
        "ticket-resumed",
        ["SpawnEvalTasks"],
      );
    }
    case "ResumeFinalization":
      return move(
        withTicket(graph, id, resumed),
        id,
        "Finalization",
        "ticket-resumed",
        ["RunFinalizer"],
      );
    case "NoResume":
      return {
        rec: { label: "ticket-resume-refused", transitions: [], effects: [] },
        post: graph,
      };
  }
}

/** The dead-end stutter: what a quiet fleet records rather than deadlocking. */
export function settledRecord(): Decision["rec"] {
  return { label: "settled", transitions: [], effects: [] };
}
