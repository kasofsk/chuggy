/**
 * Whether a project's work has a runner to go to, from the reads that say so:
 * where its work runs, and the reader's own personal runners.
 *
 * NO RUNNER IS SAID ONLY ON EVERY ANSWER. Work the cluster runs waits on no
 * runner, so a project's work is short of one only where it goes to runners
 * and its owner, the reader, has none serving the project. A read that failed
 * decides nothing, and a surface draws what it would had the read never been
 * made.
 *
 * AN OWNER'S RUNNER IS A PERSONAL RUNNER. Work routed to runners goes to its
 * owner's personal runners that serve the project, never to their chat host,
 * so the session placement, which answers the chat host, says nothing here.
 */

import type {
  ExecutionPlacementResponse,
  PersonalRunnerResponse,
} from "../../../../src/contract/responses.ts";
import type { SessionRunnerStanding } from "../../../../src/contract/rosters.ts";

import type { PanelState } from "./freshness.ts";

/** One read as a screen holds it, with whether it has ever come back, which a
 * read that failed cannot say by being pending again on every retry. */
export interface WorkRunnerRead<T> {
  readonly state: PanelState<T>;
  readonly settled: boolean;
}

/** Where the question stands: held while a read it turns on has not come
 * back, no runner where every one says so, and clear otherwise. */
export type WorkRunner = "Held" | "NoRunner" | "Clear";

/** Whose work it is: the reader's own, or work whose owner is not known to be
 * the reader, whose runners the reader cannot see. */
export type WorkRunnerOwner = "Reader" | "Unknown";

function workRunnerFailed(read: WorkRunnerRead<unknown>): boolean {
  return read.state.state !== "Ready" && read.settled;
}

/**
 * How the reader's own personal runners stand for one project: unregistered
 * where they hold none or none serves it, live where one is, and offline
 * otherwise. Every runner of a member's serves every project they are given.
 */
export function workRunnerPersonal(
  personal: PersonalRunnerResponse | undefined,
  project: string,
): SessionRunnerStanding {
  if (
    personal === undefined ||
    !personal.projects.some((served) => served.project === project)
  )
    return "Unregistered";
  return personal.runners.some((runner) => runner.live) ? "Live" : "Offline";
}

/** The reader's personal runners read as a screen holds it, taken to how they
 * stand for one project; the read answers absent where they hold none, which
 * is an answer and not a failure. */
export function workRunnerPersonalRead(
  read: WorkRunnerRead<PersonalRunnerResponse>,
  project: string,
): WorkRunnerRead<SessionRunnerStanding> {
  switch (read.state.state) {
    case "Ready":
      return {
        state: {
          ...read.state,
          value: workRunnerPersonal(read.state.value, project),
        },
        settled: read.settled,
      };
    case "Absent":
      return {
        state: {
          state: "Ready",
          value: "Unregistered",
          observedAtMs: undefined,
        },
        settled: read.settled,
      };
    case "Pending":
    case "Failed":
      return { state: read.state, settled: read.settled };
  }
}

/**
 * Whether work started now would have a runner to go to: work routed to
 * runners goes to its owner's personal runners, so only the reader's own has
 * none, where theirs stand unregistered for the project, while hosted work and
 * another member's, whose runners cannot be read, are clear. An unread read is
 * taken as the worst it could say, so a read that settles the question alone
 * is not waited on.
 */
export function workRunner(
  placement: WorkRunnerRead<ExecutionPlacementResponse>,
  personal: WorkRunnerRead<SessionRunnerStanding>,
  owner: WorkRunnerOwner,
): WorkRunner {
  if (owner === "Unknown") return "Clear";
  if ([placement, personal].some(workRunnerFailed)) return "Clear";
  const route =
    placement.state.state === "Ready"
      ? placement.state.value.work.route
      : undefined;
  const standing =
    personal.state.state === "Ready" ? personal.state.value : undefined;
  if (route === "InCluster") return "Clear";
  if (standing !== undefined && standing !== "Unregistered") return "Clear";
  return route === undefined || standing === undefined ? "Held" : "NoRunner";
}
