/**
 * What a ticket does with its own fields: what a park implies, the one site
 * that moves its task set, and the instances that hold its judgements.
 *
 * `completions` is a stored ghost here as it is in the model rather than
 * reconstructed from the phase — a stored duplicate of a derivable fact is a
 * finding, and this one is the model's own accounting, carried so a golden
 * state compares field for field.
 */

import type {
  Escalation,
  EvaluationInstance,
  EvaluationVerdict,
  Resume,
  StageRun,
  Task,
  TaskIdentity,
  TaskResultRef,
  TaskTerminalReport,
  Ticket,
} from "./generated/modelTypes.ts";
import {
  applyFailure,
  applyProduced,
  begin,
  currentTaskObligations,
  taskIdentityFor,
} from "./evaluation.ts";
import { isSettled } from "./phase.ts";
import { taskIdentityEquals, workTaskOf } from "./task.ts";

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
 * exactly one continuation and the unparked ticket offers none — which is what
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
 * The work spawn: a work cycle is one task, always. Work is not staged and
 * lists no evaluators, so the only fan-out left is an evaluation stage's
 * roster, and every work spawn site is this call — which is also the only
 * thing that claims the one mint slot its identity is drawn from.
 */
export function spawnWork(ticket: Ticket, id: number): Ticket {
  const cycle = ticket.workCyclesStarted + 1;
  return {
    ...ticket,
    tasks: new Set<Task>([
      { identity: workTaskOf(id, cycle), state: "Outstanding" },
    ]),
    workCyclesStarted: cycle,
    spawned: ticket.spawned + 1,
  };
}

/**
 * Retire the live work task: a phase that has stopped running carries no live
 * task, and one still outstanding when its ticket parks or is revoked is one
 * the world is told to cancel. Evaluation needs no retirement at all, its
 * obligations being derived from the running stage.
 */
export function retireLive(ticket: Ticket): Ticket {
  return { ...ticket, tasks: new Set<Task>() };
}

/** Did the work cycle produce? Work is one task, so the cycle's outcome is that task's. */
export function workProduced(tasks: ReadonlySet<Task>): boolean {
  return [...tasks].every(
    (t) => t.state !== "Outstanding" && t.state.value === "Passed",
  );
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
  const stage = ticket.program[index];
  if (stage === undefined)
    throw new Error(
      "spawnEvalRun: the running stage indexes outside the program",
    );
  return { ...ticket, spawned: ticket.spawned + stage.evaluators.length };
}

/**
 * Work passed, so judgement begins: the artifact the cycle produced is the
 * mint counter's current value, the instance is opened over it with the
 * ticket's authored program as its plan, and its first stage is asked. One
 * instance per work cycle that gets this far.
 */
export function beginEvaluation(ticket: Ticket, id: number): Ticket {
  const artifact = ticket.spawned;
  return spawnEvalRun({
    ...ticket,
    artifact: { type: "ProducedArtifact", value: artifact },
    evaluations: [
      ...ticket.evaluations,
      begin(
        ticket.workCyclesStarted,
        { ticket: id, workResult: artifact },
        { stages: ticket.program },
      ),
    ],
  });
}

/**
 * Every task identity an instance has named at the generation its runs now
 * stand at. The generations a resume left behind are not recoverable and are
 * deliberately not named: an earlier generation's completion is stale, and
 * staleness is absorbed by identity without the machine enumerating it.
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
 * The tasks the fabric is running for this ticket: the work task while it is
 * outstanding, or the obligations the current run still owes. Empty in every
 * other phase, which is what makes leaving a phase enough to stop owing them.
 */
export function liveTasks(ticket: Ticket): readonly TaskIdentity[] {
  if (ticket.phase === "Work")
    return [...ticket.tasks]
      .filter((t) => t.state === "Outstanding")
      .map((t) => t.identity);
  if (ticket.phase === "Evaluation")
    return currentTaskObligations(currentInstance(ticket));
  return [];
}

/** Whether this identity is one the ticket is currently owed. */
export function owesTask(ticket: Ticket, task: TaskIdentity): boolean {
  return liveTasks(ticket).some((owed) => taskIdentityEquals(owed, task));
}

/**
 * An opaque positive reference derived from a task's own identity, where the
 * real system has a stored row. The machine's only claim on such a reference
 * is that it exists and tells one evaluator's result from another's in a run.
 */
export function taskRefOf(task: TaskIdentity): number {
  return task.type === "WorkTask" ? task.value.cycle : task.value.evaluator;
}

export function taskResultRefOf(task: TaskIdentity): TaskResultRef {
  const ref = taskRefOf(task);
  return { manifest: ref, digest: ref, schema: ref };
}

/** The one reference the protocol reads out of a result triple. */
export function resultReference(result: TaskResultRef): number {
  return result.manifest;
}

export function taskResultRefValid(result: TaskResultRef): boolean {
  return result.manifest > 0 && result.digest > 0 && result.schema > 0;
}

/** A report is well-formed when every reference it carries is a real one. */
export function reportValid(report: TaskTerminalReport): boolean {
  switch (report.type) {
    case "WorkResultReport":
    case "EvaluationResultReport":
      return taskResultRefValid(report.value.result);
    case "TerminalFailureReport":
      return report.value.evidence > 0;
  }
}

/**
 * Which reports a task can carry: a work task produces a work result, an
 * evaluator produces a verdict, and either can fail to produce anything.
 * Stated here because it is the completion's enablement rather than something
 * a decider defends against mid-flight.
 */
export function reportMatchesTask(
  task: TaskIdentity,
  report: TaskTerminalReport,
): boolean {
  switch (report.type) {
    case "WorkResultReport":
      return task.type === "WorkTask";
    case "EvaluationResultReport":
      return task.type === "EvaluationTask";
    case "TerminalFailureReport":
      return true;
  }
}

/**
 * The report applied to an instance: a produced result carries its reference
 * and verdict into `applyProduced`, and a failure becomes the terminal for its
 * kind. Nothing here decides — the protocol concludes the stage itself.
 */
export function applyTaskReport(
  instance: EvaluationInstance,
  task: TaskIdentity,
  report: TaskTerminalReport,
): EvaluationInstance {
  switch (report.type) {
    case "EvaluationResultReport":
      return applyProduced(
        instance,
        task,
        resultReference(report.value.result),
        report.value.verdict satisfies EvaluationVerdict,
      );
    case "TerminalFailureReport":
      return applyFailure(
        instance,
        task,
        report.value.kind,
        report.value.evidence,
      );
    case "WorkResultReport":
      return instance;
  }
}

/**
 * How many reworks a failing evaluation has cost this ticket, read off its
 * instances rather than carried, which would be a stored duplicate: a
 * judgement that ended failed, with a later cycle started above it, bought
 * that cycle, and both edges of a failing stage count, the escalate arm's
 * resume buying the same cycle one human later.
 *
 * The model declares no cap of its own, how many being a policy rather than a
 * rule about what the machine may do.
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
