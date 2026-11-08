// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
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
  runTotals,
  runTranscriptPage,
} from "./runPageFixture.tsx";
import type { RunPageServed } from "./runPageFixture.tsx";
import { settled, turned } from "./screenHarness.tsx";
import { TicketRunPageAt } from "./ticketPageEveryTab.tsx";
import type { TicketRunView } from "../app/core/ticketRuns.ts";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
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
 * A settled run's Transcript, on the run's own page.
 *
 * What these guard is that a run is drawn one way: the prompt it was handed
 * first, then what it did, its first steps until a reader asks for every one —
 * and that a run which recorded nothing to read says so.
 */

beforeEach(() => {
  resizeObserverStubbed();
  elementScrollToStubbed();
  viewportAtEm(viewportDeskEm);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const doneTicket = {
  ticket: 11,
  phase: "Done",
  sequence: 7,
  runTotals: runTotals(9_990_000),
  ...ticketInstants,
};

const prompt = "**Build** the footer.\n\nKeep it to one line.";
const truncated = {
  chuggy_truncated: { bytes: 90_000, digest: "d".repeat(64) },
};

function attemptServed(run: Record<string, unknown> | undefined): {
  readonly execution: Record<string, unknown>;
} {
  return {
    execution: { ...runSummary(), attempts: [runAttempt("a1", { run })] },
  };
}

function settledRun(over: Partial<RunPageServed> = {}): RunPageServed {
  return {
    ticket: doneTicket,
    executions: [runSummary()],
    ...attemptServed(runEvidenceOf(2, { configuration: runConfigurationRef })),
    transcripts: [runTranscriptPage([1, 2], true)],
    configuration: runSnapshot(prompt),
    ...over,
  };
}

async function pressed(name: string): Promise<void> {
  await turned(() => {
    screen.getByRole("button", { name }).click();
  });
  await settled();
}

/** The run's own page, on the sub-tab a case names. */
function runPage(
  served: RunPageServed,
  view: TicketRunView = "Transcript",
): ReturnType<typeof runPageDrawn> {
  return runPageDrawn(atlas, served, <TicketRunPageAt task={1} view={view} />);
}

/** The prompt heads the drawing, in its own markdown, and the run's steps
 * follow it in the order they were recorded. */
function promptFirst(conversation: HTMLElement): void {
  const text = conversation.textContent ?? "";
  expect(text.startsWith("Prompt")).toBe(true);
  expect(conversation.querySelector("strong")?.textContent).toBe("Build");
  const said = ["Keep it to one line.", "batch 1", "batch 2"].map((line) =>
    text.indexOf(line),
  );
  expect(said.every((at) => at >= 0)).toBe(true);
  expect([...said].sort((left, right) => left - right)).toEqual(said);
}

test("a settled run's Transcript draws its prompt first, then what it did", async () => {
  await runPage(settledRun());
  promptFirst(screen.getByRole("group", { name: "Transcript" }));
});

test("a run's prompt is read only once its Transcript is shown", async () => {
  const summary = await runPage(settledRun(), "Summary");
  expect(screen.queryByRole("group", { name: "Transcript" })).toBeNull();
  expect(configurationReads(summary.reads)).toBe(0);
  cleanup();
  const transcript = await runPage(settledRun());
  expect(configurationReads(transcript.reads)).toBe(1);
});

/** The word under each exchange a conversation draws. */
function standingWords(conversation: HTMLElement): readonly string[] {
  return Array.from(
    conversation.querySelectorAll('.conversation-meta p [role="status"]'),
    (status) => status.textContent,
  );
}

/** A tool call with no result yet, which is what a run in the middle of its
 * work has last recorded. */
function calling(batch: number): string {
  if (batch === 1) return assistantLine("batch 1");
  return toolCall("call-1");
}

function toolCall(id: string): string {
  return JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id, name: "Read", input: {} }],
    },
  });
}

/** A run has no mailbox to say a runner took it, so its exchange is never a
 * turn that is starting: it is open while the attempt runs and settled by the
 * attempt's own state. */
test("a run in the middle of its work reads Open, and Answered once it has reported", async () => {
  const words = async (state: string): Promise<readonly string[]> => {
    const attempt = runAttempt("a1", {
      state,
      run: runEvidenceOf(2, { configuration: runConfigurationRef }),
    });
    await runPage(
      settledRun({
        execution: { ...runSummary(), attempts: [attempt] },
        transcripts: [runTranscriptPage([1, 2], true, calling)],
      }),
    );
    const drawn = standingWords(
      screen.getByRole("group", { name: "Transcript" }),
    );
    cleanup();
    return drawn;
  };
  expect(await words("Running")).toEqual(["Open"]);
  expect(await words("Reported")).toEqual(["Answered"]);
});

/** A command stage records no transcript, and an empty box would say nothing. */
test("a run that recorded no transcript says so", async () => {
  for (const run of [runEvidenceOf(0, { transcript: undefined }), undefined]) {
    const drawn = await runPage(settledRun(attemptServed(run)));
    expect(screen.queryByRole("group", { name: "Transcript" })).toBeNull();
    expect(drawn.container.querySelector(".ticket-run-body")?.textContent).toBe(
      "No transcript",
    );
    cleanup();
  }
});

test("a run that kept no prompt says so where the prompt would be", async () => {
  const cases: readonly Partial<RunPageServed>[] = [
    attemptServed(runEvidenceOf(2)),
    { configuration: runSnapshot(prompt, { argvTruncated: truncated }) },
  ];
  for (const served of cases) {
    await runPage(settledRun(served));
    const conversation = screen.getByRole("group", { name: "Transcript" });
    expect(conversation.textContent?.startsWith("Prompt not kept")).toBe(true);
    expect(conversation.textContent).not.toContain("Keep it to one line.");
    cleanup();
  }
});

/** A prompt runs to pages, and the steps under it are what a reader opened the
 * conversation for. */
test("a long prompt is folded to its opening lines until the reader asks", async () => {
  const lines = Array.from(
    { length: 12 },
    (_, at) => `Line ${String(at + 1)} of the brief.`,
  );
  await runPage(settledRun({ configuration: runSnapshot(lines.join("\n\n")) }));
  const conversation = screen.getByRole("group", { name: "Transcript" });
  expect(conversation.textContent).toContain("Line 1 of the brief.");
  expect(conversation.textContent).not.toContain("Line 12 of the brief.");

  await pressed("Show full prompt");
  expect(conversation.textContent).toContain("Line 12 of the brief.");
  expect(
    screen.getByRole("button", { name: "Hide full prompt" }),
  ).toBeDefined();
});

/** How many tool calls a conversation draws. */
function callsDrawn(conversation: HTMLElement): number {
  return Array.from(conversation.querySelectorAll("code")).filter(
    (name) => name.textContent === "Read",
  ).length;
}

/** A long run is many steps, and its page opens on the first of them and its
 * final message rather than a wall of every one. */
test("a long transcript draws its first steps and its final message until every turn is asked for", async () => {
  const content = (batch: number): string =>
    batch === 1
      ? Array.from({ length: 6 }, (_, at) =>
          toolCall(`call-${String(at)}`),
        ).join("\n")
      : assistantLine("all done");
  await runPage(
    settledRun({ transcripts: [runTranscriptPage([1, 2], true, content)] }),
  );
  const conversation = screen.getByRole("group", { name: "Transcript" });
  expect(callsDrawn(conversation)).toBe(3);
  expect(conversation.textContent).toContain("all done");

  await pressed("Show every turn");
  expect(callsDrawn(conversation)).toBe(6);
  expect(screen.queryByRole("button", { name: "Show every turn" })).toBeNull();
});

/** A link from the Context tab names a call by its own identity, and the
 * transcript it opens reads down to that call, draws it open among every step
 * and rings it, whichever batch it was recorded in. */
test("a transcript opened at a call reads down to it and draws it open, ringed and scrolled to", async () => {
  const scrolledTo: Element[] = [];
  Element.prototype.scrollIntoView = function scrolled(this: Element) {
    scrolledTo.push(this);
  };
  const content = (batch: number): string =>
    batch === 1
      ? [
          toolCall("call-asked"),
          JSON.stringify({
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "call-asked",
                  content: "found it",
                },
              ],
            },
          }),
        ].join("\n")
      : assistantLine(`batch ${String(batch)}`);
  const pages = (from: number, to: number): readonly number[] =>
    Array.from({ length: to - from + 1 }, (_, at) => from + at);
  const drawn = await runPageDrawn(
    atlas,
    settledRun({
      ...attemptServed(
        runEvidenceOf(17, { configuration: runConfigurationRef }),
      ),
      transcripts: [
        runTranscriptPage(pages(2, 9), false, content),
        runTranscriptPage(pages(10, 17), true, content),
        runTranscriptPage([1], true, content),
      ],
    }),
    <TicketRunPageAt task={1} view="Transcript" step="call-asked" />,
  );
  await settled();
  expect(
    drawn.reads.filter((read) => read.includes("/transcript")),
  ).toHaveLength(3);
  const asked = drawn.container.querySelector('[aria-current="location"]');
  expect(asked?.textContent).toContain("Read");
  expect(asked?.textContent).toContain("found it");
  expect(scrolledTo).toStrictEqual([asked]);
  expect(screen.queryByRole("button", { name: "Show every turn" })).toBeNull();
});

test("a transcript opened at no call rings none", async () => {
  const drawn = await runPage(settledRun());
  expect(drawn.container.querySelector('[aria-current="location"]')).toBeNull();
});
