/**
 * Whether a project's work has a runner to go to, from the reads that say so:
 * where its work runs, the pools registered to it, whether its owner's
 * personal runner may take it, and the reader's own personal runners.
 *
 * NO RUNNER IS SAID ONLY ON EVERY ANSWER. Work the cluster runs waits on no
 * runner, so a project with none registered is short of one only where its
 * work goes to runners, and an owner's runner takes no part where the project
 * names no fallback. A read that failed decides nothing, and a surface draws
 * what it would had the read never been made.
 *
 * AN OWNER'S RUNNER IS A PERSONAL RUNNER. Work a fallback routes to its owner
 * goes to their personal runners that serve the project, never to their chat
 * host, so the session placement's `mine`, which is the chat host, says
 * nothing here.
 */

import type {
  ExecutionPlacementResponse,
  PersonalRunnerResponse,
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

/** Whether a named fallback lets the owner's runner take the work: the
 * reader's own personal runner registered, live or not as a pool's, and
 * anyone else's taken as registered, since it cannot be read. */
function workRunnerOwnerServes(
  owner: WorkRunnerOwner,
  personal: SessionRunnerStanding,
): boolean {
  switch (owner) {
    case "Reader":
      return personal !== "Unregistered";
    case "Unknown":
      return true;
  }
}

/**
 * How the runners the reader's own work would go to stand: the project's
 * pools, or where none is registered and the project names a fallback that
 * lets the reader's own personal runner take it, that runner.
 */
export function workRunnerStanding(
  project: SessionRunnerStanding,
  named: boolean,
  personal: SessionRunnerStanding,
): SessionRunnerStanding {
  return project === "Unregistered" &&
    named &&
    workRunnerOwnerServes("Reader", personal)
    ? personal
    : project;
}

/**
 * Whether work started now would have a runner to go to. An unread read is
 * taken as the worst it could say, so a read that settles the question alone
 * is not waited on: a hosted route, or a runner already registered, and the
 * reader's personal runners are read only for work of their own.
 */
export function workRunner(
  placement: WorkRunnerRead<ExecutionPlacementResponse>,
  runners: WorkRunnerRead<SessionPlacementResponse>,
  fallback: WorkRunnerRead<ProjectOwnerFallbackResponse>,
  personal: WorkRunnerRead<SessionRunnerStanding>,
  owner: WorkRunnerOwner,
): WorkRunner {
  const read = owner === "Reader" ? [personal] : [];
  if ([placement, runners, fallback, ...read].some(workRunnerFailed))
    return "Clear";
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
  const own =
    personal.state.state === "Ready"
      ? workRunnerOwnerServes(owner, personal.state.value)
      : owner === "Unknown"
        ? true
        : undefined;
  const short = sessionRunnerShort(
    route ?? "Pool",
    standing?.project ?? "Unregistered",
  );
  if (short !== "NoRunner") return "Clear";
  if (named === true && own === true) return "Clear";
  return route === undefined ||
    standing === undefined ||
    named === undefined ||
    (named && own === undefined)
    ? "Held"
    : "NoRunner";
}
