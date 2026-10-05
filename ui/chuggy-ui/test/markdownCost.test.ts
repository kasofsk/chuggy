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
 * WHAT THE GUARD DECIDES IS HELD TO VALUES WRITTEN OUT HERE: how much of a
 * thing said over, or left to nested items, one section takes, how many
 * sections of each text are read and how many are plain, and which words a
 * text being written may end in before its section is plain. A guard that
 * takes more as one section than it did has made its reader dearer, and that
 * fails a case by a count, whatever the box is doing.
 *
 * TIME IS COUNTED IN READINGS OF A YARDSTICK. Other work shares the box, and
 * on a busy one the same reading costs several times what it does alone, so
 * a bound in milliseconds is either wide enough to pass a text that is too
 * dear or fails with nothing wrong. The yardstick is one list of a fixed size
 * handed to the parser as a section, which no weight of the guard makes
 * cheaper or dearer, and where a reading is taken again it is taken beside
 * it: as many times over in one take as the bound is yardsticks, because a
 * long reading on a busy box is slowed by more than a short one is.
 *
 * A TIMED READING FAILS ONLY SEVERAL TIMES PAST ITS BOUND. Where a box
 * rations processor time the yardstick is not slowed as a reading is: a
 * whole text read at once is held back with the collector's helper threads,
 * and one stall is most of a frame, while the yardstick, short and the least
 * of a few takes, is seldom slowed by either. So a reading a few times past
 * its bound is one a healthy reader takes there, and the clock does not tell
 * it from a reader the guard has let become that much dearer: the values
 * written out tell that, with no clock. The clock is left for what they do
 * not see, a reader that takes longer over the same sections, as one reading
 * again what it has read does, and it sees only one many times dearer. A
 * reading several times past is taken again, beside a yardstick taken then,
 * and fails where the lesser take is still several times past by that
 * yardstick. After it nothing more is timed: every later case fails at once,
 * so such a reader fails here in the time of two readings.
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

/** What a reading is bound to, in readings of the yardstick: one call of
 * the parser or one frame of a text being written, a whole text, and words
 * read as one line or scanned as they are written. */
const callYardsMax = 3;
const wholeYardsMax = 12;
const wordsYardsMax = 1;

/** How many times the yardstick is taken for its least, and how many times
 * its bound a reading fails at. */
const yardTakes = 3;
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
 * milliseconds and `within` its bound: a take under several times the bound
 * is the answer, by the least the yardstick has taken, which is the one
 * taken before any case until a reading has been taken again. One past that
 * is taken again, and the lesser of the two is held to a yardstick taken
 * between them, over a take as long as the bound.
 */
function yards(name: string, cost: () => number, within: number): number {
  if (bench.spent !== "")
    throw new Error(`not timed: ${bench.spent} was several times past`);
  const took = cost();
  if (took < severalTimes * within * bench.yard) return took / bench.yard;
  const yard = yardNow(Math.ceil(within));
  const least = Math.min(took, cost());
  if (least >= severalTimes * within * yard) bench.spent = name;
  return least / yard;
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
 * many times its bound the dearest of its dearest frame, its frames between
 * them and the reading at its stop took, in milliseconds a yardstick of the
 * bound. The frames between them are held to what the text read whole is,
 * which a reader that reads it again at every stride is many times past
 * though no frame of its costs more than the text read whole does.
 */
function written(text: string, stride: number): number {
  const clock = (): number => performance.now();
  let reading: MarkdownReading | undefined;
  let frame = 0;
  let frames = 0;
  for (let length = stride; length < text.length; length += stride) {
    const from = performance.now();
    reading = markdownReadingNext(reading, text.slice(0, length), true, clock);
    const took = performance.now() - from;
    frame = Math.max(frame, took);
    frames += took;
  }
  const stop = timed(() => markdownReadingNext(reading, text, false, clock));
  return Math.max(
    frame / callYardsMax,
    frames / wholeYardsMax,
    stop / wholeYardsMax,
  );
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

/** The depths list items are nested to, and how many of each thing one
 * section takes them left holding at each. */
const heldDepths = [1, 4, 16, 32, 60, 100];
const heldMost: Readonly<Record<string, readonly number[]>> = {
  "blank lines": [12_046, 7_678, 427, 405, 491, 53],
  "blank lines of spaces": [9_306, 3_871, 753, 248, 68, 3],
  "lines a blank line apart": [117, 164, 173, 102, 42, 3],
  "items a blank line apart": [180, 161, 173, 102, 42, 3],
  "lines under them": [1_023, 1_020, 472, 231, 82, 4],
  "lines apart, each then a line at the margin": [56, 83, 106, 81, 35, 2],
};

describe("list items nested deep, holding all one section takes", () => {
  const cases = heldDepths.flatMap((depth) =>
    Object.keys(heldShapes(depth)).map((shape) => [depth, shape] as const),
  );

  test.each(cases)("%i deep, of %s", (depth, shape) => {
    const build = heldShapes(depth)[shape] ?? ((): string => "");
    const count = most(build);
    expect(count).toBe(heldMost[shape]?.[heldDepths.indexOf(depth)]);
    expect(dearest(shape, build(count))).toBeLessThan(
      severalTimes * callYardsMax,
    );
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

/** One thing said over on one line, by how many times it is said, and how
 * many times one section takes it said. */
const saidOver: Readonly<
  Record<string, readonly [(count: number) => string, number]>
> = {
  "an address, dots that may end it, then a letter": [
    (count) => `https://a${".".repeat(count)}a and more`,
    353,
  ],
  "an address, marks that may end it, then a letter": [
    (count) => `www.a.b${"!".repeat(count)}x`,
    358,
  ],
  "an address, then references that may end it": [
    (count) => `www.a.b${"&amp;".repeat(count)}`,
    59,
  ],
  "words that close emphasis none opened": [
    (count) => "a* ".repeat(count),
    191,
  ],
  "words in emphasis": [(count) => "*a* ".repeat(count), 2_682],
  "words in brackets that link nothing": [
    (count) => "[a] ".repeat(count),
    1_103,
  ],
  "words in two brackets, the second naming nothing": [
    (count) => "[a][b] ".repeat(count),
    521,
  ],
  "words that begin an address and are none": [
    (count) => "www. ".repeat(count),
    3_276,
  ],
  "addresses, a word between each": [
    (count) => "www.a.b x ".repeat(count),
    1_638,
  ],
};

describe("one thing said over on a line, as often as one section takes", () => {
  test.each(Object.entries(saidOver))("%s", (shape, [build, taken]) => {
    const count = most(build);
    expect(count).toBe(taken);
    expect(dearest(shape, build(count))).toBeLessThan(
      severalTimes * callYardsMax,
    );
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

/** How many sections of a text are read, fenced and plain. */
function sections(text: string): string {
  const all = kinds(text);
  return ["read", "fence", "plain"]
    .map((kind) => [all.filter((one) => one === kind).length, kind] as const)
    .filter(([count]) => count > 0)
    .map(([count, kind]) => `${String(count)} ${kind}`)
    .join(", ");
}

/** The sections each text is read in. */
const textSections: Readonly<Record<string, string>> = {
  stars: "1 plain",
  "stars apart": "1 plain",
  "star then word": "1 plain",
  "word then star": "1 plain",
  "stars in words": "1 plain",
  "star and underscore": "1 plain",
  "openers then closers": "1 plain",
  "strong openers then closers": "1 plain",
  "a hundred stars a side": "1 read",
  underscores: "1 plain",
  "underscore then word": "1 plain",
  "emphasis in words": "1 plain",
  "emphasis of every kind": "1 plain",
  "paragraphs of word then star": "1 read, 4 plain",
  tildes: "1 read",
  "tilde pairs": "1 plain",
  strikes: "1 plain",
  ticks: "1 read",
  "ticks apart": "1 plain",
  "ticks of every width": "1 plain",
  "ticks of every width, widest first": "1 plain",
  "a tick then ticks": "2 plain",
  backslashes: "1 plain",
  "escaped stars": "1 plain",
  entities: "1 plain",
  "half entities": "1 plain",
  "numbered entities": "1 plain",
  ampersands: "1 plain",
  "open brackets": "1 plain",
  "close brackets": "1 plain",
  "bracket pairs": "1 plain",
  "link openings": "1 plain",
  "link halves": "1 plain",
  "brackets nested": "1 plain",
  "brackets nested then links": "2 plain",
  "picture openings": "1 plain",
  "footnote calls": "1 plain",
  "reference links": "1 plain",
  definitions: "1 plain",
  "titles never closed": "1 plain",
  angles: "1 plain",
  "angle schemes": "1 plain",
  "angle emails": "1 plain",
  tags: "1 plain",
  comments: "1 plain",
  "character data": "1 plain",
  "an address of dots": "2 plain",
  "an address of open parentheses": "2 plain",
  "an address of close parentheses": "2 plain",
  "an address of entities": "2 plain",
  "addresses the grammar does not take": "1 plain",
  "www addresses": "1 plain",
  "one www address": "2 plain",
  emails: "1 plain",
  "one long email": "2 plain",
  "email halves": "1 plain",
  quotes: "1 plain",
  "quotes apart": "1 plain",
  "quotes five hundred deep": "1 plain",
  "a quote then lines it may carry": "2 plain",
  "quotes and lists in one line": "1 plain",
  "quotes and lists in every line": "47 read, 1 plain",
  dashes: "1 plain",
  "list marks": "1 plain",
  "a list indented ever deeper": "1 plain",
  "a list of one letter": "9 read, 1 plain",
  "a spaced list of one letter": "30 read, 1 plain",
  "a numbered list of one letter": "9 read, 1 plain",
  "tasks of one letter": "6 read, 1 plain",
  "headings of one letter": "9 read, 1 plain",
  hashes: "1 plain",
  pipes: "1 plain",
  "rows with no header": "1 plain",
  "a table of one wide row": "1 plain",
  "a table of wide rows": "1 plain",
  "a table of ten thousand rows": "1 plain",
  "one line of one letter": "1 plain",
  "lines of one letter": "1 plain",
  "lines ended twice": "1 plain",
  "indented lines": "1 plain",
  tabs: "",
  spaces: "",
  "line ends": "",
  "a fence of code never closed": "1 fence, 1 plain",
  "a fence of one line never closed": "1 fence, 1 plain",
  "a fence indented, then marks": "1 read, 1 fence, 1 plain",
  "a byte order mark then list marks": "1 plain",
  "a byte order mark then stars": "1 plain",
  "a byte order mark then numbers": "1 plain",
  "a byte order mark then quoted list marks": "1 plain",
  "a byte order mark then list marks, after a fence": "1 fence, 1 plain",
  "a byte order mark then list marks, after words": "1 read, 1 plain",
  "four sections that each open with a byte order mark": "4 plain",
  "a byte order mark on every line": "9 read, 1 plain",
  "addresses after a colon, then braces": "4 plain",
  "an address after a colon, then braces": "1 plain",
  "an address of a dot, then braces": "1 plain",
  "an address after a letter, then marks": "1 plain",
  "an address an escape writes, then braces": "1 plain",
  "an address a reference writes, then braces": "1 plain",
  "addresses and braces as far as they are read": "6 read, 1 plain",
  "braces and an escaped one": "1 plain",
  "braces then a reference": "1 plain",
  "names then an escaped dot": "1 plain",
  "a word then dots": "1 plain",
  "addresses escapes write, then a mark": "1 plain",
  "addresses escapes write, as far as they are read": "1 read, 10 plain",
  "sixteen list marks a line": "103 read, 1 plain",
  "fifteen numbers a line": "39 read, 1 plain",
  "fifteen list marks and a reference a line": "90 read, 1 plain",
  "sixteen quote marks a line": "6 read, 1 plain",
  "quote and list marks, sixteen a line": "91 read, 1 plain",
  "list and quote marks, sixteen a line": "104 read, 1 plain",
  "a list mark then fifteen quote marks a line": "104 read, 1 plain",
  "eight quote marks then eight list marks a line": "20 read, 1 plain",
  "sixteen quote marks a line, each closed by a list mark": "6 read, 1 plain",
  "sixteen quote marks a line, a blank line apart": "235 read",
  "eight list marks a line": "79 read, 1 plain",
  "a fence under an item, of marks": "1 read",
  "a fence under an item, never closed": "1 read, 1 plain",
  "a fence under an item, of one line": "1 read",
  "a fence in a quote, never closed": "2 plain",
  "a fence in a quote, of blank lines": "2 plain",
  "fences under items, one after another": "11 read, 1 plain",
  "fences under items, each of blank lines": "8 read, 1 plain",
  "a fence sixteen marks deep": "2 plain",
  "fences opened under an item and never closed": "30 read, 1 plain",
  "items four deep, then blank lines": "2 read",
  "items sixteen deep, then blank lines": "2 read",
  "items sixty deep, then blank lines": "2 read",
  "items a hundred deep, then blank lines": "2 read",
  "numbered items sixty deep, then blank lines": "2 read",
  "items sixteen deep, then blank lines of spaces": "2 read",
  "items sixty deep, then blank lines of spaces": "2 read",
  "items a hundred deep, then blank lines of spaces": "2 read",
  "items sixty deep, then lines a blank line apart": "2 read",
  "items a hundred deep, then lines a blank line apart": "3 read",
  "items a hundred deep": "1 read",
  "items a hundred and twenty deep": "1 plain",
  words: "1 plain",
  "words of a line": "1 plain",
  "one paragraph on one line": "1 plain",
  "one paragraph on wrapped lines": "1 plain",
  "short paragraphs": "177 read",
  "a list": "5 read",
  "a nested list": "5 read",
  "a spaced numbered list": "4 read",
  "a quote": "5 read",
  "one table": "2 plain",
  "tables of a hundred rows": "7 read",
  "a fence of code": "1 fence, 1 plain",
  "a fence of code in no language": "1 fence, 1 plain",
  "words in brackets": "1 plain",
  "headings over paragraphs": "238 read",
  "headings over words with no line between": "5 read",
  "steps that each hold code": "6 read, 1 plain",
  "one step holding a long block of code": "1 read",
  "a quote holding code": "233 read",
  "steps after an indented block": "3 read",
  "runs of emphasis": "14 read, 1 plain",
  "runs of links": "33 read",
  "runs of every mark": "33 plain",
  "runs of addresses": "37 read",
  "runs of escapes": "34 read",
  "tables of narrow rows": "23 read, 1 plain",
  "quotes three deep": "53 read, 1 plain",
  "lists four deep": "6 read, 1 plain",
  "items of two paragraphs": "28 read, 1 plain",
  "tasks holding links and code": "4 read",
};

describe("a text read whole", () => {
  test("is the size the texts here are made to", () => {
    expect(costChars).toBe(65_536);
    expect(Object.keys(costHostile).length).toBeGreaterThan(110);
  });

  test.each(Object.entries(costTexts))("%s", (name, text) => {
    expect(sections(text)).toBe(textSections[name]);
    expect(dearest(name, text)).toBeLessThan(severalTimes * callYardsMax);
    const whole = (): number => timed(() => markdownBlocksParsed(text));
    expect(yards(name, whole, wholeYardsMax)).toBeLessThan(
      severalTimes * wholeYardsMax,
    );
  });
});

describe("a text read as one line", () => {
  test.each(Object.entries(costTexts))("%s", (name, text) => {
    const line = markdownLineJoined(text);
    const words = markdownWordsScanned(line);
    expect(words.plain || words.work <= wordsWorkMax).toBe(true);
    const cost = (): number => timed(() => markdownLineRead(line));
    expect(yards(name, cost, wordsYardsMax)).toBeLessThan(
      severalTimes * wordsYardsMax,
    );
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
    expect(yards(name, whole, wholeYardsMax)).toBeLessThan(
      severalTimes * wholeYardsMax,
    );
  });
});

describe("a text being written", () => {
  const texts = { ...costOrdinary, ...costDear, ...costHostile };

  test.each(Object.entries(texts))("%s", (name, text) => {
    reckoned(text);
    expect(yards(name, () => written(text, 1_024), 1)).toBeLessThan(
      severalTimes,
    );
  });
});

/** The words whose section is plain where a text being written ends in
 * them, as no other's is. */
const endsPlain: readonly string[] = [
  "stars",
  "word then star",
  "stars in words",
  "strike and star openings",
  "backslashes",
  "underscores",
  "open brackets",
  "open brackets in twos",
  "bracket then word",
  "bracket pairs",
  "link halves",
  "close brackets",
  "pipes",
  "angles",
  "angle emails",
  "ampersands",
  "addresses the grammar does not take",
  "addresses and what may end one",
  "lines",
  "letters that are not ASCII",
];

describe("the section a text being written ends in", () => {
  test.each(Object.entries(costWords))("of %s", (name, unit) => {
    const text = costFill(unit, 16_000);
    expect(kinds(text).includes("plain")).toBe(endsPlain.includes(name));
    const cost = (): number => timed(() => markdownWritten(text));
    expect(yards(name, cost, callYardsMax)).toBeLessThan(
      severalTimes * callYardsMax,
    );
  });
});

describe("the words a text being written ends in, scanned alone", () => {
  const scanChars = 131_072;

  test.each(Object.entries(costWords))("of %s", (name, unit) => {
    const words = costFill(unit, scanChars);
    const cost = (): number => timed(() => markdownWritingInline(words));
    expect(yards(name, cost, wordsYardsMax)).toBeLessThan(
      severalTimes * wordsYardsMax,
    );
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
    expect(yards(name, cost, wordsYardsMax)).toBeLessThan(
      severalTimes * wordsYardsMax,
    );
  });
});
