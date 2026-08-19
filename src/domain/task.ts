/**
 * What the machine does with a task set: spawn one, resolve into it, read what
 * it is still waiting on, and retire it into the record.
 *
 * The model holds the live set as `Set[Task]` and this mirrors it, so the
 * folds below read the set the model reads. Where a fold's result depends on
 * order — retirement into the record, and every comparison a trace makes —
 * `tasksInIdOrder` is what supplies it: ids are unique within the set, so id
 * order is canonical rather than incidental, and nothing here inherits
 * whatever order a rebuild happened to produce.
 */

import { assertNever } from "./assertNever.ts";
import type {
  Task,
  TaskKind,
  TaskOutcome,
  TaskState,
} from "./generated/modelTypes.ts";
import {
  firstTaskId,
  asTaskId,
  asStageIndex,
  type StageIndex,
  type TaskId,
} from "./ids.ts";

export const tkWork: TaskKind = "Work";

/** An eval task of the given stage. */
export function tkEval(stage: number): TaskKind {
  return { type: "Evaluation", value: asStageIndex(stage) };
}

export const tsOutstanding: TaskState = "Outstanding";

/** A resolved task carrying its outcome. */
export function tsResolved(outcome: TaskOutcome): TaskState {
  return { type: "Resolved", value: outcome };
}

/** The set as a list, ascending by id — the one ordering anything here folds in. */
export function tasksInIdOrder(tasks: ReadonlySet<Task>): readonly Task[] {
  return [...tasks].sort((a, b) => a.id - b.id);
}

/** How many of these tasks are still outstanding to the fabric. */
export function outstandingCount(tasks: ReadonlySet<Task>): number {
  return [...tasks].filter((t) => t.state === "Outstanding").length;
}

/**
 * The current eval stage, derived from the set's kind marks rather than
 * stored. Zero on an empty or work set, which is the fold's base.
 */
export function evalStage(tasks: ReadonlySet<Task>): StageIndex {
  let stage = asStageIndex(0);
  for (const task of tasksInIdOrder(tasks)) {
    if (task.kind === "Work") continue;
    switch (task.kind.type) {
      case "Evaluation":
        stage = asStageIndex(task.kind.value);
        break;
      default:
        assertNever(task.kind.type);
    }
  }
  return stage;
}

/** A fresh parallel set of `count` outstanding tasks, with consecutive ids from `start`. */
export function spawnTasks(
  kind: TaskKind,
  start: TaskId,
  count: number,
): ReadonlySet<Task> {
  const spawned = new Set<Task>();
  for (let i = 0; i < count; i++) {
    spawned.add({ id: asTaskId(start + i), kind, state: tsOutstanding });
  }
  return spawned;
}

/**
 * First write wins: resolve `id` if it is still outstanding, and change nothing
 * otherwise. That is the idempotence an at-least-once fabric demands.
 */
export function resolveTask(
  tasks: ReadonlySet<Task>,
  id: TaskId,
  outcome: TaskOutcome,
): ReadonlySet<Task> {
  return new Set(
    [...tasks].map((t) =>
      t.id === id && t.state === "Outstanding"
        ? { ...t, state: tsResolved(outcome) }
        : t,
    ),
  );
}

/** A pass earned this incarnation. Both other outcomes fail it. */
export function taskPassed(task: Task): boolean {
  return task.state !== "Outstanding" && task.state.value === "Passed";
}

/** The next id this history would issue: every id ever issued is retired or live. */
export function nextTaskId(recordLength: number, liveCount: number): TaskId {
  return asTaskId(firstTaskId + recordLength + liveCount);
}

/** Structural equality on a task: its identity, what it was for, and how it settled. */
export function taskEquals(left: Task, right: Task): boolean {
  return (
    left.id === right.id &&
    taskEqualsKind(left.kind, right.kind) &&
    taskEqualsState(left.state, right.state)
  );
}

/** An eval task matches only at the same stage, which is what keeps history from re-labelling itself. */
function taskEqualsKind(left: TaskKind, right: TaskKind): boolean {
  if (left === "Work") return right === "Work";
  return right !== "Work" && right.value === left.value;
}

/** A resolved task matches only on the same outcome; outstanding matches outstanding. */
function taskEqualsState(left: TaskState, right: TaskState): boolean {
  if (left === "Outstanding") return right === "Outstanding";
  return right !== "Outstanding" && right.value === left.value;
}

/**
 * Retire a live set into the retained record, in id order. A task still
 * outstanding at retirement is force-closed as cancelled, which only a revoke
 * ever reaches.
 */
export function retiredInIdOrder(tasks: ReadonlySet<Task>): readonly Task[] {
  return tasksInIdOrder(tasks).map((t) =>
    t.state === "Outstanding" ? { ...t, state: tsResolved("Cancelled") } : t,
  );
}
