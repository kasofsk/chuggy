// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import {
  assistantLine,
  configurationReads,
  runAttempt,
  runConfigurationRef,
  runEvidenceOf,
  runPageDrawn,
  runSnapshot,
  runSummary,
  runTranscriptPage,
  transcriptReads,
} from "./runPageFixture.tsx";
import type { RunPageServed } from "./runPageFixture.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { ticketHeader } from "./ticketPageEveryTab.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

const pageClock = vi.hoisted(() => ({ atMs: undefined as number | undefined }));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  nowMs: () => pageClock.atMs ?? Date.now(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useParams: () => ({ ...atlas, ticket: "11" }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

/**
 * The Now card over a ticket whose work is running.
 *
 * The card is read at a glance, so what it must not get wrong is which step
 * is running in which cycle, and the one thing the run is doing now: the call
 * still out, or else its newest note. Its transcript is the run page's, which
 * the card links to and never reads the prompt for.
 */

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  pageClock.atMs = undefined;
  cleanup();
  vi.unstubAllGlobals();
});

const runningTicket = {
  ticket: 11,
  phase: "Work",
  sequence: 7,
  program: [],
  ...ticketInstants,
};

const running = runSummary({
  status: "Running",
  outcome: undefined,
  runTotals: undefined,
});

function toolUse(id: string, name: string, input: unknown): string {
  return JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
}

function toolResult(id: string): string {
  return JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
    },
  });
}

/** Six notes, a call answered between them, and a second call still out. */
const recorded: Record<number, string> = {
  1: assistantLine("First note"),
  2: assistantLine("Second note"),
  3: assistantLine("Third note"),
  4: `${assistantLine("Fourth note")}\n${toolUse("t1", "Bash", { command: "npm test" })}`,
  5: toolResult("t1"),
  6: assistantLine("Fifth note"),
  7: assistantLine("Sixth note"),
  8: toolUse("t2", "Read", { file_path: "app/footer.tsx" }),
};

function runningRun(
  run: Record<string, unknown> | undefined,
  over: Partial<RunPageServed> = {},
): RunPageServed {
  return {
    ticket: runningTicket,
    executions: [running],
    execution: {
      ...running,
      attempts: [runAttempt("a1", { state: "Running", run })],
    },
    transcripts: [
      runTranscriptPage([1, 2, 3, 4, 5, 6, 7, 8], false, (batch) =>
        String(recorded[batch]),
      ),
    ],
    configuration: runSnapshot("**Build** the footer."),
    ...over,
  };
}

const transcribed = runEvidenceOf(8, { configuration: runConfigurationRef });

function nowCard(): HTMLElement {
  return screen.getByRole("region", { name: "Now" });
}

test("the card names the step running and its cycle, the call it waits on, and links to watch it", async () => {
  const drawn = await runPageDrawn(atlas, runningRun(transcribed));
  const card = nowCard();
  expect(card.querySelector(".ticket-card-title")?.textContent).toBe(
    "Running Work",
  );
  expect(card.querySelector(".ticket-card-where")?.textContent).toContain(
    "Cycle 1 · ",
  );
  expect(card.querySelector(".ticket-card-line")?.textContent).toBe(
    "Now: Read · app/footer.tsx",
  );
  expect(within(card).getByText("Watch").closest("a")).not.toBeNull();
  expect(within(card).queryByRole("button")).toBeNull();
  expect(configurationReads(drawn.reads)).toBe(0);
});

test("a run with no call out says the newest thing it said", async () => {
  await runPageDrawn(
    atlas,
    runningRun(runEvidenceOf(7, { configuration: runConfigurationRef }), {
      transcripts: [
        runTranscriptPage([1, 2, 3, 4, 5, 6, 7], false, (batch) =>
          String(recorded[batch]),
        ),
      ],
    }),
  );
  expect(nowCard().querySelector(".ticket-card-line")?.textContent).toBe(
    "Now: Sixth note",
  );
});

/** A command writes no transcript, so there is nothing it is doing to name
 * — only that it is running. */
test("a stage with no transcript says it is running, and reads none", async () => {
  const drawn = await runPageDrawn(
    atlas,
    runningRun(runEvidenceOf(0, { transcript: undefined })),
  );
  const card = nowCard();
  expect(card.querySelector(".ticket-card-title")?.textContent).toBe(
    "Running Work",
  );
  expect(card.querySelector(".ticket-card-line")).toBeNull();
  expect(transcriptReads(drawn.reads)).toEqual([]);
});

/** What a time drawn in a part of the page says: the run's, and its wait. */
function runTimeIn(part: Element | null): readonly unknown[] {
  return [
    part?.querySelector(".ticket-run-time-main")?.textContent,
    part?.querySelector(".ticket-run-time-waited")?.textContent,
  ];
}

test("the card and the header count the step's time from when its run was taken, the image pull included", async () => {
  pageClock.atMs = Date.parse("2026-08-27T00:25:00Z");
  const taken = { ...running, takenAt: "2026-08-27T00:20:00Z" };
  await runPageDrawn(atlas, {
    ...runningRun(
      runEvidenceOf(8, {
        configuration: runConfigurationRef,
        startedAt: "2026-08-27T00:21:00Z",
      }),
    ),
    executions: [taken],
    execution: {
      ...taken,
      attempts: [
        runAttempt("a1", {
          state: "Running",
          run: runEvidenceOf(8, {
            configuration: runConfigurationRef,
            startedAt: "2026-08-27T00:21:00Z",
          }),
        }),
      ],
    },
  });
  expect(runTimeIn(nowCard().querySelector(".ticket-card-where"))).toEqual([
    "5m",
    "waited 20m",
  ]);
  expect(
    runTimeIn(ticketHeader().querySelector(".ticket-header-fragment")),
  ).toEqual(["5m", "waited 20m"]);
});

test("a step whose run nothing has taken says it waits, and for how long", async () => {
  pageClock.atMs = Date.parse("2026-08-27T00:25:00Z");
  const waiting = runSummary({
    status: "Launching",
    outcome: undefined,
    runTotals: undefined,
  });
  await runPageDrawn(atlas, {
    ...runningRun(undefined),
    executions: [waiting],
    execution: {
      ...waiting,
      attempts: [runAttempt("a1", { state: "Placing", run: undefined })],
    },
    transcripts: [],
  });
  expect(runTimeIn(nowCard().querySelector(".ticket-card-where"))).toEqual([
    "Waiting",
    "25m",
  ]);
  expect(
    runTimeIn(ticketHeader().querySelector(".ticket-header-fragment")),
  ).toEqual(["Waiting", "25m"]);
});

/** The reader's own run, routed to runners under Strict, its worker not begun. */
function ownRunStarting(
  personalRunner: Record<string, unknown> | undefined,
): RunPageServed {
  const starting = runSummary({
    status: "Launching",
    outcome: undefined,
    runTotals: undefined,
    carrier: "Agent",
    mine: true,
    ownerFallback: "Strict",
  });
  return {
    ticket: runningTicket,
    executions: [starting],
    execution: { ...starting, attempts: [] },
    transcripts: [],
    ...(personalRunner === undefined ? {} : { personalRunner }),
  };
}

const ownRunner = {
  runners: [
    {
      id: "chuggy-personal-1",
      capabilities: ["Platform:Linux:Amd64"],
      registeredAt: "2026-08-27T00:00:00Z",
      live: false,
      executionsLive: false,
    },
  ],
  projects: ["atlas"],
};

test("the reader's own run that their offline runner holds says it waits on it, and where it is managed", async () => {
  await runPageDrawn(atlas, ownRunStarting(ownRunner));
  const card = nowCard();
  expect(card.textContent).toContain(
    "Waiting on your personal runners · offline",
  );
  expect(
    within(card).getByRole("link", { name: "Personal runners" }),
  ).toBeTruthy();
});

test("the reader's own run waits on their runners, not offline, while any one of them is live", async () => {
  const [offline] = ownRunner.runners;
  await runPageDrawn(
    atlas,
    ownRunStarting({
      ...ownRunner,
      runners: [
        offline,
        {
          ...offline,
          id: "chuggy-personal-2",
          live: true,
          executionsLive: true,
        },
      ],
    }),
  );
  const card = nowCard();
  expect(card.textContent).toContain("Waiting on your personal runners");
  expect(card.textContent).not.toContain("offline");
});

test("the reader's own run says nothing of a runner they do not have", async () => {
  await runPageDrawn(atlas, ownRunStarting(undefined));
  expect(nowCard().textContent).not.toContain("Waiting on your runner");
});

const pausedUntil = "2026-08-27T14:05:00Z";

/** The reader's own run waiting on their live runner, whose account the server
 * says has the run's agent paused, or another member's run carrying the same. */
function pausedRun(mine: boolean): RunPageServed {
  const starting = runSummary({
    status: "Launching",
    outcome: undefined,
    runTotals: undefined,
    carrier: "Agent",
    mine,
    ownerFallback: "Strict",
    paused: { until: pausedUntil, reasons: ["five_hour"], pressed: false },
  });
  const [offline] = ownRunner.runners;
  return {
    ticket: runningTicket,
    executions: [starting],
    execution: { ...starting, attempts: [] },
    transcripts: [],
    personalRunner: {
      ...ownRunner,
      runners: [{ ...offline, live: true, executionsLive: true }],
    },
  };
}

test("the reader's own waiting run whose agent their account has paused says so, why, until when, and where it is set", async () => {
  await runPageDrawn(atlas, pausedRun(true));
  const card = nowCard();
  expect(card.textContent).toContain("Paused · Five-hour window · until ");
  expect(card.textContent).not.toContain("Waiting on your personal runners");
  expect(within(card).getByRole("link", { name: "Usage" })).toBeTruthy();
});

test("another member's waiting run says nothing of a pause", async () => {
  await runPageDrawn(atlas, pausedRun(false));
  const card = nowCard();
  expect(card.textContent).not.toContain("Paused");
  expect(within(card).queryByRole("link", { name: "Usage" })).toBeNull();
});

test("the reader's own run waiting on no runner of theirs keeps its line and says nothing of a pause", async () => {
  const served = pausedRun(true);
  await runPageDrawn(atlas, {
    ...served,
    personalRunner: { ...ownRunner, projects: ["borealis"] },
  });
  const card = nowCard();
  expect(card.textContent).not.toContain("Paused");
  expect(card.textContent).not.toContain("Waiting on your runner");
});

function stillRunning(batch: number): string {
  return JSON.stringify({
    type: "tool_progress",
    tool_name: "Bash",
    elapsed_time_seconds: batch * 30,
  });
}

/**
 * A card opened while the run waits on a long command. The run has written
 * nothing since but that the command is still running, a batch at a time, so
 * the newest batches the card reads draw nothing, and what the run last said
 * and the call it is waiting on are beneath them.
 */
test("a card opened while a long command runs reads back to what the run last said", async () => {
  const page = (from: number, said: boolean): Record<string, unknown> =>
    runTranscriptPage(
      Array.from({ length: 8 }, (_, at) => from + at),
      false,
      said ? (batch) => String(recorded[batch - 8]) : stillRunning,
    );
  const drawn = await runPageDrawn(
    atlas,
    runningRun(runEvidenceOf(40, { configuration: runConfigurationRef }), {
      transcripts: [
        page(25, false),
        page(33, false),
        page(17, false),
        page(9, true),
      ],
    }),
  );
  expect(transcriptReads(drawn.reads)).toEqual([
    "?after=24",
    "?after=32",
    "?after=16",
    "?after=8",
  ]);
  expect(nowCard().querySelector(".ticket-card-line")?.textContent).toBe(
    "Now: Read · app/footer.tsx",
  );
});
