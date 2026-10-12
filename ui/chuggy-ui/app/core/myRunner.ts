/**
 * What a member's own runner is drawn as, derived: the words for a project's
 * fallback, the projects a runner may be given, whether a run of the reader's
 * is waiting on their runner, and what taking a member's runner off came to.
 *
 * WHETHER A RUN IS THE READER'S IS THE SERVER'S ANSWER. Nothing here decodes a
 * token, so a run says it is theirs by `mine`, and one whose read predates the
 * field is nobody's.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  ExecutionSummary,
  PersonalRunnerResponse,
} from "../../../../src/contract/responses.ts";
import { ownerFallbacks } from "../../../../src/contract/rosters.ts";
import type { OwnerFallback } from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";
import { executionStarting } from "./ticketLedger.ts";

/** What a member is told where the workspace has not let them register one. */
export const myRunnerWithheld =
  "A workspace admin lets members register their own runner";

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
export const ownerFallbackPinned =
  "Applies to work started after a change; work already waiting keeps the setting it started under.";

/** One plain line for what each value does to a member's own work. */
export function ownerFallbackAbout(
  fallback: OwnerFallback | undefined,
): string {
  switch (fallback) {
    case undefined:
      return "Personal runners take no work started from now on.";
    case "Strict":
      return "A member's own runner takes the work they start here, and while they have one serving this project no shared runner does.";
    case "Preferred":
      return "A member's own runner takes the work they start here while it is online, and a shared runner takes it while theirs is not.";
  }
}

/** The tenant's projects the reader reads and their runner does not yet serve, in name order. */
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

/** A run of the reader's held for their runner: online and about to take it, or offline while no other may. */
export type RunnerWait = "Waiting" | "Offline";

/**
 * Whether a run of the reader's, admitted but not begun, waits on their own
 * runner serving its project: under either fallback while that runner polls
 * for executions, which is the liveness a pool's claim defers to, and under
 * Strict while it does not, since then no pool takes it either. A queued run
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
  if (runner.executionsLive) return "Waiting";
  return execution.ownerFallback === "Strict" ? "Offline" : undefined;
}

/**
 * What taking a member's runner off came to, in one line: taken off, none the
 * caller may take, or why it was refused. The server answers a caller it will
 * not let take the runner as one with none, so the line names both.
 */
export function memberRunnerRemoved(result: ApiResult<undefined>): string {
  if (result.outcome === "Ok") return "Runner removed";
  if (result.outcome === "Absent") return "No runner you may remove";
  return `Refused · ${panelReason(result)}`;
}

export function runnerWaitWord(wait: RunnerWait): string {
  switch (wait) {
    case "Waiting":
      return "Waiting on your runner";
    case "Offline":
      return "Waiting on your runner · offline";
  }
}
