/**
 * A member's own runners, derived: the words for a project's fallback, how one
 * runner is told from another, whether one more may be registered, the
 * projects they may be given, when a run waits on the reader's runners, what
 * taking a member's runners off came to, and where a session's missing runner
 * is added.
 */

import { expect, test } from "vitest";

import { personalRunnersMax } from "../../../src/contract/http.ts";
import type { PersonalRunnerResponse } from "../../../src/contract/responses.ts";
import {
  memberRunnerRemoved,
  myRunnerAddable,
  myRunnerRemovalLine,
  myRunnerRoom,
  myRunnersCountLine,
  myRunnerShort,
  ownerFallbackAbout,
  ownerFallbackChoices,
  ownerFallbackChosen,
  ownerFallbackLabel,
  ownerFallbackValue,
  runnerWait,
  runnerWaitWord,
} from "../app/core/myRunner.ts";
import {
  sessionRunnerAdded,
  sessionRunnerNoticeWord,
} from "../app/core/sessionRunners.ts";
import { ledgerExecution, workIdentity } from "./ticketLedgerFixture.ts";

const held = {
  id: "chuggy-personal-1",
  capabilities: ["Platform:Linux:Amd64"],
  registeredAt: "2026-10-01T00:00:00Z",
  live: true,
  executionsLive: true,
};

const runner: PersonalRunnerResponse = { runners: [held], projects: ["atlas"] };

/** The reader's runners, each live for threads and for executions as named. */
function runnersLive(
  ...live: readonly (readonly [boolean, boolean])[]
): PersonalRunnerResponse {
  return {
    ...runner,
    runners: live.map(([threads, executions], index) => ({
      ...held,
      id: `chuggy-personal-${String(index + 1)}`,
      live: threads,
      executionsLive: executions,
    })),
  };
}

/** A run of the reader's, routed to runners under `Strict`, whose worker has not begun. */
const waiting = {
  ...ledgerExecution({
    execution: "execution-1",
    task: 1,
    identity: workIdentity(1),
    status: "Launching",
    carrier: "Agent",
  }),
  mine: true,
  ownerFallback: "Strict" as const,
};

test("each fallback is chosen by its own value, none included, and said in its own plain line", () => {
  expect(ownerFallbackChoices.map(ownerFallbackLabel)).toStrictEqual([
    "None",
    "Strict",
    "Preferred",
  ]);
  for (const fallback of ownerFallbackChoices)
    expect(ownerFallbackChosen(ownerFallbackValue(fallback))).toStrictEqual({
      fallback,
    });
  expect(ownerFallbackChosen("Sometimes")).toBeUndefined();
  expect(ownerFallbackAbout(undefined)).toBe(
    "Personal runners take no work started from now on.",
  );
  expect(new Set(ownerFallbackChoices.map(ownerFallbackAbout)).size).toBe(
    ownerFallbackChoices.length,
  );
});

test("a runner is offered the workspace's projects the reader reads and it does not yet serve, in name order", () => {
  expect(
    myRunnerAddable(
      [
        { tenant: "acme", project: "zephyr" },
        { tenant: "acme", project: "atlas" },
        { tenant: "other", project: "borealis" },
        { tenant: "acme", project: "borealis" },
      ],
      "acme",
      runner,
    ),
  ).toStrictEqual(["borealis", "zephyr"]);
});

test("a runner minted with a UUID is told by the UUID's first part, and any other id by the whole of it", () => {
  expect(
    myRunnerShort("chuggy-personal-3f2a9c1e-0b7d-4e21-9a43-5c1d2e3f4a5b"),
  ).toBe("3f2a9c1e");
  expect(myRunnerShort("chuggy-personal-1")).toBe("chuggy-personal-1");
  expect(myRunnerRemovalLine("3f2a9c1e", false)).toContain("3f2a9c1e");
  expect(myRunnerRemovalLine("3f2a9c1e", true)).toContain("project list");
});

test("a member's runners are counted, and one more may be registered only below the bound", () => {
  expect([0, 1, 2].map((count) => myRunnersCountLine(count))).toStrictEqual([
    "0 runners",
    "1 runner",
    "2 runners",
  ]);
  const holding = (count: number): PersonalRunnerResponse => ({
    ...runner,
    runners: Array.from({ length: count }, (_, index) => ({
      ...held,
      id: `chuggy-personal-${String(index)}`,
    })),
  });
  expect(myRunnerRoom(undefined)).toBe(true);
  expect(myRunnerRoom(holding(1))).toBe(true);
  expect(myRunnerRoom(holding(personalRunnersMax - 1))).toBe(true);
  expect(myRunnerRoom(holding(personalRunnersMax))).toBe(false);
});

test("a run of the reader's that has not begun waits on their runner while it is live", () => {
  expect(runnerWait(waiting, runner, "atlas")).toBe("Waiting");
  expect(
    runnerWait({ ...waiting, ownerFallback: "Preferred" }, runner, "atlas"),
  ).toBe("Waiting");
  expect(runnerWaitWord("Waiting")).toBe("Waiting on your runners");
});

/** Under Preferred a pool takes it while the runner is down, so it waits on nothing of the reader's. */
test("an offline runner holds a run under Strict alone", () => {
  const offline = runnersLive([false, false]);
  expect(runnerWait(waiting, offline, "atlas")).toBe("Offline");
  expect(
    runnerWait(waiting, runnersLive([false, false], [false, false]), "atlas"),
  ).toBe("Offline");
  expect(
    runnerWait({ ...waiting, ownerFallback: "Preferred" }, offline, "atlas"),
  ).toBeUndefined();
  expect(runnerWaitWord("Offline")).toBe("Waiting on your runners · offline");
});

/** A pool's claim defers under Preferred only to a runner polling for
 * executions, so one polling for its threads alone holds nothing back. */
test("a runner live for its threads alone holds a run under Strict, and under Preferred leaves it to a pool", () => {
  const threadsOnly = runnersLive([true, false]);
  expect(runnerWait(waiting, threadsOnly, "atlas")).toBe("Offline");
  expect(
    runnerWait(
      { ...waiting, ownerFallback: "Preferred" },
      threadsOnly,
      "atlas",
    ),
  ).toBeUndefined();
});

test("a run waits on the reader's runners while any one of them polls for executions", () => {
  const either = runnersLive([false, false], [true, true]);
  expect(
    runnerWait({ ...waiting, ownerFallback: "Preferred" }, either, "atlas"),
  ).toBe("Waiting");
});

test.each([
  ["another member's", { ...waiting, mine: false }, runner, "atlas"],
  [
    "a read that predates ownership",
    { ...waiting, mine: undefined },
    runner,
    "atlas",
  ],
  [
    "one no personal runner may take",
    { ...waiting, ownerFallback: undefined },
    runner,
    "atlas",
  ],
  [
    "one still queued",
    { ...waiting, status: "Queued" as const },
    runner,
    "atlas",
  ],
  [
    "one whose worker began",
    { ...waiting, runStartedAt: "2026-10-01T00:02:00Z" },
    runner,
    "atlas",
  ],
  ["one where the reader has no runner", waiting, undefined, "atlas"],
  ["one in a project their runner does not serve", waiting, runner, "borealis"],
])(
  "%s run waits on no runner of the reader's",
  (_case, execution, held, project) => {
    expect(runnerWait(execution, held, project)).toBeUndefined();
  },
);

test("taking a member's runners off says whether there were any it could take", () => {
  expect(memberRunnerRemoved({ outcome: "Ok", value: undefined })).toBe(
    "Runners removed",
  );
  expect(memberRunnerRemoved({ outcome: "Absent" })).toBe(
    "No runner you may remove",
  );
  expect(
    memberRunnerRemoved({ outcome: "Fault", code: "Internal", status: 500 }),
  ).toMatch(/^Refused · /u);
});

test("a thread's, an inquiry's and a member's own chat's missing runner is added on the member's own page, and the lead's on the project's", () => {
  expect(sessionRunnerAdded("Thread")).toBe("MyRunner");
  expect(sessionRunnerAdded("Inquiry")).toBe("MyRunner");
  expect(sessionRunnerAdded("Chat")).toBe("MyRunner");
  expect(sessionRunnerAdded("Lead")).toBe("Runners");
});

test("a thread's, an inquiry's and a member's own chat's missing runner is named their chat host, and the lead's a runner", () => {
  for (const session of ["Thread", "Inquiry", "Chat"] as const) {
    expect(sessionRunnerNoticeWord("NoRunner", session)).toBe("No chat host");
    expect(sessionRunnerNoticeWord("RunnerOffline", session)).toBe(
      "Chat host offline",
    );
  }
  expect(sessionRunnerNoticeWord("NoRunner", "Lead")).toBe("No runner");
  expect(sessionRunnerNoticeWord("RunnerOffline", "Lead")).toBe(
    "Runner offline",
  );
});
