/**
 * The deciders: one pure function per command the machine takes, and
 * `decide`, which routes a command onto its decider.
 *
 * A decider takes an observed `TicketGraph` and the command's own payload and
 * returns a `TicketDecision`: the refusal it answers, or the event that
 * happened and the obligations it owes the world. Each is the package's text
 * (`model/domain.qnt`, between its markers), checking in its order, so the
 * first failing check names the refusal. IT MOVES NO STATE — `evolve`
 * (`src/domain/evolve.ts`) is the only thing that does — and it performs
 * nothing. That is what lets a golden trace be replayed through these
 * functions with no world to stub, and what lets the same functions serve any
 * runtime shape.
 *
 * Everything a decision needs is already in the `TicketGraph` it is handed. A
 * decider that acquired a read would acquire an await, and then a mock, and
 * then it would no longer be a function.
 */

import { ticketAt } from "./ticketGraph.ts";
import type {
  EvaluationFailureDisposition,
  EvaluationInstance,
  FinalizationResultReport,
  Obligation,
  ReleasedTicket,
  TaskIdentity,
  TaskTerminalReport,
  Ticket,
  TicketCommand,
  TicketDecision,
  TicketEvent,
  TicketGraph,
  TicketRefusal,
} from "./generated/modelTypes.ts";
import { asTicketId } from "./ids.ts";
import {
  begin,
  currentTaskObligations,
  resumeBlocked,
  reworkEntries,
  taskCurrent,
} from "./evaluation.ts";
import {
  applyEvaluationReport,
  cancelLiveTasks,
  evaluationReworkInput,
  executeEvaluationTasks,
  executeWork,
  finalizationCurrent,
  finalizationResultValid,
  finalizationReworkInput,
  finalize,
  incompleteDependencies,
  initialWorkInput,
  nextCycleNumber,
  producedResult,
  releasedTicketValid,
  reportTask,
  reportTicket,
  reportValid,
  resumedFinalization,
  taskRefOf,
  workTaskObligation,
} from "./ticket.ts";
import {
  acceptedSources,
  releasedTicketBounded,
  type Config,
} from "./config.ts";
import { isPending, revocationAllowed } from "./phase.ts";
import { dependenciesEqual } from "./equality.ts";
import {
  taskIdentityEquals,
  taskObligationEquals,
  workTaskIdentity,
} from "./task.ts";

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

/** The disposition a command that concludes no stage is taken under; `decide` never asks it. */
export const unaskedDisposition: EvaluationFailureDisposition =
  "ReworkEvaluationFailure";

/**
 * What a task can come back with, as the environment may produce it: a work
 * task produced its artifact at a source the application accepted, or reached
 * no result at all; an evaluator judged either way or reached no result. A
 * produced report carries the obligation the ticket owes for the task, which
 * is the only obligation the completion accepts.
 */
export function reportChoices(
  ticket: Ticket,
  task: TaskIdentity,
): readonly TaskTerminalReport[] {
  const id = ticket.definition.id;
  const failure = { task, evidence: taskRefOf(task) };
  const failures: readonly TaskTerminalReport[] = [
    {
      type: "TerminalFailureReport",
      value: { ticket: id, failure, kind: "ProcessFailure" },
    },
    {
      type: "TerminalFailureReport",
      value: { ticket: id, failure, kind: "ExecutionUnavailableFailure" },
    },
  ];
  const result = producedResult(ticket, task);
  if (task.type === "WorkTask")
    return [
      ...acceptedSources.map((acceptedSourceRef): TaskTerminalReport => ({
        type: "WorkResultReport",
        value: { ticket: id, result, acceptedSourceRef },
      })),
      ...failures,
    ];
  return [
    {
      type: "EvaluationResultReport",
      value: { ticket: id, result, verdict: "EvaluatorPass" },
    },
    {
      type: "EvaluationResultReport",
      value: { ticket: id, result, verdict: "EvaluatorFail" },
    },
    ...failures,
  ];
}

/** An accepted command: the event, and what it owes. */
export function decided(
  event: TicketEvent,
  obligations: readonly Obligation[],
): TicketDecision {
  return { type: "TicketDecided", value: { event, obligations } };
}

/** A refused command. */
export function refused(reason: TicketRefusal): TicketDecision {
  return { type: "TicketRefused", value: reason };
}

/**
 * The package's `commandValid`: the release's own rule for a creation or an
 * update, and every reference a report or a dispatch carries a real one.
 */
export function commandValid(command: TicketCommand): boolean {
  switch (command.type) {
    case "CreateTicket":
      return releasedTicketValid(command.value);
    case "UpdateTicket":
      return (
        command.value.ticket > 0 &&
        command.value.expectedRevision > 0 &&
        releasedTicketValid(command.value.definition)
      );
    case "DispatchTicket":
      return command.value.ticket > 0 && command.value.source > 0;
    case "ReportTaskTerminal":
      return reportValid(command.value);
    case "ReportFinalizationResult":
      return (
        command.value.ticket > 0 &&
        command.value.workCycle > 0 &&
        command.value.generation > 0 &&
        finalizationResultValid(command.value.result)
      );
    case "RevokeTicket":
    case "ResumeTicket":
      return true;
  }
}

/** Every definition a command carries is inside this deployment's bounds. */
export function commandBounded(
  config: Config,
  command: TicketCommand,
): boolean {
  switch (command.type) {
    case "CreateTicket":
      return releasedTicketBounded(config, command.value);
    case "UpdateTicket":
      return releasedTicketBounded(config, command.value.definition);
    case "DispatchTicket":
    case "RevokeTicket":
    case "ResumeTicket":
    case "ReportTaskTerminal":
    case "ReportFinalizationResult":
      return true;
  }
}

/**
 * A command the machine takes: the package's shape rule and this
 * deployment's bounds. It is a shape guard and not a refusal — it reads no
 * ticket, and a command outside it is not one the machine takes at all.
 */
export function commandTaken(config: Config, command: TicketCommand): boolean {
  return commandValid(command) && commandBounded(config, command);
}

/**
 * Release: refused if the id is taken, if the ticket names itself, or if it
 * names a dependency that does not exist — in that order — and never for a
 * dependency that exists, whatever its state.
 */
export function decideCreate(
  graph: TicketGraph,
  definition: ReleasedTicket,
): TicketDecision {
  if (graph.tickets.has(definition.id))
    return refused({ type: "TicketAlreadyExists", value: definition.id });
  if (definition.dependencies.has(definition.id))
    return refused({ type: "SelfDependency", value: definition.id });
  const missing = new Set(
    [...definition.dependencies].filter((d) => !graph.tickets.has(d)),
  );
  if (missing.size > 0)
    return refused({
      type: "DependenciesNotFound",
      value: { ticket: definition.id, dependencies: missing },
    });
  return decided({ type: "TicketCreated", value: definition }, []);
}

/** What an update carries: the ticket, the revision its author read, and the definition that replaces it. */
export type TicketUpdateRequest = Extract<
  TicketCommand,
  { type: "UpdateTicket" }
>["value"];

/**
 * Update: the author replaces a Pending ticket's definition as its next
 * revision, owing nothing. Refused, in this order, if the ticket does not
 * exist, is no longer Pending, is not the one the definition names, is at
 * another revision than the one expected, or would change its dependencies.
 */
export function decideUpdate(
  graph: TicketGraph,
  update: TicketUpdateRequest,
): TicketDecision {
  if (!graph.tickets.has(update.ticket))
    return refused({ type: "TicketNotFound", value: update.ticket });
  const id = asTicketId(update.ticket);
  const ticket = ticketAt(graph, id);
  if (!isPending(ticket.state))
    return refused({ type: "TicketNotPending", value: id });
  if (update.definition.id !== id)
    return refused({ type: "TicketIdentityMismatch", value: id });
  if (update.expectedRevision !== ticket.revision)
    return refused({
      type: "TicketRevisionStale",
      value: {
        ticket: id,
        expected: update.expectedRevision,
        current: ticket.revision,
      },
    });
  if (
    !dependenciesEqual(
      update.definition.dependencies,
      ticket.definition.dependencies,
    )
  )
    return refused({ type: "TicketDependenciesChanged", value: id });
  return decided(
    {
      type: "TicketUpdated",
      value: {
        ticket: id,
        revision: ticket.revision + 1,
        definition: update.definition,
      },
    },
    [],
  );
}

/**
 * Ready to Work, at a source the caller names: which Ready ticket runs next
 * and what its work is done against are both agentic picks, so both arrive in
 * the command and the event IS the ticket writer's decision. Refused for a
 * ticket that is not Pending, or that waits on a dependency not yet Done.
 */
export function decideDispatch(
  graph: TicketGraph,
  dispatch: { readonly ticket: number; readonly source: number },
): TicketDecision {
  if (!graph.tickets.has(dispatch.ticket))
    return refused({ type: "TicketNotFound", value: dispatch.ticket });
  const id = asTicketId(dispatch.ticket);
  const ticket = ticketAt(graph, id);
  if (!isPending(ticket.state))
    return refused({ type: "TicketNotPending", value: id });
  const incomplete = incompleteDependencies(graph, ticket);
  if (incomplete.size > 0)
    return refused({
      type: "DependenciesIncomplete",
      value: { ticket: id, dependencies: incomplete },
    });
  return decided({ type: "TicketDispatched", value: dispatch }, [
    executeWork(
      ticket,
      nextCycleNumber(ticket),
      dispatch.source,
      initialWorkInput(ticket.definition),
    ),
  ]);
}

/**
 * Revoke settles the ticket its author named, owing a cancellation for every
 * task the fabric is running for it. A dependent behind it stays Pending, and
 * its own author settles it the same way.
 */
export function decideRevoke(
  graph: TicketGraph,
  ticketId: number,
): TicketDecision {
  if (!graph.tickets.has(ticketId))
    return refused({ type: "TicketNotFound", value: ticketId });
  const id = asTicketId(ticketId);
  const ticket = ticketAt(graph, id);
  if (!revocationAllowed(ticket.state))
    return refused({ type: "TicketNotRevocable", value: id });
  return decided({ type: "TicketRevoked", value: id }, cancelLiveTasks(ticket));
}

/**
 * A parked ticket resumes where its wall implies, and the event names which
 * of the three: the work walls and the evaluation-failure wall owe a new work
 * cycle over the input the wall carries, the blocked wall re-asks the
 * evaluators it stopped, and the finalization wall owes the next attempt. A
 * ticket at no wall is refused `TicketNotResumable`.
 */
export function decideResume(
  graph: TicketGraph,
  ticketId: number,
): TicketDecision {
  if (!graph.tickets.has(ticketId))
    return refused({ type: "TicketNotFound", value: ticketId });
  const id = asTicketId(ticketId);
  const ticket = ticketAt(graph, id);
  const state = ticket.state;
  if (typeof state === "string" || state.type !== "Escalated")
    return refused({ type: "TicketNotResumable", value: id });
  const wall = state.value;
  switch (wall.type) {
    case "WorkFailureEscalated":
    case "WorkExecutionUnavailableEscalated":
      return decided({ type: "TicketWorkResumed", value: id }, [
        executeWork(
          ticket,
          nextCycleNumber(ticket),
          wall.value.source,
          wall.value.resumeInput,
        ),
      ]);
    case "EvaluationFailureEscalated":
      return decided({ type: "TicketWorkResumed", value: id }, [
        executeWork(
          ticket,
          nextCycleNumber(ticket),
          wall.value.source,
          evaluationReworkInput(ticket.definition, wall.value.evidence),
        ),
      ]);
    case "EvaluationBlockedEscalated":
      return decided(
        { type: "TicketEvaluationResumed", value: id },
        executeEvaluationTasks(id, resumeBlocked(wall.value)),
      );
    case "FinalizationUnavailableEscalated":
      return decided({ type: "TicketFinalizationResumed", value: id }, [
        finalize(ticket, resumedFinalization(wall.value.finalization)),
      ]);
  }
}

/**
 * A work completion: a produced result is ACCEPTED, opening the instance that
 * judges it and owing its first stage's evaluators, and a task that died or
 * that infrastructure could not run parks the ticket at its own wall.
 */
function decideWorkTerminal(
  ticket: Ticket,
  report: TaskTerminalReport,
): TicketDecision {
  switch (report.type) {
    case "WorkResultReport": {
      const { ticket: id, result, acceptedSourceRef } = report.value;
      const evaluation = begin(
        ticket.workCyclesStarted,
        {
          ticket: ticket.definition.id,
          workResult: result.resultRef,
          acceptedSourceRef,
        },
        ticket.definition.evaluationPlan,
      );
      return decided(
        {
          type: "TicketWorkResultAccepted",
          value: { ticket: id, result, acceptedSourceRef },
        },
        executeEvaluationTasks(id, evaluation),
      );
    }
    case "TerminalFailureReport": {
      const fact = {
        ticket: report.value.ticket,
        task: report.value.failure.task,
        evidence: report.value.failure.evidence,
      };
      return report.value.kind === "ProcessFailure"
        ? decided({ type: "TicketWorkProcessFailed", value: fact }, [])
        : decided({ type: "TicketWorkExecutionUnavailable", value: fact }, []);
    }
    case "EvaluationResultReport":
      return refused({
        type: "TaskNotCurrent",
        value: {
          ticket: report.value.ticket,
          task: report.value.result.obligation.task,
        },
      });
  }
}

/** Which stage an instance is running, as the index its run stores; -1 when it is not running one. */
export function runningStageIndex(instance: EvaluationInstance): number {
  return instance.state.type === "Running"
    ? instance.state.value.stage.stageIndex
    : -1;
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
function decideEvaluationTerminal(
  ticket: Ticket,
  evaluation: EvaluationInstance,
  report: TaskTerminalReport,
  failurePolicy: EvaluationFailurePolicy,
): TicketDecision {
  const id = reportTicket(report);
  const priorStage = runningStageIndex(evaluation);
  const updated = applyEvaluationReport(evaluation, report);
  const fact = { ticket: id, report };
  const state = updated.state;
  switch (state.type) {
    case "Running":
      return decided(
        { type: "TicketEvaluationProgressed", value: fact },
        state.value.stage.stageIndex === priorStage
          ? []
          : executeEvaluationTasks(id, updated),
      );
    case "EvaluationPassed":
      return decided({ type: "TicketEvaluationPassed", value: fact }, [
        finalize(ticket, {
          workCycle: updated.workCycle,
          generation: 1,
          input: updated.input.workResult,
          source: updated.input.acceptedSourceRef,
        }),
      ]);
    case "EvaluationFailed": {
      const entries = reworkEntries(updated, state.value);
      const rework = { ticket: id, report, evidence: entries };
      return failurePolicy(updated) === "ReworkEvaluationFailure"
        ? decided({ type: "TicketEvaluationReworkStarted", value: rework }, [
            executeWork(
              ticket,
              nextCycleNumber(ticket),
              updated.input.acceptedSourceRef,
              evaluationReworkInput(ticket.definition, entries),
            ),
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
 * A task completion, accepted only for a task the ticket owes, and a produced
 * report only under the obligation that task was spawned with; anything else
 * is refused `TaskNotCurrent` — a failure naming a cycle a rework replaced
 * among them.
 */
export function decideTaskTerminal(
  graph: TicketGraph,
  report: TaskTerminalReport,
  failurePolicy: EvaluationFailurePolicy,
): TicketDecision {
  if (!graph.tickets.has(reportTicket(report)))
    return refused({ type: "TicketNotFound", value: reportTicket(report) });
  const ticket = ticketAt(graph, asTicketId(reportTicket(report)));
  const task = reportTask(report);
  const notCurrent = refused({
    type: "TaskNotCurrent",
    value: { ticket: reportTicket(report), task },
  });
  const state = ticket.state;
  if (typeof state === "string") return notCurrent;
  switch (state.type) {
    case "Work": {
      const current =
        taskIdentityEquals(
          workTaskIdentity(ticket.definition.id, ticket.workCyclesStarted),
          task,
        ) &&
        (report.type === "WorkResultReport"
          ? taskObligationEquals(
              report.value.result.obligation,
              workTaskObligation(
                ticket,
                ticket.workCyclesStarted,
                state.value.source,
                state.value.input,
              ),
            )
          : report.type === "TerminalFailureReport");
      return current ? decideWorkTerminal(ticket, report) : notCurrent;
    }
    case "Evaluation": {
      const evaluation = state.value;
      const current =
        taskCurrent(evaluation, task) &&
        (report.type === "EvaluationResultReport"
          ? currentTaskObligations(evaluation).some((owed) =>
              taskObligationEquals(owed, report.value.result.obligation),
            )
          : report.type === "TerminalFailureReport");
      return current
        ? decideEvaluationTerminal(ticket, evaluation, report, failurePolicy)
        : notCurrent;
    }
    case "Finalization":
    case "Escalated":
      return notCurrent;
  }
}

/**
 * The finalizer's result, for the attempt the report names: success completes
 * the ticket, failure owes a new work cycle, and no result at all parks it at
 * the wall whose resume runs the finalizer again. Refused
 * `FinalizationNotCurrent` outside Finalization, or for an attempt the ticket
 * is not on — its work cycle and its generation both.
 */
export function decideFinalizationResult(
  graph: TicketGraph,
  report: FinalizationResultReport,
): TicketDecision {
  if (!graph.tickets.has(report.ticket))
    return refused({ type: "TicketNotFound", value: report.ticket });
  const ticket = ticketAt(graph, asTicketId(report.ticket));
  const { workCycle, generation } = report;
  const state = ticket.state;
  if (
    typeof state === "string" ||
    state.type !== "Finalization" ||
    !finalizationCurrent(state.value, workCycle, generation)
  )
    return refused({
      type: "FinalizationNotCurrent",
      value: { ticket: report.ticket, workCycle, generation },
    });
  const fact = {
    ticket: report.ticket,
    workCycle,
    generation,
    evidence: report.result.value,
  };
  switch (report.result.type) {
    case "FinalizationSucceeded":
      return decided({ type: "TicketFinalizationSucceeded", value: fact }, []);
    case "FinalizationNeedsWork":
      return decided({ type: "TicketFinalizationNeedsWork", value: fact }, [
        executeWork(
          ticket,
          nextCycleNumber(ticket),
          state.value.source,
          finalizationReworkInput(ticket.definition, report.result.value),
        ),
      ]);
    case "FinalizationResultUnavailable":
      return decided(
        { type: "TicketFinalizationUnavailable", value: fact },
        [],
      );
  }
}

/**
 * THE DECISION: each command to its decider. The policy is asked only by a
 * completion that concludes a failing stage, and the event names the edge it
 * took, so nothing after this asks it again.
 */
export function decide(
  graph: TicketGraph,
  command: TicketCommand,
  failurePolicy: EvaluationFailurePolicy,
): TicketDecision {
  switch (command.type) {
    case "CreateTicket":
      return decideCreate(graph, command.value);
    case "UpdateTicket":
      return decideUpdate(graph, command.value);
    case "DispatchTicket":
      return decideDispatch(graph, command.value);
    case "RevokeTicket":
      return decideRevoke(graph, command.value);
    case "ResumeTicket":
      return decideResume(graph, command.value);
    case "ReportTaskTerminal":
      return decideTaskTerminal(graph, command.value, failurePolicy);
    case "ReportFinalizationResult":
      return decideFinalizationResult(graph, command.value);
  }
}
