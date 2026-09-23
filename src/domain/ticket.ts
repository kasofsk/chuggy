/**
 * What a ticket does with its own fields: what a park implies, what it owes
 * the fabric, and the instances that hold its judgements.
 *
 * `completions` is a stored ghost here as it is in the model rather than
 * reconstructed from the phase — a stored duplicate of a derivable fact is a
 * finding, and this one is the model's own accounting, carried so a golden
 * state compares field for field. The artifact is not stored at all: it is
 * the result the latest instance judges (`artifactOf`).
 */

import type {
  ArtifactMark,
  Escalation,
  EvaluationInstance,
  FinalizationOperation,
  Obligation,
  Resume,
  StageRun,
  TaskIdentity,
  TaskObligation,
  TaskTerminalReport,
  Ticket,
  ValidatedTaskResult,
} from "./generated/modelTypes.ts";
import {
  applyFailure,
  applyProduced,
  begin,
  currentTaskObligations,
  taskCurrent,
  taskIdentityFor,
} from "./evaluation.ts";
import { isSettled } from "./phase.ts";
import {
  taskIdentityEquals,
  taskIdentityValid,
  taskObligationEquals,
  taskObligationValid,
  workTaskOf,
} from "./task.ts";

/**
 * A desk task is open exactly while the ticket is parked, and parked is one
 * phase. Deriving it makes the equivalence hold by construction where storing
 * it would need the equivalence proved.
 */
export function hasOpenHumanTask(ticket: Ticket): boolean {
  return ticket.phase === "Escalated";
}

/**
 * Where each wall resumes, total on the sum, so every park offers the desk
 * exactly one way on and the unparked ticket offers none — which is what
 * lets the resume point stay off the ticket rather than sit beside the wall
 * that implies it. The two work walls and the evaluation-failure wall all buy
 * a new artifact; the blocked wall alone re-asks what it interrupted.
 */
export function resumeOf(escalation: Escalation): Resume {
  switch (escalation) {
    case "NoEscalation":
      return "NoResume";
    case "WorkFailureEscalated":
    case "WorkExecutionUnavailableEscalated":
      return "ResumeWork";
    case "EvaluationFailureEscalated":
      return "ResumeRework";
    case "EvaluationBlockedEscalated":
      return "ResumeEvaluation";
    case "FinalizationUnavailableEscalated":
      return "ResumeFinalization";
  }
}

/**
 * The work spawn: a work cycle is one task, always, so starting the cycle is
 * the only thing that moves the counter its identity is drawn from. The mint
 * counter claims the one slot the task takes, and the cycle has no
 * finalization yet.
 */
export function spawnWork(ticket: Ticket): Ticket {
  return {
    ...ticket,
    workCyclesStarted: ticket.workCyclesStarted + 1,
    spawned: ticket.spawned + 1,
    finalizationGeneration: 0,
  };
}

/**
 * The current instance: the last one, which is the open one exactly while the
 * ticket is in Evaluation or parked at the blocked wall. Callers guarantee the
 * list is non-empty, which every phase that has one does.
 */
export function currentInstance(ticket: Ticket): EvaluationInstance {
  const instance = ticket.evaluations[ticket.evaluations.length - 1];
  if (instance === undefined)
    throw new Error("currentInstance: the ticket has reached no judgement");
  return instance;
}

/** Install an advanced instance in place of the current one; only the last is ever rewritten. */
export function withInstance(
  ticket: Ticket,
  instance: EvaluationInstance,
): Ticket {
  return {
    ...ticket,
    evaluations: [...ticket.evaluations.slice(0, -1), instance],
  };
}

/** Which stage an instance is running, as the index its run stores; -1 when it is not running one. */
export function runningStageIndex(instance: EvaluationInstance): number {
  return instance.state.type === "Running"
    ? instance.state.value.stage.stageIndex
    : -1;
}

/**
 * Every run an instance holds, completed and current — the whole of what it
 * has asked for. A terminal state's list already holds the run that ended it
 * (`concludeStage` appends before it decides), so only the two open states add
 * their current run.
 */
export function instanceRuns(
  instance: EvaluationInstance,
): readonly StageRun[] {
  const state = instance.state;
  switch (state.type) {
    case "Running":
    case "EvaluationBlocked":
      return [...state.value.completedStages, state.value.stage];
    case "EvaluationPassed":
    case "EvaluationFailed":
      return state.value;
  }
}

/** Whether the instance is parked on a wall, which is the state the desk reads. */
export function instanceBlocked(instance: EvaluationInstance): boolean {
  return instance.state.type === "EvaluationBlocked";
}

/**
 * The slots a run claimed: its roster once per generation it has reached. A
 * resume re-asks only the evaluators it reopened but claims the roster again,
 * which is what makes the count a function of the run alone.
 */
export function runSpawnTotal(run: StageRun): number {
  return run.generation * run.evaluators.size;
}

/** The slots every instance of this ticket claimed — the evaluation half of the mint counter. */
export function evaluationSpawnTotal(ticket: Ticket): number {
  return ticket.evaluations.reduce(
    (total, instance) =>
      total +
      instanceRuns(instance).reduce((n, run) => n + runSpawnTotal(run), 0),
    0,
  );
}

/**
 * The evaluation spawn: the mint counter claims one slot per evaluator the
 * running stage LISTS. Claiming the roster rather than the subset asked keeps
 * the counter derivable from the instance; the slots a resume leaves unused
 * are gaps, and a gap costs a monotone mint nothing.
 */
export function spawnEvalRun(ticket: Ticket): Ticket {
  const index = runningStageIndex(currentInstance(ticket));
  const stage = ticket.definition.evaluationPlan.stages[index];
  if (stage === undefined)
    throw new Error("spawnEvalRun: the running stage indexes outside the plan");
  return { ...ticket, spawned: ticket.spawned + stage.evaluators.length };
}

/**
 * The instance an accepted work result opens, over `workResult` — the
 * reference the accepted report carried — with the released plan and the
 * source that result was accepted at. That same reference is the artifact the
 * dependents read and every evaluator obligation's `contextRef`, a judgement
 * being of a result.
 */
export function begunInstance(
  ticket: Ticket,
  workResult: number,
  acceptedSourceRef: number,
): EvaluationInstance {
  return begin(
    ticket.workCyclesStarted,
    { ticket: ticket.definition.id, workResult, acceptedSourceRef },
    ticket.definition.evaluationPlan,
  );
}

/**
 * What this ticket produced, derived: the accepted work result the latest
 * instance judges, and nothing before any work was accepted. Each accepted
 * result opens an instance over itself, so a rework's supersedes the one
 * before it.
 */
export function artifactOf(ticket: Ticket): ArtifactMark {
  if (ticket.evaluations.length === 0) return "NoArtifact";
  return {
    type: "ProducedArtifact",
    value: currentInstance(ticket).input.workResult,
  };
}

/**
 * The finalization attempt this ticket is on: the cycle, the stored
 * generation, and the accepted result and source that cycle's judgement
 * passed. Read only in Finalization and at the finalization wall, where the
 * current instance is the passed one.
 */
export function finalizationOperationOf(ticket: Ticket): FinalizationOperation {
  return {
    workCycle: ticket.workCyclesStarted,
    generation: ticket.finalizationGeneration,
    input: currentInstance(ticket).input.workResult,
    source: ticket.source,
  };
}

/** Whether a finalizer's report answers this attempt; one for an attempt a resume superseded names one nothing owes. */
export function finalizationCurrent(
  operation: FinalizationOperation,
  workCycle: number,
  generation: number,
): boolean {
  return (
    operation.workCycle === workCycle && operation.generation === generation
  );
}

/** Structural equality on a finalization attempt, field for field. */
export function finalizationOperationEquals(
  left: FinalizationOperation,
  right: FinalizationOperation,
): boolean {
  return (
    left.workCycle === right.workCycle &&
    left.generation === right.generation &&
    left.input === right.input &&
    left.source === right.source
  );
}

/**
 * Every task identity an instance has named at the generation its runs now
 * stand at. The generations a resume left behind are deliberately not named:
 * an event about one of their tasks is one nothing owes.
 */
export function instanceTasks(
  instance: EvaluationInstance,
): readonly TaskIdentity[] {
  return instanceRuns(instance).flatMap((run) =>
    [...run.evaluators.keys()]
      .sort((a, b) => a - b)
      .map((evaluator) => taskIdentityFor(instance, run, evaluator)),
  );
}

/**
 * The work obligation: the cycle's own identity, the definition the release
 * pinned for work, and the work cycle as the context reference, which is the
 * scope the application commits the cycle's input bundle under.
 */
export function workTaskObligation(
  ticket: Ticket,
  cycleNumber: number,
): TaskObligation {
  return {
    task: workTaskOf(ticket.definition.id, cycleNumber),
    definition: ticket.definition.workConfiguration,
    contextRef: cycleNumber,
  };
}

/**
 * What the fabric is running for this ticket, as the obligations it owes: the
 * work cycle's one obligation while the ticket is in Work, or the ones the
 * current run still owes. Empty in every other phase, which is what makes
 * leaving a phase enough to stop owing them.
 */
export function liveObligations(ticket: Ticket): readonly TaskObligation[] {
  if (ticket.phase === "Work")
    return [workTaskObligation(ticket, ticket.workCyclesStarted)];
  if (ticket.phase === "Evaluation")
    return currentTaskObligations(currentInstance(ticket));
  return [];
}

/** The tasks the fabric is running for this ticket, in the obligations' order. */
export function liveTasks(ticket: Ticket): readonly TaskIdentity[] {
  return liveObligations(ticket).map((owed) => owed.task);
}

/** Whether this identity is one the ticket is currently owed. */
export function owesTask(ticket: Ticket, task: TaskIdentity): boolean {
  return liveTasks(ticket).some((owed) => taskIdentityEquals(owed, task));
}

/**
 * The exact-obligation rule: an obligation is current for a task when it names
 * that task and is, field for field, one this ticket owes right now. Naming an
 * owed task is not enough — the definition and the context reference are what
 * say which spawn the result answers.
 */
export function obligationCurrent(
  ticket: Ticket,
  task: TaskIdentity,
  obligation: TaskObligation,
): boolean {
  return (
    taskIdentityEquals(obligation.task, task) &&
    liveObligations(ticket).some((owed) =>
      taskObligationEquals(owed, obligation),
    )
  );
}

/**
 * What a live task's result looks like to the machine: the obligation this
 * ticket owes for it and the reference `producedResultRef` derives. This is
 * the CORPUS's constructor and the only place a result reference is derived
 * at all: every decider takes the one its report carried.
 */
export function producedResult(
  ticket: Ticket,
  task: TaskIdentity,
): ValidatedTaskResult {
  const obligation = liveObligations(ticket).find((owed) =>
    taskIdentityEquals(owed.task, task),
  );
  if (obligation === undefined)
    throw new Error("producedResult: the ticket owes this task nothing");
  return { obligation, resultRef: producedResultRef(task) };
}

/**
 * An opaque positive reference derived from a task's own identity, where the
 * real system has a stored row — a piece of failure evidence. The machine's
 * only claim on such a reference is that it exists and tells one evaluator's
 * result from another's in a run.
 */
export function taskRefOf(task: TaskIdentity): number {
  return task.type === "WorkTask" ? task.value.cycle : task.value.evaluator;
}

/** The band a work result's model-scope reference is drawn in. */
const workResultBand = 100;

/**
 * What a produced result's reference is at model scope, where the real system
 * folds the digest of the manifest the task attested. A WORK result takes a
 * band of its own, clear of the cycle that produced it, so no reader mistakes
 * a derivation for the number that travelled.
 */
export function producedResultRef(task: TaskIdentity): number {
  return task.type === "WorkTask"
    ? workResultBand * task.value.ticket + task.value.cycle
    : task.value.evaluator;
}

/** The task a report is about, whichever arm it is. */
export function reportTask(report: TaskTerminalReport): TaskIdentity {
  switch (report.type) {
    case "WorkResultReport":
    case "EvaluationResultReport":
      return report.value.result.obligation.task;
    case "TerminalFailureReport":
      return report.value.failure.task;
  }
}

/** A report is well-formed when every reference it carries is a real one. */
export function reportValid(report: TaskTerminalReport): boolean {
  switch (report.type) {
    case "WorkResultReport":
      return (
        taskObligationValid(report.value.result.obligation) &&
        report.value.result.resultRef > 0 &&
        report.value.acceptedSourceRef > 0
      );
    case "EvaluationResultReport":
      return (
        taskObligationValid(report.value.result.obligation) &&
        report.value.result.resultRef > 0
      );
    case "TerminalFailureReport":
      return (
        taskIdentityValid(report.value.failure.task) &&
        report.value.failure.evidence > 0
      );
  }
}

/**
 * Which reports a task can carry: a work task produces a work result and an
 * evaluator a verdict, each admitted only at the obligation it was spawned
 * under, while a failure is admitted when it names the task the completion
 * names, carrying no result to hold against an obligation.
 */
export function reportMatchesTask(
  ticket: Ticket,
  task: TaskIdentity,
  report: TaskTerminalReport,
): boolean {
  switch (report.type) {
    case "WorkResultReport":
      return (
        task.type === "WorkTask" &&
        obligationCurrent(ticket, task, report.value.result.obligation)
      );
    case "EvaluationResultReport":
      return (
        task.type === "EvaluationTask" &&
        obligationCurrent(ticket, task, report.value.result.obligation)
      );
    case "TerminalFailureReport":
      return taskIdentityEquals(report.value.failure.task, task);
  }
}

/**
 * The report applied to an instance: a produced result goes to `applyProduced`
 * whole, which is what lets the protocol hold it against the obligation it
 * owes, and a failure becomes the terminal for its kind. Nothing here
 * decides — the protocol concludes the stage itself.
 */
export function applyEvaluationReport(
  instance: EvaluationInstance,
  report: TaskTerminalReport,
): EvaluationInstance {
  switch (report.type) {
    case "EvaluationResultReport":
      return applyProduced(
        instance,
        report.value.result.obligation.task,
        report.value.result,
        report.value.verdict,
      );
    case "TerminalFailureReport":
      return applyFailure(
        instance,
        report.value.failure.task,
        report.value.kind,
        report.value.failure.evidence,
      );
    case "WorkResultReport":
      return instance;
  }
}

/** An evaluation event applies only to the instance still owing its reported task. */
export function reportAdmissible(
  instance: EvaluationInstance,
  report: TaskTerminalReport,
): boolean {
  return taskCurrent(instance, reportTask(report));
}

/** Run a work cycle's task, under the obligation the cycle owes. */
export function executeWork(ticket: Ticket, cycleNumber: number): Obligation {
  return {
    type: "ExecuteTask",
    value: {
      ticket: ticket.definition.id,
      task: workTaskObligation(ticket, cycleNumber),
    },
  };
}

/** Run every evaluator an instance's current run still owes, in the roster's order. */
export function executeEvaluationTasks(
  ticket: number,
  instance: EvaluationInstance,
): readonly Obligation[] {
  return currentTaskObligations(instance).map(
    (task): Obligation => ({ type: "ExecuteTask", value: { ticket, task } }),
  );
}

/** Attempt a finalization, under the configuration the release pinned. */
export function finalize(
  ticket: Ticket,
  operation: FinalizationOperation,
): Obligation {
  return {
    type: "FinalizeTicket",
    value: {
      ticket: ticket.definition.id,
      finalization: operation,
      configuration: ticket.definition.finalizationConfiguration,
    },
  };
}

/** Stop every task the fabric is running for this ticket. */
export function cancelLiveTasks(ticket: Ticket): readonly Obligation[] {
  return liveTasks(ticket).map(
    (task): Obligation => ({
      type: "CancelTask",
      value: { ticket: ticket.definition.id, task },
    }),
  );
}

/**
 * How many reworks a failing evaluation has cost this ticket, read off its
 * instances rather than carried: a judgement that ended failed, with a later
 * cycle started above it, bought that cycle, and both edges of a failing stage
 * count, the escalate arm's resume buying the same cycle one human later.
 */
export function evaluationFailureReworksStarted(ticket: Ticket): number {
  return ticket.evaluations.filter(
    (instance) =>
      instance.state.type === "EvaluationFailed" &&
      instance.workCycle < ticket.workCyclesStarted,
  ).length;
}

/** Whether this ticket has reached one of the absorbing terminals. */
export function ticketIsSettled(ticket: Ticket): boolean {
  return isSettled(ticket.phase);
}
