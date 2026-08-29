/**
 * What the worker's report reads into: a paragraph keeps every line it was
 * written with, and the marks a worker reaches for most often — bold,
 * italic, inline code, a link — read as themselves rather than as the
 * asterisks and brackets that spelled them.
 */

import { expect, test } from "vitest";

import {
  markdownInlineOf,
  markdownReportBlocks,
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
