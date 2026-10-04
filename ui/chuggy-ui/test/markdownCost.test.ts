/**
 * What reading a text costs, held to bounds: whole, a piece at a time, as one
 * line, and at each call while it is written.
 *
 * The texts are `markdownCostTexts.ts`'s. Each of the hostile ones cost the
 * parser seconds before `markdownGuard.ts` reckoned it, and the bar is that
 * none now costs much more than a list of its length, at any length.
 *
 * THE BOUNDS ARE GENEROUS ON PURPOSE. Other suites run beside this one, so
 * each bound is several times what the reading takes alone, and a reading
 * that goes past one is taken again before it fails. What they catch is a
 * text that costs what these once did.
 */

import { describe, expect, test } from "vitest";

import { markdownPiecesFrom } from "../app/browser/ui/markdownPieces.ts";
import { markdownReadingNext } from "../app/browser/ui/markdownReading.ts";
import type { MarkdownReading } from "../app/browser/ui/markdownReading.ts";
import {
  markdownBlocksParsed,
  markdownLineJoined,
  markdownLineRead,
  markdownNormalised,
  markdownPieceBlocks,
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
  costOrdinary,
  costTexts,
  costWords,
} from "./markdownCostTexts.ts";

/** The most a whole text may take to read, in milliseconds. */
const wholeMsMax = 1_000;

/** The most one call may take: a piece, a line, or a text being written. */
const callMsMax = 250;

/** The most the writing scan may take over `scanChars` characters, which is
 * a size where a scan that looks back from each of them takes seconds. */
const scanChars = 131_072;
const scanMsMax = 400;

/** How long a reading takes: the least of up to three takes, taken again
 * only while it is past its bound. */
function taken(run: () => unknown, within: number): number {
  let least = Infinity;
  for (let take = 0; take < 3 && least > within; take += 1) {
    const from = performance.now();
    run();
    least = Math.min(least, performance.now() - from);
  }
  return least;
}

/** The dearest piece of a text, and what it took. */
function dearest(text: string): number {
  const read = markdownNormalised(text);
  let most = 0;
  for (const piece of markdownPiecesFrom(read, 0, 0))
    most = Math.max(
      most,
      taken(() => markdownPieceBlocks(read, piece, false), callMsMax),
    );
  return most;
}

/** A text written a stride at a time under the clock a page reads it by:
 * the dearest call, and what reading it whole took once it stopped. */
function written(
  text: string,
  stride: number,
): { readonly call: number; readonly stop: number } {
  const clock = (): number => performance.now();
  let reading: MarkdownReading | undefined;
  let call = 0;
  for (let length = stride; length < text.length; length += stride) {
    const from = performance.now();
    reading = markdownReadingNext(reading, text.slice(0, length), true, clock);
    call = Math.max(call, performance.now() - from);
  }
  const from = performance.now();
  markdownReadingNext(reading, text, false, clock);
  return { call, stop: performance.now() - from };
}

describe("a text read whole", () => {
  test("is the size the texts here are made to", () => {
    expect(costChars).toBe(65_536);
    expect(Object.keys(costHostile).length).toBeGreaterThan(80);
  });

  test.each(Object.entries(costTexts))("%s", (_name, text) => {
    expect(taken(() => markdownBlocksParsed(text), wholeMsMax)).toBeLessThan(
      wholeMsMax,
    );
    expect(dearest(text)).toBeLessThan(callMsMax);
  });
});

describe("a text read as one line", () => {
  test.each(Object.entries(costTexts))("%s", (_name, text) => {
    const line = markdownLineJoined(text);
    expect(taken(() => markdownLineRead(line), callMsMax)).toBeLessThan(
      callMsMax,
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
  ])("of %s costs what its first part does", (_name, unit) => {
    const text = costFill(unit, 1_048_576);
    expect(taken(() => markdownBlocksParsed(text), wholeMsMax)).toBeLessThan(
      wholeMsMax,
    );
  });
});

describe("a text being written", () => {
  const texts = { ...costOrdinary, ...costDear, ...costHostile };

  test.each(Object.entries(texts))("%s", (_name, text) => {
    let { call, stop } = written(text, 1_024);
    if (call > callMsMax || stop > wholeMsMax)
      ({ call, stop } = written(text, 1_024));
    expect(call).toBeLessThan(callMsMax);
    expect(stop).toBeLessThan(wholeMsMax);
  });
});

describe("the section a text being written ends in", () => {
  test.each(Object.entries(costWords))("of %s", (_name, unit) => {
    const text = costFill(unit, 16_000);
    expect(taken(() => markdownWritten(text), callMsMax)).toBeLessThan(
      callMsMax,
    );
  });
});

describe("the words a text being written ends in, scanned alone", () => {
  test.each(Object.entries(costWords))("of %s", (_name, unit) => {
    const words = costFill(unit, scanChars);
    expect(taken(() => markdownWritingInline(words), scanMsMax)).toBeLessThan(
      scanMsMax,
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
  ])("of %s", (_name, words) => {
    expect(taken(() => markdownWritingInline(words), scanMsMax)).toBeLessThan(
      scanMsMax,
    );
  });
});
