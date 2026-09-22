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
  ReleasedTicket,
  TaskIdentity,
  TaskTerminalReport,
  Ticket,
} from "./generated/modelTypes.ts";
import { asTicketId, type TicketId } from "./ids.ts";
import { resolveTask } from "./task.ts";
import { resumeBlocked } from "./evaluation.ts";
import {
  applyTaskReport,
  beginEvaluation,
  currentInstance,
  owesTask,
  producedResult,
  resumeOf,
  retireLive,
  runningStageIndex,
  spawnEvalRun,
  spawnWork,
  taskRefOf,
  withInstance,
  workProduced,
} from "./ticket.ts";
import { acceptedSources } from "./config.ts";

/**
 * Both ways a failing evaluation can be taken. The choice is an input to the
 * reduce rather than a field on the ticket: what a failed evaluation means is
 * the evaluation's own report, not something the release settled in advance.
 */
export const dispositionChoices: readonly EvaluationFailureDisposition[] = [
  "ReworkEvaluationFailure",
  "EscalateEvaluationFailure",
];

/**
 * What a task can come back with, as the environment may produce it: a work
 * task produced its artifact at a source the application accepted, or reached
 * no result at all; an evaluator judged either way or reached no result. A
 * produced report carries the obligation the ticket owes for the task, which
 * is the only obligation the completion's enablement admits.
 */
export function reportChoices(
  ticket: Ticket,
  task: TaskIdentity,
): readonly TaskTerminalReport[] {
  const evidence = taskRefOf(task);
  const failures: readonly TaskTerminalReport[] = [
    {
      type: "TerminalFailureReport",
      value: { evidence, kind: "ProcessFailure" },
    },
    {
      type: "TerminalFailureReport",
      value: { evidence, kind: "ExecutionUnavailableFailure" },
    },
  ];
  const result = producedResult(ticket, task);
  if (task.type === "WorkTask")
    return [
      ...acceptedSources.map((acceptedSourceRef): TaskTerminalReport => ({
        type: "WorkResultReport",
        value: { result, acceptedSourceRef },
      })),
      ...failures,
    ];
  return [
    {
      type: "EvaluationResultReport",
      value: { result, verdict: "EvaluatorPass" },
    },
    {
      type: "EvaluationResultReport",
      value: { result, verdict: "EvaluatorFail" },
    },
    ...failures,
  ];
}

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

/**
 * A ticket as a release leaves it: Pending, with nothing yet spawned and no
 * source, because nothing has been dispatched yet.
 */
export function freshTicket(definition: ReleasedTicket): Ticket {
  return {
    phase: "Pending",
    definition,
    source: 0,
    artifact: "NoArtifact",
    tasks: new Set(),
    evaluations: [],
    workCyclesStarted: 0,
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
  definition: ReleasedTicket,
): Decision {
  const tickets = new Map(graph.tickets);
  tickets.set(asTicketId(definition.id), freshTicket(definition));
  return {
    rec: { label: "ticket-released", transitions: [], effects: [] },
    post: { tickets },
  };
}

/**
 * Park a ticket on the desk, naming the wall and retiring the live work task;
 * where a resume puts it back is the wall's own (`resumeOf`), the open desk
 * task is derived from the phase, and `OpenHumanTask` is its visible effect.
 * An evaluation park keeps its instance, which is what its resume re-asks
 * from.
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
 * ticket writer's decision. The source is observed here and on no other edge:
 * the dispatch is the one that looks at what the ticket's repository is at.
 */
export function decideDispatch(
  graph: TicketGraph,
  id: TicketId,
  source: number,
): Decision {
  const ticket = ticketAt(graph, id);
  return move(
    withTicket(graph, id, { ...spawnWork(ticket), source }),
    id,
    "Work",
    "dispatch",
    ["SpawnWorkTasks"],
  );
}

/**
 * A task completion, first write wins: a completion for a task nothing is
 * waiting on changes nothing — identities are never reused, so a stale
 * delivery names one already settled and matches nothing owed.
 *
 * A WALL IS NOT A VERDICT, and the two phases answer it differently: an
 * evaluator's wall marks that evaluator and the stage runs on, where a work
 * task's parks the ticket at once, a work cycle being one task.
 */
export function decideTaskDone(
  graph: TicketGraph,
  id: TicketId,
  task: TaskIdentity,
  report: TaskTerminalReport,
  onFailure: EvaluationFailureDisposition,
): Decision {
  const ticket = ticketAt(graph, id);
  if (!owesTask(ticket, task)) return taskDoneStep(graph, id, ticket);
  return ticket.phase === "Work"
    ? decideWorkTaskDone(graph, id, task, report)
    : decideEvalTaskDone(graph, id, task, report, onFailure);
}

/** The completion's own step: no transition, because a task settling is progress inside a phase. */
function taskDoneStep(
  graph: TicketGraph,
  id: TicketId,
  ticket: Ticket,
): Decision {
  return {
    rec: { label: "task-done", transitions: [], effects: [] },
    post: withTicket(graph, id, ticket),
  };
}

/**
 * A work completion: the cycle's one task settles — produced, or died with the
 * fabric's relaunches behind it — and the reduce that follows reads it.
 * Infrastructure that could not run it at all parks the ticket here instead,
 * there being no sibling to wait for and no judgement to preserve.
 */
function decideWorkTaskDone(
  graph: TicketGraph,
  id: TicketId,
  task: TaskIdentity,
  report: TaskTerminalReport,
): Decision {
  const ticket = ticketAt(graph, id);
  switch (report.type) {
    case "WorkResultReport":
      return taskDoneStep(graph, id, {
        ...ticket,
        tasks: resolveTask(ticket.tasks, task, "Passed"),
        source: report.value.acceptedSourceRef,
      });
    case "TerminalFailureReport":
      return report.value.kind === "ProcessFailure"
        ? taskDoneStep(graph, id, {
            ...ticket,
            tasks: resolveTask(ticket.tasks, task, "Failed"),
          })
        : escalate(
            graph,
            id,
            "WorkExecutionUnavailableEscalated",
            "ticket-escalated work_execution_unavailable_escalated",
          );
    /** Unreachable: `reportMatchesTask` refuses an evaluator's verdict here. */
    case "EvaluationResultReport":
      return taskDoneStep(graph, id, ticket);
  }
}

/**
 * An evaluation completion, which is also THE EVALUATION-PLAN INTERPRETER: the
 * report goes to the instance and the state that comes back says which edge
 * this was.
 *
 *   - still RUNNING the same stage — a status settled and the stage owes its
 *     remaining evaluators; no transition
 *   - RUNNING a later stage — the stage passed and the next one is asked,
 *     which is a real Evaluation to Evaluation row
 *   - PASSED — the plan passed, so the ticket finalizes
 *   - FAILED — the later stages are skipped, not failed, and no run exists
 *     for them; the edge `onFailure` names is taken
 *   - BLOCKED — every evaluator answered and one of them was stopped, so the
 *     judgement is intact and unmade: park, and the resume re-asks exactly
 *     those evaluators at the next generation
 */
function decideEvalTaskDone(
  graph: TicketGraph,
  id: TicketId,
  task: TaskIdentity,
  report: TaskTerminalReport,
  onFailure: EvaluationFailureDisposition,
): Decision {
  const ticket = ticketAt(graph, id);
  const before = currentInstance(ticket);
  const advanced = withInstance(ticket, applyTaskReport(before, task, report));
  const stepped = withTicket(graph, id, advanced);
  const state = currentInstance(advanced).state;
  switch (state.type) {
    case "Running":
      return state.value.stage.stageIndex === runningStageIndex(before)
        ? taskDoneStep(graph, id, advanced)
        : move(
            withTicket(graph, id, spawnEvalRun(advanced)),
            id,
            "Evaluation",
            "eval-stage-passed",
            ["SpawnEvalTasks"],
          );
    case "EvaluationPassed":
      return move(stepped, id, "Finalization", "eval-passed", ["RunFinalizer"]);
    case "EvaluationFailed":
      return onFailure === "ReworkEvaluationFailure"
        ? move(
            withTicket(graph, id, spawnWork(advanced)),
            id,
            "Work",
            "rework-started eval_failure",
            ["SpawnWorkTasks"],
          )
        : escalate(
            stepped,
            id,
            "EvaluationFailureEscalated",
            "ticket-escalated evaluation_failure_escalated",
          );
    case "EvaluationBlocked":
      return escalate(
        stepped,
        id,
        "EvaluationBlockedEscalated",
        "ticket-escalated evaluation_blocked_escalated",
      );
  }
}

/**
 * The work task has settled: a pass retires it, stamps the artifact the
 * dependents will read and OPENS THE INSTANCE that judges it, whose first
 * stage is asked at once. A failed task is a failed CYCLE and parks, the
 * fabric having already retried it below the cycle grain.
 */
export function decideWorkReduce(graph: TicketGraph, id: TicketId): Decision {
  const ticket = ticketAt(graph, id);
  if (!workProduced(ticket.tasks)) {
    return escalate(
      graph,
      id,
      "WorkFailureEscalated",
      "ticket-escalated work_failure_escalated",
    );
  }
  return move(
    withTicket(graph, id, beginEvaluation(retireLive(ticket))),
    id,
    "Evaluation",
    "work-passed",
    ["SpawnEvalTasks"],
  );
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
 * A parked ticket rejoins the pipeline where its wall implies it would
 * (`resumeOf`), and an unparked one refuses and records that it did.
 *
 * The walls whose resume is work take the same exit — an evaluation failure
 * was reached by a verdict, which has no re-judge to offer, so it buys a new
 * artifact rather than a second opinion — and the blocked wall, reached
 * without a verdict, is the only one that re-asks.
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
      /** A re-ask and not a fresh fan-out: the answers already given stand. */
      const reopened = withInstance(
        resumed,
        resumeBlocked(currentInstance(resumed)),
      );
      return move(
        withTicket(graph, id, spawnEvalRun(reopened)),
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
