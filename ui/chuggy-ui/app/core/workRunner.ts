/**
 * Whether a project's work has a runner to go to, from the reads that say so:
 * where its work runs, the runners registered to it, and whether its owner's
 * personal runner may take it.
 *
 * NO RUNNER IS SAID ONLY ON EVERY ANSWER. Work the cluster runs waits on no
 * runner, so a project with none registered is short of one only where its
 * work goes to runners, and an owner's runner takes no part where the project
 * names no fallback. A read that failed decides nothing, and a surface draws
 * what it would had the read never been made.
 */

import type {
  ExecutionPlacementResponse,
  ProjectOwnerFallbackResponse,
  SessionPlacementResponse,
} from "../../../../src/contract/responses.ts";
import type { SessionRunnerStanding } from "../../../../src/contract/rosters.ts";

import type { PanelState } from "./freshness.ts";
import { sessionRunnerShort } from "./sessionRunners.ts";

/** One read as a screen holds it, with whether it has ever come back, which a
 * read that failed cannot say by being pending again on every retry. */
export interface WorkRunnerRead<T> {
  readonly state: PanelState<T>;
  readonly settled: boolean;
}

/** Where the question stands: held while a read it turns on has not come
 * back, no runner where every one says so, and clear otherwise. */
export type WorkRunner = "Held" | "NoRunner" | "Clear";

/** Whose work it is: the reader's own, which they start, or a ticket's owner,
 * who may be someone else and whose runner the reader cannot see. */
export type WorkRunnerOwner = "Reader" | "Unknown";

function workRunnerFailed(read: WorkRunnerRead<unknown>): boolean {
  return read.state.state !== "Ready" && read.settled;
}

/** Whether a named fallback lets the owner's runner take the work: the
 * reader's own registered, live or not as a pool's, and anyone else's taken
 * as registered, since it cannot be read. */
function workRunnerOwnerServes(
  owner: WorkRunnerOwner,
  mine: SessionRunnerStanding,
): boolean {
  switch (owner) {
    case "Reader":
      return mine !== "Unregistered";
    case "Unknown":
      return true;
  }
}

/**
 * Whether work started now would have a runner to go to. An unread read is
 * taken as the worst it could say, so a read that settles the question alone
 * is not waited on: a hosted route, or a runner already registered.
 */
export function workRunner(
  placement: WorkRunnerRead<ExecutionPlacementResponse>,
  runners: WorkRunnerRead<SessionPlacementResponse>,
  fallback: WorkRunnerRead<ProjectOwnerFallbackResponse>,
  owner: WorkRunnerOwner,
): WorkRunner {
  if ([placement, runners, fallback].some(workRunnerFailed)) return "Clear";
  const route =
    placement.state.state === "Ready"
      ? placement.state.value.work.route
      : undefined;
  const standing =
    runners.state.state === "Ready" ? runners.state.value.runners : undefined;
  const named =
    fallback.state.state === "Ready"
      ? fallback.state.value.fallback !== undefined
      : undefined;
  const short = sessionRunnerShort(
    route ?? "Pool",
    standing?.project ?? "Unregistered",
  );
  if (short !== "NoRunner") return "Clear";
  if (
    named === true &&
    workRunnerOwnerServes(owner, standing?.mine ?? "Unregistered")
  )
    return "Clear";
  return route === undefined || standing === undefined || named === undefined
    ? "Held"
    : "NoRunner";
}
