/**
 * What the machine does with a task set: name a task, spawn a set, resolve
 * into it, read what it is still waiting on, and retire it into the record.
 *
 * The model holds the live set as `Set[Task]` and this mirrors it, so the
 * folds below read the set the model reads. Where a fold's result depends on
 * order — retirement into the record, and every comparison a trace makes —
 * `tasksInOrdinalOrder` is what supplies it: a live set is one work task or
 * one stage's evaluators, so the evaluator ordinal is canonical rather than
 * incidental, and nothing here inherits whatever order a rebuild produced.
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
 * One evaluator of one run of one stage. `stage` is the zero-based index into
 * the ticket's authored program; the contract's key is one more, which is the
 * only place that offset is applied.
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
    value: {
      ticket,
      workCycle,
      stage: asStageIndex(stage) + 1,
      generation,
      evaluator,
    },
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
 * A task's place in its own set, and so the order the set retires in: a stage
 * runs evaluators one to its fanout, and a work cycle is one task.
 */
export function taskOrdinal(identity: TaskIdentity): number {
  switch (identity.type) {
    case "WorkTask":
      return 1;
    case "EvaluationTask":
      return identity.value.evaluator;
  }
}

/** The tasks as a list, ascending by ordinal — the one ordering anything here folds in. */
export function tasksInOrdinalOrder(tasks: Iterable<Task>): readonly Task[] {
  return [...tasks].sort(
    (a, b) => taskOrdinal(a.identity) - taskOrdinal(b.identity),
  );
}

/**
 * How many reworks a failing evaluation has cost a ticket, read off its
 * retired record and its live set together: a work cycle counts when the cycle
 * before it had an evaluator resolve `Failed`, so neither the first cycle nor
 * one bought by a failed finalization or a work wall is one. Derived rather
 * than carried on the ticket, which would be a stored duplicate of it; what
 * the tasks alone cannot separate is stated at the cap.
 */
export function evaluationFailureReworksStarted(
  record: readonly Task[],
  live: ReadonlySet<Task>,
): number {
  const all = [...record, ...live];
  const failedCycles = new Set<number>();
  for (const task of all) {
    if (task.identity.type !== "EvaluationTask") continue;
    if (task.state !== "Outstanding" && task.state.value === "Failed")
      failedCycles.add(task.identity.value.workCycle);
  }
  return all.filter(
    (task) =>
      task.identity.type === "WorkTask" &&
      failedCycles.has(task.identity.value.cycle - 1),
  ).length;
}

/** How many of these tasks are still outstanding to the fabric. */
export function outstandingCount(tasks: ReadonlySet<Task>): number {
  return [...tasks].filter((t) => t.state === "Outstanding").length;
}

/**
 * The current eval stage as a zero-based index into the authored program,
 * derived from the set's identities rather than stored. Zero on an empty or
 * work set, which is the fold's base.
 */
export function evalStage(tasks: ReadonlySet<Task>): StageIndex {
  let stage = asStageIndex(0);
  for (const task of tasksInOrdinalOrder(tasks)) {
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

/** A pass earned this incarnation. Both other outcomes fail it. */
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
 * Retire a live set into the retained record, in ordinal order. A task still
 * outstanding at retirement is force-closed as cancelled, which only a revoke
 * ever reaches.
 */
export function retiredInOrdinalOrder(
  tasks: ReadonlySet<Task>,
): readonly Task[] {
  return tasksInOrdinalOrder(tasks).map((t) =>
    t.state === "Outstanding" ? { ...t, state: tsResolved("Cancelled") } : t,
  );
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
