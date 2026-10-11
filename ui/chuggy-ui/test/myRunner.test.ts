/**
 * A member's own runner, derived: the words for a project's fallback, the
 * projects a runner may be given, when a run waits on the reader's runner, what
 * taking a member's runner off came to, and where a session's missing runner is
 * added.
 */

import { expect, test } from "vitest";

import type { PersonalRunnerResponse } from "../../../src/contract/responses.ts";
import {
  memberRunnerRemoved,
  myRunnerAddable,
  ownerFallbackAbout,
  ownerFallbackChoices,
  ownerFallbackChosen,
  ownerFallbackLabel,
  ownerFallbackValue,
  runnerWait,
  runnerWaitWord,
} from "../app/core/myRunner.ts";
import { sessionRunnerAdded } from "../app/core/sessionRunners.ts";
import { ledgerExecution, workIdentity } from "./ticketLedgerFixture.ts";

const runner: PersonalRunnerResponse = {
  capabilities: ["Platform:Linux:Amd64"],
  registeredAt: "2026-10-01T00:00:00Z",
  live: true,
  executionsLive: true,
  projects: ["atlas"],
};

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

test("a run of the reader's that has not begun waits on their runner while it is live", () => {
  expect(runnerWait(waiting, runner, "atlas")).toBe("Waiting");
  expect(
    runnerWait({ ...waiting, ownerFallback: "Preferred" }, runner, "atlas"),
  ).toBe("Waiting");
  expect(runnerWaitWord("Waiting")).toBe("Waiting on your runner");
});

/** Under Preferred a pool takes it while the runner is down, so it waits on nothing of the reader's. */
test("an offline runner holds a run under Strict alone", () => {
  const offline = { ...runner, live: false, executionsLive: false };
  expect(runnerWait(waiting, offline, "atlas")).toBe("Offline");
  expect(
    runnerWait({ ...waiting, ownerFallback: "Preferred" }, offline, "atlas"),
  ).toBeUndefined();
  expect(runnerWaitWord("Offline")).toBe("Waiting on your runner · offline");
});

/** A pool's claim defers under Preferred only to a runner polling for
 * executions, so one polling for its threads alone holds nothing back. */
test("a runner live for its threads alone holds a run under Strict, and under Preferred leaves it to a pool", () => {
  const threadsOnly = { ...runner, live: true, executionsLive: false };
  expect(runnerWait(waiting, threadsOnly, "atlas")).toBe("Offline");
  expect(
    runnerWait(
      { ...waiting, ownerFallback: "Preferred" },
      threadsOnly,
      "atlas",
    ),
  ).toBeUndefined();
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

test("taking a member's runner off says whether there was one it could take", () => {
  expect(memberRunnerRemoved({ outcome: "Ok", value: undefined })).toBe(
    "Runner removed",
  );
  expect(memberRunnerRemoved({ outcome: "Absent" })).toBe(
    "No runner you may remove",
  );
  expect(
    memberRunnerRemoved({ outcome: "Fault", code: "Internal", status: 500 }),
  ).toMatch(/^Refused · /u);
});

test("a thread's missing runner is added on the member's own page, and the lead's and an inquiry's on the project's", () => {
  expect(sessionRunnerAdded("Thread")).toBe("MyRunner");
  expect(sessionRunnerAdded("Inquiry")).toBe("Runners");
  expect(sessionRunnerAdded("Lead")).toBe("Runners");
});
