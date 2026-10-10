/**
 * Whether a project's work has a runner to go to, from the two reads that say
 * so: where its work runs, and the runners registered to it.
 *
 * NO RUNNER IS SAID ONLY ON BOTH ANSWERS. Work the cluster runs waits on no
 * runner, so a project with none registered is short of one only where its
 * work goes to runners. A read that failed decides nothing, and a surface
 * draws what it would had the read never been made.
 */

import type {
  ExecutionPlacementResponse,
  SessionPlacementResponse,
} from "../../../../src/contract/responses.ts";

import type { PanelState } from "./freshness.ts";
import { sessionRunnerShort } from "./sessionRunners.ts";

/** One read as a screen holds it, with whether it has ever come back, which a
 * read that failed cannot say by being pending again on every retry. */
export interface WorkRunnerRead<T> {
  readonly state: PanelState<T>;
  readonly settled: boolean;
}

/** Where the question stands: held while a read it turns on has not come
 * back, no runner where both say so, and clear otherwise. */
export type WorkRunner = "Held" | "NoRunner" | "Clear";

function workRunnerFailed(read: WorkRunnerRead<unknown>): boolean {
  return read.state.state !== "Ready" && read.settled;
}

/**
 * Whether work started now would have a runner to go to. An unread half is
 * taken as the worst it could say, so a half that settles the question alone
 * is not waited on: a hosted route, or a runner already registered.
 */
export function workRunner(
  placement: WorkRunnerRead<ExecutionPlacementResponse>,
  runners: WorkRunnerRead<SessionPlacementResponse>,
): WorkRunner {
  if (workRunnerFailed(placement) || workRunnerFailed(runners)) return "Clear";
  const route =
    placement.state.state === "Ready"
      ? placement.state.value.work.route
      : undefined;
  const standing =
    runners.state.state === "Ready"
      ? runners.state.value.runners.project
      : undefined;
  const short = sessionRunnerShort(route ?? "Pool", standing ?? "Unregistered");
  if (short !== "NoRunner") return "Clear";
  return route === undefined || standing === undefined ? "Held" : "NoRunner";
}
