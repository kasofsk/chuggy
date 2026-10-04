/**
 * What the report draws of a model's text: each answer of the corpus as the
 * elements it is and how they nest, the bounds a wall of pipes is held to, the
 * one place the mark is while a text is written, and that a text being written
 * and the same text whole are the same elements.
 *
 * Elements and nesting are asserted, and a class only where a class is all the
 * report says a thing in: a column's side, and the mark.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import type { ReactNode } from "react";

import {
  markdownDepthMax,
  markdownMarkClassName,
  markdownTableColumnsMax,
  markdownTableRowsMax,
} from "../app/browser/ui/MarkdownBlocks.tsx";
import { markdownCodeLanguageCharsMax } from "../app/browser/ui/MarkdownCode.tsx";
import {
  MarkdownLine,
  MarkdownReport,
} from "../app/browser/ui/MarkdownReport.tsx";
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

describe("what a wall of pipes is held to", () => {
  function cells(count: number, word: string): string {
    return `| ${Array.from({ length: count }, () => word).join(" | ")} |`;
  }

  test("a row wider or narrower than the header is cut or padded to it", () => {
    const root = drawn("| A | B |\n| - | - |\n| 1 | 2 | 3 |\n| 4 |");
    expect(all(root, "tbody > tr").map((row) => words(row.children))).toEqual([
      ["1", "2"],
      ["4", ""],
    ]);
  });

  function table(columns: number, rows: number): string {
    return [
      cells(columns, "h"),
      cells(columns, "-"),
      ...Array.from({ length: rows }, () => cells(columns, "c")),
    ].join("\n");
  }

  test("a table past the column bound is cut to it in every row", () => {
    expect(markdownTableColumnsMax).toBe(32);
    const root = drawn(table(40, 3));
    expect(all(root, "thead th")).toHaveLength(32);
    expect(all(root, "tbody > tr")).toHaveLength(3);
    for (const row of all(root, "tbody > tr"))
      expect(row.children).toHaveLength(32);
  });

  test("a table past the row bound is cut to it", () => {
    expect(markdownTableRowsMax).toBe(100);
    const root = drawn(table(3, 120));
    expect(all(root, "thead th")).toHaveLength(3);
    expect(all(root, "tbody > tr")).toHaveLength(100);
  });

  test("a table of more cells than one call may cost is its characters, a line to a row", () => {
    const text = table(40, 108);
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
