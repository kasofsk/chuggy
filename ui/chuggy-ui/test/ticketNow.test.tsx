// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { act, cleanup, screen, within } from "@testing-library/react";
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
import { sessionPlacementPolledMs } from "../app/core/sessionRunners.ts";
import { settled } from "./screenHarness.tsx";
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
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
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

/**
 * The parts of the card's notice line that each wrap whole, after asserting
 * nothing but a space stands between them: a line can then break only before
 * a part, and every part but the first opens with its dot.
 */
function nowLineParts(): readonly string[] {
  const line = nowCard().querySelector(".notice-inline");
  const parts = [...(line?.querySelectorAll(".whitespace-nowrap") ?? [])]
    .filter(
      (part) => part.parentElement?.closest(".whitespace-nowrap") === null,
    )
    .map((part) => part.textContent);
  expect(line?.textContent).toBe(parts.join(" "));
  return parts;
}

/** How many times the execution's own read was asked. */
function executionReads(reads: readonly string[]): number {
  return reads.filter((url) => url.endsWith("/executions/e1")).length;
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

/** The reader's own run, routed to runners under Strict, its worker not begun, carrying what the server answers it waits on of their runners. */
function ownRunSummary(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return runSummary({
    status: "Launching",
    outcome: undefined,
    runTotals: undefined,
    carrier: "Agent",
    mine: true,
    ownerFallback: "Strict",
    ...over,
  });
}

/** The reader's own run starting, its own read answering as `read` does at the moment it is asked. */
function ownRunStarting(
  read: () => Record<string, unknown>,
  over: Record<string, unknown> = {},
): RunPageServed {
  return {
    ticket: runningTicket,
    executions: [ownRunSummary(over)],
    execution: () => ({ ...read(), attempts: [] }),
    transcripts: [],
  };
}

/** The reader's own run starting, read the same every time it is asked. */
function ownRunAnswered(over: Record<string, unknown>): RunPageServed {
  return ownRunStarting(() => ownRunSummary(over), over);
}

test.each([
  ["Offline", ["· offline"]],
  ["Unable", ["· none can run it"]],
  ["Live", []],
] as const)(
  "the reader's own run the server says waits on their runners as %s says so once, as the link to where they are managed, with its state after it",
  async (wait, state) => {
    await runPageDrawn(atlas, ownRunAnswered({ personalRunnerWait: wait }));
    const sentence = "Waiting on your personal runners";
    expect(nowLineParts()).toStrictEqual([sentence, ...state]);
    const links = within(nowCard()).getAllByRole("link");
    const runners = links.filter((link) =>
      link.getAttribute("href")?.endsWith("/settings/workspace/runner"),
    );
    expect(runners.map((link) => link.textContent)).toStrictEqual([sentence]);
  },
);

test("the reader's own run the server answers no wait for says nothing of a runner", async () => {
  await runPageDrawn(atlas, ownRunAnswered({}));
  expect(nowCard().textContent).not.toContain("Waiting on your");
});

/** No frame says a runner polled, so the run is read again on the clock while it has not begun. */
test("the reader's own run that has not begun is read again on the clock, and says what the server answers now", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    let wait = "Offline";
    const drawn = await runPageDrawn(
      atlas,
      ownRunStarting(() => ownRunSummary({ personalRunnerWait: wait })),
    );
    expect(nowCard().textContent).toContain("· offline");
    const reads = executionReads(drawn.reads);
    wait = "Live";
    await act(() => vi.advanceTimersByTimeAsync(sessionPlacementPolledMs));
    await settled();
    expect(executionReads(drawn.reads)).toBeGreaterThan(reads);
    expect(nowCard().textContent).toContain("Waiting on your personal runners");
    expect(nowCard().textContent).not.toContain("offline");
  } finally {
    vi.useRealTimers();
  }
});

test("a run that has begun is not read again on the clock", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    const drawn = await runPageDrawn(
      atlas,
      runningRun(transcribed, {
        executions: [{ ...running, mine: true, ownerFallback: "Strict" }],
      }),
    );
    const reads = executionReads(drawn.reads);
    await act(() => vi.advanceTimersByTimeAsync(sessionPlacementPolledMs));
    await settled();
    expect(executionReads(drawn.reads)).toBe(reads);
  } finally {
    vi.useRealTimers();
  }
});

const pausedUntil = "2026-08-27T14:05:00Z";

const pause = {
  until: pausedUntil,
  reasons: ["five_hour"],
  pressed: false,
};

test("the reader's own run waiting on live runners their account holds paused says so, why, until when, and where it is set", async () => {
  await runPageDrawn(
    atlas,
    ownRunAnswered({ personalRunnerWait: "Live", paused: pause }),
  );
  const card = nowCard();
  const [status, reason, until, usage, ...rest] = nowLineParts();
  expect([status, reason, usage, rest]).toStrictEqual([
    "Paused",
    "· Five-hour window",
    "· Usage",
    [],
  ]);
  expect(until).toMatch(/^· until \S/);
  expect(card.textContent).not.toContain("Waiting on your personal runners");
  expect(within(card).getByRole("link", { name: "Usage" })).toBeTruthy();
});

test("another member's waiting run says nothing of a pause", async () => {
  await runPageDrawn(
    atlas,
    ownRunAnswered({ mine: false, personalRunnerWait: "Live", paused: pause }),
  );
  const card = nowCard();
  expect(card.textContent).not.toContain("Paused");
  expect(within(card).queryByRole("link", { name: "Usage" })).toBeNull();
});

test("the reader's own run waiting on offline runners says so and nothing of a pause", async () => {
  await runPageDrawn(
    atlas,
    ownRunAnswered({ personalRunnerWait: "Offline", paused: pause }),
  );
  const card = nowCard();
  expect(card.textContent).not.toContain("Paused");
  expect(card.textContent).toContain("· offline");
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
