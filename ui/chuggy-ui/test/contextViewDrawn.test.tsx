/**
 * The Context view as a reader sees it, in the four states a run's tab is in
 * and in the compact form beside a session: a run with a reading, a run with
 * none, a run that compacted and called a subagent, and a run with no calls.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  ContextRunView,
  ContextSessionView,
} from "../app/browser/context/ContextView.tsx";
import type { ContextRunDrawn } from "../app/browser/context/ContextView.tsx";
import type { RunContextReading } from "../../../src/contract/responses.ts";
import {
  contextInputsOf,
  contextSettingsWindowOf,
} from "../app/core/contextInputs.ts";
import {
  contextHeaviestOf,
  contextResultsOf,
} from "../app/core/contextResults.ts";
import type { RunTurnRowFixture } from "./contextFixture.ts";
import {
  contextCallsOf,
  contextReadingLatest,
  contextRunGrowth,
  contextRunTiles,
  contextRunWindow,
} from "../app/core/contextRun.ts";
import {
  contextSessionInputsOf,
  contextSessionOf,
} from "../app/core/contextSession.ts";
import { contextPeakOf } from "../app/core/contextView.ts";
import { renderCopied } from "./copied.tsx";
import {
  contextCompacted,
  contextReading,
  contextRow,
  contextSessionBody,
  contextSnapshot,
  contextToolLines,
  contextWindow,
} from "./contextFixture.ts";
import { resizeObserverStubbed } from "./resizeObserver.ts";

beforeEach(resizeObserverStubbed);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The tab drawn as the run adapter draws it from these reads. */
function drawnOf(
  rows: readonly RunTurnRowFixture[],
  readings: readonly RunContextReading[],
  lines: readonly unknown[],
  snapshot = contextSnapshot(),
): ContextRunDrawn {
  const calls = contextCallsOf(rows);
  const latest = contextReadingLatest(readings)?.window;
  const window = contextRunWindow(
    calls,
    readings,
    contextSettingsWindowOf(snapshot.argv),
  );
  const growth = contextRunGrowth(calls, readings, window);
  return {
    window,
    growth,
    tiles: contextRunTiles(calls, growth),
    inputs: contextInputsOf(snapshot, latest),
    heaviest: contextHeaviestOf(
      contextResultsOf(lines, calls),
      latest,
      contextPeakOf(growth)?.tokens,
    ),
  };
}

const rows = [
  contextRow(1, { read: 10_000 }),
  contextRow(2, { read: 10_000 }),
  contextRow(3, { read: 14_000 }),
];

const lines = contextToolLines("toolu_a", "Bash", "ls -la", "x".repeat(8_000), {
  read: 10_000,
});

function section(name: string): HTMLElement {
  return screen.getByRole("region", { name });
}

function rowTexts(scope: HTMLElement): readonly string[] {
  return [...scope.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent).join(" | "),
  );
}

test("a run with a reading draws its window against the whole, the threshold, and an unloaded deferred row", () => {
  renderCopied(
    <ContextRunView
      drawn={drawnOf(rows, [contextReading(1, 3, contextWindow())], lines)}
      callLink={(result) => <a href="#t">{String(result.call)}</a>}
    />,
  );
  const window = section("Window");
  expect(within(window).getByText("Call 2")).toBeDefined();
  expect(within(window).getByText("373,880")).toBeDefined();
  expect(within(window).getByText("of 1,000,000 tokens")).toBeDefined();
  expect(within(window).getByText("Compacts at 967,000")).toBeDefined();
  expect(within(window).getByText("Messages 350k")).toBeDefined();
  expect(rowTexts(window)).toContain("Deferred tools | 22,455 | Unloaded");
  expect(rowTexts(window).at(-1)).toBe("Window | 1,000,000 | 100 %");
  const heaviest = section("Heaviest");
  expect(
    within(heaviest).getByText("Share of the context at the latest reading."),
  ).toBeDefined();
  expect(rowTexts(heaviest)[0]).toBe("Bash | 1 | 74,776 | 20 %");
});

test("a run with no reading draws used against the snapshot's window, every category not recorded, and estimated shares", () => {
  renderCopied(
    <ContextRunView drawn={drawnOf(rows, [], lines)} callLink={() => null} />,
  );
  const window = section("Window");
  expect(within(window).getByText("Call 2 · No reading")).toBeDefined();
  expect(within(window).getByText("of 350,000 tokens")).toBeDefined();
  expect(within(window).getAllByText("Not recorded")).toHaveLength(5);
  expect(within(window).queryByText(/Compacts at/u)).toBeNull();
  const growth = section("Growth");
  expect(within(growth).getByText("Threshold not recorded")).toBeDefined();
  expect(within(section("Inputs")).getByText("Snapshot")).toBeDefined();
  const heaviest = section("Heaviest");
  expect(
    within(heaviest).getByText(
      "Share of the peak context, at four bytes a token.",
    ),
  ).toBeDefined();
  expect(rowTexts(heaviest)[0]).toBe("Bash | 1 | 8,000 | 14 %");
  expect(within(heaviest).getByText("+4,000 tok")).toBeDefined();
});

test("a run that compacted and called a subagent labels the compaction and draws the subagent apart", () => {
  const compacted = [
    contextRow(1, { read: 100_000 }),
    contextRow(2, { read: 317_000 }),
    contextRow(3, { read: 9_000, parent: "toolu_s" }),
    contextRow(4, { read: 45_000 }),
  ];
  const view = renderCopied(
    <ContextRunView
      drawn={drawnOf(compacted, [contextCompacted(1, 2, 317_189, 45_000)], [])}
      callLink={() => null}
    />,
  );
  const growth = section("Growth");
  expect(within(growth).getByText("Compacted 317,189 → 45,000")).toBeDefined();
  expect(within(growth).getByText("1 subagent")).toBeDefined();
  expect(within(growth).getByText("After call 2")).toBeDefined();
  expect(within(growth).getByText("Subagent")).toBeDefined();
  expect(
    view.container.querySelectorAll(".context-chart-line[data-series='Main']"),
  ).toHaveLength(2);
  expect(
    view.container.querySelectorAll(
      ".context-chart-line[data-series='Subagent']",
    ),
  ).toHaveLength(1);
  const hit = view.container.querySelector(".context-chart-hit");
  if (hit === null) throw new Error("no chart");
  fireEvent.pointerMove(hit, { clientX: 640 });
  const tip = view.container.querySelector(".context-chart-tip");
  expect(
    [...(tip?.children ?? [])].map((line) => line.textContent),
  ).toStrictEqual(["45,102 tokens", "Call 4", "−272,000 since call 2"]);
});

test("a run with no calls yet and no snapshot says each, and its brief and files open on Show", () => {
  renderCopied(
    <ContextRunView
      drawn={{ ...drawnOf([], [], []), inputs: undefined }}
      callLink={() => null}
    />,
  );
  expect(
    within(section("Growth")).getByText("No calls recorded yet"),
  ).toBeDefined();
  expect(within(section("Inputs")).getByText("No snapshot kept")).toBeDefined();
  expect(
    within(section("Heaviest")).getByText("No tool results read yet"),
  ).toBeDefined();
  cleanup();
  const view = renderCopied(
    <ContextRunView drawn={drawnOf(rows, [], lines)} callLink={() => null} />,
  );
  const inputs = section("Inputs");
  const brief = view.container.querySelector(".context-brief");
  expect(brief?.getAttribute("data-open")).toBe("false");
  fireEvent.click(within(inputs).getByRole("button", { name: "Show" }));
  expect(brief?.getAttribute("data-open")).toBe("true");
  fireEvent.click(within(inputs).getByRole("button", { name: "CLAUDE.md" }));
  expect(within(inputs).getByText("# chuggy")).toBeDefined();
});

test("a session's compact form draws its window per turn, its figures in a line, and its appended prompt folded", () => {
  const context = contextSessionBody([
    { ordinal: 12, total: 150_000 },
    { ordinal: 13, total: 96_721 },
  ]);
  const view = contextSessionOf({ context, entries: [], cuts: [] });
  const drawn = renderCopied(
    <ContextSessionView
      drawn={{
        ...view,
        inputs: contextSessionInputsOf(
          context,
          "The seeded page.",
          view.window,
        ),
      }}
    />,
  );
  const window = section("Window");
  expect(within(window).getByText("Turn 13")).toBeDefined();
  expect(within(window).getByText("of 200,000 tokens")).toBeDefined();
  const growth = section("Growth");
  expect(within(growth).getByText("Per turn")).toBeDefined();
  expect(growth.querySelector(".context-stats")?.textContent).toBe(
    "Peak 150,000Turns 13Compactions None",
  );
  const inputs = section("Inputs");
  expect(within(inputs).getByText("Appended prompt")).toBeDefined();
  expect(within(inputs).queryByText("You are the project's lead.")).toBeNull();
  fireEvent.click(
    within(inputs).getAllByRole("button", { name: "Show" })[1] as HTMLElement,
  );
  expect(within(inputs).getByText("You are the project's lead.")).toBeDefined();
  expect(
    drawn.container
      .querySelector(".context-view")
      ?.getAttribute("data-compact"),
  ).toBe("true");
});
