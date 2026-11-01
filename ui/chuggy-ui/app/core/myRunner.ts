/**
 * What a member's own runners are drawn as, derived: the words for a project's
 * fallback, how a runner is told from another, whether one more may be
 * registered, the projects they may be given, whether a run of the reader's is
 * waiting on them, and what taking a member's runners off came to.
 *
 * WHETHER A RUN IS THE READER'S IS THE SERVER'S ANSWER. Nothing here decodes a
 * token, so a run says it is theirs by `mine`, and one whose read predates the
 * field is nobody's.
 */

import { personalRunnersMax } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionSummary,
  PersonalRunnerResponse,
} from "../../../../src/contract/responses.ts";
import { ownerFallbacks } from "../../../../src/contract/rosters.ts";
import type { OwnerFallback } from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";
import { failureWords } from "./failureWords.ts";
import { executionStarting } from "./ticketLedger.ts";

/** What a member is told where the workspace has not let them register one. */
export const myRunnerWithheld =
  "A workspace admin lets members register their own runners";

/** The radio value a project naming no fallback is chosen by. */
export const ownerFallbackNone = "None";

/** Every value the setting is chosen from, none first. */
export const ownerFallbackChoices: readonly (OwnerFallback | undefined)[] = [
  undefined,
  ...ownerFallbacks,
];

export function ownerFallbackValue(
  fallback: OwnerFallback | undefined,
): string {
  return fallback ?? ownerFallbackNone;
}

/** The fallback a radio group answered, where it is one this wire knows. */
export function ownerFallbackChosen(
  value: string,
): { readonly fallback: OwnerFallback | undefined } | undefined {
  if (value === ownerFallbackNone) return { fallback: undefined };
  const fallback = ownerFallbacks.find((each) => each === value);
  return fallback === undefined ? undefined : { fallback };
}

export function ownerFallbackLabel(
  fallback: OwnerFallback | undefined,
): string {
  switch (fallback) {
    case undefined:
      return "None";
    case "Strict":
      return "Strict";
    case "Preferred":
      return "Preferred";
  }
}

/** An execution keeps the fallback it was registered under, so a change reaches only work started after it. */
export const ownerFallbackPinned = "Changes reach new work only";

/** One plain line for what each value does to a member's own work. */
export function ownerFallbackAbout(
  fallback: OwnerFallback | undefined,
): string {
  switch (fallback) {
    case undefined:
      return "Personal runners take no work started from now on.";
    case "Strict":
      return "A member's own runners take the work they start here, and while they have one serving this project no shared runner does.";
    case "Preferred":
      return "A member's own runners take the work they start here while one is online, and a shared runner takes it while none is.";
  }
}

/** The start of a runner's id where it ends in a UUID, which tells it from another of the reader's, and the whole id where it does not. */
export function myRunnerShort(id: string): string {
  return /([0-9a-f]{8})(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.exec(id)?.[1] ?? id;
}

/** The line a member's runners are listed under. */
export function myRunnersCountLine(count: number): string {
  return count === 1 ? "1 runner" : `${String(count)} runners`;
}

/** Whether the reader holds fewer runners than a member may, none where they hold none. */
export function myRunnerRoom(
  runner: PersonalRunnerResponse | undefined,
): boolean {
  return (runner?.runners.length ?? 0) < personalRunnersMax;
}

/** What taking one of the reader's runners off does, said in its question: the last takes the projects with it. */
export function myRunnerRemovalLine(short: string, last: boolean): string {
  return last
    ? `Runner ${short} is your last; your project list goes too.`
    : `Runner ${short} stops taking your work in this workspace.`;
}

/** The tenant's projects the reader reads and their runners do not yet serve, in name order. */
export function myRunnerAddable(
  readable: readonly PartitionIdentity[],
  tenant: string,
  runner: PersonalRunnerResponse,
): readonly string[] {
  const served = new Set(runner.projects);
  return readable
    .filter((each) => each.tenant === tenant && !served.has(each.project))
    .map((each) => each.project)
    .sort();
}

/** A run of the reader's held for their runners: one online and about to take it, or all offline while no other may. */
export type RunnerWait = "Waiting" | "Offline";

/**
 * Whether a run of the reader's, admitted but not begun, waits on their own
 * runners serving its project: under either fallback while any of them polls
 * for executions, which is the liveness a pool's claim defers to, and under
 * Strict while none does, since then no pool takes it either. A queued run
 * waits on capacity rather than on a runner.
 */
export function runnerWait(
  execution: ExecutionSummary,
  runner: PersonalRunnerResponse | undefined,
  project: string,
): RunnerWait | undefined {
  if (execution.mine !== true || execution.ownerFallback === undefined)
    return undefined;
  if (execution.status === "Queued" || !executionStarting(execution))
    return undefined;
  if (runner === undefined || !runner.projects.includes(project))
    return undefined;
  if (runner.runners.some((each) => each.executionsLive)) return "Waiting";
  return execution.ownerFallback === "Strict" ? "Offline" : undefined;
}

/**
 * What taking a member's runners off came to, in one line: taken off, none the
 * caller may take, or why it was refused. The server answers a caller it will
 * not let take them as one with none, so the line names both.
 */
export function memberRunnerRemoved(result: ApiResult<undefined>): string {
  if (result.outcome === "Ok") return "Runners removed";
  if (result.outcome === "Absent") return "No runner you may remove";
  return failureWords(result).word;
}

export function runnerWaitWord(wait: RunnerWait): string {
  switch (wait) {
    case "Waiting":
      return "Waiting on your runners";
    case "Offline":
      return "Waiting on your runners · offline";
  }
}
