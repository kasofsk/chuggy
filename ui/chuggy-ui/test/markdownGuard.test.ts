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
  markdownSideOf,
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
import {
  markdownBlocksParsed,
  markdownLineJoined,
  markdownLineRead,
  markdownNormalised,
  markdownSectionRead,
} from "../app/browser/ui/markdownTree.ts";
import type { MarkdownNode } from "../app/browser/ui/markdownTree.ts";
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

describe("a line that opens with many marks", () => {
  const line = `${"- ".repeat(16)}a\n`;

  test("costs what each of them does, so a run of such lines is read a few at a time", () => {
    const pieces = markdownPiecesFrom(line.repeat(40), 0, 0);
    expect(pieces.map((piece) => piece.kind)).toEqual(
      Array.from({ length: 8 }, () => "read"),
    );
    for (const piece of pieces)
      expect(piece.end - piece.start).toBe(line.length * 5);
    expect(read(line.repeat(40)).split("<listItem>")).toHaveLength(641);
    expect(markdownPiecesFrom("- a\n".repeat(40), 0, 0)).toHaveLength(1);
  });

  test.each([
    ["list marks", "- ".repeat(16)],
    ["numbers", "1) ".repeat(15)],
    ["a list mark and then quote marks", `- ${"> ".repeat(15)}`],
    ["quote and list marks", "> - ".repeat(8)],
    ["list and quote marks", "- > ".repeat(8)],
  ])(
    "of %s, with no line that begins a block at the margin, is its characters once past what its length allows",
    (_name, opening) => {
      const indented = ` ${opening}a\n`;
      expect(kinds(indented.repeat(4))).toEqual(["read"]);
      expect(kinds(indented.repeat(40))).toEqual(["plain"]);
    },
  );

  test("of quote marks and no list mark is a quote carried on from the line above, and is read as far as one", () => {
    expect(kinds(` ${"> ".repeat(16)}a\n`.repeat(40))).toEqual(["read"]);
    const quoted = `${"> > > a quoted line\n".repeat(60)}\n`.repeat(40);
    const pieces = markdownPiecesFrom(quoted, 0, 0);
    expect(pieces.map((piece) => piece.kind)).toEqual(
      Array.from({ length: 40 }, () => "read"),
    );
    expect(read(quoted).split("<blockquote>")).toHaveLength(121);
  });
});

describe("a word that holds an address", () => {
  const heads: readonly (readonly [string, string])[] = [
    ["one the grammar takes", "http://."],
    ["one after a colon, which it does not", ":www.a.b/"],
    ["one after a letter, which it does not", "xhttp://a/"],
    ["one an escape writes", "www\\.a.b/"],
    ["one a reference writes", "&#119;ww.a.b/"],
  ];

  test.each(heads)(
    "%s, is its characters past a long run of what an address is cut back over",
    (_name, head) => {
      for (const mark of ["}", "!", "?", ")", ";", "'", '"', ":", ","]) {
        expect(kinds(`${head}${mark.repeat(40)}x`), mark).toEqual(["read"]);
        expect(kinds(`${head}${mark.repeat(8_000)}x`), mark).toEqual(["plain"]);
        expect(markdownWordsPass(`${head}${mark.repeat(8_000)}x`), mark).toBe(
          false,
        );
      }
      expect(kinds(`${head}${"}".repeat(16_370)}x`)).toEqual(["plain"]);
    },
  );

  test("the grammar leaves is linked by the tree all the same, and read with a run the size one taken is read with", () => {
    for (const [, head] of heads.slice(1))
      expect(kinds(`${head}${"}".repeat(7_000)}x`), head).toEqual(["read"]);
    const address = `www.a.b/${"}".repeat(7_000)}x`;
    expect(read(`:${address}`)).toBe(
      `<paragraph>:<link http://${address}>${address}</link></paragraph>`,
    );
  });

  test("written over and over by escapes is its characters before joining them is dear", () => {
    expect(kinds(`${"www\\.".repeat(1_000)}_`)).toEqual(["read"]);
    expect(kinds(`${"www\\.".repeat(2_000)}_`)).toEqual(["plain"]);
    expect(kinds(`${"a\\@".repeat(600)}`)).toEqual(["read"]);
    expect(kinds(`${"a\\@".repeat(2_000)}`)).toEqual(["plain"]);
  });

  test("and none is read with any run of them, a word and its dots apart", () => {
    for (const mark of ["}", "!", "?", ")", ";"])
      expect(kinds(`words${mark.repeat(16_000)}x`), mark).toEqual(["read"]);
  });

  test.each([
    ["braces and an escaped one", "}}}\\}"],
    ["braces then a reference", `${"}".repeat(100)}&gt;`],
    ["names then an escaped dot", `${"a.".repeat(50)}\\.`],
  ])(
    "made of %s is its characters at the size a text may be",
    (_name, unit) => {
      const short = unit.repeat(Math.ceil(600 / unit.length));
      const long = unit.repeat(Math.ceil(65_536 / unit.length));
      expect(kinds(short)).toEqual(["read"]);
      expect(kinds(long.slice(0, 16_000))).toEqual(["plain"]);
    },
  );
});

describe("one thing said over on a line", () => {
  test.each<readonly [string, number, (count: number) => string]>([
    [
      "marks that may end an address the grammar took",
      358,
      (count) => `www.a.b${"!".repeat(count)}x`,
    ],
    [
      "words that close emphasis none opened",
      191,
      (count) => "a* ".repeat(count),
    ],
    [
      "words in brackets that link nothing",
      1_103,
      (count) => "[a] ".repeat(count),
    ],
    [
      "words that may begin an address, after one that did",
      2_163,
      (count) => `www.a.b ${"www.".repeat(count)}`,
    ],
  ])(
    "%s: is read at %i of them, and is its characters at one more",
    (_name, count, build) => {
      expect(kinds(build(count))).toEqual(["read"]);
      expect(kinds(build(count + 1))).toEqual(["plain"]);
    },
  );
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

  test("is read where it is a list numbered on under a step's indented words, however many steps", () => {
    const head = "1. Do it\n\n   This step needs a word more.\n";
    for (const steps of [180, 185, 400, 1_200]) {
      const numbered = Array.from(
        { length: steps },
        (_unused, at) => `${String(at + 2)}. step with **bold** words\n`,
      );
      const text = `${head}${numbered.join("")}`;
      expect(new Set(kinds(text)), String(steps)).toEqual(new Set(["read"]));
      expect(read(text).split("<listItem>")).toHaveLength(steps + 2);
    }
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

/** How deep the quotes and lists of some nodes go, one inside another. */
function nesting(nodes: readonly MarkdownNode[]): number {
  let most = 0;
  for (const node of nodes) {
    const own = node.type === "list" || node.type === "blockquote" ? 1 : 0;
    const below = "children" in node ? nesting(node.children) : 0;
    most = Math.max(most, own + below);
  }
  return most;
}

/** How many nodes of one kind some nodes hold, at any depth. */
function counted(nodes: readonly MarkdownNode[], kind: string): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === kind) count += 1;
    if ("children" in node) count += counted(node.children, kind);
  }
  return count;
}

const mark = "\uFEFF";

/** Every code unit from one to below another, but the byte order mark. */
function units(from: number, to: number): readonly string[] {
  const held: string[] = [];
  for (let code = from; code < Math.min(to, 65_536); code += 1)
    if (code !== mark.charCodeAt(0)) held.push(String.fromCharCode(code));
  return held;
}

describe("a character the parser rewrites before it reads", () => {
  const leads: Readonly<Record<string, string>> = {
    "the text's start": "",
    "a fence": "```\ncode\n```\n",
    "a long paragraph and a blank line": `${"Some words go on. ".repeat(20)}\n\n`,
    "a short paragraph and a blank line": "Some words.\n\n",
  };

  test("is rewritten wherever it stands, before the text is reckoned", () => {
    expect(markdownNormalised(`${mark}a${mark}\r\nb\rc\0`)).toBe(
      "a\nb\nc\uFFFD",
    );
    expect(markdownNormalised("words\nand more")).toBe("words\nand more");
  });

  test("left in a text has both doors turn the text away", () => {
    expect(markdownSectionRead("- a")).toHaveLength(1);
    expect(markdownLineRead("a *b*")).toHaveLength(2);
    for (const held of [mark, "\0", "\r"]) {
      const named = JSON.stringify(held);
      expect(markdownSectionRead(`${held}- a`), named).toBeUndefined();
      expect(markdownSectionRead(`- a${held}`), named).toBeUndefined();
      expect(markdownLineRead(`${held}a *b*`), named).toBeUndefined();
      expect(markdownLineRead(`a *b*${held}`), named).toBeUndefined();
    }
  });

  test.each(["- ", "> - ", "> ", "1. ", "* ", "+ "])(
    "a byte order mark before %j a thousand times over opens nothing the guard did not reckon",
    (unit) => {
      const marks = `${unit.repeat(1_000)}a`;
      for (const [name, lead] of Object.entries(leads)) {
        const text = `${lead}${mark}${marks}`;
        expect(kinds(markdownNormalised(text)).at(-1), name).toBe("plain");
        expect(read(text), name).toBe(read(`${lead}${marks}`));
        expect(nesting(markdownBlocksParsed(text)), name).toBe(0);
      }
    },
  );

  test("four sections that each open with one are each their characters", () => {
    const text = `${mark}${"- ".repeat(1_000)}a\n\n`.repeat(4);
    expect(kinds(markdownNormalised(text))).toEqual(
      Array.from({ length: 4 }, () => "plain"),
    );
    expect(nesting(markdownBlocksParsed(text))).toBe(0);
    expect(read(text)).toBe(read(text.replaceAll(mark, "")));
  });

  test("one on every line of a list leaves the list it would be without it", () => {
    const text = `${mark}- a\n`.repeat(40);
    expect(read(text)).toBe(read("- a\n".repeat(40)));
    expect(read(text).split("<listItem>")).toHaveLength(41);
  });

  test("one before marks read as a line of a note is the line without it", () => {
    const text = `${mark}${"- ".repeat(1_000)}*a*`;
    const line = markdownLineRead(markdownLineJoined(text));
    expect(line).toEqual(markdownLineRead(markdownLineJoined(text.slice(1))));
    expect(counted(line ?? [], "emphasis")).toBe(1);
  });

  test("one before marks is never drawn nested while the text is written", () => {
    const text = `Some words.\n\n${mark}${"- ".repeat(200)}a\nand words under it\n`;
    let reading = markdownReadingNext(undefined, "", true);
    for (let length = 1; length <= text.length; length += 7) {
      reading = markdownReadingNext(reading, text.slice(0, length), true);
      expect(
        nesting(markdownReadingBlocks(reading)),
        String(length),
      ).toBeLessThanOrEqual(markdownLineMarksMax);
    }
  });
});

describe("every character there is", () => {
  const fence = "```\ncode\n```\n";

  test("before a line's marks opens no more of them than the guard saw", () => {
    for (const first of [...units(0, 128), mark])
      for (const lead of ["", fence]) {
        const text = `${lead}${first}${"- ".repeat(17)}a`;
        expect(
          nesting(markdownBlocksParsed(text)),
          `${JSON.stringify(lead)} then ${JSON.stringify(first)}`,
        ).toBeLessThanOrEqual(markdownLineMarksMax);
      }
  });

  test("past the ASCII ones, but the byte order mark, stands before a mark as a word does", () => {
    for (let from = 128; from < 65_536; from += 512) {
      const firsts = units(from, from + 512);
      const text = firsts.map((first) => `${first}- a`).join("\n\n");
      const blocks = markdownBlocksParsed(text);
      expect(blocks.map((block) => block.type)).toEqual(
        firsts.map(() => "paragraph"),
      );
      expect(counted(blocks, "list"), from.toString(16)).toBe(0);
    }
  });

  test("is sorted beside a mark by the grammar as the guard sorts it", () => {
    const marks = new Set(["\0", "\n", "\r", "*", "_", "~", "\\", "`"]);
    const wrong: string[] = [];
    for (let from = 0; from < 65_536; from += 512) {
      const sides = units(from, from + 512).filter((side) => !marks.has(side));
      const text = sides.map((side) => `*${side}a* a*${side}b*`).join("\n\n");
      const blocks = markdownBlocksParsed(text);
      expect(blocks, from.toString(16)).toHaveLength(sides.length);
      for (const [at, side] of sides.entries()) {
        const block = blocks[at];
        const stressed =
          block === undefined ? -1 : counted([block], "emphasis");
        const sorted = [1, 2, 0][stressed];
        if (sorted !== markdownSideOf(side.charCodeAt(0)))
          wrong.push(side.charCodeAt(0).toString(16));
      }
    }
    expect(wrong).toEqual([]);
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
