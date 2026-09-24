/**
 * What a ticket does with its own record, and the ledger chuggy keeps beside
 * it: `model/ticket.qnt`, the package's part first and chuggy's after it.
 *
 * The record is the package's four fields and nothing else. What it forgets
 * and chuggy still reads — the instances that have closed, the mint counter,
 * the completion ghost — is the `TicketLedger`, folded beside the graph from
 * the same events (`src/domain/ledger.ts`); `decide` never reads it and
 * `evolve` never moves it. The artifact is not stored at all: it is the
 * result the latest instance judges (`artifactOf`).
 */

import type {
  ArtifactMark,
  EvaluationInstance,
  EvaluationReworkEntry,
  FinalizationOperation,
  FinalizationResult,
  Obligation,
  ReleasedTicket,
  Resume,
  StageRun,
  TaskIdentity,
  TaskObligation,
  TaskTerminalReport,
  Ticket,
  TicketGraph,
  TicketLedger,
  TicketState,
  ValidatedTaskResult,
  WorkInput,
} from "./generated/modelTypes.ts";
import {
  applyFailure,
  applyProduced,
  currentTaskObligations,
  planValid,
  taskCurrent,
  taskIdentityFor,
} from "./evaluation.ts";
import { isEscalated, isPending } from "./phase.ts";
import {
  taskDefinitionValid,
  taskIdentityEquals,
  taskIdentityValid,
  taskObligationValid,
  workTaskIdentity,
} from "./task.ts";
import { ticketAt } from "./ticketGraph.ts";
import { asTicketId } from "./ids.ts";

/** The package's `releasedContentValid`. */
export function releasedContentValid(content: number): boolean {
  return content > 0;
}

/** The release's own rule, the package's: every reference real and the plan one the protocol runs. */
export function releasedTicketValid(definition: ReleasedTicket): boolean {
  return (
    definition.id > 0 &&
    releasedContentValid(definition.content) &&
    [...definition.dependencies].every((d) => d > 0) &&
    taskDefinitionValid(definition.workConfiguration) &&
    planValid(definition.evaluationPlan) &&
    definition.finalizationConfiguration > 0
  );
}

/** A finalizer's result is well-formed when its evidence is a real reference. */
export function finalizationResultValid(result: FinalizationResult): boolean {
  return result.value > 0;
}

/** The ticket a report is for, whichever arm it is. */
export function reportTicket(report: TaskTerminalReport): number {
  return report.value.ticket;
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
        report.value.ticket > 0 &&
        taskObligationValid(report.value.result.obligation) &&
        report.value.result.resultRef > 0 &&
        report.value.acceptedSourceRef > 0
      );
    case "EvaluationResultReport":
      return (
        report.value.ticket > 0 &&
        taskObligationValid(report.value.result.obligation) &&
        report.value.result.resultRef > 0
      );
    case "TerminalFailureReport":
      return (
        report.value.ticket > 0 &&
        taskIdentityValid(report.value.failure.task) &&
        report.value.failure.evidence > 0
      );
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

/** The first cycle's input: the released content, and nothing to retry. */
export function initialWorkInput(definition: ReleasedTicket): WorkInput {
  return {
    released: definition.content,
    cause: "InitialWork",
    retryEvidence: [],
  };
}

/** The input a work wall resumes with: the one it stopped, plus the evidence of why. */
export function retryWorkInput(input: WorkInput, evidence: number): WorkInput {
  return { ...input, retryEvidence: [...input.retryEvidence, evidence] };
}

/** The cycle a new work spawn starts. */
export function nextCycleNumber(ticket: Ticket): number {
  return ticket.workCyclesStarted + 1;
}

/** The input a failed evaluation's rework runs with. */
export function evaluationReworkInput(
  definition: ReleasedTicket,
  entries: readonly EvaluationReworkEntry[],
): WorkInput {
  return {
    released: definition.content,
    cause: { type: "EvaluationRework", value: entries },
    retryEvidence: [],
  };
}

/** The input a finalizer's rework runs with. */
export function finalizationReworkInput(
  definition: ReleasedTicket,
  evidence: number,
): WorkInput {
  return {
    released: definition.content,
    cause: { type: "FinalizationRework", value: evidence },
    retryEvidence: [],
  };
}

/**
 * The work obligation: the cycle's own identity, the definition the release
 * pinned for work, and the work cycle as the context reference. The package
 * also passes the cycle's source and input here and to `executeWork`, and
 * neither reads them, so this mirror does not take them.
 */
export function workTaskObligation(
  ticket: Ticket,
  cycleNumber: number,
): TaskObligation {
  return {
    task: workTaskIdentity(ticket.definition.id, cycleNumber),
    definition: ticket.definition.workConfiguration,
    contextRef: cycleNumber,
  };
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

/** The attempt a finalization resume starts: the same one, a generation on. */
export function resumedFinalization(
  operation: FinalizationOperation,
): FinalizationOperation {
  return { ...operation, generation: operation.generation + 1 };
}

/** Whether a finalizer's report answers this attempt. */
export function finalizationCurrent(
  operation: FinalizationOperation,
  workCycle: number,
  generation: number,
): boolean {
  return (
    operation.workCycle === workCycle && operation.generation === generation
  );
}

/** Run every evaluator an instance's current run still owes, in the roster's order. */
export function executeEvaluationTasks(
  ticket: number,
  instance: EvaluationInstance,
): readonly Obligation[] {
  return currentTaskObligations(instance).map((task): Obligation => ({
    type: "ExecuteTask",
    value: { ticket, task },
  }));
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

/** Whether a dependency is Done. */
export function dependencyComplete(
  graph: TicketGraph,
  dependency: number,
): boolean {
  return ticketAt(graph, asTicketId(dependency)).state === "Done";
}

/** The dependencies of this ticket that are not Done, which is what a refused dispatch names. */
export function incompleteDependencies(
  graph: TicketGraph,
  ticket: Ticket,
): ReadonlySet<number> {
  return new Set(
    [...ticket.definition.dependencies].filter(
      (d) => !dependencyComplete(graph, d),
    ),
  );
}

/** Whether every dependency of this ticket is Done. */
export function dependenciesComplete(
  graph: TicketGraph,
  ticket: Ticket,
): boolean {
  return incompleteDependencies(graph, ticket).size === 0;
}

/** The derived waiting room: released, Pending, with every dependency Done. */
export function isReady(graph: TicketGraph, id: number): boolean {
  const ticket = graph.tickets.get(id);
  return (
    ticket !== undefined &&
    isPending(ticket.state) &&
    dependenciesComplete(graph, ticket)
  );
}

/** The tasks the fabric is running for this ticket, in the obligations' order. */
export function liveTaskList(ticket: Ticket): readonly TaskIdentity[] {
  const state = ticket.state;
  if (state === "Pending" || state === "Done" || state === "Revoked") return [];
  switch (state.type) {
    case "Work":
      return [workTaskIdentity(ticket.definition.id, ticket.workCyclesStarted)];
    case "Evaluation":
      return currentTaskObligations(state.value).map((owed) => owed.task);
    case "Finalization":
    case "Escalated":
      return [];
  }
}

/** Whether a list holds this task. */
export function listHasTask(
  tasks: readonly TaskIdentity[],
  task: TaskIdentity,
): boolean {
  return tasks.some((owed) => taskIdentityEquals(owed, task));
}

/** Stop every task the fabric is running for this ticket. */
export function cancelLiveTasks(ticket: Ticket): readonly Obligation[] {
  return liveTaskList(ticket).map((task): Obligation => ({
    type: "CancelTask",
    value: { ticket: ticket.definition.id, task },
  }));
}

/**
 * Where each wall resumes, total on the state, so every park offers the desk
 * exactly one way on and every other state offers none. The two work walls
 * and the evaluation-failure wall all buy a new artifact; the blocked wall
 * alone re-asks what it interrupted.
 */
export function resumeOf(state: TicketState): Resume {
  if (typeof state === "string" || state.type !== "Escalated")
    return "NoResume";
  switch (state.value.type) {
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

/** A desk task is open exactly while the ticket is parked. */
export function hasOpenHumanTask(ticket: Ticket): boolean {
  return isEscalated(ticket.state);
}

/** A released ticket's ledger: nothing judged, nothing claimed. */
export const emptyLedger: TicketLedger = {
  closedEvaluations: [],
  spawned: 0,
  completions: 0,
};

/** The instance a state holds open: the one judging, or the one the blocked wall saved. */
export function heldInstances(
  state: TicketState,
): readonly EvaluationInstance[] {
  if (typeof state === "string") return [];
  if (state.type === "Evaluation") return [state.value];
  if (
    state.type === "Escalated" &&
    state.value.type === "EvaluationBlockedEscalated"
  )
    return [state.value.value];
  return [];
}

/** Every instance this ticket has opened, in the order its cycles ran: the closed ones, then the open one. */
export function ledgerInstances(
  ticket: Ticket,
  ledger: TicketLedger,
): readonly EvaluationInstance[] {
  return [...ledger.closedEvaluations, ...heldInstances(ticket.state)];
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

/** Whether the instance is parked on a wall. */
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

/** The slots a list of instances claimed — the evaluation half of the mint counter. */
export function evaluationSpawnTotal(
  instances: readonly EvaluationInstance[],
): number {
  return instances.reduce(
    (total, instance) =>
      total +
      instanceRuns(instance).reduce((n, run) => n + runSpawnTotal(run), 0),
    0,
  );
}

/**
 * What this ticket produced, derived: the accepted work result the latest
 * instance judges, and nothing before any work was accepted. Each accepted
 * result opens an instance over itself, so a rework's supersedes the one
 * before it.
 */
export function artifactOf(ticket: Ticket, ledger: TicketLedger): ArtifactMark {
  const instances = ledgerInstances(ticket, ledger);
  const latest = instances[instances.length - 1];
  if (latest === undefined) return "NoArtifact";
  return { type: "ProducedArtifact", value: latest.input.workResult };
}

/** The finalization attempt a ticket is on: the one it runs, or the one its wall stopped. */
export function finalizationOf(
  ticket: Ticket,
): FinalizationOperation | undefined {
  const state = ticket.state;
  if (typeof state === "string") return undefined;
  if (state.type === "Finalization") return state.value;
  if (
    state.type === "Escalated" &&
    state.value.type === "FinalizationUnavailableEscalated"
  )
    return state.value.value.finalization;
  return undefined;
}

/** The generation of that attempt, and 0 where there is none (the model's `attemptGeneration`). */
export function attemptGeneration(ticket: Ticket): number {
  return finalizationOf(ticket)?.generation ?? 0;
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
 * What the fabric is running for this ticket, as the obligations it owes: the
 * work cycle's one obligation while the ticket is in Work, or the ones the
 * current run still owes. Empty in every other state, which is what makes
 * leaving a state enough to stop owing them.
 */
export function liveObligations(ticket: Ticket): readonly TaskObligation[] {
  const state = ticket.state;
  if (typeof state === "string") return [];
  if (state.type === "Work")
    return [workTaskObligation(ticket, ticket.workCyclesStarted)];
  if (state.type === "Evaluation") return currentTaskObligations(state.value);
  return [];
}

/** The tasks the fabric is running for this ticket, in the obligations' order. */
export function liveTasks(ticket: Ticket): readonly TaskIdentity[] {
  return liveObligations(ticket).map((owed) => owed.task);
}

/** Whether this identity is one the ticket is currently owed. */
export function owesTask(ticket: Ticket, task: TaskIdentity): boolean {
  return listHasTask(liveTasks(ticket), task);
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

/**
 * How many reworks a failing evaluation has cost this ticket, read off its
 * closed instances: a judgement that ended failed, with a later cycle started
 * above it, bought that cycle, and both edges of a failing stage count, the
 * escalate arm's resume buying the same cycle one human later.
 */
export function evaluationFailureReworksStarted(
  ticket: Ticket,
  ledger: TicketLedger,
): number {
  return ledger.closedEvaluations.filter(
    (instance) =>
      instance.state.type === "EvaluationFailed" &&
      instance.workCycle < ticket.workCyclesStarted,
  ).length;
}
