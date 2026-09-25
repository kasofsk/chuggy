// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { viewportDeskEm } from "../app/browser/shell/viewport.ts";
import {
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
 * A settled ticket's runs, read back from its ledger.
 *
 * What these guard is that a run is drawn one way: the prompt it was handed
 * first, then what it did, whether the reader came by the row's own
 * Conversation button or through its details — and that a run which recorded
 * nothing to read offers nothing to press.
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

test("a settled run's details draw its prompt first, as its row's conversation does", async () => {
  await runPageDrawn(atlas, settledRun());
  await pressed("Details");
  const transcript = screen.getByRole("region", { name: "transcript" });
  const inDetails = within(transcript).getByRole("group", {
    name: "Conversation",
  });
  promptFirst(inDetails);
  const drawn = inDetails.textContent;

  await pressed("Conversation");
  expect(screen.queryByRole("region", { name: "transcript" })).toBeNull();
  const opened = screen.getByRole("group", { name: "Conversation" });
  promptFirst(opened);
  expect(opened.textContent).toBe(drawn);
});

test("a settled run's conversation opens in one press, and reads its prompt only then", async () => {
  const drawn = await runPageDrawn(atlas, settledRun());
  expect(screen.queryByRole("group", { name: "Conversation" })).toBeNull();
  expect(configurationReads(drawn.reads)).toBe(0);

  await pressed("Conversation");
  promptFirst(screen.getByRole("group", { name: "Conversation" }));
  expect(configurationReads(drawn.reads)).toBe(1);
  expect(
    screen
      .getByRole("button", { name: "Hide conversation" })
      .getAttribute("aria-expanded"),
  ).toBe("true");

  await pressed("Hide conversation");
  expect(screen.queryByRole("group", { name: "Conversation" })).toBeNull();
});

/** A command stage records no transcript, and a button onto nothing would be
 * a press that opens an empty box. */
test("a run that recorded no transcript offers no conversation", async () => {
  for (const run of [runEvidenceOf(0, { transcript: undefined }), undefined]) {
    await runPageDrawn(atlas, settledRun(attemptServed(run)));
    expect(screen.getByRole("button", { name: "Details" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Conversation" })).toBeNull();
    cleanup();
  }
});

test("a run that kept no prompt says so where the prompt would be", async () => {
  const cases: readonly Partial<RunPageServed>[] = [
    attemptServed(runEvidenceOf(2)),
    { configuration: runSnapshot(prompt, { argvTruncated: truncated }) },
  ];
  for (const served of cases) {
    await runPageDrawn(atlas, settledRun(served));
    await pressed("Conversation");
    const conversation = screen.getByRole("group", { name: "Conversation" });
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
  await runPageDrawn(
    atlas,
    settledRun({ configuration: runSnapshot(lines.join("\n\n")) }),
  );
  await pressed("Conversation");
  const conversation = screen.getByRole("group", { name: "Conversation" });
  expect(conversation.textContent).toContain("Line 1 of the brief.");
  expect(conversation.textContent).not.toContain("Line 12 of the brief.");

  await pressed("Show full prompt");
  expect(conversation.textContent).toContain("Line 12 of the brief.");
  expect(
    screen.getByRole("button", { name: "Hide full prompt" }),
  ).toBeDefined();
});
