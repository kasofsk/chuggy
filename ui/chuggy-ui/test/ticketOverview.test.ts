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

/** A run registered, taken and ended where a case says, still going where
 * it names no end and untaken where it names no taking. */
function run(
  task: number,
  registeredAt: string,
  takenAt?: string,
  terminalAt?: string,
) {
  return ledgerExecution({
    execution: `e-${String(task)}`,
    task,
    identity: workIdentity(task),
    registeredAt,
    ...(takenAt === undefined ? { untaken: true } : { takenAt }),
    ...(terminalAt === undefined ? { status: "Running" } : { terminalAt }),
  });
}

test("the run time and the wait are each the runs' summed, the gap between runs in neither, and none before the first run", () => {
  const ran = [
    run(
      1,
      "2026-11-07T10:00:00Z",
      "2026-11-07T10:23:00Z",
      "2026-11-07T10:25:00Z",
    ),
    run(
      2,
      "2026-11-07T11:00:00Z",
      "2026-11-07T11:00:30Z",
      "2026-11-07T11:00:37Z",
    ),
  ];
  const nowMs = Date.parse("2026-11-07T12:00:00Z");
  expect(ticketOverviewRunTime(ran, nowMs)).toEqual({
    ran: { kind: "Duration", text: "2m 07s" },
    waited: { kind: "Duration", text: "23m 30s" },
  });
  expect(ticketOverviewRunning(ran)).toBe(false);
  expect(ticketOverviewRunTime([], nowMs)).toBeUndefined();
});

test("a run still going counts to now, and makes every sum one still growing", () => {
  const going = [run(1, "2026-11-07T11:50:00Z", "2026-11-07T11:58:48Z")];
  expect(
    ticketOverviewRunTime(going, Date.parse("2026-11-07T12:00:00Z")),
  ).toEqual({
    ran: { kind: "Duration", text: "1m 12s" },
    waited: { kind: "Duration", text: "8m 48s" },
  });
  expect(ticketOverviewRunning(going)).toBe(true);
});

test("a run nothing has taken adds no run time, and its wait grows with now", () => {
  const ended = run(
    1,
    "2026-11-07T10:00:00Z",
    "2026-11-07T10:23:00Z",
    "2026-11-07T10:25:00Z",
  );
  const waiting = run(2, "2026-11-07T11:00:00Z");
  expect(
    ticketOverviewRunTime([ended, waiting], Date.parse("2026-11-07T11:05:00Z")),
  ).toEqual({
    ran: { kind: "Duration", text: "2m" },
    waited: { kind: "Duration", text: "28m" },
  });
  expect(
    ticketOverviewRunTime([ended, waiting], Date.parse("2026-11-07T11:10:00Z"))
      ?.waited,
  ).toEqual({ kind: "Duration", text: "33m" });
  expect(
    ticketOverviewRunTime([waiting], Date.parse("2026-11-07T11:05:00Z"))?.ran
      .kind,
  ).toBe("Absent");
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
