/**
 * Tasks: what one is for, what state it is in, and the plumbing that spawns,
 * resolves and retires a set of them.
 *
 * The model holds the live set as `Set[Task]`; here it is an array kept
 * ascending by id. The two are in bijection because ids are unique within the
 * set — `tasksWellFormed` is what makes that true — so the ordering is
 * canonical rather than incidental, and every fold below reads it in id order
 * instead of inheriting whatever order a rebuild happened to produce.
 */

import { assertNever } from "./assertNever.ts";
import {
  firstTaskId,
  asTaskId,
  asStageIndex,
  type StageIndex,
  type TaskId,
} from "./ids.ts";

/** What a task is for: the single work set, or one stage of the eval program. */
export type TaskKind =
  | { readonly kind: "TKWork" }
  | { readonly kind: "TKEval"; readonly stage: StageIndex };

/** A settled task's outcome. `TCancelled` is the mark only a revoke produces. */
export type TaskOutcome = "TPassed" | "TFailed" | "TCancelled";

/** A task runs, then resolves exactly once. A running task cannot carry an outcome. */
export type TaskState =
  | { readonly state: "TSRunning" }
  | { readonly state: "TSResolved"; readonly outcome: TaskOutcome };

/** Identity, kind and lifecycle state. Ids are sequential within the ticket. */
export interface Task {
  readonly id: TaskId;
  readonly kind: TaskKind;
  readonly state: TaskState;
}

/** A task-completion event's verdict, as distinct from the stored resolution. */
export type Verdict = "VPass" | "VFail";

export const tkWork: TaskKind = { kind: "TKWork" };

/** An eval task of the given stage. */
export function tkEval(stage: number): TaskKind {
  return { kind: "TKEval", stage: asStageIndex(stage) };
}

export const tsRunning: TaskState = { state: "TSRunning" };

/** A resolved task carrying its outcome. */
export function tsResolved(outcome: TaskOutcome): TaskState {
  return { state: "TSResolved", outcome };
}

/** How many of these tasks are still running. */
export function runningCount(tasks: readonly Task[]): number {
  return tasks.filter((t) => t.state.state === "TSRunning").length;
}

/**
 * The current eval stage, derived from the set's kind marks rather than
 * stored. Zero on an empty or work set, which is the fold's base.
 */
export function evalStage(tasks: readonly Task[]): StageIndex {
  let stage = asStageIndex(0);
  for (const task of tasks) {
    switch (task.kind.kind) {
      case "TKWork":
        break;
      case "TKEval":
        stage = task.kind.stage;
        break;
      default:
        assertNever(task.kind);
    }
  }
  return stage;
}

/** A fresh parallel set of `count` running tasks, ids running up from `start`. */
export function spawnTasks(
  kind: TaskKind,
  start: TaskId,
  count: number,
): readonly Task[] {
  const spawned: Task[] = [];
  for (let i = 0; i < count; i++) {
    spawned.push({ id: asTaskId(start + i), kind, state: tsRunning });
  }
  return spawned;
}

/**
 * First write wins: resolve `id` if it is still running, and change nothing
 * otherwise. That is the idempotence an at-least-once fabric demands.
 */
export function resolveTask(
  tasks: readonly Task[],
  id: TaskId,
  outcome: TaskOutcome,
): readonly Task[] {
  return tasks.map((t) =>
    t.id === id && t.state.state === "TSRunning"
      ? { ...t, state: tsResolved(outcome) }
      : t,
  );
}

/** A pass earned this incarnation. Both other outcomes fail it. */
export function taskPassed(task: Task): boolean {
  return task.state.state === "TSResolved" && task.state.outcome === "TPassed";
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
  switch (left.kind) {
    case "TKWork":
      return right.kind === "TKWork";
    case "TKEval":
      return right.kind === "TKEval" && right.stage === left.stage;
    default:
      return assertNever(left);
  }
}

/** A resolved task matches only on the same outcome; running matches running. */
function taskEqualsState(left: TaskState, right: TaskState): boolean {
  switch (left.state) {
    case "TSRunning":
      return right.state === "TSRunning";
    case "TSResolved":
      return right.state === "TSResolved" && right.outcome === left.outcome;
    default:
      return assertNever(left);
  }
}

/**
 * Retire a live set into the retained record, in id order. A task still
 * running at retirement is force-closed as cancelled, which only a revoke
 * ever reaches.
 */
export function retiredInIdOrder(tasks: readonly Task[]): readonly Task[] {
  return [...tasks]
    .sort((a, b) => a.id - b.id)
    .map((t) =>
      t.state.state === "TSRunning"
        ? { ...t, state: tsResolved("TCancelled") }
        : t,
    );
}
