/**
 * The Heaviest section's derivations: the largest growths ranked from the
 * whole series, each in its own series and never across a compaction; the
 * tool call a ranked call first read the result of, named only where the pane
 * holds it; and By tool, from a reading's tokens where one weighed the tools,
 * and otherwise from the results held, counting only those whose tool call is
 * held too.
 */

import { expect, test } from "vitest";

import {
  contextGrowthLargest,
  contextGrowthsOf,
  contextHeaviestOf,
  contextInputSaid,
  contextLargestOf,
  contextLinesLatestOnly,
  contextLinesOf,
  contextToolCallsOf,
} from "../app/core/contextResults.ts";
import type {
  ContextByTool,
  ContextHeaviestRead,
} from "../app/core/contextResults.ts";
import {
  contextCallsOf,
  contextRunCompactions,
} from "../app/core/contextRun.ts";
import { runTranscriptHeldEmpty } from "../app/core/runTranscript.ts";
import {
  contextCompacted,
  contextImageLines,
  contextRecordedAt,
  contextRow,
  contextToolLines,
  contextWindow,
} from "./contextFixture.ts";

/** A run whose context at each call is its cache read and 102 tokens more,
 * with two subagents' calls between its own. */
const series = contextCallsOf([
  contextRow(1, { read: 10_000 }),
  contextRow(2, { read: 14_000 }),
  contextRow(3, { read: 3_000, parent: "toolu_task_a" }),
  contextRow(4, { read: 9_000, parent: "toolu_task_a" }),
  contextRow(5, { read: 20_000, parent: "toolu_task_b" }),
  contextRow(6, { read: 21_000 }),
  contextRow(7, { read: 30_000 }),
  contextRow(8, { read: 45_000 }),
  contextRow(9, { read: 46_000 }),
  contextRow(10, { read: 45_000 }),
  contextRow(11, { read: 49_000 }),
]);

const compacted = contextRunCompactions(series, [
  contextCompacted(1, 7, 317_189, 25_000),
]);

test("a call grows from the call before it in its own series: the run's own across a subagent's calls, and each subagent's from its own", () => {
  const growths = contextGrowthsOf(series, []);
  expect(
    growths.map((growth) => [
      growth.call.call,
      growth.before.call,
      growth.tokens,
    ]),
  ).toStrictEqual([
    [2, 1, 4_000],
    [4, 3, 6_000],
    [6, 2, 7_000],
    [7, 6, 9_000],
    [8, 7, 15_000],
    [9, 8, 1_000],
    [11, 10, 4_000],
  ]);
});

test("a growth across a compaction is not ranked, nor one that fell", () => {
  expect(compacted.map((mark) => mark.ordinal)).toStrictEqual([7]);
  const calls = contextGrowthsOf(series, compacted).map(
    (growth) => growth.call.call,
  );
  expect(calls).not.toContain(8);
  expect(calls).not.toContain(10);
  expect(calls).toContain(9);
});

test("the largest are the five that grew most, the earlier first where two grew alike", () => {
  expect(
    contextGrowthLargest(contextGrowthsOf(series, compacted)).map((growth) => [
      growth.call.call,
      growth.tokens,
    ]),
  ).toStrictEqual([
    [7, 9_000],
    [6, 7_000],
    [4, 6_000],
    [2, 4_000],
    [11, 4_000],
  ]);
});

const heldLines = [
  ...contextToolLines("toolu_cat", "Read", "a.ts", "y".repeat(400), {
    read: 21_000,
  }),
  ...contextToolLines("toolu_ls", "Bash", "ls -la", "x".repeat(8_000), {
    read: 21_000,
  }),
  ...contextToolLines("toolu_grep", "Grep", "TODO", "z".repeat(900), {
    read: 3_000,
    parent: "toolu_task_a",
  }),
];

test("a ranked call names the heaviest tool call asked in the call before it where the pane holds that, and its growth alone where it does not", () => {
  const rows = contextLargestOf(
    contextGrowthLargest(contextGrowthsOf(series, compacted)),
    contextToolCallsOf(heldLines, series),
  );
  expect(
    rows.map((row) => [
      row.call,
      row.series,
      row.growth,
      row.asked?.id,
      row.asked?.tool,
      row.asked?.input,
      row.asked?.result?.bytes,
    ]),
  ).toStrictEqual([
    [7, "Main", 9_000, "toolu_ls", "Bash", "ls -la", 8_000],
    [6, "Main", 7_000, undefined, undefined, undefined, undefined],
    [4, "Subagent", 6_000, "toolu_grep", "Grep", "TODO", 900],
    [2, "Main", 4_000, undefined, undefined, undefined, undefined],
    [11, "Main", 4_000, undefined, undefined, undefined, undefined],
  ]);
});

test("a subagent's line is joined to that subagent's call, not to the run's own call billed alike", () => {
  const alike = contextCallsOf([
    contextRow(1, { read: 5_000 }),
    contextRow(2, { read: 5_000, parent: "toolu_task" }),
  ]);
  const held = contextToolCallsOf(
    contextToolLines("toolu_sub", "Read", "b.ts", "b", {
      read: 5_000,
      parent: "toolu_task",
    }),
    alike,
  );
  expect(held.asked.map((asked) => asked.call)).toStrictEqual([2]);
});

test("a tool call held with no result yet is named with no size", () => {
  const [asked] = contextToolLines("toolu_live", "Bash", "npm test", "", {
    read: 21_000,
  });
  const rows = contextLargestOf(
    contextGrowthLargest(contextGrowthsOf(series, compacted)),
    contextToolCallsOf([asked], series),
  );
  expect(rows[0]?.asked?.tool).toBe("Bash");
  expect(rows[0]?.asked?.result).toBeUndefined();
});

function heaviestOf(
  read: Partial<ContextHeaviestRead> & Pick<ContextHeaviestRead, "held">,
) {
  return contextHeaviestOf({
    calls: series,
    compactions: compacted,
    latestOnly: false,
    window: undefined,
    peak: 10_000,
    ...read,
  });
}

function estimated(
  byTool: ContextByTool,
): Extract<ContextByTool, { from: "Transcript" }> {
  if (byTool.from !== "Transcript") throw new Error("not estimated");
  return byTool;
}

test("where a reading weighed the tools, a tool's tokens are its calls' and its results' together, against the context it read", () => {
  const heaviest = heaviestOf({
    held: contextToolCallsOf(heldLines, series),
    window: contextWindow({
      messages: {
        toolCalls: 0,
        toolResults: 0,
        attachments: 0,
        assistant: 0,
        user: 0,
        byTool: [
          { name: "Bash", callTokens: 300, resultTokens: 74_776 },
          { name: "Read", callTokens: 20, resultTokens: 1_000 },
          { name: "Edit", callTokens: 5_000, resultTokens: 100 },
        ],
      },
    }),
  });
  expect(heaviest.calls).toBe(11);
  if (heaviest.byTool.from !== "Reading") throw new Error("not read");
  expect(
    heaviest.byTool.tools.map((row) => [
      row.tool,
      row.tokens,
      row.share?.kind === "Quantity" ? row.share.text : undefined,
    ]),
  ).toStrictEqual([
    ["Bash", 75_076, "20"],
    ["Edit", 5_100, "1"],
    ["Read", 1_020, "<1"],
  ]);
});

test("a reading that weighed no tools leaves By tool to the held results", () => {
  const window = contextWindow();
  const heaviest = heaviestOf({
    held: contextToolCallsOf(heldLines, series),
    window: {
      ...window,
      ...(window.messages === undefined
        ? {}
        : { messages: { ...window.messages, byTool: [] } }),
    },
  });
  expect(heaviest.byTool.from).toBe("Transcript");
});

test("with no reading, By tool counts only the results held whose tool call is held, at four bytes a token against the peak, and counts the rest as left out", () => {
  const orphan = contextToolLines("toolu_gone", "Bash", "git log", "o", {
    read: 1,
  })[1];
  const byTool = estimated(
    heaviestOf({
      held: contextToolCallsOf([orphan, orphan, ...heldLines], series),
      latestOnly: true,
    }).byTool,
  );
  expect(
    byTool.tools.map((row) => [
      row.tool,
      row.results,
      row.bytes,
      row.share?.kind === "Quantity" ? row.share.text : undefined,
    ]),
  ).toStrictEqual([
    ["Bash", 1, 8_000, "20"],
    ["Grep", 1, 900, "2"],
    ["Read", 1, 400, "1"],
  ]);
  expect(byTool.results).toBe(3);
  expect(byTool.unasked).toBe(2);
  expect(byTool.latestOnly).toBe(true);
});

test("a tool call that names no tool is none, and its result is counted as left out", () => {
  const nameless = contextToolLines("toolu_x", "", "?", "q", { read: 1 });
  const held = contextToolCallsOf(nameless, series);
  expect(held.asked).toStrictEqual([]);
  expect(held.unasked).toBe(1);
});

test("a result that held no text has no size, and its tool is listed after the weighed ones with no share rather than as the lightest", () => {
  const shots = [
    ...contextToolLines("toolu_s", "StructuredOutput", "verdict", "{}", {
      read: 30_000,
    }),
    ...contextImageLines("toolu_i", 10_000),
    ...contextImageLines("toolu_j", 14_000),
    ...contextToolLines("toolu_e", "Bash", "true", "", { read: 45_000 }),
  ];
  const held = contextToolCallsOf(shots, series);
  expect(
    held.asked.map((asked) => [asked.tool, asked.result?.bytes]),
  ).toStrictEqual([
    ["StructuredOutput", 2],
    ["Read", undefined],
    ["Read", undefined],
    ["Bash", 0],
  ]);
  const byTool = estimated(heaviestOf({ held }).byTool);
  expect(byTool.unweighed).toBe(true);
  expect(
    byTool.tools.map((row) => [
      row.tool,
      row.results,
      row.bytes,
      row.share?.kind === "Quantity" ? row.share.text : undefined,
    ]),
  ).toStrictEqual([
    ["StructuredOutput", 1, 2, "<1"],
    ["Bash", 1, 0, "0"],
    ["Read", 2, undefined, undefined],
  ]);
  expect(
    estimated(
      heaviestOf({ held: contextToolCallsOf(heldLines, series) }).byTool,
    ).unweighed,
  ).toBe(false);
});

test("a call's input is said by its command or path, on one line", () => {
  expect(contextInputSaid({ command: "git\n  status" })).toBe("git status");
  expect(
    contextInputSaid({
      file_path: "ui/chuggy-ui/app/core/contextRun.ts",
      limit: 2,
    }),
  ).toBe("ui/chuggy-ui/app/core/contextRun.ts");
  expect(contextInputSaid("bare")).toBe("");
});

test("only the lines a batch answered with are parsed, and a line that is not JSON is passed over", () => {
  expect(
    contextLinesOf({
      ...runTranscriptHeldEmpty,
      batches: [
        {
          batch: 1,
          recordedAt: "2026-11-08T10:00:00.000Z",
          read: "Content",
          content: '{"type":"user"}\nnot json\n',
        },
      ],
    } as never),
  ).toStrictEqual([{ type: "user" }]);
});

test("held batches are the run's latest only where the run wrote batches below the lowest held", () => {
  const heldFrom = (lowest: number) => ({
    ...runTranscriptHeldEmpty,
    batches: [lowest, lowest + 1].map((batch) => ({
      batch,
      recordedAt: contextRecordedAt,
      bytes: 0,
      read: "Missing" as const,
    })),
  });
  expect(contextLinesLatestOnly(heldFrom(1) as never)).toBe(false);
  expect(contextLinesLatestOnly(heldFrom(230) as never)).toBe(true);
  expect(contextLinesLatestOnly(runTranscriptHeldEmpty)).toBe(false);
});
