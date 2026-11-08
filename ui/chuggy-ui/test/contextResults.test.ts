/**
 * The Heaviest section's sums: each tool result joined to the call it was
 * asked in by the figures that call was billed with, summed by tool, and its
 * share either a reading's exact tokens or the bytes at four to a token
 * against the peak, never a mixture.
 */

import { expect, test } from "vitest";

import {
  contextHeaviestOf,
  contextInputSaid,
  contextLinesOf,
  contextResultsOf,
} from "../app/core/contextResults.ts";
import { contextCallsOf } from "../app/core/contextRun.ts";
import { runTranscriptHeldEmpty } from "../app/core/runTranscript.ts";
import {
  contextImageLines,
  contextRow,
  contextToolLines,
  contextWindow,
} from "./contextFixture.ts";

const calls = contextCallsOf([
  contextRow(1, { read: 10_000 }),
  contextRow(2, { read: 14_000 }),
  contextRow(3, { read: 15_000 }),
]);

const lines = [
  ...contextToolLines("toolu_a", "Bash", "ls -la", "x".repeat(8_000), {
    read: 10_000,
  }),
  ...contextToolLines("toolu_b", "Read", "a.ts", "y".repeat(400), {
    read: 14_000,
  }),
  ...contextToolLines("toolu_c", "Bash", "git log", "z".repeat(2_000), {
    read: 99,
  }),
];

test("each result is weighed in bytes and joined to the call its asking line was billed as", () => {
  const results = contextResultsOf(lines, calls);
  expect(
    results.map((result) => [
      result.tool,
      result.input,
      result.bytes,
      result.call,
      result.growth,
    ]),
  ).toStrictEqual([
    ["Bash", "ls -la", 8_000, 1, 4_000],
    ["Read", "a.ts", 400, 2, 1_000],
    ["Bash", "git log", 2_000, undefined, undefined],
  ]);
});

test("with no reading that weighed the tools, a share is the bytes at four to a token against the peak", () => {
  const heaviest = contextHeaviestOf(
    contextResultsOf(lines, calls),
    undefined,
    10_000,
  );
  expect(heaviest.exact).toBe(false);
  expect(heaviest.results).toBe(3);
  expect(
    heaviest.tools.map((row) => [
      row.tool,
      row.calls,
      row.bytes,
      row.share?.kind === "Quantity" ? row.share.text : undefined,
    ]),
  ).toStrictEqual([
    ["Bash", 2, 10_000, "25"],
    ["Read", 1, 400, "1"],
  ]);
  expect(heaviest.largest.map((result) => result.id)).toStrictEqual([
    "toolu_a",
    "toolu_c",
    "toolu_b",
  ]);
});

test("where a reading weighed the tools, a share is its tokens against the context it read", () => {
  const heaviest = contextHeaviestOf(
    contextResultsOf(lines, calls),
    contextWindow(),
    10_000,
  );
  expect(heaviest.exact).toBe(true);
  expect(
    heaviest.tools.map((row) => [
      row.tool,
      row.tokens,
      row.share?.kind === "Quantity" ? row.share.text : undefined,
    ]),
  ).toStrictEqual([
    ["Bash", 74_776, "20"],
    ["Read", 456, "<1"],
  ]);
});

test("a result that held no text has no size, and its tool is listed after the weighed ones with no share rather than as the lightest", () => {
  const shots = [
    ...contextToolLines("toolu_s", "StructuredOutput", "verdict", "{}", {
      read: 15_000,
    }),
    ...contextImageLines("toolu_i", 10_000),
    ...contextImageLines("toolu_j", 14_000),
    ...contextToolLines("toolu_e", "Bash", "true", "", { read: 99 }),
  ];
  const results = contextResultsOf([...lines, ...shots], calls);
  expect(
    results.slice(3).map((result) => [result.tool, result.bytes]),
  ).toStrictEqual([
    ["StructuredOutput", 2],
    ["Read", undefined],
    ["Read", undefined],
    ["Bash", 0],
  ]);
  const heaviest = contextHeaviestOf(
    contextResultsOf(shots, calls),
    undefined,
    10_000,
  );
  expect(heaviest.unweighed).toBe(true);
  expect(
    heaviest.tools.map((row) => [
      row.tool,
      row.calls,
      row.bytes,
      row.share?.kind === "Quantity" ? row.share.text : undefined,
    ]),
  ).toStrictEqual([
    ["StructuredOutput", 1, 2, "<1"],
    ["Bash", 1, 0, "0"],
    ["Read", 2, undefined, undefined],
  ]);
  expect(heaviest.largest.map((result) => result.id)).toStrictEqual([
    "toolu_s",
    "toolu_e",
  ]);
  expect(
    contextHeaviestOf(contextResultsOf(lines, calls), undefined, 10_000)
      .unweighed,
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
