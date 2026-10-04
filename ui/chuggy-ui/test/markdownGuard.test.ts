/**
 * What a text is split into before the parser sees any of it, and which of
 * its runs the parser is never handed.
 *
 * The bounds are asserted on texts written out here, one inside each bound
 * and one past it, so a bound that moved fails a case rather than moving the
 * case with it. What the parser then costs on the texts that pass is
 * `markdownCost.test.ts`'s.
 */

import { describe, expect, test } from "vitest";

import {
  markdownLineMarksMax,
  markdownMarkRunMax,
  markdownRunCharsMax,
  markdownRunLinesMax,
  markdownRunScanned,
  markdownWordsPass,
} from "../app/browser/ui/markdownGuard.ts";
import {
  markdownBlank,
  markdownPiecesFrom,
  markdownTextCharsMax,
} from "../app/browser/ui/markdownPieces.ts";
import {
  markdownReadingBlocks,
  markdownReadingNext,
} from "../app/browser/ui/markdownReading.ts";
import { markdownBlocksParsed } from "../app/browser/ui/markdownTree.ts";
import { shape } from "./markdownShape.ts";

/** The kinds of the pieces a text is split into, in order. */
function kinds(text: string): readonly string[] {
  return markdownPiecesFrom(text, 0, 0).map((piece) => piece.kind);
}

function read(text: string): string {
  return shape(markdownBlocksParsed(text));
}

/** A run that costs the parser a good part of what a run may, and passes. */
const dear = "*a* ".repeat(1_000).trimEnd();

/** A run past what any run may cost. */
const hostile = "a* ".repeat(4_000).trimEnd();

describe("what one run may hold", () => {
  test("is its characters past the most a run may be", () => {
    expect(markdownRunCharsMax).toBe(16_384);
    expect(kinds("a".repeat(16_384))).toEqual(["read"]);
    expect(kinds("a".repeat(16_385))).toEqual(["plain"]);
    expect(read("a".repeat(16_385))).toBe(
      `<paragraph>${"a".repeat(16_385)}</paragraph>`,
    );
  });

  test("is its characters past the most lines a run may be", () => {
    expect(markdownRunLinesMax).toBe(1_024);
    expect(kinds(`${"some words\n".repeat(1_023)}some words`)).toEqual([
      "read",
    ]);
    expect(kinds(`${"some words\n".repeat(1_024)}some words`)).toEqual([
      "plain",
    ]);
  });

  test("is its characters where a line opens with more marks than any text has", () => {
    expect(markdownLineMarksMax).toBe(16);
    expect(kinds(`${"> ".repeat(16)}a`)).toEqual(["read"]);
    expect(kinds(`${"> ".repeat(17)}a`)).toEqual(["plain"]);
    expect(kinds(`${"- ".repeat(17)}a`)).toEqual(["plain"]);
    expect(kinds(`${"1. > - ".repeat(6)}a`)).toEqual(["plain"]);
  });

  test("is its characters where one mark is written more times together than any text has", () => {
    expect(markdownMarkRunMax).toBe(128);
    for (const mark of ["*", "_", "~"]) {
      expect(kinds(`a ${mark.repeat(128)}b`), mark).toEqual(["read"]);
      expect(kinds(`a ${mark.repeat(129)}b`), mark).toEqual(["plain"]);
    }
  });

  test("is its characters where its marks cost more than its length in a list would", () => {
    expect(kinds(dear)).toEqual(["read"]);
    expect(kinds(hostile)).toEqual(["plain"]);
    expect(read(hostile)).toBe(`<paragraph>${hostile}</paragraph>`);
  });
});

/** Where each piece of a text begins and ends, and its kind. */
function cuts(text: string): readonly string[] {
  return markdownPiecesFrom(text, 0, 0).map(
    (piece) => `${piece.kind} ${String(piece.start)} ${String(piece.end)}`,
  );
}

describe("a run longer than one call may cost", () => {
  const list = "- an item of the list, with some words in it\n".repeat(500);
  const quote = "> a line of the quote, which goes on and on\n".repeat(500);
  const titled = "## A heading\nAnd some words under it, at the margin.\n";

  test("is read as several where its lines begin blocks of their own", () => {
    expect(list.length).toBeGreaterThan(16_384);
    for (const text of [list, quote, titled.repeat(450)]) {
      const pieces = markdownPiecesFrom(text, 0, 0);
      expect(pieces.length, text.slice(0, 12)).toBeGreaterThan(1);
      for (const piece of pieces) {
        expect(piece.kind, text.slice(0, 12)).toBe("read");
        expect(piece.end - piece.start).toBeLessThanOrEqual(16_384);
        expect(text.slice(piece.start, piece.start + 2)).toBe(text.slice(0, 2));
      }
    }
    expect(read(list).split("<listItem>")).toHaveLength(501);
    expect(read(list)).not.toContain("- an item");
    expect(read(quote)).not.toContain("> a line");
    expect(read(titled.repeat(450)).split("<heading2>")).toHaveLength(451);
  });

  test("is its characters where none of its lines does", () => {
    const row = "| a cell | another cell | and a third one |\n";
    const table = `| A | B | C |\n| - | - | - |\n${row.repeat(400)}`;
    expect(kinds(table)).toEqual(["plain"]);
    expect(kinds("Some words on a line of a paragraph.\n".repeat(500))).toEqual(
      ["plain"],
    );
    expect(kinds(`> quoted\n${"and carried on\n".repeat(1_200)}`)).toEqual([
      "plain",
    ]);
  });

  test("ends above the line that took it past, at the last line that begins a block", () => {
    const long = "a".repeat(16_400);
    expect(cuts(`Some words.\n- an item\n${long}\n- another`)).toEqual([
      "read 0 12",
      `plain 12 ${String(12 + 10 + 16_401 + 9)}`,
    ]);
    expect(cuts(`- an item\n${long}\n- another`)).toEqual([
      `plain 0 ${String(10 + 16_401 + 9)}`,
    ]);
  });

  test("ends where it did however much of the next line is written", () => {
    const head = "- an item of the list, in words\n".repeat(512);
    expect(head).toHaveLength(16_384);
    const whole = `${head}# A heading\nAnd words.\n`;
    expect(cuts(head)).toEqual(["read 0 16384"]);
    for (let length = head.length + 1; length <= whole.length; length += 1)
      expect(cuts(whole.slice(0, length))[0], String(length)).toBe(
        cuts(whole)[0],
      );
  });
});

describe("a run that is ended as it is written", () => {
  test("begins each piece where it ever will, at every moment", () => {
    const units = [
      "- an item of a list with words\n",
      "## A heading\n",
      "> a quoted line\n",
      "#\n",
      "1. one\n",
      "2. two\n",
      "words at the margin\n",
      "  and carried on\n",
      "#hash\n",
      "-dash\n",
      "- \n",
      "* * *\n",
    ];
    const text = Array.from(
      { length: 2_400 },
      (_, at) => units[(at * at + 3 * at) % units.length] ?? "",
    ).join("");
    const whole = cuts(text);
    expect(whole.length).toBeGreaterThan(3);
    const lengths = new Set<number>();
    for (let length = 1; length < text.length; length += 97)
      lengths.add(length);
    for (const cut of whole) {
      const start = Number(cut.split(" ")[1]);
      for (let length = start; length < start + 160; length += 1)
        lengths.add(Math.min(length, text.length));
    }
    for (const length of lengths) {
      const now = cuts(text.slice(0, length));
      const settled = Math.max(now.length - 1, 0);
      expect(now.slice(0, settled), String(length)).toEqual(
        whole.slice(0, settled),
      );
    }
  });
});

describe("a blank line", () => {
  test("ends a run, and what the run cost is not carried into the next", () => {
    const text = Array.from({ length: 8 }, () => dear).join("\n\n");
    expect(new Set(kinds(text))).toEqual(new Set(["read"]));
    expect(read(text)).not.toContain("*");
    expect(read(text).split("<emphasis>a</emphasis>")).toHaveLength(8_001);
  });

  test("taken out, leaves one run past what a run may be, which is its characters", () => {
    const text = Array.from({ length: 8 }, () => dear).join("\n");
    expect(kinds(text)).toEqual(["plain"]);
    expect(read(text)).not.toContain("<emphasis>");
  });

  test("is a line of spaces and tabs, and of nothing else", () => {
    expect(markdownBlank(" \t\n\t \n")).toBe(true);
    expect(markdownBlank(" ")).toBe(false);
    expect(markdownBlank(" ")).toBe(false);
    expect(markdownBlank("\f")).toBe(false);
    const run = "word ".repeat(1_800).trimEnd();
    expect(kinds(`${run}\n\n${run}`)).toEqual(["read", "read"]);
    for (const line of [" ", "　", "\f", " ", "\v"]) {
      const text = `${run}\n${line}\n${run}`;
      expect(markdownRunScanned(text, 0).end, line).toBe(text.length);
      expect(kinds(text), JSON.stringify(line)).toEqual(["plain"]);
    }
  });

  test("leaves a plain run plain and reads the runs on either side of it", () => {
    const text = `Read **before**.\n\n${hostile}\n\nRead **after**.`;
    expect(kinds(text)).toEqual(["read", "plain", "read"]);
    expect(read(text)).toBe(
      `<paragraph>Read <strong>before</strong>.</paragraph><paragraph>${hostile}</paragraph><paragraph>Read <strong>after</strong>.</paragraph>`,
    );
  });
});

describe("a fence opened at the margin", () => {
  test("is code that the parser is not handed, closed by its own line", () => {
    const text = `\`\`\`md\n${hostile}\n\`\`\`\nAnd **words**.`;
    expect(kinds(text)).toEqual(["fence", "read"]);
    expect(read(text)).toBe(
      `<code md>${hostile}</code><paragraph>And <strong>words</strong>.</paragraph>`,
    );
  });

  test("closes, so what follows it is reckoned like any other text", () => {
    const text = `\`\`\`\ncode\n\`\`\`\n${hostile}`;
    expect(kinds(text)).toEqual(["fence", "plain"]);
    expect(read(text)).toBe(
      `<code>code</code><paragraph>${hostile}</paragraph>`,
    );
  });

  test.each([
    ["```\ncode\n```", "code"],
    ["```\ncode\n````", "code"],
    ["````\ncode\n```\n````", "code\n```"],
    ["```\ncode\n   ```", "code"],
    ["```\ncode\n    ```", "code\n    ```"],
    ["```\ncode\n``` not a close", "code\n``` not a close"],
    ["```\ncode\n~~~", "code\n~~~"],
    ["~~~\ncode\n~~~ \t", "code"],
    ["```\ncode", "code"],
    ["```\n", ""],
  ])("%j holds %j", (text, held) => {
    expect(read(text)).toBe(`<code>${held}</code>`);
  });

  test("is no fence where backticks follow its opening ones on the line", () => {
    expect(kinds("``` a `b`\nwords")).toEqual(["read"]);
    expect(read("``` a `b`\nwords")).not.toContain("<code>");
  });

  test("indented is its run's, and exempts nothing after it", () => {
    for (const opened of ["   ```\n", "- a\n\n   ```\n   code\n   ```\n\n"]) {
      const text = `${opened}${hostile}\n\n${hostile}`;
      expect(kinds(text), opened).not.toContain("fence");
      expect(kinds(text).at(-1), opened).toBe("plain");
      expect(read(text), opened).not.toMatch(/<emphasis>|<strong>/u);
    }
  });
});

describe("a text past the most that is read", () => {
  const paragraph = `${"Some **bold** words. ".repeat(47)}\n\n`;

  test("is its characters from the bound on, and read above it", () => {
    expect(markdownTextCharsMax).toBe(65_536);
    expect(paragraph).toHaveLength(989);
    const text = paragraph.repeat(70);
    const pieces = markdownPiecesFrom(text, 0, 0);
    expect(pieces.at(-1)?.kind).toBe("plain");
    expect(pieces.at(-1)?.end).toBe(text.length);
    expect(pieces.at(-1)?.start).toBeGreaterThan(64_000);
    expect(pieces.at(-1)?.start).toBeLessThanOrEqual(65_536);
    const blocks = markdownBlocksParsed(text);
    expect(shape(blocks.slice(0, 1))).toContain("<strong>bold</strong>");
    expect(shape(blocks.slice(-1))).toContain("Some **bold** words.");
    expect(shape(blocks.slice(-1))).not.toContain("<strong>");
  });

  test("of runs that are each dear is its characters once they have cost what a text may", () => {
    const text = Array.from({ length: 16 }, () => dear).join("\n\n");
    expect(text.length).toBeLessThan(65_536);
    const read = kinds(text);
    expect(read[0]).toBe("read");
    expect(read.at(-1)).toBe("plain");
    expect(read.indexOf("plain")).toBeGreaterThan(8);
    expect(read.slice(read.indexOf("plain"))).toEqual(["plain"]);
  });
});

describe("the verdict on a run", () => {
  test("goes from read to plain once as the run is written, and never back", () => {
    const texts = [
      hostile,
      `${"> - ".repeat(12)}a\n`.repeat(40),
      `https://a${".".repeat(6_000)}a and more`,
      `${"| a ".repeat(40)}|\n`.repeat(120),
      `${"[a](".repeat(3_000)} then words`,
    ];
    for (const text of texts) {
      let plain = false;
      for (let length = 1; length <= text.length; length += 37) {
        const now = kinds(text.slice(0, length))[0] === "plain";
        expect(plain && !now, `${String(length)} of ${text.slice(0, 12)}`).toBe(
          false,
        );
        plain = now;
      }
      expect(kinds(text)[0], text.slice(0, 12)).toBe("plain");
    }
  });

  test("is the same for a text being written as for the same text stored", () => {
    const text = `Read **before**.\n\n${hostile}\n\nRead **after**.`;
    let reading = markdownReadingNext(undefined, "", true);
    for (let length = 1; length <= text.length; length += 53)
      reading = markdownReadingNext(reading, text.slice(0, length), true);
    reading = markdownReadingNext(reading, text, true);
    expect(shape(markdownReadingBlocks(reading))).toBe(read(text));
  });
});

describe("words read as one line", () => {
  test("pass where they are words, and not where their marks cost more than a line may", () => {
    expect(markdownWordsPass("Filed [[ticket:15]] and **moved** on.")).toBe(
      true,
    );
    expect(markdownWordsPass("word ".repeat(2_000))).toBe(true);
    expect(markdownWordsPass(hostile)).toBe(false);
    expect(markdownWordsPass(`https://a${".".repeat(6_000)}a`)).toBe(false);
    expect(markdownWordsPass("[a](".repeat(3_000))).toBe(false);
    expect(markdownWordsPass("a".repeat(16_385))).toBe(false);
  });
});
