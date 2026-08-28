/**
 * The markdown an agent writes, read as blocks and spans rather than left as
 * characters a pane would otherwise print unread.
 *
 * The failure this guards is a report or a turn's text drawn with its own
 * syntax left in it — a heading shown as `# Summary` rather than a heading, a
 * paragraph's own line breaks collapsed away, and a link whose scheme this
 * console would never open drawn as something to click anyway.
 */

import { expect, test } from "vitest";

import { markdownBlocksOf, markdownInlineOf } from "../app/core/markdown.ts";

test("a heading is read at its level, not left as hashes and text", () => {
  expect(markdownBlocksOf("## Findings")).toEqual([
    { kind: "Heading", level: 2, inline: [{ kind: "Text", text: "Findings" }] },
  ]);
});

test("blank-line-separated lines are two paragraphs, not one run-on block", () => {
  expect(markdownBlocksOf("first\n\nsecond")).toEqual([
    { kind: "Paragraph", inline: [{ kind: "Text", text: "first" }] },
    { kind: "Paragraph", inline: [{ kind: "Text", text: "second" }] },
  ]);
});

/** The floor the ticket asks for even where nothing else renders: a
 * paragraph's own line breaks survive as the text a reader wrote, not as a
 * single run-on line. */
test("a paragraph keeps the line breaks written inside it", () => {
  const blocks = markdownBlocksOf("line one\nline two");
  expect(blocks).toEqual([
    {
      kind: "Paragraph",
      inline: [{ kind: "Text", text: "line one\nline two" }],
    },
  ]);
});

test("a fenced block is read whole, its own syntax untouched inside it", () => {
  expect(markdownBlocksOf("```\nconst x = 1;\n```")).toEqual([
    { kind: "CodeBlock", text: "const x = 1;" },
  ]);
});

test("a bulleted list is items, not lines carrying their own marker", () => {
  expect(markdownBlocksOf("- one\n- two")).toEqual([
    {
      kind: "List",
      ordered: false,
      items: [[{ kind: "Text", text: "one" }], [{ kind: "Text", text: "two" }]],
    },
  ]);
});

test("a numbered list is read as ordered", () => {
  const blocks = markdownBlocksOf("1. first\n2. second");
  expect(blocks).toEqual([
    {
      kind: "List",
      ordered: true,
      items: [
        [{ kind: "Text", text: "first" }],
        [{ kind: "Text", text: "second" }],
      ],
    },
  ]);
});

test("strong, emphasis and inline code are read as spans, not asterisks and backticks", () => {
  expect(markdownInlineOf("a **bold** and `code` and *italic* word")).toEqual([
    { kind: "Text", text: "a " },
    { kind: "Strong", text: "bold" },
    { kind: "Text", text: " and " },
    { kind: "Code", text: "code" },
    { kind: "Text", text: " and " },
    { kind: "Emphasis", text: "italic" },
    { kind: "Text", text: " word" },
  ]);
});

test("a link to an address a browser would open is read as a link", () => {
  expect(
    markdownInlineOf("see [the ticket](https://example.test/t/1)"),
  ).toEqual([
    { kind: "Text", text: "see " },
    { kind: "Link", text: "the ticket", href: "https://example.test/t/1" },
  ]);
});

/** A scheme this console would not follow is drawn as what was written, never
 * as something to click. */
test("a link whose scheme is not http, https or mailto is left as text", () => {
  expect(markdownInlineOf("[click me](javascript:doBadThings)")).toEqual([
    { kind: "Text", text: "[click me](javascript:doBadThings)" },
  ]);
});
