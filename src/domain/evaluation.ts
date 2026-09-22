/**
 * The evaluation protocol, one function per definition in
 * `model/ticket-domain/evaluation/evaluation.qnt`.
 *
 * THAT FILE IS A COPY OF THE PACKAGE'S, and this is its mirror: the ticket
 * does not restate any of it, and every decider that advances an instance
 * goes through the entries here. What a stage means, when it has concluded
 * and what a resume re-asks are the protocol's answers, not chuggy's.
 *
 * ONE SPELLING DIFFERS. The model's `applyFailure` takes the task contract's
 * `TaskTerminal`, a sum whose two failing arms carry `{task, evidence}` and
 * nothing else; `api.qnt` does not export that sum, so the failure arrives
 * here as the kind and the evidence the arm would have held. The arms are the
 * same two and the evidence is the same number, so no decision moves.
 */

import type {
  EvaluationInstance,
  EvaluationPlan,
  EvaluationInput,
  EvaluationReworkEntry,
  EvaluationVerdict,
  EvaluatorStatus,
  FailureKind,
  StageDefinition,
  StageRun,
  TaskIdentity,
} from "./generated/modelTypes.ts";
import { evaluationTaskOf, taskIdentityEquals } from "./task.ts";

/** The evaluator keys a stage lists, which is what a run of it is keyed by. */
export function evaluatorKeys(stage: StageDefinition): ReadonlySet<number> {
  return new Set(stage.evaluators.map((entry) => entry.key));
}

/** The stage a run is running, read out of the plan by the index the run stores. */
function stageOf(instance: EvaluationInstance, run: StageRun): StageDefinition {
  const stage = instance.plan.stages[run.stageIndex];
  if (stage === undefined)
    throw new Error(
      `evaluation: stage ${String(run.stageIndex)} is outside a plan of ${String(instance.plan.stages.length)}`,
    );
  return stage;
}

/**
 * The identity one evaluator of one run answers under: the stage's own key
 * and the run's generation, so a re-ask is a different task from the attempt
 * infrastructure stopped.
 */
export function taskIdentityFor(
  instance: EvaluationInstance,
  run: StageRun,
  evaluator: number,
): TaskIdentity {
  return evaluationTaskOf(
    instance.input.ticket,
    instance.workCycle,
    stageOf(instance, run).key,
    run.generation,
    evaluator,
  );
}

/** A stage asked for the first time: its whole roster awaiting, at generation one. */
export function initialStageRun(
  stage: StageDefinition,
  stageIndex: number,
): StageRun {
  return {
    stageIndex,
    generation: 1,
    evaluators: new Map(stage.evaluators.map((entry) => [entry.key, "Awaiting"])),
  };
}

export function statusAwaiting(status: EvaluatorStatus): boolean {
  return status === "Awaiting";
}

export function statusFailed(status: EvaluatorStatus): boolean {
  return (
    status !== "Awaiting" &&
    status.type === "Produced" &&
    status.value.type === "EvaluatorFailed"
  );
}

/**
 * A stopped evaluator, either way it was stopped: a process that died with the
 * fabric's relaunches behind it and infrastructure that never ran it are both
 * absences of an answer. Both leave the judgement to be made, which is what
 * makes the blocked park a different edge from the rework.
 */
export function statusBlocked(status: EvaluatorStatus): boolean {
  return (
    status !== "Awaiting" &&
    (status.type === "EvaluatorProcessFailed" ||
      status.type === "EvaluatorExecutionUnavailable")
  );
}

function anyStatus(
  run: StageRun,
  holds: (status: EvaluatorStatus) => boolean,
): boolean {
  return [...run.evaluators.values()].some(holds);
}

export function stageHasAwaiting(run: StageRun): boolean {
  return anyStatus(run, statusAwaiting);
}

export function stageHasFailed(run: StageRun): boolean {
  return anyStatus(run, statusFailed);
}

export function stageHasBlocked(run: StageRun): boolean {
  return anyStatus(run, statusBlocked);
}

/** A stage passes when every evaluator in it answered, and every answer passed. */
export function stagePassed(run: StageRun): boolean {
  return (
    !stageHasAwaiting(run) && !stageHasFailed(run) && !stageHasBlocked(run)
  );
}

/** The run an instance is on, or nothing when it is not running one. */
function runningRun(instance: EvaluationInstance): StageRun | undefined {
  return instance.state.type === "Running" ? instance.state.value.stage : undefined;
}

/** Whether this task is one the running stage is still waiting on. */
function taskCurrent(
  instance: EvaluationInstance,
  task: TaskIdentity,
): boolean {
  const run = runningRun(instance);
  if (run === undefined) return false;
  return [...run.evaluators].some(
    ([evaluator, status]) =>
      statusAwaiting(status) &&
      taskIdentityEquals(taskIdentityFor(instance, run, evaluator), task),
  );
}

/** Which evaluator of the running stage this task is, which the roster decides. */
function evaluatorKeyForTask(
  instance: EvaluationInstance,
  run: StageRun,
  task: TaskIdentity,
): number {
  const entry = stageOf(instance, run).evaluators.find((candidate) =>
    taskIdentityEquals(taskIdentityFor(instance, run, candidate.key), task),
  );
  if (entry === undefined)
    throw new Error("evaluation: the task names no evaluator of this stage");
  return entry.key;
}

/** Set one evaluator's status in the running stage, leaving everything else. */
function withStatus(
  instance: EvaluationInstance,
  task: TaskIdentity,
  status: EvaluatorStatus,
): EvaluationInstance {
  if (instance.state.type !== "Running" || !taskCurrent(instance, task))
    return instance;
  const running = instance.state.value;
  const evaluator = evaluatorKeyForTask(instance, running.stage, task);
  const evaluators = new Map(running.stage.evaluators);
  evaluators.set(evaluator, status);
  return {
    ...instance,
    state: {
      type: "Running",
      value: { ...running, stage: { ...running.stage, evaluators } },
    },
  };
}

/**
 * The stage is asked whether it has concluded and what it concluded, and
 * nothing else in the protocol moves an instance's state. An answer beats a
 * stopped evaluator — a verdict is a judgement and a wall is not — and a
 * stage that has passed either finishes the plan or asks the next one.
 */
export function concludeStage(instance: EvaluationInstance): EvaluationInstance {
  if (instance.state.type !== "Running") return instance;
  const running = instance.state.value;
  const run = running.stage;
  const completed = [...running.completedStages, run];
  if (stageHasAwaiting(run)) return instance;
  if (stageHasFailed(run))
    return { ...instance, state: { type: "EvaluationFailed", value: completed } };
  if (stageHasBlocked(run))
    return { ...instance, state: { type: "EvaluationBlocked", value: running } };
  const nextIndex = run.stageIndex + 1;
  const next = instance.plan.stages[nextIndex];
  if (next === undefined)
    return { ...instance, state: { type: "EvaluationPassed", value: completed } };
  return {
    ...instance,
    state: {
      type: "Running",
      value: {
        completedStages: completed,
        stage: initialStageRun(next, nextIndex),
      },
    },
  };
}

/** The obligations the running stage still owes, in the roster's own order. */
export function currentTaskObligations(
  instance: EvaluationInstance,
): readonly TaskIdentity[] {
  const run = runningRun(instance);
  if (run === undefined) return [];
  return stageOf(instance, run)
    .evaluators.filter((entry) =>
      statusAwaiting(run.evaluators.get(entry.key) ?? "Awaiting"),
    )
    .map((entry) => taskIdentityFor(instance, run, entry.key));
}

/** Whether this task is one the instance is currently owed, by identity. */
function owed(instance: EvaluationInstance, task: TaskIdentity): boolean {
  return currentTaskObligations(instance).some((obligation) =>
    taskIdentityEquals(obligation, task),
  );
}

/**
 * An evaluator answered. The verdict becomes its result, and the stage is
 * asked whether that concluded it — an answer to a task nothing is waiting on
 * changes nothing, which is the idempotence an at-least-once fabric demands.
 */
export function applyProduced(
  instance: EvaluationInstance,
  task: TaskIdentity,
  result: number,
  verdict: EvaluationVerdict,
): EvaluationInstance {
  if (!owed(instance, task)) return instance;
  return concludeStage(
    withStatus(instance, task, {
      type: "Produced",
      value: {
        type: verdict === "EvaluatorPass" ? "EvaluatorPassed" : "EvaluatorFailed",
        value: result,
      },
    }),
  );
}

/**
 * An evaluator was stopped rather than answering. It is marked with what
 * stopped it and the stage runs on: its siblings are still judging, and
 * whether the ticket parks is the stage's own decision once they finish.
 */
export function applyFailure(
  instance: EvaluationInstance,
  task: TaskIdentity,
  kind: FailureKind,
  evidence: number,
): EvaluationInstance {
  return concludeStage(
    withStatus(instance, task, {
      type:
        kind === "ProcessFailure"
          ? "EvaluatorProcessFailed"
          : "EvaluatorExecutionUnavailable",
      value: evidence,
    }),
  );
}

/**
 * The blocked stage comes back, at the next generation, owing exactly the
 * evaluators that were stopped. The ones that answered keep what they said,
 * which is what makes this a re-ask rather than a fresh fan-out.
 */
export function resumeBlocked(
  instance: EvaluationInstance,
): EvaluationInstance {
  if (instance.state.type !== "EvaluationBlocked") return instance;
  const unavailable = instance.state.value;
  const evaluators = new Map(unavailable.stage.evaluators);
  for (const [evaluator, status] of unavailable.stage.evaluators)
    if (statusBlocked(status)) evaluators.set(evaluator, "Awaiting");
  return {
    ...instance,
    state: {
      type: "Running",
      value: {
        ...unavailable,
        stage: {
          ...unavailable.stage,
          generation: unavailable.stage.generation + 1,
          evaluators,
        },
      },
    },
  };
}

/**
 * What a rework is owed an account of: the evaluators of the stage that
 * failed, and what each of them produced. The cause an implementation hands
 * to the next work cycle.
 */
export function reworkEntries(
  instance: EvaluationInstance,
  completedStages: readonly StageRun[],
): readonly EvaluationReworkEntry[] {
  const completed = completedStages[completedStages.length - 1];
  if (completed === undefined) return [];
  return stageOf(instance, completed)
    .evaluators.flatMap((entry) => {
      const status = completed.evaluators.get(entry.key);
      if (status === undefined || !statusFailed(status)) return [];
      if (status === "Awaiting" || status.type !== "Produced") return [];
      return [{ evaluator: entry.key, resultRef: status.value.value }];
    });
}

/** Judgement begins: the plan's lowest stage is asked over the artifact named. */
export function begin(
  workCycle: number,
  input: EvaluationInput,
  plan: EvaluationPlan,
): EvaluationInstance {
  const first = plan.stages[0];
  if (first === undefined)
    throw new Error("evaluation: a plan with no stages cannot begin");
  return {
    workCycle,
    input,
    plan,
    state: {
      type: "Running",
      value: { completedStages: [], stage: initialStageRun(first, 0) },
    },
  };
}

function sameKeys(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): boolean {
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/** Every reference a settled status carries is a real one. */
function statusValid(status: EvaluatorStatus): boolean {
  if (status === "Awaiting") return true;
  if (status.type === "Produced") return status.value.value > 0;
  return status.value > 0;
}

function stageRunValid(
  instance: EvaluationInstance,
  run: StageRun,
): boolean {
  if (run.stageIndex < 0 || run.stageIndex >= instance.plan.stages.length)
    return false;
  const defined = evaluatorKeys(stageOf(instance, run));
  return (
    run.generation > 0 &&
    sameKeys(new Set(run.evaluators.keys()), defined) &&
    [...run.evaluators.values()].every(statusValid)
  );
}

/**
 * A completed history: each run at the index it belongs to, every one of them
 * answered, and every one but the last a pass — the last being the stage that
 * ended the instance.
 */
function completedHistoryValid(
  instance: EvaluationInstance,
  completedStages: readonly StageRun[],
): boolean {
  return completedStages.every(
    (run, index) =>
      run.stageIndex === index &&
      stageRunValid(instance, run) &&
      !stageHasAwaiting(run) &&
      (index + 1 === completedStages.length || stagePassed(run)),
  );
}

function stateHistoryValid(instance: EvaluationInstance): boolean {
  const state = instance.state;
  switch (state.type) {
    case "Running":
      return (
        completedHistoryValid(instance, state.value.completedStages) &&
        stageRunValid(instance, state.value.stage) &&
        state.value.completedStages.length === state.value.stage.stageIndex &&
        stageHasAwaiting(state.value.stage)
      );
    case "EvaluationPassed":
      return (
        completedHistoryValid(instance, state.value) &&
        state.value.length === instance.plan.stages.length &&
        state.value.every(stagePassed)
      );
    case "EvaluationFailed": {
      const last = state.value[state.value.length - 1];
      return (
        completedHistoryValid(instance, state.value) &&
        last !== undefined &&
        stageHasFailed(last)
      );
    }
    case "EvaluationBlocked":
      return (
        completedHistoryValid(instance, state.value.completedStages) &&
        stageRunValid(instance, state.value.stage) &&
        !stageHasAwaiting(state.value.stage) &&
        !stageHasFailed(state.value.stage) &&
        stageHasBlocked(state.value.stage) &&
        state.value.completedStages.length === state.value.stage.stageIndex
      );
  }
}

/** A plan the protocol will run: stages and rosters non-empty, keys unique and positive. */
export function planValid(plan: EvaluationPlan): boolean {
  const stageKeys = plan.stages.map((stage) => stage.key);
  return (
    plan.stages.length > 0 &&
    new Set(stageKeys).size === stageKeys.length &&
    plan.stages.every((stage) => {
      const keys = stage.evaluators.map((entry) => entry.key);
      return (
        stage.key > 0 &&
        keys.length > 0 &&
        new Set(keys).size === keys.length &&
        keys.every((key) => key > 0)
      );
    })
  );
}

/** The protocol's own invariant, which every instance on every ticket satisfies. */
export function instanceValid(instance: EvaluationInstance): boolean {
  return (
    instance.workCycle > 0 &&
    instance.input.ticket > 0 &&
    instance.input.workResult > 0 &&
    planValid(instance.plan) &&
    stateHistoryValid(instance)
  );
}

/**
 * Structural equality over the protocol's own shapes, written out because
 * `node:util`'s deep compare sits outside the layers that need it
 * (`.dependency-cruiser.cjs`). Every entry below is a conjunction over its
 * shape's declared fields, which `test/actor/equality.test.ts` holds to a
 * `Record<keyof Shape, ...>` roster.
 */
export function stageDefinitionEquals(
  left: StageDefinition,
  right: StageDefinition,
): boolean {
  return (
    left.key === right.key &&
    left.evaluators.length === right.evaluators.length &&
    left.evaluators.every(
      (entry, index) => entry.key === right.evaluators[index]?.key,
    )
  );
}

export function stagesEqual(
  left: readonly StageDefinition[],
  right: readonly StageDefinition[],
): boolean {
  return (
    left.length === right.length &&
    left.every((stage, index) => {
      const other = right[index];
      return other !== undefined && stageDefinitionEquals(stage, other);
    })
  );
}

export function evaluatorStatusEquals(
  left: EvaluatorStatus,
  right: EvaluatorStatus,
): boolean {
  if (left === "Awaiting") return right === "Awaiting";
  if (right === "Awaiting" || left.type !== right.type) return false;
  if (left.type === "Produced")
    return (
      right.type === "Produced" &&
      left.value.type === right.value.type &&
      left.value.value === right.value.value
    );
  return left.value === right.value;
}

export function stageRunEquals(left: StageRun, right: StageRun): boolean {
  return (
    left.stageIndex === right.stageIndex &&
    left.generation === right.generation &&
    left.evaluators.size === right.evaluators.size &&
    [...left.evaluators].every(([evaluator, status]) => {
      const other = right.evaluators.get(evaluator);
      return other !== undefined && evaluatorStatusEquals(status, other);
    })
  );
}

function stageRunsEqual(
  left: readonly StageRun[],
  right: readonly StageRun[],
): boolean {
  return (
    left.length === right.length &&
    left.every((run, index) => {
      const other = right[index];
      return other !== undefined && stageRunEquals(run, other);
    })
  );
}

function progressEquals(
  left: { readonly completedStages: readonly StageRun[]; readonly stage: StageRun },
  right: { readonly completedStages: readonly StageRun[]; readonly stage: StageRun },
): boolean {
  return (
    stageRunsEqual(left.completedStages, right.completedStages) &&
    stageRunEquals(left.stage, right.stage)
  );
}

export function evaluationStateEquals(
  left: EvaluationInstance["state"],
  right: EvaluationInstance["state"],
): boolean {
  if (left.type !== right.type) return false;
  switch (left.type) {
    case "Running":
    case "EvaluationBlocked":
      return (
        (right.type === "Running" || right.type === "EvaluationBlocked") &&
        progressEquals(left.value, right.value)
      );
    case "EvaluationPassed":
    case "EvaluationFailed":
      return (
        (right.type === "EvaluationPassed" ||
          right.type === "EvaluationFailed") &&
        stageRunsEqual(left.value, right.value)
      );
  }
}

export function instanceEquals(
  left: EvaluationInstance,
  right: EvaluationInstance,
): boolean {
  return (
    left.workCycle === right.workCycle &&
    left.input.ticket === right.input.ticket &&
    left.input.workResult === right.input.workResult &&
    stagesEqual(left.plan.stages, right.plan.stages) &&
    evaluationStateEquals(left.state, right.state)
  );
}
