/**
 * The two reads a project's runner for work is decided from, as a case names
 * them: where its work runs, the runners registered to it, and each read as a
 * screen holds one — answered, not yet back, failed, or asked again after
 * failing.
 */

import type { ExecutionPlacementResponse } from "../../../src/contract/responses.ts";
import type { PlacementRoute } from "../../../src/contract/rosters.ts";
import type { WorkRunnerRead } from "../app/core/workRunner.ts";

/** One project's execution placement, its work running where the case says. */
export function executionPlacementBody(
  work: PlacementRoute = "Pool",
): ExecutionPlacementResponse {
  return {
    work: { route: work, source: "Default" },
    evaluation: { route: "Pool", source: "Default" },
    choices: ["Pool"],
  };
}

export function workRunnerAnswered<T>(value: T): WorkRunnerRead<T> {
  return {
    state: { state: "Ready", value, observedAtMs: undefined },
    settled: true,
  };
}

export const workRunnerUnread: WorkRunnerRead<never> = {
  state: { state: "Pending" },
  settled: false,
};

export const workRunnerFailed: WorkRunnerRead<never> = {
  state: { state: "Failed", reason: "the read failed" },
  settled: true,
};

/** A read that failed and is being asked again, which is pending a second time. */
export const workRunnerRetried: WorkRunnerRead<never> = {
  state: { state: "Pending" },
  settled: true,
};
