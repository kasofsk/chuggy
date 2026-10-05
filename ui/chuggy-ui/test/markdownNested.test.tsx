/**
 * Code fenced under a list item or inside a quote: that it is drawn as the
 * code it is and the words around it as words, whole and while it is written,
 * that no piece of a text begins inside it, and that what it holds is charged
 * as code only for as long as the grammar is sure to read it as code. And how
 * many list items the lines above may have left open, which is what a line
 * held deep is charged by.
 *
 * Every answer here is built a part at a time, so what each block of code must
 * hold is known from how the text was made and never from a reading of it.
 */

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";

import { MarkdownReport } from "../app/browser/ui/MarkdownReport.tsx";
import {
  markdownNestingBegun,
  markdownNestingLine,
} from "../app/browser/ui/markdownNested.ts";
import { markdownPiecesFrom } from "../app/browser/ui/markdownPieces.ts";
import {
  markdownReadingBlocks,
  markdownReadingNext,
} from "../app/browser/ui/markdownReading.ts";
import type { MarkdownReading } from "../app/browser/ui/markdownReading.ts";
import { markdownBlocksParsed } from "../app/browser/ui/markdownTree.ts";
import type { MarkdownNode } from "../app/browser/ui/markdownTree.ts";
import { prefixes } from "./markdownShape.ts";

/** One part of an answer: what is written, and either the code a fence holds
 * or what a reader is drawn of the words. */
interface Part {
  readonly text: string;
  readonly code?: string;
  readonly said?: string;
}

/** An answer, and what of it is code. */
interface Answer {
  readonly text: string;
  readonly codes: readonly string[];
  /** Everything drawn outside a block of code, with nothing between. */
  readonly prose: string;
  /** Where each fence's opening line begins and its closing line ends. */
  readonly fences: readonly (readonly [number, number])[];
}

function words(text: string, said: string): Part {
  return { text, said };
}

/** A fence whose every line opens with `under`, a blank line of its code
 * being written as `under` with no space after it. */
function fenced(
  under: string,
  lines: readonly string[],
  mark = "```",
  language = "",
): Part {
  const written = lines.map((line) =>
    line === "" ? under.trimEnd() : `${under}${line}`,
  );
  const text = [`${under}${mark}${language}`, ...written, `${under}${mark}`];
  return { text: `${text.join("\n")}\n`, code: lines.join("\n") };
}

function answer(parts: readonly Part[]): Answer {
  const codes: string[] = [];
  const fences: (readonly [number, number])[] = [];
  let text = "";
  let prose = "";
  for (const part of parts) {
    if (part.code !== undefined) {
      codes.push(part.code);
      fences.push([text.length, text.length + part.text.length]);
    }
    prose += part.said ?? "";
    text += part.text;
  }
  return { text, codes, prose, fences };
}

const python = [
  "def __init__(self, *args, **kwargs):",
  "    self._items = [x for x in args if x is not None]",
  "    self.max_retry_count = kwargs.get('max_retry_count', 2 ** 10)",
  "    total = a[i] + b[j] * c[k]",
  "",
  "def __repr__(self):",
  "    return f'<Retry {self._items!r} {self.max_retry_count}>'",
  "    # see https://example.com/a_b_c and `backticks` here",
  "",
];

/** Numbered steps, each a line of words and then the parts `held` gives for
 * the blank its words stand at and the lines of its code. */
function stepped(
  count: number,
  lines: number,
  held: (pad: string, code: readonly string[]) => readonly Part[],
): Answer {
  const parts: Part[] = [];
  for (let step = 0; step < count; step += 1) {
    const mark = `${String(step + 1)}. `;
    const code = Array.from(
      { length: lines },
      (_unused, at) => python[at % python.length] ?? "",
    );
    parts.push(
      words(
        `${mark}Create \`step_${String(step)}\`:\n\n`,
        `Create step_${String(step)}:`,
      ),
      ...held(" ".repeat(mark.length), code),
    );
  }
  return answer(parts);
}

/** Numbered steps, each a line of words, a block of Python and a line more. */
function steps(count: number, lines: number): Answer {
  return stepped(count, lines, (pad, code) => [
    fenced(pad, code, "```", "python"),
    words(
      `\n${pad}Then run it and check the \`exit_code\`.\n\n`,
      "Then run it and check the exit_code.",
    ),
  ]);
}

/** Numbered steps, each a line of its own, then a sentence under it and a
 * block of Python under that. */
function explained(count: number, lines: number): Answer {
  const said =
    "First edit the file so that it reads as below, keeping the rest.";
  return stepped(count, lines, (pad, code) => [
    words(`${pad}${said}\n\n`, said),
    fenced(pad, code, "```", "python"),
    words("\n", ""),
  ]);
}

function mounted(text: string, writing: boolean): Element {
  const view = render(<MarkdownReport text={text} bare writing={writing} />);
  return view.container;
}

function codes(root: Element): readonly string[] {
  return Array.from(
    root.querySelectorAll("pre > code"),
    (code) => code.textContent,
  );
}

/** Everything drawn that is neither a block of code nor the bar over one. */
function prose(root: Element): string {
  const copy = root.cloneNode(true);
  if (!(copy instanceof Element)) throw new Error("no report is drawn");
  for (const block of copy.querySelectorAll("pre"))
    block.parentElement?.remove();
  return copy.textContent;
}

/** A text written `stride` characters at a time into one mounted report,
 * `each` being handed what is drawn at every moment. */
function written(
  text: string,
  stride: number,
  each: (root: Element) => void,
): Element {
  const view = render(<MarkdownReport text="" bare writing />);
  for (const prefix of prefixes(text, stride)) {
    view.rerender(<MarkdownReport text={prefix} bare writing />);
    each(view.container);
  }
  return view.container;
}

/** Whether every block of code drawn is the opening of the code it will be. */
function opening(root: Element, built: Answer): boolean {
  return codes(root).every((code, at) => built.codes[at]?.startsWith(code));
}

afterEach(cleanup);

describe("numbered steps that each hold a block of code", () => {
  const answers: readonly (readonly [number, number, number])[] = [
    [1, 60, 3],
    [7, 30, 7],
    [6, 40, 7],
    [3, 100, 11],
  ];

  test.each(answers)(
    "%i of %i lines: each block holds its code, and the words are words",
    (count, lines) => {
      const built = steps(count, lines);
      const root = mounted(built.text, false);
      expect(codes(root)).toEqual(built.codes);
      expect(prose(root)).toBe(built.prose);
      expect(root.querySelectorAll("li")).toHaveLength(count);
    },
  );

  test.each(answers)(
    "%i of %i lines, written a few characters at a time: no block ever holds anything but its code",
    (count, lines, stride) => {
      const built = steps(count, lines);
      let sound = true;
      const root = written(built.text, stride, (drawn) => {
        sound &&= opening(drawn, built);
      });
      expect(sound).toBe(true);
      expect(codes(root)).toEqual(built.codes);
      expect(prose(root)).toBe(built.prose);
      cleanup();
      expect(codes(mounted(built.text, false))).toEqual(built.codes);
    },
  );

  test.each(answers)(
    "%i of %i lines: no piece begins inside a block at any moment of its writing",
    (count, lines) => {
      const built = steps(count, lines);
      const inside = new Set<number>();
      for (const prefix of prefixes(built.text, 3))
        for (const piece of markdownPiecesFrom(prefix, 0, 0)) {
          expect(piece.kind).toBe("read");
          for (const [from, to] of built.fences)
            if (piece.start > from && piece.start < to) inside.add(piece.start);
        }
      expect([...inside]).toEqual([]);
    },
  );
});

describe("an answer of more steps than one call may cost", () => {
  const built = steps(48, 12);
  const pieces = markdownPiecesFrom(built.text, 0, 0);

  test("is parted only where a step begins, and never inside a step's code", () => {
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.kind).toBe("read");
      expect(built.text.slice(piece.start).search(/^\d+\. Create/u)).toBe(0);
    }
  });

  test("still holds every block as it was written, and counts its steps as one list", () => {
    const blocks = markdownBlocksParsed(built.text);
    expect(codesOf(blocks)).toEqual(built.codes);
    let next = 1;
    for (const block of blocks) {
      if (block.type !== "list") throw new Error("a step is not in a list");
      expect(block.start).toBe(next);
      next += block.children.length;
    }
    expect(next).toBe(49);
  });
});

describe("steps of a sentence and then a block of code, more than one call may cost", () => {
  /** How many lines each step's code is, which moves the line a call's
   * allowance is spent on from one part of a step to another. */
  const lengths = [4, 6, 8, 12, 20];

  test.each(lengths)(
    "of %i lines of code each: are parted only where a step begins, never at a line under one",
    (lines) => {
      const built = explained(48, lines);
      const pieces = markdownPiecesFrom(built.text, 0, 0);
      expect(pieces.length).toBeGreaterThan(1);
      for (const piece of pieces) {
        expect(piece.kind).toBe("read");
        expect(built.text.slice(piece.start).search(/^\d+\. Create/u)).toBe(0);
      }
    },
  );

  test.each(lengths)(
    "of %i lines of code each: still hold every sentence as words and every block as it was written",
    (lines) => {
      const built = explained(48, lines);
      const root = mounted(built.text, false);
      expect(codes(root)).toEqual(built.codes);
      expect(prose(root)).toBe(built.prose);
      expect(root.querySelectorAll("li")).toHaveLength(48);
    },
  );
});

/** A file of markdown as it is written out under a step: lines of words with
 * marks in them, blank lines, and a fence of three ticks every few lines. */
function fileWritten(lines: number): readonly string[] {
  return Array.from({ length: lines }, (_unused, at) =>
    at % 9 === 3
      ? ["```sh", `npm run build_${String(at)}`, "```", ""]
      : [`What part ${String(at)} is for, with *a mark* and \`a_name\`.`, ""],
  )
    .flat()
    .slice(0, -1);
}

describe("a step that holds a fence of four ticks, and in it fences of three", () => {
  const built = answer([
    words("1. Write this file:\n\n", "Write this file:"),
    fenced("   ", fileWritten(400), "````", "md"),
  ]);

  test("is long enough that so many lines of words under a step would be parted", () => {
    const wordy = built.text.replaceAll("`", "");
    expect(markdownPiecesFrom(wordy, 0, 0).length).toBeGreaterThan(1);
  });

  test("is one piece, which no fence of three ticks inside the four ends", () => {
    expect(kinds(built.text)).toEqual(["read"]);
  });

  test("holds the file as one block of code, its fences and blank lines and marks as they were written", () => {
    expect(codesOf(markdownBlocksParsed(built.text))).toEqual(built.codes);
    const root = mounted(built.text, false);
    expect(codes(root)).toEqual(built.codes);
    expect(prose(root)).toBe(built.prose);
    expect(root.querySelectorAll("em, code:not(pre > code)")).toHaveLength(0);
  });
});

/** A text with every line of it written inside one quote. */
function quoted(text: string): string {
  const lines = text.trimEnd().split("\n");
  return `${lines.map((line) => (line === "" ? ">" : `> ${line}`)).join("\n")}\n`;
}

describe("a quote that holds steps, more than one call may cost", () => {
  const shapes: Readonly<Record<string, Answer>> = {
    "each a block of code": steps(40, 3),
    "each a block of code with a blank line in it": steps(40, 6),
    "each a sentence and then a block of code": explained(40, 4),
    "each a sentence and then a longer block of code": explained(40, 12),
  };

  test.each(Object.keys(shapes))(
    "%s: is parted only where a step begins, never at a line under one",
    (name) => {
      const text = quoted(shapes[name]?.text ?? "");
      const pieces = markdownPiecesFrom(text, 0, 0);
      expect(pieces.length).toBeGreaterThan(1);
      for (const piece of pieces) {
        expect(piece.kind).toBe("read");
        expect(text.slice(piece.start).search(/^> \d+\. Create/u)).toBe(0);
      }
    },
  );

  test.each(Object.keys(shapes))(
    "%s: still holds every block as it was written, in a quote, and the words as words",
    (name) => {
      const built = shapes[name] ?? answer([]);
      const root = mounted(quoted(built.text), false);
      expect(codes(root)).toEqual(built.codes);
      expect(prose(root)).toBe(built.prose);
      expect(root.querySelectorAll("blockquote > ol > li")).toHaveLength(40);
    },
  );

  test("is parted under its one step where no line of it stands at the quote's own margin", () => {
    const said = "   Open the page and check the value before you go on.\n\n";
    const text = quoted(`1. Do all of this:\n\n${said.repeat(400)}`);
    const pieces = markdownPiecesFrom(text, 0, 0);
    expect(pieces.length).toBeGreaterThan(1);
    expect(new Set(pieces.map((piece) => piece.kind))).toEqual(
      new Set(["read"]),
    );
  });
});

const neighbours: Readonly<Record<string, Answer>> = {
  "a fence under a bullet": answer([
    words("- Install it:\n\n", "Install it:"),
    fenced("  ", ["npm ci", "", "just check"], "```", "sh"),
    words("\n  Then read what it prints.\n", "Then read what it prints."),
    words("- And a second item.\n", "And a second item."),
  ]),
  "a fence under a bullet with no line between": answer([
    words("- Run:\n", "Run:"),
    fenced("  ", ["just check"], "```", "sh"),
    words("- Done.\n", "Done."),
  ]),
  "a fence a bullet opens with": answer([
    { text: "- ```sh\n  just check\n  ```\n", code: "just check" },
    words("- Done.\n", "Done."),
  ]),
  "a fence under a nested item": answer([
    words("- parent\n\n  - child, which holds code:\n\n", "parent"),
    words("", "child, which holds code:"),
    fenced("    ", ["const a = 1;", "", "- not an item"], "```", "ts"),
    words("\n  - a second child\n- a second parent\n", "a second child"),
    words("", "a second parent"),
  ]),
  "a fence inside a quote": answer([
    words("> As the file has it:\n>\n", "As the file has it:"),
    fenced("> ", ["const a = *b*;", "", "const c = `d`;"], "```", "ts"),
    words(">\n> And so it stays.\n", "And so it stays."),
  ]),
  "a fence with blank lines and lines that would begin blocks": answer([
    words("1. Write the file:\n\n", "Write the file:"),
    fenced(
      "   ",
      ["# A heading", "", "- a list item", "", "", "> a quote", "", "words"],
      "```",
      "md",
    ),
    words("\n2. Then commit it.\n", "Then commit it."),
  ]),
  "two fences under one item": answer([
    words("1. Build, then test:\n\n", "Build, then test:"),
    fenced("   ", ["just build"], "```", "sh"),
    words("\n   and once that is green:\n\n", "and once that is green:"),
    fenced("   ", ["just check", "", "git push"], "```", "sh"),
    words("\n2. Push it.\n", "Push it."),
  ]),
  "a fence of tildes that holds backticks": answer([
    words(
      "1. A file that itself holds a fence:\n\n",
      "A file that itself holds a fence:",
    ),
    fenced("   ", ["```ts", "const a = 1;", "", "```"], "~~~", "md"),
    words("\n   Tildes hold backticks.\n", "Tildes hold backticks."),
  ]),
  "a fence the text ends inside": answer([
    words("1. Run:\n\n", "Run:"),
    {
      text: "   ```sh\n   npm ci\n\n   just check\n",
      code: "npm ci\n\njust check",
    },
  ]),
  "a fence a line at the margin ends": answer([
    words("1. Run:\n\n", "Run:"),
    { text: "   ```sh\n   npm ci\n", code: "npm ci" },
    words("back at the margin, **words**\n", "back at the margin, words"),
  ]),
};

describe("code fenced where a model also writes it", () => {
  test.each(Object.keys(neighbours))(
    "%s: the block holds its code, and the words are words",
    (name) => {
      const built = neighbours[name] ?? answer([]);
      const root = mounted(built.text, false);
      expect(codes(root)).toEqual(built.codes);
      expect(prose(root)).toBe(built.prose);
    },
  );

  test.each(Object.keys(neighbours))(
    "%s, written a character at a time: no block ever holds anything but its code",
    (name) => {
      const built = neighbours[name] ?? answer([]);
      let sound = true;
      const root = written(built.text, 1, (drawn) => {
        sound &&= opening(drawn, built);
      });
      expect(sound).toBe(true);
      expect(codes(root)).toEqual(built.codes);
      expect(prose(root)).toBe(built.prose);
    },
  );

  test("a quote's fence is drawn inside the quote, and a nested item's inside the item", () => {
    const quoted = mounted(
      neighbours["a fence inside a quote"]?.text ?? "",
      false,
    );
    expect(quoted.querySelectorAll("blockquote pre")).toHaveLength(1);
    cleanup();
    const nested = mounted(
      neighbours["a fence under a nested item"]?.text ?? "",
      false,
    );
    expect(nested.querySelectorAll("ul > li > ul > li pre")).toHaveLength(1);
  });
});

/** The kinds of the pieces a text is split into, in order. */
function kinds(text: string): readonly string[] {
  return markdownPiecesFrom(text, 0, 0).map((piece) => piece.kind);
}

/** Lines that are dear as words and cost nothing as code. */
function hostile(under: string, lines: number): string {
  return `${under}${"a* ".repeat(24)}[b](c \`d\n`.repeat(lines);
}

describe("what a fence under an item holds", () => {
  test("is code however dear it would be as words, and is read", () => {
    const code = hostile("", 600).split("\n").slice(0, -1);
    const built = answer([
      words("- a\n", "a"),
      fenced("  ", code),
      words("- b\n", "b"),
    ]);
    expect(kinds(hostile("  ", 600))).toEqual(["plain"]);
    expect(new Set(kinds(built.text))).toEqual(new Set(["read"]));
    const root = mounted(built.text, false);
    expect(codes(root)).toEqual(built.codes);
    expect(root.querySelectorAll("em, a, code:not(pre > code)")).toHaveLength(
      0,
    );
  });

  test("is plain where it is too long to read, and no section ends inside it", () => {
    const head = "1. a\n\n";
    const text = `${head}   \`\`\`\n${"   b\n\n".repeat(10_000)}`;
    const pieces = markdownPiecesFrom(text, 0, 0);
    expect(pieces.map((piece) => piece.kind)).toEqual(["read", "plain"]);
    expect(pieces[0]?.end).toBe(head.length);
  });

  test("is charged a little for each of its characters, as code is read", () => {
    const work = (code: string): number =>
      markdownPiecesFrom(`- a\n  \`\`\`\n  ${code}\n  \`\`\`\n`, 0, 0)[0]
        ?.work ?? 0;
    expect(work("b".repeat(101)) - work("b")).toBe(2_500);
  });

  test("is code again under an item once a line of the item above has ended one", () => {
    const code = hostile("", 600).split("\n").slice(0, -1);
    const built = answer([
      words("- a\n  - b\n    ```\n    c\n  d\n", ""),
      fenced("    ", code),
    ]);
    expect(kinds(built.text)).toEqual(["read"]);
    expect(codesOf(markdownBlocksParsed(built.text))).toEqual([
      "c",
      ...built.codes,
    ]);
  });

  test.each([
    ["in a quote", "> As the file has it:\n>\n", "> "],
    ["under a step", "1. Write this file:\n\n", "   "],
    ["under a nested item", "- a\n  - b\n", "    "],
  ])(
    "is one block %s however long it is, where so many lines of words would be parted or plain",
    (_name, head, under) => {
      const code = Array.from(
        { length: 1_500 },
        (_unused, at) => `const a${String(at)} = b * c;`,
      );
      const built = answer([words(head, ""), fenced(under, code, "```", "ts")]);
      expect(kinds(built.text)).toEqual(["read"]);
      expect(codesOf(markdownBlocksParsed(built.text))).toEqual(built.codes);
      const wordy = code.map((line) => `${under}${line}\n`).join("");
      expect(kinds(`${head}${wordy}`)).not.toEqual(["read"]);
    },
  );
});

describe("a fence under an item that is one no longer, or is not surely one", () => {
  test.each([
    ["once the fence has closed", "- a\n  ```\n  b\n  ```\n", "  "],
    ["once a line at the margin has ended it", "- a\n  ```\n  b\nc\n", "  "],
    [
      "once a line less indented than its opening leaves it in doubt",
      "- a\n   ```\n",
      "  ",
    ],
    [
      "where backticks after its marks make it no fence",
      "- a\n  ```b`c\n",
      "  ",
    ],
    ["where its marks are too few", "- a\n  ``\n", "  "],
    ["once a fence in a quote has closed", "> ```\n> b\n> ```\n", "> "],
    ["once a line with no quote mark has ended one", "> ```\n> b\nc\n", ""],
    [
      "once a line with no quote mark has ended one, though it is indented",
      "> ```\n> b\n  c\n",
      "  ",
    ],
  ])("is charged as words %s", (_name, head, under) => {
    expect(kinds(`${head}${under}b\n`)).toEqual(["read"]);
    expect(kinds(`${head}${hostile(under, 600)}`).at(-1)).toBe("plain");
  });

  test("is charged as words where its marks are indented past what a fence may be", () => {
    const head = "- a\n      ```\n";
    expect(kinds(`${head}      b\n`)).toEqual(["read"]);
    expect(kinds(`${head}${hostile("      ", 600)}`).at(-1)).toBe("plain");
    expect(
      mounted(`${head}      *b*\n`, false).querySelectorAll("em"),
    ).toHaveLength(1);
  });

  test("is charged as words where it opens deeper than a fence is followed", () => {
    const text = (depth: number): string => {
      const nest = Array.from(
        { length: depth },
        (_unused, at) => `${"  ".repeat(at)}- a\n`,
      );
      const under = "  ".repeat(depth);
      return `${nest.join("")}${under}\`\`\`\n${hostile(under, 60)}`;
    };
    expect(kinds(text(8))).toEqual(["read"]);
    expect(kinds(text(20)).at(-1)).toBe("plain");
  });
});

/** The most list items that may be holding a line after each line of a text
 * has been taken. */
function held(text: string): readonly number[] {
  const nesting = markdownNestingBegun();
  let start = 0;
  return text.split("\n").map((line) => {
    markdownNestingLine(nesting, text, start, start + line.length);
    start += line.length + 1;
    return nesting.held;
  });
}

describe("how many list items may be holding a line", () => {
  test.each([
    ["words", 0],
    ["- a", 1],
    ["1. a", 1],
    ["123456789) a", 1],
    ["  - a", 2],
    ["    - a", 3],
    ["\t- a", 3],
    ["- - - a", 4],
    ["> - a", 3],
    ["      a", 3],
    ["---", 0],
    ["-a", 0],
    ["1.a", 0],
  ])("is, after %j, at most %i", (line, most) => {
    expect(held(line)).toEqual([most]);
  });

  test("is the most any line above has left, which a line at the margin does not lower", () => {
    expect(held("- a\n  - b\n    - c\nd\n\n- e")).toEqual([1, 2, 3, 3, 3, 3]);
  });

  test("counts the line a fence opens on and none of the code it holds", () => {
    const text = "- a\n\n  ```\n          - b\n\t\t\tc\n  ```\n  d";
    expect(held(text)).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(held("- a\n  - ```\n        b")).toEqual([1, 2, 2]);
  });

  test("counts every line once a fence may be open that is not followed", () => {
    expect(held("- a\n\t```\n          - b")).toEqual([1, 2, 6]);
  });
});

/** A source of numbers that is the same every run. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const coded = [
  "x = 1",
  "",
  "    deeper",
  "- not an item",
  "> not a quote",
  "# not a heading",
  "1. not a step",
  "``",
  "*not* [a](link)",
  "| not | a table |",
  "",
];

/** An answer of items and quotes that hold fences, drawn from a seed. */
function shaped(seed: number): Answer {
  const random = seeded(seed);
  const pick = <Kind,>(from: readonly Kind[]): Kind =>
    from[Math.floor(random() * from.length)] as Kind;
  const parts: Part[] = [];
  const items = 1 + Math.floor(random() * 5);
  for (let item = 0; item < items; item += 1) {
    const mark = pick(["- ", "* ", `${String(item + 1)}. `, "> "]);
    const under = mark === "> " ? "> " : " ".repeat(mark.length);
    const gap = mark === "> " ? ">\n" : "\n";
    parts.push(
      words(`${mark}words ${String(item)}\n`, `words ${String(item)}`),
    );
    for (let block = Math.floor(random() * 3); block > 0; block -= 1) {
      const lines = Array.from({ length: Math.floor(random() * 9) }, () =>
        pick(coded),
      );
      const fence = pick(["```", "~~~", "````"]);
      if (random() < 0.7) parts.push(words(gap, ""));
      parts.push(fenced(under, lines, fence, pick(["", "py", "sh"])));
      if (random() < 0.5)
        parts.push(
          words(
            `${gap}${under}more ${String(block)}\n`,
            `more ${String(block)}`,
          ),
        );
    }
    parts.push(words("\n", ""));
  }
  return answer(parts);
}

function codesOf(nodes: readonly MarkdownNode[]): readonly string[] {
  const found: string[] = [];
  for (const node of nodes) {
    if (node.type === "code") found.push(node.value);
    if ("children" in node) found.push(...codesOf(node.children));
  }
  return found;
}

describe("answers drawn from a seed, of items and quotes that hold fences", () => {
  const seeds = Array.from({ length: 400 }, (_unused, at) => at + 1);

  test("each read whole holds the code it was built with, block for block", () => {
    for (const seed of seeds) {
      const built = shaped(seed);
      expect(codesOf(markdownBlocksParsed(built.text)), String(seed)).toEqual(
        built.codes,
      );
    }
  });

  test("each read as it is written holds, at every moment, only the openings of that code", () => {
    for (const seed of seeds.slice(0, 120)) {
      const built = shaped(seed);
      let reading: MarkdownReading | undefined;
      for (const prefix of prefixes(built.text, 1 + (seed % 4))) {
        reading = markdownReadingNext(reading, prefix, true);
        const held = codesOf(markdownReadingBlocks(reading));
        const sound = held.every((code, at) =>
          built.codes[at]?.startsWith(code),
        );
        if (!sound)
          expect(held, `${String(seed)} at ${String(prefix.length)}`).toEqual(
            built.codes,
          );
      }
      const last = markdownReadingNext(reading, built.text, false);
      expect(codesOf(markdownReadingBlocks(last)), String(seed)).toEqual(
        built.codes,
      );
    }
  });

  test("no piece of any begins inside a block at any moment of its writing", () => {
    for (const seed of seeds) {
      const built = shaped(seed);
      for (const prefix of prefixes(built.text, 1 + (seed % 3)))
        for (const piece of markdownPiecesFrom(prefix, 0, 0))
          for (const [from, to] of built.fences)
            if (piece.start > from && piece.start < to)
              expect(piece.start, `${String(seed)} in ${String(from)}`).toBe(
                from,
              );
    }
  });
});
