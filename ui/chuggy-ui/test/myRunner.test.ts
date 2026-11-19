/**
 * A member's own runners, derived: how one runner is told from another, what it is running and how many wait in a
 * project, whether one more may be registered, the
 * projects they may be given, what a run says it waits on of the reader's runners, what
 * taking a member's runners off came to, and where a session's missing runner
 * is added.
 */

import { expect, test } from "vitest";

import { personalRunnersMax } from "../../../src/contract/http.ts";
import type { PersonalRunnerResponse } from "../../../src/contract/responses.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import { copyOrDataText } from "../app/core/copy.ts";
import {
  memberRunnerRemoved,
  myRunnerAddable,
  myRunnerHeldLabel,
  myRunnerLineProjects,
  myRunnerRemovalLine,
  myRunnerRoom,
  myRunnersCountLine,
  myRunnerShort,
  myRunnerWaitingLabel,
  runnerWait,
  runnerWaitPause,
  runnerWaitLine,
  runnerWaitRoom,
  runnerWaitRoomLine,
  runnerWaitWord,
} from "../app/core/myRunner.ts";
import { sessionRunnerNoticeWord } from "../app/core/sessionRunners.ts";
import { ledgerExecution, workIdentity } from "./ticketLedgerFixture.ts";

const held = {
  id: "chuggy-personal-1",
  capabilities: ["Platform:Linux:Amd64"],
  registeredAt: "2026-10-01T00:00:00Z",
  live: true,
  executionsLive: true,
  held: [],
  heldTruncated: false,
};

const runner: PersonalRunnerResponse = {
  runners: [held],
  projects: [
    {
      project: "atlas",
      priority: "Normal",
      waiting: 0,
      waitingTruncated: false,
    },
  ],
};

/** A run of the reader's, routed to runners, whose worker has not begun. */
const waiting = {
  ...ledgerExecution({
    execution: "execution-1",
    task: 1,
    identity: workIdentity(1),
    status: "Launching",
    carrier: "Agent",
  }),
  mine: true,
};

test("the register line is made for the project the page is framed in, or else for any of the workspace's projects the reader reads, in name order", () => {
  const readable = [
    { tenant: "acme", project: "zephyr" },
    { tenant: "other", project: "borealis" },
    { tenant: "acme", project: "atlas" },
  ];
  expect(myRunnerLineProjects(readable, "acme", "zephyr")).toStrictEqual([
    "zephyr",
  ]);
  expect(myRunnerLineProjects(readable, "acme", undefined)).toStrictEqual([
    "atlas",
    "zephyr",
  ]);
  expect(myRunnerLineProjects(readable, "none", undefined)).toStrictEqual([]);
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
  expect(copyTextEn(myRunnerRemovalLine("3f2a9c1e", false))).toContain(
    "3f2a9c1e",
  );
  expect(copyTextEn(myRunnerRemovalLine("3f2a9c1e", true))).toContain(
    "project list",
  );
});

test("a member's runners are counted, and one more may be registered only below the bound", () => {
  expect(
    [0, 1, 2].map((count) => copyTextEn(myRunnersCountLine(count))),
  ).toStrictEqual([
    "0 personal runners",
    "1 personal runner",
    "2 personal runners",
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

test.each([
  ["Live", undefined],
  ["Offline", "offline"],
  ["Unable", "none can run it"],
] as const)(
  "a run of the reader's that has not begun says the server's answer %s as one line and the state's own word",
  (wait, word) => {
    const answered = { ...waiting, personalRunnerWait: wait };
    expect(runnerWait(answered)).toBe(wait);
    expect(copyTextEn(runnerWaitLine)).toBe("Waiting on your personal runners");
    const said = runnerWaitWord(wait);
    expect(said === undefined ? undefined : copyTextEn(said)).toBe(word);
  },
);

test.each([
  ["another member's", { ...waiting, mine: false }],
  ["a read that predates ownership", { ...waiting, mine: undefined }],
  ["one still queued", { ...waiting, status: "Queued" as const }],
  [
    "one whose worker began",
    { ...waiting, runStartedAt: "2026-10-01T00:02:00Z" },
  ],
])("%s run waits on no runner of the reader's", (_case, execution) => {
  expect(
    runnerWait({ ...execution, personalRunnerWait: "Live" }),
  ).toBeUndefined();
});

/** A run admitted with no attempt opened, or one a runner has claimed, the server answers nothing of. */
test("a run the server answers no wait for says nothing of a runner", () => {
  expect(runnerWait(waiting)).toBeUndefined();
});

/** The server sends a pause only where every live runner a run waits on is held, and the console says it only there. */
test("a run of the reader's waiting on their live runners says the pause the server answered, and one waiting on offline runners says none", () => {
  const pause = {
    until: "2026-10-01T05:00:00Z",
    reasons: ["five_hour" as const],
    pressed: false,
  };
  const paused = {
    ...waiting,
    personalRunnerWait: "Live" as const,
    paused: pause,
  };
  expect(runnerWaitPause(paused, runnerWait(paused))).toStrictEqual(pause);
  const live = { ...waiting, personalRunnerWait: "Live" as const };
  expect(runnerWaitPause(live, runnerWait(live))).toBeUndefined();
  for (const wait of ["Offline", "Unable"] as const) {
    const held = { ...paused, personalRunnerWait: wait };
    expect(runnerWaitPause(held, runnerWait(held))).toBeUndefined();
  }
  const elsewhere = { ...paused, mine: false };
  expect(runnerWaitPause(elsewhere, runnerWait(elsewhere))).toBeUndefined();
});

/** The server sends a room only where every live runner a run waits on is short of memory, and the console says it only there, and not over a pause. */
test("a run of the reader's waiting on their live runners says the memory they are short of, and one paused, offline, unable or another member's says none", () => {
  const room = { freeMib: 1_434, neededMib: 4_096 };
  const short = {
    ...waiting,
    personalRunnerWait: "Live" as const,
    personalRunnerRoom: room,
  };
  expect(runnerWaitRoom(short)).toStrictEqual(room);
  expect(
    runnerWaitRoom({ ...waiting, personalRunnerWait: "Live" }),
  ).toBeUndefined();
  expect(
    runnerWaitRoom({
      ...short,
      paused: { until: "2026-10-01T05:00:00Z", reasons: [], pressed: false },
    }),
  ).toBeUndefined();
  for (const wait of ["Offline", "Unable"] as const)
    expect(
      runnerWaitRoom({ ...short, personalRunnerWait: wait }),
    ).toBeUndefined();
  expect(runnerWaitRoom({ ...short, mine: false })).toBeUndefined();
});

/** Whether a run is the reader's own is the server's to say, so a run naming
 * a fallback says its wait as one naming none does. */
test("a run of the reader's says its wait whatever fallback it names", () => {
  for (const ownerFallback of [undefined, "Strict", "Preferred"] as const)
    expect(
      runnerWait({ ...waiting, ownerFallback, personalRunnerWait: "Offline" }),
    ).toBe("Offline");
});

test("the memory a run's runners are short of is said in GiB", () => {
  expect(
    copyOrDataText(
      copyTextEn,
      runnerWaitRoomLine({ freeMib: 3_686, neededMib: 4_096 }),
    ),
  ).toBe("3.6 GiB free, needs 4 GiB");
});

test("taking a member's runners off says whether there were any it could take", () => {
  const removed = (result: Parameters<typeof memberRunnerRemoved>[0]): string =>
    copyOrDataText(copyTextEn, memberRunnerRemoved(result));
  expect(removed({ outcome: "Ok", value: undefined })).toBe(
    "Personal runners removed",
  );
  expect(removed({ outcome: "Absent" })).toBe(
    "No personal runner you may remove",
  );
  expect(removed({ outcome: "Fault", code: "Internal", status: 500 })).toBe(
    "Server error",
  );
});

test("a thread's and a member's own chat's missing runner is named their chat host", () => {
  expect(copyTextEn(sessionRunnerNoticeWord("NoRunner"))).toBe("No chat host");
  expect(copyTextEn(sessionRunnerNoticeWord("RunnerOffline"))).toBe(
    "Chat host offline",
  );
});

test("what a runner holds is named by its cycle's work, or by its stage and the cycle it judges", () => {
  expect(
    copyTextEn(
      myRunnerHeldLabel({ type: "WorkTask", value: { ticket: 7, cycle: 2 } }),
    ),
  ).toBe("Work · cycle 2");
  expect(
    copyTextEn(
      myRunnerHeldLabel({
        type: "EvaluationTask",
        value: {
          ticket: 7,
          workCycle: 3,
          stage: 1,
          generation: 1,
          evaluator: 2,
        },
      }),
    ),
  ).toBe("Stage 1 · cycle 3");
});

test("a project's count of what waits is the count, and the count marked where more wait than one read counts", () => {
  const served = runner.projects[0];
  if (served === undefined) throw new Error("no project planted");
  expect(
    copyOrDataText(copyTextEn, myRunnerWaitingLabel({ ...served, waiting: 4 })),
  ).toBe("4");
  expect(
    copyOrDataText(
      copyTextEn,
      myRunnerWaitingLabel({ ...served, waiting: 99, waitingTruncated: true }),
    ),
  ).toBe("99+");
});
