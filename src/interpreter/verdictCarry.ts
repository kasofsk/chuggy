/**
 * Whether an evaluation about to launch carries the passing verdict an earlier
 * work cycle of its ticket earned instead, and which execution earned it.
 * `model/stacking.qnt` states the rule as `verdictHolds`, which
 * `landsOnAHoldingVerdict` holds every landing to: the verdict stands while the
 * patch is the same and it was earned unstacked or over a stack whose beneath
 * all landed at the commits it names. The patch here is the `ChangeIdentity`
 * each bundle pins, and `beneathLanded` is a task's `stack`.
 *
 * It takes plain rows and reads nothing, so the rule is decided without a
 * database. Only an `OnChange` workload is ever carried, and an earlier task is
 * a candidate only where it is the same evaluator of the same stage of the same
 * ticket on an earlier work cycle, passed with no handoffs, registered to run
 * the same workload, pinned the same change identity, and its stack, if it had
 * one, landed beneath it. Whether the current cycle is stacked is not read.
 * Among the candidates the latest is carried.
 */

import { materialDigest } from "./ticketDefinition.ts";
import type { TicketId } from "../domain/ids.ts";
import type { ExecutionOutcome } from "./executionScheduler.ts";
import type { ExecutionId } from "./schedulerIdentity.ts";
import type { WorkloadTask } from "./workloadTask.ts";

/** Whether a workload run as an evaluator runs again where the ticket's diff has not changed; absent is `Always`. */
export type VerdictCarryReevaluation = "Always" | "OnChange";

/**
 * What a work cycle's stack says of a verdict earned over it: none was
 * recorded, everything beneath it landed as the stack named, or not.
 */
export type VerdictCarryStack = "Unstacked" | "Landed" | "NotLanded";

/** Every stack answer, so a reader narrows a stored one rather than restating them. */
export const allVerdictCarryStacks: readonly VerdictCarryStack[] = [
  "Unstacked",
  "Landed",
  "NotLanded",
];

/** One evaluation task as the rule reads it. */
export interface VerdictCarryTask {
  readonly execution: ExecutionId;
  readonly ticket: TicketId;
  readonly stage: number;
  readonly evaluator: number;
  readonly workCycle: number;
  readonly generation: number;
  /** The digest of the workload it was registered to run, absent on a row registered before one was recorded. */
  readonly workloadDigest: string | undefined;
  /** The change identity its bundle pinned, absent where it pinned none. */
  readonly changeIdentity: string | undefined;
  readonly stack: VerdictCarryStack;
}

/** The task about to launch, and whether its workload may be carried at all. */
export interface VerdictCarryCurrent extends VerdictCarryTask {
  readonly reevaluate: VerdictCarryReevaluation;
}

/** An earlier task of the ticket, and how it settled. */
export interface VerdictCarryEarlier extends VerdictCarryTask {
  /** Its outcome, absent where it has not settled. */
  readonly outcome: ExecutionOutcome | undefined;
  /** How many handoff artifacts its result declares. */
  readonly handoffs: number;
}

function verdictCarryRequireTask(task: VerdictCarryTask, what: string): void {
  for (const [name, value] of [
    ["stage", task.stage],
    ["evaluator", task.evaluator],
    ["work cycle", task.workCycle],
    ["generation", task.generation],
  ] as const)
    if (!Number.isSafeInteger(value) || value < 1)
      throw new RangeError(`verdict carry: the ${what}'s ${name} is not a key`);
}

/** Whether `earlier` is a verdict `current` may carry. */
function verdictCarryCandidate(
  current: VerdictCarryTask,
  earlier: VerdictCarryEarlier,
): boolean {
  return (
    earlier.execution !== current.execution &&
    earlier.ticket === current.ticket &&
    earlier.stage === current.stage &&
    earlier.evaluator === current.evaluator &&
    earlier.workCycle < current.workCycle &&
    earlier.outcome === "Passed" &&
    earlier.handoffs === 0 &&
    earlier.workloadDigest !== undefined &&
    earlier.workloadDigest === current.workloadDigest &&
    earlier.changeIdentity !== undefined &&
    earlier.changeIdentity === current.changeIdentity &&
    earlier.stack !== "NotLanded"
  );
}

/** Whether `left` is later than `right`: a later work cycle, then a later generation of it. */
function verdictCarryLater(
  left: VerdictCarryTask,
  right: VerdictCarryTask,
): boolean {
  return (
    left.workCycle > right.workCycle ||
    (left.workCycle === right.workCycle && left.generation > right.generation)
  );
}

/**
 * The execution whose passing verdict `current` carries, or undefined where it
 * launches: its workload is `Always`, or no earlier task is a candidate.
 */
export function verdictCarrySource(
  current: VerdictCarryCurrent,
  earlier: readonly VerdictCarryEarlier[],
): ExecutionId | undefined {
  verdictCarryRequireTask(current, "current task");
  if (current.reevaluate !== "OnChange") return undefined;
  let latest: VerdictCarryEarlier | undefined;
  for (const task of earlier) {
    verdictCarryRequireTask(task, "earlier task");
    if (!Number.isSafeInteger(task.handoffs) || task.handoffs < 0)
      throw new RangeError("verdict carry: a handoff count is not a count");
    if (!verdictCarryCandidate(current, task)) continue;
    if (latest === undefined || verdictCarryLater(task, latest)) latest = task;
  }
  if (latest !== undefined && latest.workCycle >= current.workCycle)
    throw new Error("verdict carry: a carried verdict is not from earlier");
  return latest?.execution;
}

/** Whether a catalog task's workload may be carried, which an approval's never is. */
export function verdictCarryReevaluation(
  task: WorkloadTask | undefined,
): VerdictCarryReevaluation {
  if (task === undefined || task.workload.runner === "Approval")
    return "Always";
  return task.workload.reevaluate ?? "Always";
}

/**
 * The digest a task is registered under: its workload as resolved for it, the
 * ticket's overrides applied, and whether the ticket's own checks join it. The
 * workload's `reevaluate` is left out, because whether a verdict may be carried
 * is not part of what earned it, so adopting `OnChange` does not set aside
 * every verdict earned before.
 */
export function verdictCarryWorkloadDigest(
  task: WorkloadTask | undefined,
): string | undefined {
  if (task === undefined || task.workload.runner === "Approval")
    return undefined;
  return materialDigest({
    workload: { ...task.workload, reevaluate: undefined },
    ticketChecks: task.ticketChecks,
  });
}
