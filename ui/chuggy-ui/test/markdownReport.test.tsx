/**
 * What the report draws of a model's text: each answer of the corpus as the
 * elements it is and how they nest, every row and cell of a wall of pipes and
 * where its columns sit, the one place the mark is while a text is written,
 * and that a text being written and the same text whole are the same elements.
 *
 * Elements and nesting are asserted, and a class only where a class is all the
 * report says a thing in: a column's side, and the mark.
 */

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  markdownColumnClassName,
  markdownDepthMax,
  markdownMarkClassName,
} from "../app/browser/ui/MarkdownBlocks.tsx";
import { markdownCodeLanguageCharsMax } from "../app/browser/ui/MarkdownCode.tsx";
import { MarkdownProvider } from "../app/browser/ui/markdownHeld.ts";
import {
  MarkdownLine,
  MarkdownReport,
} from "../app/browser/ui/MarkdownReport.tsx";
import reportSheet from "../app/browser/ui/MarkdownReport.css?raw";
import {
  corpusAnswers,
  corpusComparison,
  corpusEverything,
  corpusHowTo,
  corpusLongLine,
  corpusPlain,
  corpusReview,
} from "./markdownCorpus.ts";
import { prefixes } from "./markdownShape.ts";
import { syntaxDoubleHeld } from "./markdownSyntaxDouble.ts";
import { styleless } from "./styleless.ts";

function drawn(text: string, writing = false): HTMLElement {
  const view = render(<MarkdownReport text={text} bare writing={writing} />);
  const root = view.container.firstElementChild;
  if (!(root instanceof HTMLElement)) throw new Error("no report is drawn");
  return root;
}

function all(root: Element, selector: string): readonly Element[] {
  return Array.from(root.querySelectorAll(selector));
}

function tags(elements: Iterable<Element>): readonly string[] {
  return Array.from(elements, (element) => element.tagName.toLowerCase());
}

function words(elements: Iterable<Element>): readonly string[] {
  return Array.from(elements, (element) => element.textContent);
}

/** The language each block of code says it is in, read from the line over it. */
function languages(root: Element): readonly string[] {
  return all(root, "pre").map(
    (block) =>
      block.previousElementSibling?.firstElementChild?.textContent ?? "",
  );
}

afterEach(cleanup);

describe("a review of a change", () => {
  test("its headings are headings at the level written, and its findings nest three deep with numbers under bullets", () => {
    const root = drawn(corpusReview);
    expect(tags(all(root, ":scope > :is(h1, h2, h3, h4)"))).toEqual([
      "h2",
      "h3",
      "h3",
    ]);
    expect(all(root, ":scope > ul > li")).toHaveLength(2);
    expect(all(root, ":scope > ul > li > ul > li")).toHaveLength(3);
    expect(words(all(root, ":scope > ul > li > ul > li > ol > li"))).toEqual([
      "the held text is cleared",
      "the reader sees it typed again",
    ]);
    expect(all(root, "ul ul ol ul, ul ul ol ol")).toHaveLength(0);
    styleless();
  });

  test("a finding holds a second paragraph and a block of code, in that order", () => {
    const root = drawn(corpusReview);
    const finding = all(root, ":scope > ul > li")[1];
    expect(tags(finding?.children ?? [])).toEqual(["p", "p", "div"]);
    expect(finding?.querySelector("p > strong")?.textContent).toBe(
      "The retry never backs off.",
    );
    expect(finding?.querySelector("div > pre > code")?.textContent).toBe(
      "const waitMilliseconds = Math.min(\n  retryBaseMilliseconds * 2 ** attempt,\n  retryCeilingMilliseconds,\n);",
    );
  });

  test("each block of code says its language and is the text between its fences", () => {
    const root = drawn(corpusReview);
    expect(languages(root)).toEqual(["ts", "python", "bash"]);
    expect(all(root, "pre > code")[2]?.textContent).toBe(
      'set -euo pipefail\npython3 tally/__init__.py "$@" | tee out.log',
    );
    expect(all(root, "pre em, pre strong, pre a")).toHaveLength(0);
  });

  test("a quote holds its lines, a link goes out in its own tab, a strike is struck and a ticket is its number", () => {
    const root = drawn(corpusReview);
    const quote = root.querySelector(":scope > blockquote > p");
    expect(quote?.querySelector("strong")?.textContent).toBe("Note");
    expect(quote?.querySelectorAll("br")).toHaveLength(1);
    expect(quote?.querySelector("code")?.textContent).toBe("src/contract");
    const link = root.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://example.test/fold#L41");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("noreferrer");
    expect(link?.textContent).toBe("the fold");
    const last = root.lastElementChild;
    expect(last?.querySelector("del")?.textContent).toBe(
      "Blocked on the server.",
    );
    expect(last?.textContent).toContain("Tracked as #41.");
    expect(last?.textContent).not.toContain("[[");
  });
});

describe("a comparison", () => {
  const sides = ["left", "right", "right", "center", "right", "left", "left"];

  test("its table is a table with a header, in a box of its own between the prose", () => {
    const root = drawn(corpusComparison);
    expect(tags(root.children)).toEqual(["p", "div", "p", "ol"]);
    const box = root.children[1];
    expect(tags(box?.children ?? [])).toEqual(["table"]);
    expect(all(root, "table > thead > tr > th")).toHaveLength(7);
    expect(all(root, "table > tbody > tr")).toHaveLength(3);
    expect(all(root, "table > tbody > tr > td")).toHaveLength(21);
    expect(words(all(root, "thead th")).slice(0, 2)).toEqual([
      "Option",
      "Latency (p50)",
    ]);
  });

  test("each column is set to the side its rule said, by class and never by a style", () => {
    const root = drawn(corpusComparison);
    for (const row of all(root, "tr"))
      expect(
        Array.from(row.children, (cell) =>
          sides.find((side) =>
            cell.classList.contains(`run-report-align-${side}`),
          ),
        ),
      ).toEqual(sides);
    expect(all(root, "[style]")).toHaveLength(0);
  });

  test("a cell carries its own marks", () => {
    const root = drawn(corpusComparison);
    const first = all(root, "tbody > tr > td:first-child");
    expect(
      words(first.map((cell) => cell.querySelector("strong") ?? cell)),
    ).toEqual(["A", "B", "C"]);
    expect(first[1]?.querySelector("code")?.textContent).toBe(
      "server-sent events",
    );
    expect(root.querySelector("td > em")?.textContent).toBe("recommended");
    expect(root.querySelector("td > a")?.getAttribute("href")).toBe(
      "https://example.test/broker",
    );
    expect(all(root, ":scope > ol > li")).toHaveLength(2);
  });
});

describe("a how-to", () => {
  test("its steps start where they say, and each holds its code", () => {
    const root = drawn(corpusHowTo);
    const list = root.querySelector(":scope > ol");
    expect(list?.getAttribute("start")).toBe("3");
    const steps = all(root, ":scope > ol > li");
    expect(steps.map((step) => tags(step.children))).toEqual([
      ["p", "div"],
      ["p", "div", "p"],
      ["p", "ul"],
    ]);
    expect(languages(root)).toEqual(["sh", "sh", "markdown"]);
    expect(words(all(root, "ol pre > code"))).toEqual(["npm ci", "just hooks"]);
  });

  test("a task is a box that is ticked or not and cannot be pressed", () => {
    const root = drawn(corpusHowTo);
    const boxes = all(root, "ol > li > ul > li > input");
    expect(
      boxes.map((box) => [
        box.getAttribute("type"),
        (box as HTMLInputElement).checked,
        (box as HTMLInputElement).disabled,
      ]),
    ).toEqual([
      ["checkbox", true, true],
      ["checkbox", false, true],
    ]);
    expect(root.textContent).not.toContain("[x]");
    expect(root.textContent).not.toContain("[ ]");
  });

  test("a longer fence holds a shorter one as text, a rule is a rule, and a bare address is a link", () => {
    const root = drawn(corpusHowTo);
    expect(root.querySelector(":scope > div > pre > code")?.textContent).toBe(
      "```sh\njust check\n```",
    );
    expect(tags(root.children)).toEqual([
      "h1",
      "p",
      "ol",
      "p",
      "div",
      "hr",
      "h4",
      "p",
    ]);
    const link = root.querySelector(":scope > p:last-child > a");
    expect(link?.getAttribute("href")).toBe("https://example.test/gates");
    expect(link?.textContent).toBe("https://example.test/gates");
  });
});

describe("a plain answer, and one that is a single long line", () => {
  test("words alone are paragraphs and nothing else", () => {
    const root = drawn(corpusPlain);
    expect(tags(root.children)).toEqual(["p", "p"]);
    expect(all(root, "p *")).toHaveLength(0);
  });

  test("a long line is one paragraph holding all of it", () => {
    const root = drawn(corpusLongLine);
    expect(tags(root.children)).toEqual(["p", "p", "p"]);
    const line = root.children[1]?.textContent ?? "";
    expect(line.startsWith("In short, the reader keeps")).toBe(true);
    expect(line.endsWith("and that is all of it.")).toBe(true);
    expect(corpusLongLine).toContain(line);
  });
});

describe("one of everything", () => {
  test("four levels of heading are four elements", () => {
    const root = drawn(corpusEverything);
    expect(tags(Array.from(root.children).slice(0, 4))).toEqual([
      "h1",
      "h2",
      "h3",
      "h4",
    ]);
  });

  test("a mark holds a mark, and a writer's own newline breaks the line", () => {
    const paragraph = drawn(corpusEverything).querySelector(":scope > p");
    expect(paragraph?.querySelectorAll(":scope > br")).toHaveLength(3);
    expect(paragraph?.querySelector("em > strong")?.textContent).toBe(
      "bold italic",
    );
    expect(paragraph?.querySelector("strong > code")?.textContent).toBe("code");
    expect(paragraph?.querySelector("strong > a")?.textContent).toBe("a link");
    expect(paragraph?.querySelector("a > code")?.textContent).toBe("code");
    expect(paragraph?.querySelector("del")?.textContent).toBe("struck");
    expect(words(all(paragraph ?? document.body, ":scope > code"))).toEqual([
      "code holding a ` backtick",
    ]);
    expect(paragraph?.textContent).toContain("an escaped *star*");
  });

  test("markup meant for a browser is the characters it is", () => {
    const root = drawn(
      `${corpusEverything}\n\n<script>alert(1)</script> and <img src=x onerror=alert(1)>`,
    );
    expect(all(root, "b, script, img")).toHaveLength(0);
    expect(root.textContent).toContain("<b>tags</b> as text");
    expect(root.textContent).toContain("<script>alert(1)</script>");
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  test("a line goes on, holds a second paragraph, and nests numbers and bullets three deep", () => {
    const root = drawn(corpusEverything);
    const lines = all(root, ":scope > ul > li");
    expect(lines.map((line) => tags(line.children))).toEqual([
      ["p"],
      ["p", "p", "ol"],
      ["p"],
    ]);
    expect(lines[0]?.querySelectorAll("p > br")).toHaveLength(1);
    expect(words(all(root, ":scope > ul > li > ol > li > ul > li"))).toEqual([
      "nested again, three deep",
    ]);
    expect(all(root, ":scope > ul > li > ol > li")).toHaveLength(2);
  });
});

describe("one of everything, in its lists and after them", () => {
  test("a link to nowhere a member could be sent is its words, where it pointed as code, and no link", () => {
    const line = all(drawn(corpusEverything), ":scope > ul > li")[2];
    expect(line?.querySelectorAll("a")).toHaveLength(0);
    expect(line?.textContent).toBe(
      "three, with a relative link ./console/BRIEF.md and a script javascript:alert(1) that are not links",
    );
    expect(words(all(line ?? document.body, "code"))).toEqual([
      "./console/BRIEF.md",
      "javascript:alert(1)",
    ]);
  });

  test("a numbered list starts at its number, a quote holds a list, and a rule is drawn", () => {
    const root = drawn(corpusEverything);
    expect(root.querySelector(":scope > ol")?.getAttribute("start")).toBe("7");
    expect(
      tags(root.querySelector(":scope > blockquote")?.children ?? []),
    ).toEqual(["p", "ul"]);
    expect(all(root, ":scope > blockquote > ul > li")).toHaveLength(2);
    expect(all(root, ":scope > hr")).toHaveLength(1);
    const last = root.lastElementChild;
    expect(last?.textContent).toContain("count_words and __init__.py");
    expect(last?.querySelectorAll("em, strong")).toHaveLength(0);
    expect(last?.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.test/bare",
    );
  });
});

function pipeCells(count: number, word: string): string {
  return `| ${Array.from({ length: count }, () => word).join(" | ")} |`;
}

function pipeTable(columns: number, rows: number): string {
  return [
    pipeCells(columns, "h"),
    pipeCells(columns, "-"),
    ...Array.from({ length: rows }, () => pipeCells(columns, "c")),
  ].join("\n");
}

/** A table whose every cell is a word of its own, rows of `wider` cells
 * under a header of `columns`. */
function pipeNumbered(columns: number, rows: number, wider: number): string {
  const row = (name: string, width: number): string =>
    `| ${Array.from({ length: width }, (_unused, at) => `${name}c${String(at)}e`).join(" | ")} |`;
  return [
    row("h", columns),
    pipeCells(columns, "-"),
    ...Array.from({ length: rows }, (_unused, at) =>
      row(`r${String(at)}`, wider),
    ),
  ].join("\n");
}

describe("what a wall of pipes is held to", () => {
  test("a row narrower than the header is padded to it, and one wider keeps what it wrote past it in its last cell", () => {
    const root = drawn("| A | B |\n| - | - |\n| 1 | 2 | 3 | **4** |\n| 5 |");
    expect(all(root, "tbody > tr").map((row) => words(row.children))).toEqual([
      ["1", "2 | 3 | 4"],
      ["5", ""],
    ]);
    expect(words(all(root, "td:last-child > strong"))).toEqual(["4"]);
  });

  test("a table of forty columns is drawn with forty in every row", () => {
    const root = drawn(pipeTable(40, 3));
    expect(all(root, "thead th")).toHaveLength(40);
    expect(all(root, "tbody > tr")).toHaveLength(3);
    for (const row of all(root, "tbody > tr"))
      expect(row.children).toHaveLength(40);
  });

  test("a table of a hundred and twenty rows is drawn with every one", () => {
    const root = drawn(pipeTable(3, 120));
    expect(all(root, "thead th")).toHaveLength(3);
    expect(all(root, "tbody > tr")).toHaveLength(120);
  });

  test.each([
    ["wide", 40, 3, 40],
    ["long", 3, 120, 3],
    ["long and wide", 33, 101, 33],
    ["of rows wider than its header", 3, 60, 9],
    ["of more cells than one call may cost", 40, 108, 40],
  ])(
    "no cell a writer wrote is missing from a table that is %s",
    (_name, columns, rows, wider) => {
      const text = pipeNumbered(columns, rows, wider);
      for (const writing of [false, true]) {
        const said = drawn(text, writing).textContent;
        for (const word of text.match(/\w+c\d+e/gu) ?? [])
          if (!said.includes(word)) expect(word).toBe("drawn");
        cleanup();
      }
    },
  );

  test("a table of more cells than one call may cost is its characters, a line to a row", () => {
    const text = pipeTable(40, 108);
    const root = drawn(text);
    expect(all(root, "table")).toHaveLength(0);
    expect(tags(root.children)).toEqual(["p", "p"]);
    expect(all(root, "br")).toHaveLength(108);
    expect(
      Array.from(root.children, (block) => block.textContent).join(""),
    ).toBe(text.replaceAll("\n", ""));
  });

  test("a text of marks past what is read is its characters, in one paragraph", () => {
    const hostile = `${"a* ".repeat(4_000)}and **bold**`;
    const root = drawn(hostile);
    expect(tags(root.children)).toEqual(["p"]);
    expect(root.querySelectorAll("strong, em")).toHaveLength(0);
    expect(root.textContent).toBe(hostile);
  });
});

function styleRules(list: CSSRuleList): readonly CSSStyleRule[] {
  return Array.from(list).flatMap((rule) =>
    rule instanceof CSSStyleRule
      ? [rule]
      : rule instanceof CSSGroupingRule
        ? styleRules(rule.cssRules)
        : [],
  );
}

/** Every value the report's sheet gives one element for one property. */
function declared(element: Element, property: string): readonly string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(reportSheet);
  return styleRules(sheet.cssRules).flatMap((rule) => {
    const value = rule.style.getPropertyValue(property);
    return value !== "" && element.matches(rule.selectorText) ? [value] : [];
  });
}

/**
 * Where a column sits is a browser's to say, and no suite here runs one. What
 * these hold is everything that decides it: a `col` to each cell of the
 * header, one class on each, a sheet that fixes the layout and sizes a column
 * by that class alone, and a cell that stays the cell of its column.
 */
const audited = [
  "| Part | Language | Purpose |",
  "| --- | --- | --- |",
  "| Recorder (`arbbot.record`, `arb-recorder`) | Python + Rust | Credential-free ingest into normalized `BookEvents`, append-only JSONL per venue/day |",
  "| Scanner (`config/registry.yaml` + ScanLoop) | Python | Prices the relationship graph and writes per-relationship opportunity streams |",
  "| Replay (`arbbot.report.daily`) | Python (DuckDB/SQL) | The Stage 2 gate: deterministic lag sweeps at 300/500/1000 ms |",
  "",
  "Dashboard is the notable fifth piece.",
].join("\n");
const uneven = [
  "| Gate | Hook | What it checks |",
  "|:--|:-:|--:|",
  "| `check-figures` | yes | no comment states a quantity | and | more |",
  "| `check-model` |",
  "| `check-paths` | yes | a path a doc names is there |",
].join("\n");

/** What sizes a table's columns, as it is in the markup. */
function columns(root: Element): string {
  const table = root.querySelector("div.run-report-table > table");
  const group = table?.querySelector(":scope > colgroup");
  if (table === null || table === undefined) return "none";
  if (group === null || group === undefined) return "none";
  return `${String(table.attributes.length)} ${group.outerHTML}`;
}

/** The table a report draws, and the box it scrolls in. */
function tableOf(root: Element): readonly [Element, Element] {
  const table = root.querySelector("table");
  const box = table?.parentElement;
  if (table === null || box === null || box === undefined)
    throw new Error("no table is drawn");
  return [table, box];
}

describe("where a table's columns sit", () => {
  test("are a column to each cell of the header, each of the one class and nothing else", () => {
    const root = drawn(corpusComparison);
    const cols = all(root, "table > colgroup > col");
    expect(cols).toHaveLength(7);
    for (const col of cols)
      expect(col.outerHTML).toBe(`<col class="${markdownColumnClassName}">`);
    expect(root.querySelector("table")?.attributes).toHaveLength(0);
    expect(all(root, "[style], [width], style")).toHaveLength(0);
    styleless();
  });

  test("are sized by the sheet from that class under a fixed layout, and by nothing a cell holds", () => {
    const root = drawn(audited);
    const [table, box] = tableOf(root);
    expect(declared(table, "table-layout")).toEqual(["fixed"]);
    expect(declared(table, "width")).toEqual(["100%"]);
    expect(declared(table, "min-width")).toEqual([]);
    expect(declared(box, "overflow-x")).toEqual(["auto"]);
    const widths = all(root, "col").map((col) => declared(col, "width"));
    expect(widths).toHaveLength(3);
    for (const width of widths) expect(width).toEqual(widths[0]);
    expect(widths[0]).toHaveLength(1);
    const held = all(root, "th, td, th *, td *");
    expect(held.some((element) => element.matches("td > code"))).toBe(true);
    for (const element of held) {
      for (const property of ["width", "min-width", "max-width"])
        expect(declared(element, property), property).toEqual([]);
      for (const property of ["white-space", "text-wrap", "text-wrap-mode"])
        expect(declared(element, property)).not.toContain("nowrap");
    }
    for (const cell of all(root, "th, td"))
      expect(declared(cell, "overflow-wrap")).toEqual(["anywhere"]);
  });

  test("are no narrower than a floor set in the report's own type, in a box that scrolls and never widens what holds it", () => {
    const root = drawn(audited);
    const [table, box] = tableOf(root);
    for (const col of all(root, "col"))
      expect(declared(col, "width")).toEqual(["10em"]);
    expect(declared(table, "width")).toEqual(["100%"]);
    expect(declared(box, "overflow-x")).toEqual(["auto"]);
    for (const property of ["width", "min-width", "max-width", "display"])
      expect(declared(box, property), property).toEqual([]);
    expect(declared(root, "min-width")).toEqual(["0px"]);
    for (const element of [root, box, table, ...all(root, "col, th, td")])
      for (const property of ["font-size", "width", "min-width", "padding"])
        for (const value of declared(element, property))
          expect(value, property).not.toMatch(/[1-9]\d*(?:px|rem)\b/u);
  });
});

describe("a table written a few characters at a time", () => {
  test.each([
    ["a table of prose and names", audited],
    ["a table of rows wider and narrower than its header", uneven],
    ["a comparison", corpusComparison],
  ])(
    "%s keeps every drawn cell in its column, and its columns as its header drew them",
    (_name, text) => {
      const fresh = drawn(text).outerHTML;
      cleanup();
      const view = render(<MarkdownReport text="" bare writing />);
      const seen = new Map<string, Element>();
      let sized: string | undefined;
      let frames = 0;
      const headed = text.indexOf("\n", text.indexOf("|"));
      const frame = (written: string, writing: boolean): void => {
        view.rerender(<MarkdownReport text={written} bare writing={writing} />);
        const root = view.container;
        const table = root.querySelector("table");
        if (table === null) return;
        const count = all(table, "col").length;
        expect(all(table, "thead th")).toHaveLength(count);
        all(table, "tr").forEach((row, line) => {
          expect(row.children).toHaveLength(count);
          Array.from(row.children).forEach((cell, column) => {
            const place = `${String(line)}.${String(column)}`;
            if (seen.has(place)) expect(seen.get(place)).toBe(cell);
            seen.set(place, cell);
          });
        });
        if (written.length <= headed) return;
        sized ??= columns(root);
        expect(columns(root)).toBe(sized);
        frames += 1;
      };
      for (const prefix of prefixes(text, 3)) frame(prefix, true);
      frame(text, false);
      expect(frames).toBeGreaterThan(20);
      expect(sized).toContain(markdownColumnClassName);
      expect(all(view.container, "[style]")).toHaveLength(0);
      expect(view.container.firstElementChild?.outerHTML).toBe(fresh);
      styleless();
    },
  );
});

describe("a ticket named in a report", () => {
  test("is the ticket's number wherever words are drawn, and the characters where code or a link is", () => {
    const root = drawn(
      "Filed [[ticket:15]], **[[ticket:16]]** and `[[ticket:17]]`, with [see [[ticket:18]]](https://example.test/t).\n\n| T |\n| - |\n| [[ticket:19]] |",
    );
    expect(words(all(root, ".num"))).toEqual(["#15", "#16", "#19"]);
    expect(root.querySelector("strong")?.textContent).toBe("#16");
    expect(root.querySelector("code")?.textContent).toBe("[[ticket:17]]");
    expect(root.querySelector("a")?.textContent).toBe("see [[ticket:18]]");
  });
});

/** Where the mark is: the element carrying it, and how many do. */
function marks(root: HTMLElement): readonly string[] {
  const carrying = [
    ...(root.classList.contains(markdownMarkClassName) ? [root] : []),
    ...all(root, `.${markdownMarkClassName}`),
  ];
  return carrying.map((element) =>
    element === root ? "report" : element.tagName.toLowerCase(),
  );
}

describe("the mark, while a text is being written", () => {
  function markOf(text: string): readonly string[] {
    const found = marks(drawn(text, true));
    cleanup();
    return found;
  }

  test("is on the last thing written, whatever that is", () => {
    expect(markOf("It is")).toEqual(["p"]);
    expect(markOf("## Review")).toEqual(["h2"]);
    expect(markOf("- one\n- two")).toEqual(["p"]);
    expect(markOf("1. step\n\n   ```sh\n   npm")).toEqual(["code"]);
    expect(markOf("> quoted")).toEqual(["p"]);
    expect(markOf("```ts\nconst a = 1;")).toEqual(["code"]);
    expect(markOf("| A | B |\n| - | - |\n| 1 | 2 |\n")).toEqual(["td"]);
    expect(markOf("| A | B |\n| - | - |\n")).toEqual(["th"]);
  });

  test("is in the last cell written of a table that is the last block", () => {
    const root = drawn("| A | B |\n| - | - |\n| 1 | 2 |\n| 3 |\n", true);
    const marked = root.querySelector(`.${markdownMarkClassName}`);
    expect(marked?.textContent).toBe("3");
    expect(marked?.parentElement).toBe(
      root.querySelector("tbody > tr:last-child"),
    );
  });

  test("is on the report itself where nothing written can carry it", () => {
    expect(markOf("")).toEqual(["report"]);
    expect(markOf("- ")).toEqual(["report"]);
    expect(markOf("Above.\n\n---\n")).toEqual(["report"]);
  });

  test("is one mark and never two or none, at every moment each answer is written", () => {
    for (const [name, text] of Object.entries(corpusAnswers)) {
      const view = render(<MarkdownReport text="" bare writing />);
      for (const prefix of prefixes(text, name === "longLine" ? 211 : 7)) {
        view.rerender(<MarkdownReport text={prefix} bare writing />);
        const root = view.container.firstElementChild as HTMLElement;
        expect(marks(root), `${name} at ${String(prefix.length)}`).toHaveLength(
          1,
        );
      }
      cleanup();
    }
  });

  test("is nowhere on a text that is whole", () => {
    for (const text of Object.values(corpusAnswers)) {
      expect(marks(drawn(text))).toEqual([]);
      cleanup();
    }
  });
});

describe("what the served policy would refuse", () => {
  test("no element of any answer carries a style, written or whole, and no sheet is added", () => {
    for (const [name, text] of Object.entries(corpusAnswers)) {
      const half = text.slice(0, Math.floor(text.length / 2));
      for (const root of [drawn(half, true), drawn(text)]) {
        expect(all(root, "[style]"), name).toEqual([]);
        expect(root.hasAttribute("style"), name).toBe(false);
      }
      styleless();
      cleanup();
    }
  });
});

/** A report's markup with the mark taken off, which is all a text being
 * written is allowed to differ from itself whole by. */
function unmarked(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  for (const element of [copy, ...all(copy, `.${markdownMarkClassName}`)]) {
    element.classList.remove(markdownMarkClassName);
    if (element.classList.length === 0) element.removeAttribute("class");
  }
  return copy.outerHTML;
}

function stepped(text: string, stride: number): ReactNode[] {
  return prefixes(text, stride).map((prefix) => (
    <MarkdownReport text={prefix} bare writing />
  ));
}

describe("a text being written and the same text whole", () => {
  test("are the same elements, apart from the mark", () => {
    for (const [name, text] of Object.entries(corpusAnswers)) {
      const whole = drawn(text).outerHTML;
      cleanup();
      expect(unmarked(drawn(text, true)), name).toBe(whole);
      cleanup();
    }
  });

  test("written a few characters at a time, then whole, it is what it is drawn as from nothing", () => {
    for (const [name, text] of Object.entries(corpusAnswers)) {
      const fresh = drawn(text).outerHTML;
      cleanup();
      const view = render(<MarkdownReport text="" bare writing />);
      for (const moment of stepped(text, name === "longLine" ? 211 : 13))
        view.rerender(moment);
      const root = view.container.firstElementChild;
      const first = root?.firstElementChild;
      view.rerender(<MarkdownReport text={text} bare />);
      expect(view.container.firstElementChild).toBe(root);
      expect(root?.firstElementChild).toBe(first);
      expect(root?.outerHTML, name).toBe(fresh);
      cleanup();
    }
  });
});

describe("a line of prose with its marks", () => {
  test("is drawn as its marks with no block around them", () => {
    const view = render(
      <p>
        <MarkdownLine text={"Filed **[[ticket:15]]**\nand `moved` on."} />
      </p>,
    );
    const line = view.container.firstElementChild;
    expect(tags(line?.children ?? [])).toEqual(["strong", "code"]);
    expect(line?.textContent).toBe("Filed #15 and moved on.");
  });

  test.each([
    "## Summary Filed [[ticket:15]] and **moved** `on`.",
    "- Filed [[ticket:15]] and **moved** `on`.",
    "1. Filed [[ticket:15]] and **moved** `on`.",
    "> Filed [[ticket:15]] and **moved** `on`.",
    "    Filed [[ticket:15]] and **moved** `on`.",
    "| Filed [[ticket:15]] | and **moved** `on`.\n| - | - |",
  ])(
    "is its words, marks and references whatever it opens with: %j",
    (note) => {
      const view = render(
        <p>
          <MarkdownLine text={note} />
        </p>,
      );
      const line = view.container.firstElementChild;
      expect(words(all(line ?? view.container, ".num"))).toEqual(["#15"]);
      expect(tags(line?.children ?? [])).toEqual(["span", "strong", "code"]);
      expect(line?.textContent).toContain("Filed #15");
      expect(line?.textContent).toContain("and moved on.");
    },
  );

  test("keeps what it opens with as the characters they are", () => {
    const view = render(
      <p>
        <MarkdownLine text={"## Summary\n\n- one **two**\r\n\t> three"} />
      </p>,
    );
    expect(view.container.textContent).toBe("## Summary - one two > three");
    expect(tags(view.container.firstElementChild?.children ?? [])).toEqual([
      "strong",
    ]);
  });

  test("past what a line may cost is the line as it was written", () => {
    const note = `${"a* ".repeat(4_000)}and **bold**`;
    const view = render(
      <p>
        <MarkdownLine text={note} />
      </p>,
    );
    expect(view.container.firstElementChild?.childElementCount).toBe(0);
    expect(view.container.textContent).toBe(note);
  });
});

/** How many of an element's ancestors, and itself, match a selector. */
function nested(element: Element, selector: string): number {
  let count = 0;
  for (let at: Element | null = element; at !== null; at = at.parentElement)
    if (at.matches(selector)) count += 1;
  return count;
}

function deepest(root: Element, selector: string): number {
  return Math.max(
    0,
    ...all(root, selector).map((element) => nested(element, selector)),
  );
}

describe("a text nested past what is drawn", () => {
  test("lists indented one under another are lists to the bound, and their words below it", () => {
    expect(markdownDepthMax).toBe(16);
    const text = Array.from(
      { length: 40 },
      (_unused, at) => `${"  ".repeat(at)}- item ${String(at)}.`,
    ).join("\n");
    for (const writing of [false, true]) {
      const root = drawn(text, writing);
      expect(deepest(root, "ul")).toBe(9);
      for (let at = 0; at < 40; at += 1)
        expect(root.textContent).toContain(`item ${String(at)}.`);
      cleanup();
    }
  });

  test("marks held one inside another are marks to the bound, and their words below it", () => {
    const text = `${"*a **b ".repeat(11)}c${"***".repeat(11)}`;
    for (const writing of [false, true]) {
      const root = drawn(text, writing);
      expect(deepest(root, "em, strong")).toBe(17);
      expect(root.textContent).toBe(`${"a b ".repeat(11)}c`);
      cleanup();
    }
  });

  test.each([
    `${">".repeat(3_000)} a`,
    `${"- ".repeat(2_000)}a`,
    `${"[".repeat(3_000)}a${"](https://a.test)".repeat(3_000)}`,
    `${"~~a ".repeat(200)}b${" ~~".repeat(200)}`,
  ])("a line of more marks than any text has is drawn, shallow: %#", (text) => {
    for (const writing of [false, true]) {
      const root = drawn(text, writing);
      expect(deepest(root, "*")).toBeLessThan(40);
      expect(root.textContent.length).toBeGreaterThan(0);
      cleanup();
    }
  });
});

describe("a block of code's language", () => {
  test("is said no longer than the bar has room for", () => {
    expect(markdownCodeLanguageCharsMax).toBe(24);
    const root = drawn(`\`\`\`${"quint".repeat(8)}\nval a = 1\n\`\`\``);
    expect(languages(root)).toEqual(["quintquintquintquintquin"]);
    expect(root.querySelector("pre > code")?.textContent).toBe("val a = 1");
  });
});

describe("a text written a character at a time", () => {
  function written(text: string, each: (root: Element) => void): Element {
    const view = render(<MarkdownReport text="" bare writing />);
    for (let length = 1; length <= text.length; length += 1) {
      view.rerender(
        <MarkdownReport text={text.slice(0, length)} bare writing />,
      );
      each(view.container.firstElementChild ?? view.container);
    }
    return view.container;
  }

  test.each([
    "| Option | **Verdict** |\n| --- | --- |\n| A | **take it** |\n",
    "| `code` | *why* | ~~not~~ | [link](https://a.test) |\n| - | - | - | - |\n| 1 | 2 | 3 | 4 |",
    "| _name_ | \\| piped | `a\\|b` |\n|:-|-:|:-:|\n| x | y | z |",
  ])(
    "a table is a table from its header's first cell on, whatever a cell opens with: %#",
    (text) => {
      const seen = new Set<string>();
      written(text, (root) => {
        const first = root.firstElementChild;
        if (first !== null && !first.matches("div.run-report-table"))
          seen.add(`<${first.tagName.toLowerCase()}> ${first.textContent}`);
      });
      expect([...seen]).toEqual([]);
    },
  );

  test.each(["\r", "\r\n", "\n"])(
    "a heading ended by %j is drawn once, and what follows it under it",
    (ending) => {
      const text = `# Title${ending}The answer goes on${ending}and on, a word at a time.`;
      const container = written(text, (root) => {
        expect(all(root, "h1").length).toBeLessThanOrEqual(1);
      });
      expect(words(all(container, "h1"))).toEqual(["Title"]);
      expect(tags(container.firstElementChild?.children ?? [])).toEqual([
        "h1",
        "p",
      ]);
    },
  );

  test("code ended by a lone carriage return is not what follows it", () => {
    const text = "```ts\rconst a = 1;\r```\rAnd then **words**.\rMore.";
    const container = written(text, () => undefined);
    expect(words(all(container, "pre > code"))).toEqual(["const a = 1;"]);
    expect(words(all(container, "strong"))).toEqual(["words"]);
  });
});

describe("a list longer than one call may cost", () => {
  test("is drawn as lists one under another, every item an item", () => {
    const root = drawn(
      "- an item of the list, with **words** in it\n".repeat(600),
    );
    expect(all(root, "ul").length).toBeGreaterThan(1);
    expect(tags(root.children).every((tag) => tag === "ul")).toBe(true);
    expect(all(root, "li")).toHaveLength(600);
    expect(all(root, "li strong")).toHaveLength(600);
  });

  test("numbered, goes on from the number each part of it begins with", () => {
    const text = Array.from(
      { length: 600 },
      (_unused, at) => `${String(at + 1)}. an item of the list, with words\n`,
    ).join("");
    const root = drawn(text);
    const lists = all(root, "ol");
    expect(lists.length).toBeGreaterThan(1);
    let items = 0;
    for (const list of lists) {
      expect(list.getAttribute("start")).toBe(String(items + 1));
      items += list.children.length;
    }
    expect(items).toBe(600);
  });
});

describe("a text that is dear to read", () => {
  const text = Array.from(
    { length: 6 },
    (_unused, at) => `Paragraph ${String(at)} ${"goes on ".repeat(40)}.`,
  ).join("\n\n");

  /** A report under a clock that moves by `time.step` each time it is
   * read, which is what a reading that costs something is from inside. */
  function mounted(
    writing: boolean,
    time: { now: number; step: number },
  ): HTMLElement {
    const clock = (): number => (time.now += time.step);
    const view = render(
      <MarkdownProvider clock={clock} syntax={syntaxDoubleHeld().open}>
        <MarkdownReport text={text} bare writing={writing} />
      </MarkdownProvider>,
    );
    return view.container;
  }

  test("is drawn a step behind while it is written, and to its end once its rest is over", () => {
    vi.useFakeTimers();
    try {
      const time = { now: 0, step: 5 };
      const container = mounted(true, time);
      const first = all(container, "p").length;
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(6);
      time.step = 0;
      act(() => {
        vi.advanceTimersByTime(10);
      });
      expect(all(container, "p")).toHaveLength(first);
      act(() => {
        time.now += 60_000;
        vi.advanceTimersByTime(1_000);
      });
      expect(all(container, "p")).toHaveLength(6);
      expect(all(container, `.${markdownMarkClassName}`)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("is drawn to its end at once when it is whole", () => {
    expect(all(mounted(false, { now: 0, step: 5 }), "p")).toHaveLength(6);
  });
});
