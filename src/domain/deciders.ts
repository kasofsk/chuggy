/**
 * The deciders: one pure function per decision the machine can make.
 *
 * A decider takes an observed `TicketGraph` and the decision's own arguments
 * and returns the event that happened and the obligations it owes the world.
 * IT MOVES NO STATE — `evolve` (`src/domain/evolve.ts`) is the only thing that
 * does — and it performs nothing. That is what lets a golden trace be replayed
 * through these functions with no world to stub, and what lets the same
 * functions serve any runtime shape.
 *
 * Everything a decision needs is already in the `TicketGraph` it is handed. A
 * decider that acquired a read would acquire an await, and then a mock, and
 * then it would no longer be a function.
 */

import { ticketAt } from "./ticketGraph.ts";
import type {
  EvaluationFailureDisposition,
  EvaluationInstance,
  FinalizationOutcome,
  Obligation,
  ReleasedTicket,
  SuccessfulTicketDecision,
  TaskIdentity,
  TaskTerminalReport,
  Ticket,
  TicketEvent,
  TicketGraph,
} from "./generated/modelTypes.ts";
import type { TicketId } from "./ids.ts";
import { resumeBlocked, reworkEntries } from "./evaluation.ts";
import {
  applyEvaluationReport,
  begunInstance,
  cancelLiveTasks,
  currentInstance,
  executeEvaluationTasks,
  executeWork,
  finalizationOperationOf,
  finalize,
  producedResult,
  resumeOf,
  runningStageIndex,
  taskRefOf,
} from "./ticket.ts";
import { acceptedSources } from "./config.ts";

/**
 * What a failing evaluation does, as a function of the failed instance. The
 * machine holds no policy of its own: the event a failing stage decides names
 * the edge taken, so no replay ever consults one.
 */
export type EvaluationFailurePolicy = (
  instance: EvaluationInstance,
) => EvaluationFailureDisposition;

/** Both ways a failing evaluation can be taken; any implementation policy is a restriction of this draw. */
export const dispositionChoices: readonly EvaluationFailureDisposition[] = [
  "ReworkEvaluationFailure",
  "EscalateEvaluationFailure",
];

/** The policy that takes one edge whatever failed. */
export function alwaysPolicy(
  disposition: EvaluationFailureDisposition,
): EvaluationFailurePolicy {
  return () => disposition;
}

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
  const failure = { task, evidence: taskRefOf(task) };
  const failures: readonly TaskTerminalReport[] = [
    {
      type: "TerminalFailureReport",
      value: { failure, kind: "ProcessFailure" },
    },
    {
      type: "TerminalFailureReport",
      value: { failure, kind: "ExecutionUnavailableFailure" },
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

/** A decision: the event, and what it owes. */
export function decided(
  event: TicketEvent,
  obligations: readonly Obligation[],
): SuccessfulTicketDecision {
  return { event, obligations };
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
    evaluations: [],
    workCyclesStarted: 0,
    spawned: 0,
    finalizationGeneration: 0,
    escalation: "NoEscalation",
    completions: 0,
  };
}

/**
 * Release: the ticket enters the fleet already Pending, carrying every value
 * that will affect its behaviour. Authoring happens outside this machine, and
 * what arrives is frozen.
 */
export function decideReleaseTicket(
  _graph: TicketGraph,
  definition: ReleasedTicket,
): SuccessfulTicketDecision {
  return decided({ type: "TicketCreated", value: definition }, []);
}

/**
 * Revoke settles the ticket its author named, owing a cancellation for every
 * task the fabric is running for it. A dependent behind it stays Pending, and
 * its own author settles it the same way.
 */
export function decideRevoke(
  graph: TicketGraph,
  id: TicketId,
): SuccessfulTicketDecision {
  return decided(
    { type: "TicketRevoked", value: id },
    cancelLiveTasks(ticketAt(graph, id)),
  );
}

/**
 * Ready to Work, at a source the caller names: which Ready ticket runs next
 * and what its work is done against are both agentic picks, so both arrive as
 * arguments and the event IS the ticket writer's decision. The dispatch is the
 * only edge that observes a source.
 */
export function decideDispatch(
  graph: TicketGraph,
  id: TicketId,
  source: number,
): SuccessfulTicketDecision {
  const ticket = ticketAt(graph, id);
  return decided({ type: "TicketDispatched", value: { ticket: id, source } }, [
    executeWork(ticket, ticket.workCyclesStarted + 1),
  ]);
}

/**
 * A task completion, in either phase. There is no second decision behind it:
 * a work completion that produced opens the judgement in the same step, and
 * one that concludes a stage decides the stage, which is why the policy is an
 * argument here.
 */
export function decideTaskDone(
  graph: TicketGraph,
  id: TicketId,
  _task: TaskIdentity,
  report: TaskTerminalReport,
  failurePolicy: EvaluationFailurePolicy,
): SuccessfulTicketDecision {
  const ticket = ticketAt(graph, id);
  return ticket.phase === "Work"
    ? decideWorkTaskDone(ticket, id, report)
    : decideEvalTaskDone(ticket, id, report, failurePolicy);
}

/**
 * A work completion: a produced result is ACCEPTED, opening the instance that
 * judges it and owing its first stage's evaluators, and a task that died or
 * that infrastructure could not run parks the ticket at its own wall. There is
 * no sibling to wait for, a work cycle being one task.
 */
function decideWorkTaskDone(
  ticket: Ticket,
  id: TicketId,
  report: TaskTerminalReport,
): SuccessfulTicketDecision {
  switch (report.type) {
    case "WorkResultReport": {
      const { result, acceptedSourceRef } = report.value;
      return decided(
        {
          type: "TicketWorkResultAccepted",
          value: { ticket: id, result, acceptedSourceRef },
        },
        executeEvaluationTasks(
          id,
          begunInstance(ticket, result.resultRef, acceptedSourceRef),
        ),
      );
    }
    case "TerminalFailureReport": {
      const fact = {
        ticket: id,
        task: report.value.failure.task,
        evidence: report.value.failure.evidence,
      };
      return report.value.kind === "ProcessFailure"
        ? decided({ type: "TicketWorkProcessFailed", value: fact }, [])
        : decided({ type: "TicketWorkExecutionUnavailable", value: fact }, []);
    }
    /** Unreachable: `reportMatchesTask` refuses a verdict here, and `evolve` lets the event fall through Work. */
    case "EvaluationResultReport":
      return decided(
        { type: "TicketEvaluationProgressed", value: { ticket: id, report } },
        [],
      );
  }
}

/**
 * An evaluation completion, which is also THE EVALUATION-PLAN INTERPRETER: the
 * report goes to the instance and the state that comes back says which event
 * this is.
 *
 *   - still RUNNING the same stage — Progressed, owing nothing new
 *   - RUNNING a later stage — Progressed, owing the next stage's evaluators
 *   - PASSED — the first finalization attempt of this cycle is owed
 *   - FAILED — the policy picks the edge and the event names it: ReworkStarted
 *     owes a new work cycle, FailureEscalated parks and owes nothing
 *   - BLOCKED — every evaluator answered and one was stopped, so the judgement
 *     is intact and unmade: park, and the resume re-asks exactly those
 */
function decideEvalTaskDone(
  ticket: Ticket,
  id: TicketId,
  report: TaskTerminalReport,
  failurePolicy: EvaluationFailurePolicy,
): SuccessfulTicketDecision {
  const before = currentInstance(ticket);
  const advanced = applyEvaluationReport(before, report);
  const fact = { ticket: id, report };
  const state = advanced.state;
  switch (state.type) {
    case "Running":
      return decided(
        { type: "TicketEvaluationProgressed", value: fact },
        state.value.stage.stageIndex === runningStageIndex(before)
          ? []
          : executeEvaluationTasks(id, advanced),
      );
    case "EvaluationPassed":
      return decided({ type: "TicketEvaluationPassed", value: fact }, [
        finalize(ticket, {
          workCycle: advanced.workCycle,
          generation: 1,
          input: advanced.input.workResult,
          source: advanced.input.acceptedSourceRef,
        }),
      ]);
    case "EvaluationFailed": {
      const rework = {
        ticket: id,
        report,
        evidence: reworkEntries(advanced, state.value),
      };
      return failurePolicy(advanced) === "ReworkEvaluationFailure"
        ? decided({ type: "TicketEvaluationReworkStarted", value: rework }, [
            executeWork(ticket, ticket.workCyclesStarted + 1),
          ])
        : decided(
            { type: "TicketEvaluationFailureEscalated", value: rework },
            [],
          );
    }
    case "EvaluationBlocked":
      return decided({ type: "TicketEvaluationBlocked", value: fact }, []);
  }
}

/**
 * The finalizer's report, as the attempt the ticket is on: success completes
 * the ticket, failure owes a new work cycle, and no result at all parks it at
 * the wall whose resume runs the finalizer again. The command names the
 * evidence and the decider names the attempt.
 */
export function decideFinalizationResult(
  graph: TicketGraph,
  id: TicketId,
  outcome: FinalizationOutcome,
  evidence: number,
): SuccessfulTicketDecision {
  const ticket = ticketAt(graph, id);
  const fact = {
    ticket: id,
    workCycle: ticket.workCyclesStarted,
    generation: ticket.finalizationGeneration,
    evidence,
  };
  switch (outcome) {
    case "FinalizationSucceeded":
      return decided({ type: "TicketFinalizationSucceeded", value: fact }, []);
    case "FinalizationNeedsWork":
      return decided({ type: "TicketFinalizationNeedsWork", value: fact }, [
        executeWork(ticket, ticket.workCyclesStarted + 1),
      ]);
    case "FinalizationResultUnavailable":
      return decided(
        { type: "TicketFinalizationUnavailable", value: fact },
        [],
      );
  }
}

/**
 * A parked ticket resumes where its wall implies (`resumeOf`), and the event
 * names which of the three: the work walls and the evaluation-failure wall
 * owe a new work cycle, the blocked wall re-asks the evaluators it stopped,
 * and the finalization wall owes the next attempt.
 */
export function decideResumeTicket(
  graph: TicketGraph,
  id: TicketId,
): SuccessfulTicketDecision {
  const ticket = ticketAt(graph, id);
  switch (resumeOf(ticket.escalation)) {
    case "ResumeWork":
    case "ResumeRework":
      return decided({ type: "TicketWorkResumed", value: id }, [
        executeWork(ticket, ticket.workCyclesStarted + 1),
      ]);
    case "ResumeEvaluation":
      return decided(
        { type: "TicketEvaluationResumed", value: id },
        executeEvaluationTasks(id, resumeBlocked(currentInstance(ticket))),
      );
    case "ResumeFinalization": {
      const operation = finalizationOperationOf(ticket);
      return decided({ type: "TicketFinalizationResumed", value: id }, [
        finalize(ticket, {
          ...operation,
          generation: operation.generation + 1,
        }),
      ]);
    }
    /** Unreachable: `retryableIn` refuses an unparked ticket, and `evolve` lets the event fall through it. */
    case "NoResume":
      return decided({ type: "TicketWorkResumed", value: id }, []);
  }
}
