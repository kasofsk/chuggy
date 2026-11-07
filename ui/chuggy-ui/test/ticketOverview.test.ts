/**
 * What the Overview's sidebar and banner say of a ticket: its branch and
 * where it lands by their names, each dependency at its phase, how long its
 * runs took between them, and how many edits its draft holds unreleased.
 */

import { expect, test } from "vitest";

import type {
  DraftResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import { ticketLandingOf } from "../app/core/ticketLandings.ts";
import {
  ticketOverviewBranchOf,
  ticketOverviewDependenciesOf,
  ticketOverviewRunning,
  ticketOverviewRunTime,
  ticketOverviewUnreleased,
} from "../app/core/ticketOverview.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { landingConflicted } from "./ticketLandingsFixture.ts";
import { ledgerExecution, workIdentity } from "./ticketLedgerFixture.ts";

function ticket(over: Partial<TicketResponse> = {}): TicketResponse {
  return {
    ticket: 335,
    phase: "Pending",
    sequence: 1,
    ...ticketInstants,
    ...over,
  };
}

const brief = {
  intent: "Lock the contract",
  links: [],
  branch: "refs/heads/contract/thread-offer-tools",
};

test("the branch and the one it lands on are drawn by their names", () => {
  expect(
    ticketOverviewBranchOf(
      ticket({
        brief: {
          ...brief,
          finalization: {
            kind: "PullRequest",
            target: "refs/heads/release",
          },
        },
      }),
      [],
    ),
  ).toEqual({ branch: "contract/thread-offer-tools", target: "release" });
});

test("a target the brief left to its repository is the one its landing named, and none before a landing", () => {
  const unnamed = ticket({
    brief: {
      ...brief,
      finalization: {
        kind: "GitMerge",
        mode: "PullRequestMerge",
        policy: "Direct",
      },
    },
  });
  expect(
    ticketOverviewBranchOf(unnamed, [ticketLandingOf(landingConflicted(1))]),
  ).toEqual({ branch: "contract/thread-offer-tools", target: "main" });
  expect(ticketOverviewBranchOf(unnamed, [])).toEqual({
    branch: "contract/thread-offer-tools",
    target: undefined,
  });
});

test("a ticket that lands nothing lands on no branch, and one whose brief names no branch draws none", () => {
  expect(
    ticketOverviewBranchOf(
      ticket({ brief: { ...brief, finalization: { kind: "None" } } }),
      [ticketLandingOf(landingConflicted(1))],
    ),
  ).toEqual({ branch: "contract/thread-offer-tools", target: undefined });
  expect(ticketOverviewBranchOf(ticket(), [])).toBeUndefined();
});

/** A run from `startedAt` to `terminalAt`, or still going where it has none. */
function run(task: number, startedAt: string, terminalAt?: string) {
  const row = ledgerExecution({
    execution: `e-${String(task)}`,
    task,
    identity: workIdentity(task),
    ...(terminalAt === undefined ? { status: "Running" } : { terminalAt }),
  });
  return { ...row, startedAt };
}

test("the run time is the runs' spans added, the wait between them left out, and none before the first run", () => {
  const ran = [
    run(1, "2026-08-26T10:00:00Z", "2026-08-26T10:05:25Z"),
    run(2, "2026-08-26T11:00:00Z", "2026-08-26T11:00:07Z"),
  ];
  const nowMs = Date.parse("2026-08-26T12:00:00Z");
  expect(ticketOverviewRunTime(ran, nowMs)).toEqual({
    kind: "Duration",
    text: "5m 32s",
  });
  expect(ticketOverviewRunning(ran)).toBe(false);
  expect(ticketOverviewRunTime([], nowMs)).toBeUndefined();
});

test("a run still going counts to now, and makes every sum one still growing", () => {
  const going = [run(1, "2026-08-26T11:58:48Z")];
  expect(
    ticketOverviewRunTime(going, Date.parse("2026-08-26T12:00:00Z")),
  ).toEqual({ kind: "Duration", text: "1m 12s" });
  expect(ticketOverviewRunning(going)).toBe(true);
});

test("each dependency is at its own phase: revoked, open, or else done", () => {
  expect(
    ticketOverviewDependenciesOf(
      ticket({
        dependencies: [200, 334, 336],
        revokedDependencies: [200],
        openDependencies: [{ ticket: 334, phase: "Work" }],
      }),
    ),
  ).toEqual([
    { ticket: 200, phase: "Revoked" },
    { ticket: 334, phase: "Work" },
    { ticket: 336, phase: "Done" },
  ]);
  expect(ticketOverviewDependenciesOf(ticket())).toEqual([]);
});

function draft(authoringVersion: number, released?: number): DraftResponse {
  return {
    partition: { tenant: "vteng", project: "chuggy" },
    ticket: 335,
    authoringVersion,
    ...(released === undefined ? {} : { releasedAuthoringVersion: released }),
    state: "Released",
    configurationRevision: "r1",
    authoring: { dependencies: [], program: [] },
  };
}

test("a draft ahead of its release counts its unreleased changes, and one at it or unrecorded has none", () => {
  expect(ticketOverviewUnreleased(draft(5, 3))).toBe("2 unreleased changes");
  expect(ticketOverviewUnreleased(draft(4, 3))).toBe("1 unreleased change");
  expect(ticketOverviewUnreleased(draft(3, 3))).toBeUndefined();
  expect(ticketOverviewUnreleased(draft(3))).toBeUndefined();
});
