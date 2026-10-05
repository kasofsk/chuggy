/**
 * What reading a text costs, held to bounds: whole, a piece at a time, as one
 * line, and at each call while it is written.
 *
 * The texts are `markdownCostTexts.ts`'s. Each of the hostile ones cost the
 * parser seconds before `markdownGuard.ts` reckoned it, and the bar is that
 * none now costs much more than a list of its length, at any length.
 *
 * WHAT THE GUARD RECKONED IS ASSERTED BEFORE ANYTHING IS TIMED, and against
 * ceilings written out here rather than read from the guard. Every piece the
 * parser is handed is reckoned within what its length allows, so a ceiling
 * that moves fails a case, and a guard that stops saying plain fails one at
 * once instead of handing the parser a text it reads for minutes.
 *
 * TIME IS COUNTED IN READINGS OF A YARDSTICK. Other work shares the box, and
 * on a busy one the same reading costs several times what it does alone, so
 * a bound in milliseconds is either wide enough to pass a text that is too
 * dear or fails with nothing wrong. The yardstick is one list of a fixed size
 * handed to the parser as a section, which no weight of the guard makes
 * cheaper or dearer, and it is taken beside what it measures: as many times
 * over in one take as the bound is yardsticks, because a long reading on a
 * busy box is slowed by more than a short one is.
 *
 * A READING PAST ITS BOUND IS TAKEN AGAIN, beside a yardstick taken then,
 * and fails where the least of a few takes is still past the least the
 * yardstick took beside them. One several times past on its second take too
 * is not taken a third time, and after it nothing more is timed: every later
 * case fails at once, so a reader that has become dear fails here in the
 * time of two readings.
 */

import { beforeAll, describe, expect, test } from "vitest";

import {
  markdownCost,
  markdownWordsScanned,
  markdownWordsWorkMax,
  markdownWorkFloor,
  markdownWorkMax,
  markdownWorkPerChar,
} from "../app/browser/ui/markdownGuard.ts";
import {
  markdownPiecesFrom,
  markdownTextWorkMax,
} from "../app/browser/ui/markdownPieces.ts";
import type { MarkdownPiece } from "../app/browser/ui/markdownPieces.ts";
import { markdownReadingNext } from "../app/browser/ui/markdownReading.ts";
import type { MarkdownReading } from "../app/browser/ui/markdownReading.ts";
import {
  markdownBlocksParsed,
  markdownLineJoined,
  markdownLineRead,
  markdownNormalised,
  markdownPieceBlocks,
  markdownSectionRead,
} from "../app/browser/ui/markdownTree.ts";
import {
  markdownWritingInline,
  markdownWritten,
} from "../app/browser/ui/markdownWriting.ts";
import {
  costChars,
  costDear,
  costFill,
  costHostile,
  costNested,
  costOrdinary,
  costSunk,
  costTexts,
  costWords,
} from "./markdownCostTexts.ts";

/** What one call of the parser may be reckoned at: a floor and a rate for
 * each character under a ceiling, and the call itself. */
const workFloor = 1_000_000;
const workPerChar = 5_000;
const workMax = 32_000_000;
const workCall = 40_000;

/** What words read as one line, and the sections of one text between them,
 * may be reckoned at. */
const wordsWorkMax = 8_000_000;
const textWorkMax = 160_000_000;

/** The yardstick: a list of one letter an item, as long as one run may be. */
const yardItems = 1_023;
const yardText = "- a\n".repeat(yardItems);

/** The most a reading may take, in readings of the yardstick: one call of
 * the parser or one frame of a text being written, a whole text, and words
 * read as one line or scanned as they are written. */
const callYardsMax = 3;
const wholeYardsMax = 12;
const wordsYardsMax = 1;

/** How many times the yardstick is taken for its least, how many times a
 * reading is before it fails, and how many times past its bound one is that
 * is not taken again. */
const yardTakes = 3;
const takesMax = 8;
const severalTimes = 4;

/** The least the yardstick has taken, and the reading that ended the timing
 * by being several times past its bound. */
const bench = { yard: Infinity, spent: "" };

function timed(run: () => unknown): number {
  const from = performance.now();
  run();
  return performance.now() - from;
}

/** The yardstick read now, `times` over in each take: the least of a few
 * takes, in milliseconds for one reading of it. */
function yardNow(times = 1): number {
  let least = Infinity;
  for (let take = 0; take < yardTakes; take += 1) {
    const took = timed(() => {
      for (let read = 0; read < times; read += 1) markdownSectionRead(yardText);
    });
    least = Math.min(least, took / times);
  }
  bench.yard = Math.min(bench.yard, least);
  return least;
}

/**
 * How many yardsticks a reading took, `cost` being one take of it in
 * milliseconds. A take within the bound by the least the yardstick has taken
 * is the answer, and the least of those past it is held to the least of the
 * yardsticks taken beside them, each over a take as long as the bound.
 */
function yards(name: string, cost: () => number, within: number): number {
  if (bench.spent !== "")
    throw new Error(`not timed: ${bench.spent} was several times past`);
  let took = cost();
  if (took <= within * bench.yard) return took / bench.yard;
  let yard = Infinity;
  for (let take = 1; ; take += 1) {
    yard = Math.min(yard, yardNow(Math.ceil(within)));
    if (take > 1 && took > severalTimes * within * yard) bench.spent = name;
    const past = took > within * yard;
    if (!past || take === takesMax || bench.spent !== "") return took / yard;
    took = Math.min(took, cost());
  }
}

/** The pieces of a text, each one the parser is handed held to what its
 * length allows, and all of them to what one text may be reckoned at. */
function reckoned(text: string): {
  readonly read: string;
  readonly pieces: readonly MarkdownPiece[];
} {
  const read = markdownNormalised(text);
  const pieces = markdownPiecesFrom(read, 0, 0);
  let spent = 0;
  for (const piece of pieces) {
    if (piece.kind !== "read") continue;
    const allowed = workFloor + workPerChar * (piece.end - piece.start);
    expect(piece.work, `the piece at ${String(piece.start)}`).toBeLessThan(
      Math.min(workMax, allowed) + workCall,
    );
    spent += piece.work;
  }
  expect(spent).toBeLessThan(textWorkMax + workMax + workCall);
  return { read, pieces };
}

/** The dearest piece of a text, in yardsticks. */
function dearest(name: string, text: string): number {
  const { read, pieces } = reckoned(text);
  let most = 0;
  for (const piece of pieces) {
    const cost = (): number =>
      timed(() => markdownPieceBlocks(read, piece, false));
    most = Math.max(most, yards(name, cost, callYardsMax));
  }
  return most;
}

/**
 * A text written a stride at a time under the clock a page reads it by: how
 * many times its bound the dearer of its dearest frame and the reading at
 * its stop took, in milliseconds a yardstick of the bound.
 */
function written(text: string, stride: number): number {
  const clock = (): number => performance.now();
  let reading: MarkdownReading | undefined;
  let frame = 0;
  for (let length = stride; length < text.length; length += stride) {
    const from = performance.now();
    reading = markdownReadingNext(reading, text.slice(0, length), true, clock);
    frame = Math.max(frame, performance.now() - from);
  }
  const stop = timed(() => markdownReadingNext(reading, text, false, clock));
  return Math.max(frame / callYardsMax, stop / wholeYardsMax);
}

beforeAll(() => {
  for (let take = 0; take < yardTakes; take += 1)
    markdownBlocksParsed(
      costFill(
        "warm *up* `a` [b](https://c.d) www.e.f\n\n- g\n\n> h\n\n",
        8_192,
      ),
    );
  yardNow();
});

describe("the yardstick", () => {
  test("is one section the parser reads, an item to each of its lines", () => {
    const blocks = markdownSectionRead(yardText) ?? [];
    expect(blocks).toHaveLength(1);
    const list = blocks[0];
    expect(list?.type === "list" ? list.children.length : 0).toBe(yardItems);
    expect(bench.yard).toBeGreaterThan(0);
    expect(bench.yard).toBeLessThan(Infinity);
  });
});

/** The reckoned work of the dearest piece a text is read in. */
function dearestWork(text: string): number {
  return Math.max(0, ...reckoned(text).pieces.map((piece) => piece.work));
}

function kinds(text: string): readonly string[] {
  return reckoned(text).pieces.map((piece) => piece.kind);
}

describe("what one call may be reckoned at", () => {
  test("is what is written here", () => {
    expect([
      markdownWorkFloor,
      markdownWorkPerChar,
      markdownWorkMax,
      markdownCost.call,
      markdownWordsWorkMax,
      markdownTextWorkMax,
    ]).toEqual([
      workFloor,
      workPerChar,
      workMax,
      workCall,
      wordsWorkMax,
      textWorkMax,
    ]);
  });

  test("by the rate is ridden by a line of pipes, read to it and plain past it", () => {
    const allowed = workFloor + workPerChar * 738;
    expect(allowed).toBeLessThan(workMax);
    expect(kinds("|".repeat(738))).toEqual(["read"]);
    expect(dearestWork("|".repeat(738))).toBeGreaterThan(allowed);
    expect(kinds("|".repeat(739))).toEqual(["plain"]);
    expect(kinds("|".repeat(4_000))).toEqual(["plain"]);
  });

  test("by the floor is ridden by a few lines of many marks, which the rate alone would turn away", () => {
    const line = ` ${"- ".repeat(16)}a\n`;
    const work = dearestWork(line.repeat(6));
    expect(kinds(line.repeat(6))).toEqual(["read"]);
    expect(work).toBeGreaterThan(workPerChar * line.length * 6);
    expect(work).toBeGreaterThan(workFloor);
    expect(kinds(line.repeat(7))).toEqual(["plain"]);
    expect(kinds(line.repeat(40))).toEqual(["plain"]);
  });

  test("by the ceiling is ridden by an address and what it may be cut back over", () => {
    const text = (braces: number): string => `:www.a.b/${"}".repeat(braces)}x`;
    expect(workFloor + workPerChar * 7_000).toBeGreaterThan(workMax);
    expect(kinds(text(7_671))).toEqual(["read"]);
    expect(dearestWork(text(7_671))).toBeGreaterThan(workMax);
    expect(kinds(text(7_672))).toEqual(["plain"]);
    expect(kinds(text(16_000))).toEqual(["plain"]);
  });

  test("by the ceiling is ridden by the sections of a long list, each ended under it", () => {
    for (const name of [
      "tasks holding links and code",
      "a nested list",
      "a spaced numbered list",
    ]) {
      const text = costTexts[name] ?? "";
      expect(new Set(kinds(text)), name).toEqual(new Set(["read"]));
      expect(dearestWork(text), name).toBeGreaterThan(workMax * 0.95);
    }
  });
});

/** The most of a shape one section takes: the greatest count the text built
 * of is still read as one piece at. */
function most(build: (count: number) => string): number {
  const one = (count: number): boolean => {
    const text = build(count);
    return text.length <= costChars && kinds(text).join() === "read";
  };
  if (!one(1)) return 0;
  let low = 1;
  let high = 2;
  while (one(high)) [low, high] = [high, high * 2];
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (one(middle)) low = middle;
    else high = middle;
  }
  return low;
}

/** What list items nested so deep may be left holding, by how many. */
function heldShapes(
  depth: number,
): Readonly<Record<string, (count: number) => string>> {
  const nest = costNested(depth);
  const under = costSunk(depth);
  return {
    "blank lines": (count) => `${nest}${"\n".repeat(count)}${under}b\n`,
    "blank lines of spaces": (count) =>
      `${nest}${`${under}\n`.repeat(count)}${under}b\n`,
    "lines a blank line apart": (count) =>
      `${nest}${`\n${under}b\n`.repeat(count)}`,
    "items a blank line apart": (count) =>
      `${nest}${`\n${costSunk(depth - 1)}- b\n`.repeat(count)}`,
    "lines under them": (count) => `${nest}${`${under}b\n`.repeat(count)}`,
    "lines apart, each then a line at the margin": (count) =>
      `${nest}${`\n${under}b\nc\n`.repeat(count)}`,
  };
}

describe("list items nested deep, holding all one section takes", () => {
  const depths = [1, 4, 16, 32, 60, 100];
  const cases = depths.flatMap((depth) =>
    Object.keys(heldShapes(depth)).map((shape) => [depth, shape] as const),
  );

  test.each(cases)("%i deep, of %s", (depth, shape) => {
    const build = heldShapes(depth)[shape] ?? ((): string => "");
    const count = most(build);
    expect(count).toBeGreaterThan(0);
    expect(dearest(shape, build(count))).toBeLessThan(callYardsMax);
  });

  test("take fewer the deeper they are held: a blank line, its spaces, and a line's own", () => {
    const taken = (depth: number, shape: string): number =>
      most(heldShapes(depth)[shape] ?? ((): string => ""));
    expect(taken(1, "blank lines")).toBeGreaterThan(10_000);
    expect(taken(16, "blank lines")).toBeLessThan(1_000);
    expect(taken(1, "blank lines of spaces")).toBeGreaterThan(5_000);
    expect(taken(32, "blank lines of spaces")).toBeLessThan(500);
    expect(taken(1, "lines under them")).toBeGreaterThan(1_000);
    expect(taken(100, "lines under them")).toBeLessThan(10);
  });

  test("are plain past the depth one call may be spent on reading", () => {
    expect(kinds(costNested(104))).toEqual(["read"]);
    expect(dearestWork(costNested(104))).toBeGreaterThan(workMax * 0.95);
    expect(kinds(costNested(105))).toEqual(["plain"]);
    expect(kinds(costNested(120))).toEqual(["plain"]);
  });
});

/** One thing said over on one line, by how many times it is said. */
const saidOver: Readonly<Record<string, (count: number) => string>> = {
  "an address, dots that may end it, then a letter": (count) =>
    `https://a${".".repeat(count)}a and more`,
  "an address, marks that may end it, then a letter": (count) =>
    `www.a.b${"!".repeat(count)}x`,
  "an address, then references that may end it": (count) =>
    `www.a.b${"&amp;".repeat(count)}`,
  "words that close emphasis none opened": (count) => "a* ".repeat(count),
  "words in emphasis": (count) => "*a* ".repeat(count),
  "words in brackets that link nothing": (count) => "[a] ".repeat(count),
  "words in two brackets, the second naming nothing": (count) =>
    "[a][b] ".repeat(count),
  "words that begin an address and are none": (count) => "www. ".repeat(count),
  "addresses, a word between each": (count) => "www.a.b x ".repeat(count),
};

describe("one thing said over on a line, as often as one section takes", () => {
  test.each(Object.keys(saidOver))("%s", (shape) => {
    const build = saidOver[shape] ?? ((): string => "");
    const count = most(build);
    expect(count).toBeGreaterThan(0);
    expect(dearest(shape, build(count))).toBeLessThan(callYardsMax);
  });
});

describe("what a line and a whole text may be reckoned at", () => {
  test("as one line is ridden by runs of emphasis, read to it and turned away past it", () => {
    const text = (runs: number): string => "*a* ".repeat(runs).trimEnd();
    const inside = markdownWordsScanned(text(670));
    expect(inside.plain).toBe(false);
    expect(inside.work).toBeGreaterThan(wordsWorkMax * 0.99);
    expect(inside.work).toBeLessThan(wordsWorkMax);
    expect(markdownLineRead(text(670))).toHaveLength(1_339);
    expect(markdownWordsScanned(text(671)).plain).toBe(true);
    expect(markdownLineRead(text(671))).toBeUndefined();
    expect(markdownLineRead(text(4_000))).toBeUndefined();
  });

  test("between the sections of one text is ridden by runs of emphasis, plain once they have cost it", () => {
    const { pieces } = reckoned(costDear["runs of emphasis"] ?? "");
    const spent = pieces.reduce((sum, piece) => sum + piece.work, 0);
    expect(spent).toBeGreaterThan(textWorkMax);
    expect(pieces.at(-1)?.kind).toBe("plain");
    expect(pieces.slice(0, -1).every((piece) => piece.kind === "read")).toBe(
      true,
    );
  });
});

describe("a text read whole", () => {
  test("is the size the texts here are made to", () => {
    expect(costChars).toBe(65_536);
    expect(Object.keys(costHostile).length).toBeGreaterThan(110);
  });

  test.each(Object.entries(costTexts))("%s", (name, text) => {
    expect(dearest(name, text)).toBeLessThan(callYardsMax);
    const whole = (): number => timed(() => markdownBlocksParsed(text));
    expect(yards(name, whole, wholeYardsMax)).toBeLessThan(wholeYardsMax);
  });
});

describe("a text read as one line", () => {
  test.each(Object.entries(costTexts))("%s", (name, text) => {
    const line = markdownLineJoined(text);
    const words = markdownWordsScanned(line);
    expect(words.plain || words.work <= wordsWorkMax).toBe(true);
    const cost = (): number => timed(() => markdownLineRead(line));
    expect(yards(name, cost, wordsYardsMax)).toBeLessThan(wordsYardsMax);
  });
});

describe("a text far past the most that is read", () => {
  test.each([
    ["a list", "- an item of the list, with **words** in it\n"],
    ["short paragraphs", "Some words, and then a line between.\n\n"],
    ["word then star", "a* "],
    ["a quote then lines it may carry", "b\n"],
    ["bracket pairs", "[a]"],
    ["rows", "| a | b |\n"],
  ])("of %s costs what its first part does", (name, unit) => {
    const text = costFill(unit, 1_048_576);
    reckoned(text);
    const whole = (): number => timed(() => markdownBlocksParsed(text));
    expect(yards(name, whole, wholeYardsMax)).toBeLessThan(wholeYardsMax);
  });
});

describe("a text being written", () => {
  const texts = { ...costOrdinary, ...costDear, ...costHostile };

  test.each(Object.entries(texts))("%s", (name, text) => {
    reckoned(text);
    expect(yards(name, () => written(text, 1_024), 1)).toBeLessThan(1);
  });
});

describe("the section a text being written ends in", () => {
  test.each(Object.entries(costWords))("of %s", (name, unit) => {
    const text = costFill(unit, 16_000);
    const cost = (): number => timed(() => markdownWritten(text));
    expect(yards(name, cost, callYardsMax)).toBeLessThan(callYardsMax);
  });
});

describe("the words a text being written ends in, scanned alone", () => {
  const scanChars = 131_072;

  test.each(Object.entries(costWords))("of %s", (name, unit) => {
    const words = costFill(unit, scanChars);
    const cost = (): number => timed(() => markdownWritingInline(words));
    expect(yards(name, cost, wordsYardsMax)).toBeLessThan(wordsYardsMax);
  });

  test.each([
    ["a tick then ticks", `\`a${"`".repeat(scanChars)}b`],
    ["an address then dots", `see https://a${".".repeat(scanChars)}a x`],
    ["an address of dots", `see https://a${".".repeat(scanChars)}`],
    ["a word then stars", `a ${"*".repeat(scanChars)}`],
    ["a link's address", `[a](${"b".repeat(scanChars)}`],
    ["an angle then a name", `a <${"a".repeat(scanChars)}`],
    ["brackets, then links", `${"[".repeat(65_536)}a${"](x)".repeat(16_384)}`],
  ])("of %s", (name, words) => {
    const cost = (): number => timed(() => markdownWritingInline(words));
    expect(yards(name, cost, wordsYardsMax)).toBeLessThan(wordsYardsMax);
  });
});
