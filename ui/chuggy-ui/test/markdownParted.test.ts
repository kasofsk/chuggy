/**
 * A text long enough to be parted, read as it is written.
 *
 * `markdownReading.ts` keeps the blocks of every piece another has begun
 * after and never reads them again, so it leans on one thing: a place a piece
 * was ended at is where it ends however the text goes on. The texts here are
 * drawn from a seed out of the lines a model writes, said over until they
 * cross what one run and one call may cost, and each is walked a few
 * characters or a few hundred at a time.
 *
 * At every step: every place a piece began at is one still, every block kept
 * is the block the whole text reads in its place, and now and then the reading
 * is what one made fresh comes to. At the end what was heard is what the
 * stored text reads as, and a piece drawn as its characters has lost none.
 */

import { describe, expect, test } from "vitest";

import { markdownPiecesFrom } from "../app/browser/ui/markdownPieces.ts";
import {
  markdownReadingBlocks,
  markdownReadingNext,
} from "../app/browser/ui/markdownReading.ts";
import type { MarkdownReading } from "../app/browser/ui/markdownReading.ts";
import {
  markdownBlocksParsed,
  markdownNodesAlike,
  markdownNormalised,
  markdownPieceBlocks,
} from "../app/browser/ui/markdownTree.ts";
import { drawn, shape } from "./markdownShape.ts";

/** A generator the suite can run again and get the same texts from. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** The lines and marks a text is made of. */
const lines: readonly string[] = [
  "- item with `code_name` and words\n",
  "1. step with **bold** words\n",
  "- a\n",
  "  - child item\n",
  "    - grandchild\n",
  "> quoted line of words\n",
  "> - quoted item\n",
  "| a | b | c |\n",
  "| - | - | - |\n",
  "plain words on a line of prose\n",
  "words with snake_case and __dunder__ and *args and **kwargs\n",
  "src/**/*.ts and test/**/*.tsx\n",
  "   def f(a_b, *c, **d):\n",
  "       return a_b[c] * d\n",
  "# Heading\n",
  "## Sub heading `x`\n",
  "[a](https://a.test/b) and [c](./d.md)\n",
  "www.a.test/x_y, a@b.co.\n",
  ...["*a ", "a* ", "_a_ ", "[a] ", "`a` ", "~~a~~ ", "&amp; ", "\\* "],
  ...["![a](b) ", "<https://a.test> ", "a|b ", "- - - a\n", "> > a\n"],
  ...["1. - > a\n", "\t- tabbed\n", " \n", "\r\n", "x\ry\n"],
];

/** What stands between two stretches of them. */
const breaks: readonly string[] = [
  ...["", "\n", "\n", "\n\n", "\n\n", "```\n", "```ts\n", "~~~\n"],
  ...["   ```\n", "   ```python\n", "  ```\n", "> ```\n", "````\n"],
  ...["\n   \n", "- x\n\n  ```\n", "  ```\n\n"],
];

const stretchChars = [40, 300, 1_500, 6_000, 17_000];
const textCharsMax = 70_000;

function drawnFrom<Item>(random: () => number, from: readonly Item[]): Item {
  const item = from[Math.floor(random() * from.length)];
  if (item === undefined) throw new Error("nothing to draw from");
  return item;
}

/** A text of a few stretches, each a few kinds of line said over to a length
 * that may be short or longer than one run. */
function parted(random: () => number): string {
  const parts: string[] = [];
  const stretches = 2 + Math.floor(random() * 7);
  for (let stretch = 0; stretch < stretches; stretch += 1) {
    const kinds = 1 + Math.floor(random() * 3);
    const mine = Array.from({ length: kinds }, () => drawnFrom(random, lines));
    const size = drawnFrom(random, stretchChars);
    let held = "";
    while (held.length < size) held += drawnFrom(random, mine);
    parts.push(held, drawnFrom(random, breaks));
  }
  return parts.join("").slice(0, textCharsMax);
}

/** How many times in one walk a reading is held against one made fresh. */
const freshMax = 4;

function shapeOf(reading: MarkdownReading): string {
  return shape(markdownReadingBlocks(reading));
}

function squeezed(text: string): string {
  return text.replace(/\s+/gu, "");
}

/** A piece drawn as its characters that drew others than it holds. */
function lost(text: string): number | undefined {
  const read = markdownNormalised(text);
  return markdownPiecesFrom(read, 0, 0).find((piece) => {
    if (piece.kind !== "plain") return false;
    const blocks = markdownPieceBlocks(read, piece, false);
    const written = read.slice(piece.start, piece.end);
    return squeezed(drawn(blocks).characters) !== squeezed(written);
  })?.start;
}

/** What is wrong with a text read in steps of lengths drawn as it goes, or
 * nothing. `from` is how much of it the first reading is handed. */
function strayed(
  text: string,
  random: () => number,
  from = 0,
): string | undefined {
  const whole = markdownBlocksParsed(text);
  let reading: MarkdownReading | undefined;
  let passed: readonly number[] = [];
  let fresh = 0;
  for (let length = from; length < text.length;) {
    const reach = random() * (random() < 0.2 ? 3 : 700);
    length = Math.min(text.length, length + 1 + Math.floor(reach));
    const prefix = text.slice(0, length);
    const said = `at ${String(length)}`;
    reading = markdownReadingNext(reading, prefix, true);
    const starts = markdownPiecesFrom(markdownNormalised(prefix), 0, 0).map(
      (piece) => piece.start,
    );
    if (passed.some((start, at) => starts[at] !== start))
      return `a place a piece began at is one no longer ${said}`;
    passed = starts;
    const kept = reading.settled.every((block, at) => {
      const final = whole[at];
      return final !== undefined && markdownNodesAlike(block, final);
    });
    if (!kept) return `a block kept is not the whole text's ${said}`;
    if (random() >= 0.08 || fresh === freshMax) continue;
    fresh += 1;
    if (
      shapeOf(reading) !== shapeOf(markdownReadingNext(undefined, prefix, true))
    )
      return `read in steps is not what read fresh is ${said}`;
  }
  const last = markdownReadingNext(reading, text, false);
  if (shapeOf(last) !== shape(whole)) return "what was heard is not stored";
  return undefined;
}

/** The text a seed writes, and the walk of it the same seed goes on to. */
function walk(seed: number): string | undefined {
  const random = seeded(seed * 104_729);
  const text = parted(random);
  const gone = lost(text);
  if (gone !== undefined) return `the plain piece at ${String(gone)} lost text`;
  return strayed(text, random);
}

describe("a long text read as it is written", () => {
  test("is long enough here to be parted, and to hold a run drawn as its characters", () => {
    const pieces = [176, 843, 992].map((seed) =>
      markdownPiecesFrom(parted(seeded(seed * 104_729)), 0, 0),
    );
    for (const mine of pieces) expect(mine.length).toBeGreaterThan(2);
    expect(pieces.flat().some((piece) => piece.kind === "plain")).toBe(true);
  });

  test.each([176, 843, 992])(
    "keeps every place it has passed, from the seed %i a place once moved on",
    (seed) => {
      expect(walk(seed)).toBeUndefined();
    },
  );

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9])(
    "keeps every place it has passed, from the seed %i",
    (seed) => {
      expect(walk(seed)).toBeUndefined();
    },
  );

  test("keeps the place a list, a nested item and a quoted one were ended at, a character at a time under lines that grow dear", () => {
    const head = "- a\n\n    - grandchild\n    - grandchild\n> - quoted item\n";
    const text = `${head}${"   def f(a_b, *c, **d):\n".repeat(178)}`;
    expect(markdownPiecesFrom(text, 0, 0).length).toBeGreaterThan(1);
    expect(strayed(text, seeded(5))).toBeUndefined();
    expect(strayed(text, () => 0, text.length - 200)).toBeUndefined();
  });
});
