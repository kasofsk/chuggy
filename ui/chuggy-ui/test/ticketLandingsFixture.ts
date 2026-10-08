/**
 * What the read of a ticket's landings answers, as the bodies the landing
 * suites draw from: ticket 68's second cycle, whose landing failed on a merge
 * conflict, and a landing at each state a row says something different of.
 */

import type {
  TicketLandingResponse,
  TicketLandingsResponse,
} from "../../../src/contract/responses.ts";
import type { ExecutionShape } from "./ticketLedgerFixture.ts";
import { evalIdentity, workIdentity } from "./ticketLedgerFixture.ts";

export const landingTargetCommit = `7c1e04a9${"2".repeat(32)}`;
export const landingCandidateCommit = `b51d9f03${"3".repeat(32)}`;
export const landingLandedCommit = `e0f3a7c2${"4".repeat(32)}`;
export const landingConflictPath = "ui/chuggy-ui/app/core/tones.ts";
export const landingPullRequest =
  "https://forge.example.test/acme/atlas/pull/68";
export const landingPreparedAt = "2026-10-07T14:02:11.000000Z";

/** The newest attempt of a landing, prepared or failed as a case says. */
const landingAttempt = {
  outcome: "Prepared",
  targetRef: "refs/heads/main",
  targetCommit: landingTargetCommit,
  candidateCommit: landingCandidateCommit,
  preparedAt: landingPreparedAt,
} as const;

/** A landing of `cycle` that failed on a merge conflict naming one path. */
export function landingConflicted(cycle: number): TicketLandingResponse {
  return {
    cycle,
    generation: 1,
    attempts: 1,
    state: "Failed",
    attempt: {
      ...landingAttempt,
      outcome: "Failed",
      failureKind: "MergeConflict",
    },
    conflict: { paths: [landingConflictPath], truncated: false },
  };
}

/** A landing of `cycle` that opened a pull request at `url` and landed. */
export function landingLanded(
  cycle: number,
  url: string = landingPullRequest,
): TicketLandingResponse {
  return {
    cycle,
    generation: 1,
    attempts: 1,
    state: "Landed",
    attempt: landingAttempt,
    landedCommit: landingLandedCommit,
    proposal: {
      url,
      headRef: "chug/ticket-68",
      baseRef: "main",
      creation: "Created",
      merge: "Merged",
      mergeability: "Mergeable",
      mergeCommit: landingLandedCommit,
    },
  };
}

/** A landing of `cycle` still running, its pull request open. */
export function landingRunning(cycle: number): TicketLandingResponse {
  return {
    cycle,
    generation: 1,
    attempts: 1,
    state: "Running",
    attempt: landingAttempt,
    proposal: {
      url: landingPullRequest,
      headRef: "chug/ticket-68",
      baseRef: "main",
      mergeability: "Unknown",
    },
  };
}

/** A landing of `cycle` held on an unreadable target since `since`. */
export function landingHeld(
  cycle: number,
  since: string,
): TicketLandingResponse {
  return {
    cycle,
    generation: 1,
    attempts: 2,
    state: "Held",
    hold: { kind: "TargetUnreadable", passes: 3, since },
  };
}

/** The read's answer over `landings`, oldest first. */
export function landingsRead(
  landings: readonly TicketLandingResponse[],
): TicketLandingsResponse {
  return { landings: [...landings], truncated: false };
}

/**
 * Ticket 68's journal on ticket 21's builders: a cycle its first stage sent
 * back, a second that passed its work and both stages, and a third at work.
 */
export const ticket68Shapes: readonly ExecutionShape[] = [
  {
    execution: "work-1",
    task: 1,
    identity: workIdentity(1),
    outcome: "Passed",
  },
  {
    execution: "eval-1-1",
    task: 2,
    identity: evalIdentity(1, 1, 1),
    outcome: "Failed",
  },
  {
    execution: "work-2",
    task: 3,
    identity: workIdentity(2),
    outcome: "Passed",
  },
  {
    execution: "eval-2-1",
    task: 4,
    identity: evalIdentity(2, 1, 1),
    outcome: "Passed",
  },
  {
    execution: "eval-2-2",
    task: 5,
    identity: evalIdentity(2, 2, 1),
    outcome: "Passed",
  },
  {
    execution: "work-3",
    task: 6,
    identity: workIdentity(3),
    status: "Running",
  },
];
