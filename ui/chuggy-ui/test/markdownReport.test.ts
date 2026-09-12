/**
 * What the worker's report reads into: a paragraph keeps every line it was
 * written with, and the marks a worker reaches for most often — bold,
 * italic, inline code, a link — read as themselves rather than as the
 * asterisks and brackets that spelled them.
 *
 * A ticket named in the prose is one more mark, and the case that matters is
 * where it is not one: a reference a worker showed inside a code span is the
 * characters they meant to show.
 */

import { expect, test } from "vitest";

import {
  markdownInlineOf,
  markdownReportBlocks,
  markdownTableColumnsMax,
  markdownTableRowsMax,
} from "../app/core/markdownReport.ts";

test("a paragraph keeps every line break it was written with", () => {
  const blocks = markdownReportBlocks("first line\nsecond line\nthird line");
  expect(blocks).toEqual([
    {
      kind: "Paragraph",
      lines: [
        [{ kind: "Text", text: "first line" }],
        [{ kind: "Text", text: "second line" }],
        [{ kind: "Text", text: "third line" }],
      ],
    },
  ]);
});

test("a blank line ends one paragraph and opens the next", () => {
  const blocks = markdownReportBlocks(
    "the tests pass\n\nno further action is needed",
  );
  expect(blocks.map((block) => block.kind)).toEqual(["Paragraph", "Paragraph"]);
});

test("bold, italic, inline code and a link read as their own marks", () => {
  expect(
    markdownInlineOf(
      "**bold** and *italic* and `code` and [a link](https://example.com)",
    ),
  ).toEqual([
    { kind: "Bold", text: "bold" },
    { kind: "Text", text: " and " },
    { kind: "Italic", text: "italic" },
    { kind: "Text", text: " and " },
    { kind: "Code", text: "code" },
    { kind: "Text", text: " and " },
    { kind: "Link", text: "a link", href: "https://example.com" },
  ]);
});

/** A link naming no `http(s)` scheme is read as the plain text it wrote,
 * never as a mark a browser would navigate on. */
test("a link scheme this console does not trust reads as plain text", () => {
  expect(markdownInlineOf("[click me](javascript:alert(1))")).toEqual([
    { kind: "Text", text: "[click me](javascript:alert(1))" },
  ]);
});

test("a heading and a bullet list read as their own blocks", () => {
  const blocks = markdownReportBlocks("## Summary\n- one\n- two");
  expect(blocks).toEqual([
    { kind: "Heading", level: 2, inline: [{ kind: "Text", text: "Summary" }] },
    {
      kind: "BulletList",
      items: [[{ kind: "Text", text: "one" }], [{ kind: "Text", text: "two" }]],
    },
  ]);
});

test("an ordered list and a blockquote read as their own blocks", () => {
  const blocks = markdownReportBlocks("1. first\n2. second\n> a quoted line");
  expect(blocks).toEqual([
    {
      kind: "OrderedList",
      items: [
        [{ kind: "Text", text: "first" }],
        [{ kind: "Text", text: "second" }],
      ],
    },
    { kind: "Quote", lines: [[{ kind: "Text", text: "a quoted line" }]] },
  ]);
});

test("a fenced code block keeps its body as literal text with no marks read", () => {
  const blocks = markdownReportBlocks("```\nconst x = 1;\n**not bold**\n```");
  expect(blocks).toEqual([
    { kind: "CodeBlock", text: "const x = 1;\n**not bold**" },
  ]);
});

test("a fence left unclosed still reads as a code block rather than nothing", () => {
  const blocks = markdownReportBlocks("```\nunterminated");
  expect(blocks).toEqual([{ kind: "CodeBlock", text: "unterminated" }]);
});

test("a pipe table reads as a table block, a cell carrying its own marks", () => {
  const blocks = markdownReportBlocks(
    "| Name | Note |\n| --- | --- |\n| **a** | plain |",
  );
  expect(blocks).toEqual([
    {
      kind: "Table",
      header: [
        [{ kind: "Text", text: "Name" }],
        [{ kind: "Text", text: "Note" }],
      ],
      rows: [
        [[{ kind: "Bold", text: "a" }], [{ kind: "Text", text: "plain" }]],
      ],
    },
  ]);
});

test("a row wider or narrower than the header is cut or padded to it", () => {
  const blocks = markdownReportBlocks(
    "| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n| only |",
  );
  expect(blocks).toEqual([
    {
      kind: "Table",
      header: [[{ kind: "Text", text: "A" }], [{ kind: "Text", text: "B" }]],
      rows: [
        [[{ kind: "Text", text: "1" }], [{ kind: "Text", text: "2" }]],
        [[{ kind: "Text", text: "only" }], []],
      ],
    },
  ]);
});

test("a run of lines missing its delimiter row stays a paragraph", () => {
  const blocks = markdownReportBlocks("| A | B |\n| 1 | 2 |");
  expect(blocks.map((block) => block.kind)).toEqual(["Paragraph"]);
});

test("a table past the column or row bound is cut rather than read in full", () => {
  const columns = markdownTableColumnsMax + 5;
  const header = Array.from({ length: columns }, (_unused, at) => `c${at}`);
  const delimiter = header.map(() => "---");
  const bodyRow = header.map((_unused, at) => `${at}`);
  const report = [
    `| ${header.join(" | ")} |`,
    `| ${delimiter.join(" | ")} |`,
    ...Array.from(
      { length: markdownTableRowsMax + 5 },
      () => `| ${bodyRow.join(" | ")} |`,
    ),
  ].join("\n");
  const table = markdownReportBlocks(report)[0];
  if (table === undefined || table.kind !== "Table")
    throw new Error("expected the report's first block to be a table");
  expect(table.header.length).toBe(markdownTableColumnsMax);
  expect(table.rows.length).toBe(markdownTableRowsMax);
});

test("a ticket named in the prose reads as the ticket rather than as brackets", () => {
  expect(markdownInlineOf("filed [[ticket:15]] for it")).toEqual([
    { kind: "Text", text: "filed " },
    { kind: "Reference", ticket: 15 },
    { kind: "Text", text: " for it" },
  ]);
});

test("a reference inside a mark is the characters the worker showed", () => {
  expect(markdownInlineOf("write `[[ticket:15]]` to name it")).toEqual([
    { kind: "Text", text: "write " },
    { kind: "Code", text: "[[ticket:15]]" },
    { kind: "Text", text: " to name it" },
  ]);
  expect(markdownInlineOf("**[[ticket:15]]**")).toEqual([
    { kind: "Bold", text: "[[ticket:15]]" },
  ]);
});

test("a reference is read wherever a line's marks are read", () => {
  expect(markdownReportBlocks("- closed [[ticket:15]]")).toEqual([
    {
      kind: "BulletList",
      items: [
        [
          { kind: "Text", text: "closed " },
          { kind: "Reference", ticket: 15 },
        ],
      ],
    },
  ]);
});
