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
  markdownMarkClassName,
  markdownTableColumnsMax,
  markdownTableRowsMax,
} from "../app/browser/ui/MarkdownBlocks.tsx";
import {
  MarkdownLine,
  MarkdownReport,
} from "../app/browser/ui/MarkdownReport.tsx";
import { markdownMarksMax } from "../app/browser/ui/markdownTree.ts";
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
  test("a link to nowhere a member could be sent is its words and no link", () => {
    const line = all(drawn(corpusEverything), ":scope > ul > li")[2];
    expect(line?.querySelectorAll("a")).toHaveLength(0);
    expect(line?.textContent).toBe(
      "three, with a relative link and a script that are not links",
    );
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

  test("a table past the column or the row bound is cut rather than drawn in full", () => {
    const wide = markdownTableColumnsMax + 8;
    const long = markdownTableRowsMax + 8;
    const root = drawn(
      [
        cells(wide, "h"),
        cells(wide, "-"),
        ...Array.from({ length: long }, () => cells(wide, "c")),
      ].join("\n"),
    );
    expect(all(root, "thead th")).toHaveLength(markdownTableColumnsMax);
    expect(all(root, "tbody > tr")).toHaveLength(markdownTableRowsMax);
    expect(all(root, "tbody > tr:last-child > td")).toHaveLength(
      markdownTableColumnsMax,
    );
  });

  test("a text of marks past what is read is its characters, in one paragraph", () => {
    const hostile = "*a ".repeat(markdownMarksMax + 8);
    const root = drawn(hostile);
    expect(tags(root.children)).toEqual(["p"]);
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

  test("that is not one paragraph is the line as it was written", () => {
    const view = render(
      <p>
        <MarkdownLine text="- one **two**" />
      </p>,
    );
    expect(view.container.firstElementChild?.childElementCount).toBe(0);
    expect(view.container.textContent).toBe("- one **two**");
  });
});
