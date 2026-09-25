// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
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
import { settled, turned } from "./screenHarness.tsx";
import { elementScrollToStubbed } from "./scrolling.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import { ticketInstants } from "./ticketInstants.ts";
import { viewportAtEm } from "./viewport.ts";

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
// jscpd:ignore-end

/**
 * The Now card over a ticket whose work is running.
 *
 * The card is read at a glance, so what it must not get wrong is which note is
 * newest, which call is still out, and that opening it shows the same run the
 * ledger would, prompt first — without reading the prompt for a reader who
 * never opens it.
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

test("the card leads with the newest note, the call still out, and the notes before it", async () => {
  const drawn = await runPageDrawn(atlas, runningRun(transcribed));
  const card = nowCard();
  expect(card.textContent).toContain("Work · run 1");
  expect(card.querySelector(".ticket-now-line")?.textContent).toBe(
    "Sixth note",
  );
  const call = card.querySelector(".ticket-now-call");
  expect(call?.querySelector(".ticket-now-call-name")?.textContent).toBe(
    "Read",
  );
  expect(call?.textContent).toContain("app/footer.tsx");
  const earlier = within(card).getByRole("list", { name: "Earlier notes" });
  expect(
    [...earlier.querySelectorAll(".ticket-now-note-text")].map(
      (note) => note.textContent,
    ),
  ).toEqual(["Fifth note", "Fourth note", "Third note", "Second note"]);
  expect(card.textContent).toContain("3 turns · 6 notes");
  expect(configurationReads(drawn.reads)).toBe(0);
});

test("opening the card draws the run's conversation prompt first, and reads the prompt then", async () => {
  const drawn = await runPageDrawn(atlas, runningRun(transcribed));
  await turned(() => {
    within(nowCard())
      .getByRole("button", { name: "Show conversation" })
      .click();
  });
  await settled();
  const conversation = within(nowCard()).getByRole("group", {
    name: "Conversation",
  });
  const text = conversation.textContent ?? "";
  expect(text.startsWith("Prompt")).toBe(true);
  expect(conversation.querySelector("strong")?.textContent).toBe("Build");
  expect(text.indexOf("Build the footer.")).toBeLessThan(
    text.indexOf("First note"),
  );
  expect(configurationReads(drawn.reads)).toBe(1);
  expect(
    within(nowCard()).getByRole("button", { name: "Hide conversation" }),
  ).toBeDefined();
});

/** A command writes no transcript, so there is nothing to open and no note
 * to lead with — only that it is running. */
test("a stage with no transcript says it is running and offers nothing to open", async () => {
  const drawn = await runPageDrawn(
    atlas,
    runningRun(runEvidenceOf(0, { transcript: undefined })),
  );
  const card = nowCard();
  expect(card.querySelector(".ticket-now-line")?.textContent).toBe("Running");
  expect(within(card).queryByRole("button")).toBeNull();
  expect(transcriptReads(drawn.reads)).toEqual([]);
});

/** A long run opens on its newest batches, and a reader who wants the ones
 * under them asks for a page at a time from the top. */
test("a long run opens on its newest batches and reads earlier ones on asking", async () => {
  const page = (from: number): Record<string, unknown> =>
    runTranscriptPage(
      Array.from({ length: 8 }, (_, at) => from + at),
      false,
    );
  const drawn = await runPageDrawn(
    atlas,
    runningRun(runEvidenceOf(30, { configuration: runConfigurationRef }), {
      transcripts: [page(15), page(23), page(7)],
    }),
  );
  expect(transcriptReads(drawn.reads)).toEqual(["?after=14", "?after=22"]);
  await turned(() => {
    within(nowCard())
      .getByRole("button", { name: "Show conversation" })
      .click();
  });
  await settled();
  await turned(() => {
    within(nowCard()).getByRole("button", { name: "Earlier" }).click();
  });
  await settled();
  expect(transcriptReads(drawn.reads)).toEqual([
    "?after=14",
    "?after=22",
    "?after=6",
  ]);
  expect(
    within(nowCard()).getByRole("button", { name: "Earlier" }),
  ).toBeDefined();
});
