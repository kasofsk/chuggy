/**
 * What a reader is told about the runner a session's turn would wait on:
 * nothing where the route is the cluster's or a runner is live, and otherwise
 * the one word for why none can take the turn now.
 *
 * WHOSE RUNNER IS THE CALLER'S CHOICE. A member's thread runs only on their
 * chat host or their own personal runner, their inquiries only on their chat
 * host, and the lead on any of the project's pools, so the placement read
 * answers each standing and each surface passes the one its turns would wait
 * on.
 */

import type { SessionPlacementResponse } from "../../../../src/contract/responses.ts";
import { noRunnerCode } from "../../../../src/contract/rosters.ts";
import type {
  PlacementRoute,
  SessionRunnerStanding,
} from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";

/**
 * How often a project's session placement is read again. No frame says a
 * runner polled, so this is what moves a standing on screen; it is a fraction
 * of `sessionRunnerPolledSecsMax`, the window the server keeps a runner live
 * for, which `test/ui/sessionPlacementPolled.test.ts` holds it to.
 */
export const sessionPlacementPolledMs = 15_000;

/** Why no runner can take a turn now: none is registered, or none has polled lately. */
export type SessionRunnerShort = "NoRunner" | "RunnerOffline";

export function sessionRunnerShort(
  route: PlacementRoute,
  standing: SessionRunnerStanding,
): SessionRunnerShort | undefined {
  if (route === "InCluster") return undefined;
  switch (standing) {
    case "Unregistered":
      return "NoRunner";
    case "Offline":
      return "RunnerOffline";
    case "Live":
      return undefined;
  }
}

/** Whether a session door refused because the reader has registered no runner
 * where the session's turns go to runners. */
export function sessionRefusedNoRunner(result: ApiResult<unknown>): boolean {
  return result.outcome === "Rejected" && result.code === noRunnerCode;
}

/** The session a notice speaks for: a member's thread, their inquiry, or the lead. */
export type SessionRunnerSession = "Thread" | "Inquiry" | "Lead";

/** Where a reader adds the runner a session's turn waits on. */
export type SessionRunnerAdded = "MyRunner" | "Runners";

/** A thread and an inquiry run only on their member's own machines, so one is
 * added on their own page; the lead runs on a project's pools. */
export function sessionRunnerAdded(
  session: SessionRunnerSession,
): SessionRunnerAdded {
  switch (session) {
    case "Thread":
    case "Inquiry":
      return "MyRunner";
    case "Lead":
      return "Runners";
  }
}

export function sessionRunnerShortWord(short: SessionRunnerShort): string {
  switch (short) {
    case "NoRunner":
      return "No runner";
    case "RunnerOffline":
      return "Runner offline";
  }
}

/** The word for why no runner can take one session's turn, said of the
 * machine it waits on: an inquiry waits on its member's chat host alone. */
export function sessionRunnerNoticeWord(
  short: SessionRunnerShort,
  session: SessionRunnerSession,
): string {
  if (session !== "Inquiry") return sessionRunnerShortWord(short);
  switch (short) {
    case "NoRunner":
      return "No chat host";
    case "RunnerOffline":
      return "Chat host offline";
  }
}

/** Why no runner can take one session's turn, from a placement read: the
 * session's own route and the runners the caller says its turns wait on. A
 * server that does not read those runners' standing says nothing of them. */
export function sessionPlacementShort(
  read: SessionPlacementResponse | undefined,
  session: "thread" | "lead",
  runners: keyof SessionPlacementResponse["runners"],
): SessionRunnerShort | undefined {
  const standing = read?.runners[runners];
  return read === undefined || standing === undefined
    ? undefined
    : sessionRunnerShort(read[session].route, standing);
}
