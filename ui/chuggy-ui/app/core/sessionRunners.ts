/**
 * What a reader is told about the runner a session's turn would wait on:
 * nothing where the route is the cluster's or a runner is live, and otherwise
 * the one word for why none can take the turn now.
 *
 * WHOSE RUNNER IS THE CALLER'S CHOICE. A member's thread and their inquiries
 * run only on a runner they registered, and the lead on any of the project's,
 * so the placement read answers both standings and each surface passes the one
 * its turns would wait on.
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

export function sessionRunnerShortWord(short: SessionRunnerShort): string {
  switch (short) {
    case "NoRunner":
      return "No runner";
    case "RunnerOffline":
      return "Runner offline";
  }
}

/** Why no runner can take one session's turn, from a placement read: the
 * session's own route and the runners the caller says its turns wait on. */
export function sessionPlacementShort(
  read: SessionPlacementResponse | undefined,
  session: "thread" | "lead",
  runners: keyof SessionPlacementResponse["runners"],
): SessionRunnerShort | undefined {
  return read === undefined
    ? undefined
    : sessionRunnerShort(read[session].route, read.runners[runners]);
}
