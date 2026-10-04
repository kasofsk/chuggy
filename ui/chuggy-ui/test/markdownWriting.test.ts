/**
 * A report read while it is still being written.
 *
 * The cases say what each half-written mark draws as. The two properties walk
 * every prefix of one report that holds every shape the reader knows, because
 * a reader watches all of them go by: no block ever turns into another kind of
 * block, and no mark is ever drawn as the characters it is written in.
 */

import { describe, expect, test } from "vitest";

import { markdownReportBlocks } from "../app/core/markdownReport.ts";
import type {
  MarkdownBlock,
  MarkdownInline,
} from "../app/core/markdownReport.ts";
import { markdownWritingText } from "../app/core/markdownWriting.ts";

function written(text: string): readonly MarkdownBlock[] {
  return markdownReportBlocks(markdownWritingText(text));
}

function words(text: string): readonly MarkdownInline[] {
  const block = written(text).at(-1);
  if (block?.kind !== "Paragraph") throw new Error("no paragraph was drawn");
  return block.lines.at(-1) ?? [];
}

describe("a mark left open on the last line", () => {
  test("bold is drawn as bold from its first letter", () => {
    expect(words("so **bo")).toEqual([
      { kind: "Text", text: "so " },
      { kind: "Bold", text: "bo" },
    ]);
    expect(words("so **bold*")).toEqual([
      { kind: "Text", text: "so " },
      { kind: "Bold", text: "bold" },
    ]);
  });

  test("italic and code are closed the same way", () => {
    expect(words("an *ita")).toEqual([
      { kind: "Text", text: "an " },
      { kind: "Italic", text: "ita" },
    ]);
    expect(words("an _ita")).toEqual([
      { kind: "Text", text: "an " },
      { kind: "Italic", text: "ita" },
    ]);
    expect(words("run `npm c")).toEqual([
      { kind: "Text", text: "run " },
      { kind: "Code", text: "npm c" },
    ]);
  });

  test("an opener nothing follows yet is held back", () => {
    for (const opener of ["**", "*", "`", "_", "[", "[["])
      expect(words(`so ${opener}`)).toEqual([{ kind: "Text", text: "so " }]);
  });

  test("a star a space follows opens nothing", () => {
    expect(words("2 * 3")).toEqual([{ kind: "Text", text: "2 * 3" }]);
    expect(words("2 ** 3")).toEqual([{ kind: "Text", text: "2 ** 3" }]);
  });

  test("an underscore inside a name opens nothing", () => {
    expect(words("see count_wor")).toEqual([
      { kind: "Text", text: "see count_wor" },
    ]);
  });

  test("a mark already closed is left as the reader reads it", () => {
    expect(words("a **b** and `c` d")).toEqual([
      { kind: "Text", text: "a " },
      { kind: "Bold", text: "b" },
      { kind: "Text", text: " and " },
      { kind: "Code", text: "c" },
      { kind: "Text", text: " d" },
    ]);
  });
});

describe("a link or a reference left open on the last line", () => {
  test("a link is its own words until its address is whole", () => {
    const linked = [{ kind: "Text", text: "see the docs" }];
    expect(words("see [the do")).toEqual([
      { kind: "Text", text: "see the do" },
    ]);
    expect(words("see [the docs]")).toEqual(linked);
    expect(words("see [the docs](")).toEqual(linked);
    expect(words("see [the docs](https://exam")).toEqual(linked);
    expect(words("see [the docs](https://example.test)")).toEqual([
      { kind: "Text", text: "see " },
      { kind: "Link", text: "the docs", href: "https://example.test" },
    ]);
  });

  test("words that were meant in brackets keep them once more is written", () => {
    expect(words("as [sic] ")).toEqual([{ kind: "Text", text: "as [sic] " }]);
  });

  test("a ticket's reference is drawn once it is whole and not before", () => {
    for (const half of [
      "[[",
      "[[tick",
      "[[ticket:4",
      "[[ticket:41",
      "[[ticket:41]",
    ])
      expect(words(`blocked by ${half}`)).toEqual([
        { kind: "Text", text: "blocked by " },
      ]);
    expect(words("blocked by [[ticket:41]]")).toEqual([
      { kind: "Text", text: "blocked by " },
      { kind: "Reference", ticket: 41 },
    ]);
  });

  test("the marks are closed past what makes the line a listed one", () => {
    expect(written("- one\n- **tw")).toEqual([
      {
        kind: "BulletList",
        items: [
          [{ kind: "Text", text: "one" }],
          [{ kind: "Bold", text: "tw" }],
        ],
      },
    ]);
  });

  test("only the last line is closed", () => {
    expect(written("a **b\nc")).toEqual(markdownReportBlocks("a **b\nc"));
  });
});

describe("a block's own mark, half written", () => {
  test("the start of a mark is held back until it is one", () => {
    for (const start of ["#", "##", "-", "*", "1", "1.", "`", "``", "|"])
      expect(written(`Before.\n\n${start}`)).toEqual(
        markdownReportBlocks("Before."),
      );
  });

  test("a listed line with nothing on it yet is a line of the list", () => {
    expect(written("- one\n- ")).toEqual([
      { kind: "BulletList", items: [[{ kind: "Text", text: "one" }], []] },
    ]);
  });

  test("a fence nothing closes reads as code to the end, without the fence it is closing on", () => {
    const code = [{ kind: "CodeBlock", text: "const a = 1;" }];
    expect(written("```ts\nconst a = 1;")).toEqual(code);
    expect(written("```ts\nconst a = 1;\n`")).toEqual(code);
    expect(written("```ts\nconst a = 1;\n``")).toEqual(code);
    expect(written("```ts\nconst a = 1;\n```")).toEqual(code);
  });

  test("marks inside a fence are code and are left alone", () => {
    expect(written("```\na **b")).toEqual([
      { kind: "CodeBlock", text: "a **b" },
    ]);
  });
});

describe("a table, half written", () => {
  const cell = (text: string): readonly MarkdownInline[] => [
    { kind: "Text", text },
  ];

  test("a header is a table from its first cell", () => {
    expect(written("| Ticket")).toEqual([
      { kind: "Table", header: [cell("Ticket")], rows: [] },
    ]);
    expect(written("| Ticket | State |")).toEqual([
      { kind: "Table", header: [cell("Ticket"), cell("State")], rows: [] },
    ]);
  });

  test("the header stands while the delimiter under it is written", () => {
    const table = [
      { kind: "Table", header: [cell("Ticket"), cell("State")], rows: [] },
    ];
    for (const under of [
      "",
      "|",
      "| ",
      "|:",
      "| --",
      "| --- |",
      "| --- | :",
      "| --- | --- |",
    ])
      expect(written(`| Ticket | State |\n${under}`)).toEqual(table);
  });

  test("a row is drawn as it is written, padded to the header", () => {
    expect(written("| Ticket | State |\n| --- | --- |\n| 41")).toEqual([
      {
        kind: "Table",
        header: [cell("Ticket"), cell("State")],
        rows: [[cell("41"), []]],
      },
    ]);
  });

  test("pipes under a paragraph's own line stay the paragraph the reader draws", () => {
    const text = "The shape:\n| a | b |";
    expect(written(text)).toEqual(markdownReportBlocks(text));
  });
});

const report = [
  "# Where 41 stands",
  "",
  "It is **blocked** by [[ticket:40]], which *nobody* has claimed.",
  "See `chug status` and [the runbook](https://example.test/runbook) first.",
  "",
  "- claim 40",
  "- run _both_ gates",
  "",
  "1. then **merge**",
  "2. then release",
  "",
  "> a quoted `line`",
  "",
  "```sh",
  "just check",
  "```",
  "",
  "| Ticket | State |",
  "| --- | :-- |",
  "| 40 | **Open** |",
  "| 41 | Blocked |",
  "",
  "## Next",
  "",
  "Nothing until 40 lands.",
].join("\n");

const prefixes = Array.from({ length: report.length + 1 }, (_unused, length) =>
  report.slice(0, length),
);

function inlineRuns(
  block: MarkdownBlock,
): readonly (readonly MarkdownInline[])[] {
  switch (block.kind) {
    case "Heading":
      return [block.inline];
    case "Paragraph":
    case "Quote":
      return block.lines;
    case "BulletList":
    case "OrderedList":
      return block.items;
    case "CodeBlock":
      return [];
    case "Table":
      return [...block.header, ...block.rows.flat()];
  }
}

describe("every moment of one report", () => {
  test("the whole of it reads as itself", () => {
    expect(written(report)).toEqual(markdownReportBlocks(report));
  });

  test("no block turns into another kind of block", () => {
    let before: readonly string[] = [];
    for (const prefix of prefixes) {
      const kinds = written(prefix).map((block) => block.kind);
      expect(kinds.slice(0, before.length), JSON.stringify(prefix)).toEqual(
        before,
      );
      before = kinds;
    }
  });

  test("no mark is drawn as the characters it is written in", () => {
    for (const prefix of prefixes)
      for (const block of written(prefix))
        for (const run of inlineRuns(block))
          for (const node of run)
            if (node.kind === "Text")
              expect(node.text, JSON.stringify(prefix)).not.toMatch(
                /[*`_[\]|#]/u,
              );
  });

  test("read without it, the same report shows its marks", () => {
    const shown = prefixes.some((prefix) =>
      markdownReportBlocks(prefix).some((block) =>
        inlineRuns(block).some((run) =>
          run.some((node) => node.kind === "Text" && /[*`[]/u.test(node.text)),
        ),
      ),
    );
    expect(shown).toBe(true);
  });
});
