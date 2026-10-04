/**
 * A text read a block at a time while it is written.
 *
 * The claim that matters is that reading in steps changes nothing: at every
 * moment of a text, the blocks kept from earlier readings and the blocks read
 * anew are together what one reading of that moment comes to. It is walked
 * over answers as a model writes them, over the texts a soup of marks found
 * the first cut of this wrong on, and over a seeded soup of its own.
 *
 * The rest is what the report leans on: a block once kept is the same object
 * from then on, a whole text is read whole, and a text the parser cannot be
 * trusted with is drawn as its characters and stays that way.
 */

import { describe, expect, test } from "vitest";

import {
  markdownReadingBlocks,
  markdownReadingNext,
} from "../app/browser/ui/markdownReading.ts";
import type { MarkdownReading } from "../app/browser/ui/markdownReading.ts";
import {
  markdownBlocksParsed,
  markdownMarkRunMax,
} from "../app/browser/ui/markdownTree.ts";
import {
  corpusAnswers,
  corpusComparison,
  corpusHowTo,
  corpusLongAnswer,
  corpusLongAnswerCharsMin,
  corpusReview,
} from "./markdownCorpus.ts";
import { prefixes, shape } from "./markdownShape.ts";

function shapeOf(reading: MarkdownReading): string {
  return shape(markdownReadingBlocks(reading));
}

/** A text read at every prefix as it is written, each reading handed on. */
function walked(
  text: string,
  stride: number,
  each: (reading: MarkdownReading, prefix: string) => void,
): MarkdownReading {
  let reading = markdownReadingNext(undefined, "", true);
  for (const prefix of prefixes(text, stride)) {
    reading = markdownReadingNext(reading, prefix, true);
    each(reading, prefix);
  }
  return reading;
}

function sameInOneStep(reading: MarkdownReading, prefix: string): void {
  expect(shapeOf(reading), JSON.stringify(prefix)).toBe(
    shapeOf(markdownReadingNext(undefined, prefix, true)),
  );
}

describe("a text read as it is written", () => {
  test.each(Object.keys(corpusAnswers))(
    "%s: every moment is what one reading of it comes to",
    (name) => {
      const text = corpusAnswers[name] ?? "";
      walked(text, name === "longLine" ? 23 : 1, sameInOneStep);
    },
  );

  test.each(Object.keys(corpusAnswers))(
    "%s: whole, it is what the stored text reads as",
    (name) => {
      const text = corpusAnswers[name] ?? "";
      const last = walked(text, name === "longLine" ? 37 : 11, () => undefined);
      expect(shapeOf(markdownReadingNext(last, text, false))).toBe(
        shape(markdownBlocksParsed(text) ?? []),
      );
    },
  );

  test("a block once kept is the same object from then on", () => {
    let kept: MarkdownReading["settled"] = [];
    const last = walked(corpusReview, 1, (reading) => {
      kept.forEach((block, at) => {
        expect(reading.settled[at]).toBe(block);
      });
      kept = reading.settled;
    });
    expect(last.settled.length).toBeGreaterThan(last.open.length);
  });

  test("only what follows the last block kept is read again", () => {
    const last = walked(corpusReview, 1, (reading, prefix) => {
      expect(reading.offset).toBeLessThanOrEqual(prefix.length);
      expect(prefix.charAt(reading.offset - 1)).toBe(
        reading.offset === 0 ? "" : "\n",
      );
    });
    expect(last.offset).toBeGreaterThan(corpusReview.lastIndexOf("```bash"));
  });

  test("a text that does not go on from the one before is read anew", () => {
    const before = walked("one\n\ntwo\n\nthree\n\nfour", 1, () => undefined);
    expect(before.settled.length).toBeGreaterThan(0);
    const next = markdownReadingNext(before, "five", true);
    expect(shapeOf(next)).toBe("<paragraph>five</paragraph>");
    expect(next.offset).toBe(0);
  });
});

describe("a text that stops being written", () => {
  test("keeps every block that reads the same as the object it was", () => {
    for (const [name, text] of Object.entries(corpusAnswers)) {
      const last = walked(text, name === "longLine" ? 37 : 5, () => undefined);
      const before = markdownReadingBlocks(last);
      const whole = markdownReadingNext(last, text, false);
      expect(shapeOf(whole), name).toBe(
        shape(markdownBlocksParsed(text) ?? []),
      );
      expect(whole.open).toEqual([]);
      whole.settled.forEach((block, at) => {
        expect(block, `${name} block ${String(at)}`).toBe(before[at]);
      });
    }
  });

  test("takes the whole reading's block wherever the two read otherwise", () => {
    const text = "Kept as it was.\n\nIt is **blo";
    const last = walked(text, 1, () => undefined);
    const before = markdownReadingBlocks(last);
    expect(shape(before)).toContain("<strong>blo</strong>");
    const whole = markdownReadingNext(last, text, false);
    expect(shapeOf(whole)).toBe(shape(markdownBlocksParsed(text) ?? []));
    expect(shapeOf(whole)).toContain("It is **blo");
    expect(whole.settled[0]).toBe(before[0]);
    expect(whole.settled[1]).not.toBe(before[1]);
  });

  test("and another text takes nothing from the one before it", () => {
    const last = walked("one\n\ntwo\n\nthree", 1, () => undefined);
    const other = "one\n\nnot two\n\nthree";
    const whole = markdownReadingNext(last, other, false);
    const before = markdownReadingBlocks(last);
    expect(shapeOf(whole)).toBe(shape(markdownBlocksParsed(other) ?? []));
    expect(whole.settled[0]).toBe(before[0]);
    expect(whole.settled[1]).not.toBe(before[1]);
    expect(whole.settled[2]).toBe(before[2]);
  });
});

/** The longest stretch of a text that is read again at any moment of its being
 * written, in characters. */
function tailCharsMax(text: string, stride: number): number {
  let longest = 0;
  walked(text, stride, (reading, prefix) => {
    longest = Math.max(longest, prefix.length - reading.offset);
  });
  return longest;
}

describe("a long answer", () => {
  const stride = 13;

  test("costs at each moment what its last blocks cost, and not what all of it does", () => {
    expect(corpusLongAnswer.length).toBeGreaterThanOrEqual(
      corpusLongAnswerCharsMin,
    );
    const round = [corpusReview, corpusComparison, corpusHowTo].join("\n\n");
    const once = tailCharsMax(round, stride);
    expect(once).toBeLessThan(round.length / 2);
    expect(tailCharsMax(corpusLongAnswer, stride)).toBeLessThanOrEqual(
      once + stride,
    );
  });

  test("read in steps, it is what one reading of all of it comes to", () => {
    const last = walked(corpusLongAnswer, stride, () => undefined);
    expect(shapeOf(markdownReadingNext(last, corpusLongAnswer, false))).toBe(
      shape(markdownBlocksParsed(corpusLongAnswer) ?? []),
    );
    expect(shapeOf(last)).toBe(
      shapeOf(markdownReadingNext(undefined, corpusLongAnswer, true)),
    );
  });
});

/**
 * Texts the cut is not made in, each found by the soup below. The grammar reads
 * a line under indented code, a paragraph or a table differently from the same
 * line standing first, so a reading that began there would come to other
 * blocks than the text read whole.
 */
const waiting: readonly string[] = [
  "    code\n\n2. two\n\nmore\n\nend",
  "\ttext\n2. [```ts[:[x] <==\n \n\nend",
  "     [ ] &\n2. \n\nend\n\nmore",
  "<\n1) \t1.    \n-\n\nend\n\nmore",
  "[\n+ - \t\n\nend\n\nmore",
  "<div>\n- 2. | - | - |\n\nend\n\nmore",
  "words\n> 2. two\n\nend\n\nmore",
  "| a |\n| - |\n2. two\n\nend\n\nmore",
  "a **b | c |\n=\n*\n>\n\nend\n\nmore",
];

const soupTokens: readonly string[] = [
  ..."- |1. |2. |> |\n|\n|\n\n|| a | b ||| - | - ||| c |||```|```ts|~~~".split(
    "|",
  ),
  ...["    ", "  ", "text", "word ", "more words", "*", "**", "_", "`", "``"],
  ...["# ", "## ", "---", "***", "[x] ", "[ ] ", "[", "](", ")", "<", "&"],
  ...["\\", ":", "-", "+ ", "a_b", "https://a.test/x_y", "[[ticket:4", "]]"],
  ...["=", "\t", "<div>", "1) ", "|"],
];

/** A generator the suite can run again and get the same soup from. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const soupSeed = 7;
const soupRounds = 120;
const soupTokensMax = 28;

describe("a text the cut could be made wrongly in", () => {
  test.each(waiting)("%j", (text) => {
    walked(text, 1, sameInOneStep);
  });

  test("a seeded soup of marks reads the same in steps as in one", () => {
    const random = seeded(soupSeed);
    for (let round = 0; round < soupRounds; round += 1) {
      const count = 6 + Math.floor(random() * (soupTokensMax - 6));
      const text = Array.from(
        { length: count },
        () => soupTokens[Math.floor(random() * soupTokens.length)] ?? "",
      ).join("");
      walked(text, 1, sameInOneStep);
    }
  });
});

describe("a whole text", () => {
  test("is read in one step, every block of it final", () => {
    const reading = markdownReadingNext(undefined, corpusReview, false);
    expect(reading.open).toEqual([]);
    expect(shapeOf(reading)).toBe(
      shape(markdownBlocksParsed(corpusReview) ?? []),
    );
  });

  test("asked for again is the reading it was", () => {
    const reading = markdownReadingNext(undefined, corpusReview, false);
    expect(markdownReadingNext(reading, corpusReview, false)).toBe(reading);
  });
});

describe("a text the parser cannot be trusted with", () => {
  const run = "*".repeat(markdownMarkRunMax + 1);
  const text = `before\n\na ${run}b${run} c`;

  test("is drawn as its characters, whole or written", () => {
    for (const writing of [true, false])
      expect(shapeOf(markdownReadingNext(undefined, text, writing))).toBe(
        `<paragraph>${text}</paragraph>`,
      );
  });

  test("stays that way however it goes on", () => {
    const last = walked(`${text}\n\n**bold** after`, 1, () => undefined);
    expect(shapeOf(last)).toBe(
      `<paragraph>${text}\n\n**bold** after</paragraph>`,
    );
    expect(last.settled).toEqual([]);
  });

  test("is still read where the run is code", () => {
    expect(
      shapeOf(markdownReadingNext(undefined, `\`\`\`\n${run}\n\`\`\``, false)),
    ).toBe(`<code>${run}</code>`);
  });
});
