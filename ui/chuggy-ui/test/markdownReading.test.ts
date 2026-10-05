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
 * from then on and is the block the whole text reads in its place, a whole
 * text is read whole, a text the parser cannot be trusted with is drawn as its
 * characters and stays that way, and a reading that costs more than a frame's
 * share stops short and rests, by a clock the cases hand it.
 */

import { describe, expect, test } from "vitest";

import { markdownPiecesFrom } from "../app/browser/ui/markdownPieces.ts";
import {
  markdownReadingBlocks,
  markdownReadingCurrent,
  markdownReadingNext,
  markdownReadingRest,
  markdownReadingRests,
  markdownReadingShareMs,
} from "../app/browser/ui/markdownReading.ts";
import type { MarkdownReading } from "../app/browser/ui/markdownReading.ts";
import {
  markdownBlocksParsed,
  markdownNodesAlike,
} from "../app/browser/ui/markdownTree.ts";
import type { MarkdownBlock } from "../app/browser/ui/markdownTree.ts";
import {
  corpusAnswers,
  corpusComparison,
  corpusHowTo,
  corpusLongAnswer,
  corpusLongAnswerCharsMin,
  corpusReview,
} from "./markdownCorpus.ts";
import { drawn, prefixes, shape, within } from "./markdownShape.ts";

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
    const before = walked(corpusComparison, 7, () => undefined);
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
  const run = "*".repeat(129);
  const text = `before\n\na ${run}b${run} c`;

  const plain = `<paragraph>before</paragraph><paragraph>a ${run}b${run} c</paragraph>`;

  test("is drawn as its characters where it cannot be, whole or written, and read above it", () => {
    for (const writing of [true, false])
      expect(shapeOf(markdownReadingNext(undefined, text, writing))).toBe(
        plain,
      );
  });

  test("stays that way however it goes on, and what follows it is read", () => {
    const last = walked(`${text}\n\n**bold** after`, 1, sameInOneStep);
    expect(shapeOf(last)).toBe(
      `${plain}<paragraph><strong>bold</strong> after</paragraph>`,
    );
    expect(last.settled).toHaveLength(2);
  });

  test("is still read where the run is code", () => {
    expect(
      shapeOf(markdownReadingNext(undefined, `\`\`\`\n${run}\n\`\`\``, false)),
    ).toBe(`<code>${run}</code>`);
  });
});

const endingTokens: readonly string[] = [
  ...["\r", "\r", "\r\n", "\r\n", "a\rb", "\u00a0", "\n\u00a0\n", "\f"],
  ...["\u2028", "\v", "  \r", "\\\r", "```\r", "# ", "- ", "> ", "end"],
  ...["| a | b |", "| - | - |", "```", "~~~", "    ", "**", "`", "word "],
];

/** What is wrong with a text read in steps, or nothing: each reading against
 * one made fresh, each block kept against the whole text's, and how far the
 * place it reads from had moved when the block was kept. */
function unsound(text: string, stride: number): string | undefined {
  const whole = markdownBlocksParsed(text);
  let before = markdownReadingNext(undefined, "", true);
  for (const prefix of prefixes(text, stride)) {
    const reading = markdownReadingNext(before, prefix, true);
    const fresh = markdownReadingNext(undefined, prefix, true);
    if (shapeOf(reading) !== shapeOf(fresh)) return `in steps: ${prefix}`;
    if (reading.offset < before.offset) return `went back: ${prefix}`;
    const kept = reading.settled.length > before.settled.length;
    if (kept && reading.offset === before.offset) return `kept: ${prefix}`;
    for (const [at, block] of reading.settled.entries()) {
      const final = whole[at];
      if (at < before.settled.length && block !== before.settled[at])
        return `let go: ${prefix}`;
      if (final === undefined || !markdownNodesAlike(block, final))
        return `block ${String(at)}: ${prefix}`;
    }
    before = reading;
  }
  const last = markdownReadingNext(before, text, false);
  return shapeOf(last) === shape(whole) ? undefined : "whole";
}

describe("a text read in steps, whatever its lines end in", () => {
  test.each([
    "# Title\rThe answer goes on\nand on.",
    "```ts\rconst a = 1;\r```\rAnd then **words**.\rMore.",
    "one\r\rtwo\r\n\r\nthree\n\rfour",
    "a\n\u00a0\nb\n\nc\n\u00a0\n\nd",
    "- a\r- b\r\r1. c\r\n   d\r\r> e\rf\r\rend",
    "| a |\r| - |\r| b |\r\rend",
  ])("%j keeps only what the whole text reads, and never twice", (text) => {
    expect(unsound(text, 1)).toBeUndefined();
  });

  test("a seeded soup of marks, line ends and spaces that are not blank does too", () => {
    const tokens = [...soupTokens, ...endingTokens];
    const random = seeded(11);
    for (let round = 0; round < 160; round += 1) {
      const count = 4 + Math.floor(random() * 30);
      const text = Array.from(
        { length: count },
        () => tokens[Math.floor(random() * tokens.length)] ?? "",
      ).join("");
      const stride = round % 2 === 0 ? 1 : 1 + Math.floor(random() * 9);
      expect(unsound(text, stride), JSON.stringify(text)).toBeUndefined();
    }
  });
});

describe("a text read in steps, where a run is longer than one call may cost", () => {
  test.each([
    ["a list", "- an item of the list, with **words** in it\n"],
    ["a numbered list", "1. an item of the list, with `words` in it\n"],
    ["a quote", "> a line of the quote, which goes on and on\n"],
    [
      "headings over words",
      "## A heading\nAnd words under it, no line between.\n",
    ],
  ])("%s keeps only what the whole text reads", (_name, unit) => {
    const text = unit.repeat(Math.ceil(40_000 / unit.length));
    expect(markdownPiecesFrom(text, 0, 0).length).toBeGreaterThan(2);
    expect(unsound(text, 1_531)).toBeUndefined();
    expect(shape(markdownBlocksParsed(text))).not.toContain(unit.slice(0, 6));
  });
});

describe("a numbered list longer than one call may cost", () => {
  const text = "1. an item of the list, with `words` in it\n".repeat(900);

  /** Where each list of a reading begins counting, and how many it holds. */
  function counted(blocks: readonly MarkdownBlock[]): readonly number[][] {
    return blocks.map((block) =>
      block.type === "list" ? [block.start ?? 0, block.children.length] : [],
    );
  }

  /** Whether each list counts on from the one above it, and how far. */
  function countedOn(blocks: readonly MarkdownBlock[]): number {
    let next = 1;
    for (const [start, items] of counted(blocks)) {
      expect(start).toBe(next);
      next += items ?? 0;
    }
    return next;
  }

  test("counts on past each place it is parted at, though every item is written as the first", () => {
    const whole = markdownBlocksParsed(text);
    expect(whole.length).toBeGreaterThan(2);
    expect(countedOn(whole)).toBe(901);
  });

  test("counts the same while it is written as once it is whole", () => {
    const written = walked(text, 1_531, (reading) => {
      countedOn(markdownReadingBlocks(reading));
    });
    expect(countedOn(markdownReadingBlocks(written))).toBe(901);
  });
});

/** Six paragraphs, each long enough to be read on its own. */
const dear = Array.from(
  { length: 6 },
  (_unused, at) => `Paragraph ${String(at)} ${"goes on ".repeat(40)}.`,
).join("\n\n");

/** A clock that moves by `step` each time it is read, which is what a
 * reading that costs something is from inside. */
function ticking(time: { now: number; step: number }): () => number {
  return () => (time.now += time.step);
}

describe("a reading that costs more than a frame's share", () => {
  test("stops short of the text's end while it is written, and says so", () => {
    expect(markdownReadingShareMs).toBe(8);
    const time = { now: 0, step: 5 };
    const reading = markdownReadingNext(undefined, dear, true, ticking(time));
    expect(reading.behind).toBe(true);
    expect(markdownReadingCurrent(reading, dear, true)).toBe(false);
    expect(reading.settled.length).toBeGreaterThan(0);
    expect(reading.settled.length).toBeLessThan(6);
    expect(reading.open).toEqual([]);
    expect(shapeOf(reading)).toBe(
      shape(markdownBlocksParsed(dear).slice(0, reading.settled.length)),
    );
  });

  test("rests for a multiple of what it cost, and is the reading it was until then", () => {
    expect(markdownReadingRest).toBe(3);
    const time = { now: 0, step: 5 };
    const clock = ticking(time);
    const reading = markdownReadingNext(undefined, dear, true, clock);
    const cost = reading.since - 5;
    expect(reading.until).toBe(reading.since + cost * 3);
    time.step = 0;
    time.now = reading.until - 1;
    expect(markdownReadingRests(reading, time.now)).toBe(true);
    expect(markdownReadingNext(reading, `${dear} more`, true, clock)).toBe(
      reading,
    );
    time.now = reading.until;
    expect(markdownReadingRests(reading, time.now)).toBe(false);
    const next = markdownReadingNext(reading, `${dear} more`, true, clock);
    expect(next.behind).toBe(false);
    expect(shapeOf(next)).toBe(shape(markdownBlocksParsed(`${dear} more`)));
    next.settled.slice(0, reading.settled.length).forEach((block, at) => {
      expect(block).toBe(reading.settled[at]);
    });
  });
});

describe("a reading under a clock that says every piece is dear", () => {
  test("takes one piece each time its rest is over, so it always ends", () => {
    const time = { now: 0, step: 1_000 };
    const clock = ticking(time);
    let reading = markdownReadingNext(undefined, dear, true, clock);
    const kept = [reading.settled.length];
    while (!markdownReadingCurrent(reading, dear, true) && kept.length < 20) {
      expect(markdownReadingNext(reading, dear, true, clock)).toBe(reading);
      time.now = reading.until;
      const next = markdownReadingNext(reading, dear, true, clock);
      expect(next.offset).toBeGreaterThan(reading.offset);
      reading = next;
      kept.push(reading.settled.length);
    }
    expect(kept).toEqual([1, 2, 3, 4, 5]);
    expect(shapeOf(reading)).toBe(shape(markdownBlocksParsed(dear)));
  });

  test("does not rest by a clock that has gone back", () => {
    const time = { now: 10_000, step: 5 };
    const clock = ticking(time);
    const reading = markdownReadingNext(undefined, dear, true, clock);
    expect(reading.until).toBeGreaterThan(reading.since);
    time.step = 0;
    time.now = 3;
    expect(markdownReadingRests(reading, time.now)).toBe(false);
    expect(
      markdownReadingNext(reading, dear, true, clock).offset,
    ).toBeGreaterThan(reading.offset);
  });

  test("is read to its end at once when the text is whole, and when no clock is handed", () => {
    const whole = shape(markdownBlocksParsed(dear));
    const clock = ticking({ now: 0, step: 5 });
    expect(shapeOf(markdownReadingNext(undefined, dear, false, clock))).toBe(
      whole,
    );
    const resting = markdownReadingNext(undefined, dear, true, clock);
    expect(shapeOf(markdownReadingNext(resting, dear, false, clock))).toBe(
      whole,
    );
    const still = markdownReadingNext(undefined, dear, true);
    expect(still.behind).toBe(false);
    expect(still.until).toBe(0);
    expect(shapeOf(still)).toBe(whole);
  });
});

/** Two paragraphs, each of them dear to read, and a list's line. */
const twice = `${"*a* ".repeat(2_000).trimEnd()}\n\n`.repeat(2);
const listed = "- an item of the list, with **words** in it\n";

/** How much of a text has been written when it is first parted in two. */
function partedAt(text: string): number {
  let low = 0;
  let high = text.length;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (markdownPiecesFrom(text.slice(0, middle), 0, 0).length > 1)
      high = middle;
    else low = middle;
  }
  return high;
}

describe("the piece a text ends in, in a frame whose share is spent", () => {
  test("is left for the next frame where it is a second dear piece", () => {
    const pieces = markdownPiecesFrom(twice, 0, 0);
    expect(pieces.map((piece) => piece.kind)).toEqual(["read", "read"]);
    const time = { now: 0, step: 10 };
    const clock = ticking(time);
    const reading = markdownReadingNext(undefined, twice, true, clock);
    expect(reading.behind).toBe(true);
    expect(reading.open).toEqual([]);
    expect(reading.settled).toHaveLength(1);
    expect(reading.offset).toBe(pieces[1]?.start);
    time.now = reading.until;
    const next = markdownReadingNext(reading, twice, true, clock);
    expect(next.behind).toBe(false);
    expect(shapeOf(next)).toBe(shape(markdownBlocksParsed(twice)));
  });

  test("is read with the piece above it under no clock, and in a frame with share left", () => {
    const still = markdownReadingNext(undefined, twice, true);
    expect(still.behind).toBe(false);
    expect(still.open).toHaveLength(1);
    const clock = ticking({ now: 0, step: 1 });
    const quick = markdownReadingNext(undefined, twice, true, clock);
    expect(quick.behind).toBe(false);
    expect(quick.open).toHaveLength(1);
  });

  test("is read all the same where it is the rest of a section parted in two", () => {
    const text = listed.repeat(380);
    expect(markdownPiecesFrom(text, 0, 0)).toHaveLength(2);
    const clock = ticking({ now: 0, step: 1_000 });
    const reading = markdownReadingNext(undefined, text, true, clock);
    expect(reading.behind).toBe(false);
    expect(reading.settled).toHaveLength(1);
    expect(reading.open).toHaveLength(1);
    expect(shapeOf(reading)).toBe(
      shapeOf(markdownReadingNext(undefined, text, true)),
    );
  });

  test.each([
    ["a list", listed.repeat(800)],
    ["a spaced list", `${listed.repeat(20)}\n`.repeat(45)],
  ])(
    "so %s loses nothing it has drawn in the frame it is parted in, however spent that frame",
    (_name, text) => {
      const length = partedAt(text);
      const before = markdownReadingNext(
        undefined,
        text.slice(0, length - 1),
        true,
      );
      expect(before.settled).toEqual([]);
      const clock = ticking({ now: 0, step: 1_000 });
      const after = markdownReadingNext(
        before,
        text.slice(0, length),
        true,
        clock,
      );
      expect(after.settled.length).toBeGreaterThan(0);
      expect(after.offset).toBeLessThan(length - 1);
      expect(after.behind).toBe(false);
      const shown = drawn(markdownReadingBlocks(before)).characters;
      const now = drawn(markdownReadingBlocks(after)).characters;
      expect(shown.length).toBeGreaterThan(after.offset / 2);
      expect(within(shown, now)).toBe(true);
    },
  );
});

describe("a reading within a frame's share", () => {
  test("does not rest, and is read again as soon as the text moves", () => {
    const time = { now: 0, step: 1 };
    const clock = ticking(time);
    const reading = markdownReadingNext(undefined, "One **bo", true, clock);
    expect(reading.until).toBe(0);
    expect(markdownReadingRests(reading, time.now)).toBe(false);
    const next = markdownReadingNext(reading, "One **bold**", true, clock);
    expect(shapeOf(next)).toBe(
      "<paragraph>One <strong>bold</strong></paragraph>",
    );
  });
});
