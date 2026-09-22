/**
 * What the machine does with a task set: name a task, spawn one, resolve into
 * it, and read what it is still waiting on.
 *
 * The model holds the live set as `Set[Task]` and this mirrors it, so the
 * folds below read the set the model reads. A live set is the work cycle's one
 * task, so `tasksInEvaluatorKeyOrder` supplies the order every comparison a
 * trace makes needs rather than inheriting whatever order a rebuild produced;
 * an evaluation's obligations are not a set at all but the running stage's
 * own roster (`src/domain/evaluation.ts`).
 */

import { assertNever } from "./assertNever.ts";
import type {
  Task,
  TaskIdentity,
  TaskOutcome,
  TaskState,
} from "./generated/modelTypes.ts";
import { asStageIndex, type StageIndex } from "./ids.ts";

/** The work task of one cycle — the only task a work cycle runs. */
export function workTaskOf(ticket: number, cycle: number): TaskIdentity {
  return { type: "WorkTask", value: { ticket, cycle } };
}

/**
 * One evaluator of one run of one stage, under the two keys the program
 * authored. No offset is applied: a caller holding a stage index passes that
 * stage's key, which the positional rule makes the same number.
 */
export function evaluationTaskOf(
  ticket: number,
  workCycle: number,
  stage: number,
  generation: number,
  evaluator: number,
): TaskIdentity {
  return {
    type: "EvaluationTask",
    value: { ticket, workCycle, stage, generation, evaluator },
  };
}

/** Structural equality on an identity: same arm, same fields. */
export function taskIdentityEquals(
  left: TaskIdentity,
  right: TaskIdentity,
): boolean {
  if (left.type === "WorkTask") {
    return (
      right.type === "WorkTask" &&
      left.value.ticket === right.value.ticket &&
      left.value.cycle === right.value.cycle
    );
  }
  return (
    right.type === "EvaluationTask" &&
    left.value.ticket === right.value.ticket &&
    left.value.workCycle === right.value.workCycle &&
    left.value.stage === right.value.stage &&
    left.value.generation === right.value.generation &&
    left.value.evaluator === right.value.evaluator
  );
}

/** The ticket an identity belongs to, whichever arm it is. */
export function taskOwner(identity: TaskIdentity): number {
  return identity.value.ticket;
}

/**
 * The key a task sorts under within its own set: an evaluation task's authored
 * evaluator key, and a work cycle is one task.
 */
export function taskRetirementKey(identity: TaskIdentity): number {
  switch (identity.type) {
    case "WorkTask":
      return 1;
    case "EvaluationTask":
      return identity.value.evaluator;
  }
}

/** The tasks as a list, ascending by evaluator key — the one ordering anything here folds in. */
export function tasksInEvaluatorKeyOrder(
  tasks: Iterable<Task>,
): readonly Task[] {
  return [...tasks].sort(
    (a, b) => taskRetirementKey(a.identity) - taskRetirementKey(b.identity),
  );
}

/**
 * Where a task sits in its own set, one-based, with the set ordered by
 * evaluator key. This is what a wire integer minted per set counts, now that
 * the keys themselves need not run one to the set's size.
 */
export function taskPositionInSet(
  tasks: Iterable<Task>,
  identity: TaskIdentity,
): number {
  const position = tasksInEvaluatorKeyOrder(tasks).findIndex((t) =>
    taskIdentityEquals(t.identity, identity),
  );
  if (position < 0)
    throw new Error("taskPositionInSet: the identity is not in this set");
  return position + 1;
}

/** How many of these tasks are still outstanding to the fabric. */
export function outstandingCount(tasks: ReadonlySet<Task>): number {
  return [...tasks].filter((t) => t.state === "Outstanding").length;
}

/**
 * The stage an evaluation task belongs to, as a zero-based index into the
 * authored program: the identity carries the stage's key and the key is its
 * position, and zero is the fold's base on an empty or work set. A run's own
 * `stageIndex` is what the machine reads; this is for a reader holding
 * identities and no instance.
 */
export function evalStage(tasks: ReadonlySet<Task>): StageIndex {
  let stage = asStageIndex(0);
  for (const task of tasksInEvaluatorKeyOrder(tasks)) {
    switch (task.identity.type) {
      case "WorkTask":
        continue;
      case "EvaluationTask":
        stage = asStageIndex(task.identity.value.stage - 1);
        break;
      default:
        assertNever(task.identity);
    }
  }
  return stage;
}

/** A fresh outstanding set under the identities the caller names. */
export function spawnTasks(
  identities: readonly TaskIdentity[],
): ReadonlySet<Task> {
  return new Set(
    identities.map((identity) => ({ identity, state: tsOutstanding })),
  );
}

export const tsOutstanding: TaskState = "Outstanding";

/** A resolved task carrying its outcome. */
export function tsResolved(outcome: TaskOutcome): TaskState {
  return { type: "Resolved", value: outcome };
}

/**
 * First write wins: resolve the named task if it is still outstanding, and
 * change nothing otherwise. That is the idempotence an at-least-once fabric
 * demands.
 */
export function resolveTask(
  tasks: ReadonlySet<Task>,
  identity: TaskIdentity,
  outcome: TaskOutcome,
): ReadonlySet<Task> {
  return new Set(
    [...tasks].map((t) =>
      taskIdentityEquals(t.identity, identity) && t.state === "Outstanding"
        ? { ...t, state: tsResolved(outcome) }
        : t,
    ),
  );
}

/** A pass earned this incarnation; a failure is the only other outcome. */
export function taskPassed(task: Task): boolean {
  return task.state !== "Outstanding" && task.state.value === "Passed";
}

/** Structural equality on a task: what it names, and how it settled. */
export function taskEquals(left: Task, right: Task): boolean {
  return (
    taskIdentityEquals(left.identity, right.identity) &&
    taskEqualsState(left.state, right.state)
  );
}

/** A resolved task matches only on the same outcome; outstanding matches outstanding. */
function taskEqualsState(left: TaskState, right: TaskState): boolean {
  if (left === "Outstanding") return right === "Outstanding";
  return right !== "Outstanding" && right.value === left.value;
}

/**
 * The contract's own claim about an identity (`taskIdentityValid` in
 * `model/task-contract/task.qnt`): every counter it carries is positive.
 */
export function taskIdentityValid(identity: TaskIdentity): boolean {
  if (identity.type === "WorkTask")
    return identity.value.ticket > 0 && identity.value.cycle > 0;
  return (
    identity.value.ticket > 0 &&
    identity.value.workCycle > 0 &&
    identity.value.stage > 0 &&
    identity.value.generation > 0 &&
    identity.value.evaluator > 0
  );
}
