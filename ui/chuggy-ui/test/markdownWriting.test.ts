/**
 * A report read while it is still being written.
 *
 * The cases say what each half-written mark draws as. The properties walk
 * every prefix of answers as a model writes them, because a reader watches
 * every one go by: no block turns into another kind of block, and nothing a
 * reader was drawn is taken away or loses the mark it was drawn in.
 *
 * Four things are allowed to arrive late, and each is pinned here as a case
 * rather than left out of a property in silence: words a writer did mean in
 * brackets, an underscore pair, a pair of stars opened inside a word, and a
 * table written without its leading pipe.
 */

import { describe, expect, test } from "vitest";

import {
  markdownReadingBlocks,
  markdownReadingNext,
} from "../app/browser/ui/markdownReading.ts";
import { markdownBlocksParsed } from "../app/browser/ui/markdownTree.ts";
import type { MarkdownBlock } from "../app/browser/ui/markdownTree.ts";
import { corpusAnswers, corpusReview } from "./markdownCorpus.ts";
import { drawn, prefixes, shape, skeleton, within } from "./markdownShape.ts";
import type { Drawn } from "./markdownShape.ts";

function read(text: string): string {
  return shape(markdownBlocksParsed(text) ?? []);
}

function blocksWritten(text: string): readonly MarkdownBlock[] {
  return markdownReadingBlocks(markdownReadingNext(undefined, text, true));
}

function written(text: string): string {
  return shape(blocksWritten(text));
}

function paragraph(held: string): string {
  return `<paragraph>${held}</paragraph>`;
}

describe("a mark left open", () => {
  test("bold is drawn as bold from its first letter", () => {
    const bold = paragraph("so <strong>bold</strong>");
    expect(written("so **bo")).toBe(paragraph("so <strong>bo</strong>"));
    expect(written("so **bold")).toBe(bold);
    expect(written("so **bold*")).toBe(bold);
    expect(written("so **bold**")).toBe(bold);
  });

  test("italic, code and a strike are closed the same way", () => {
    expect(written("an *ita")).toBe(paragraph("an <emphasis>ita</emphasis>"));
    expect(written("run `npm c")).toBe(
      paragraph("run <inlineCode>npm c</inlineCode>"),
    );
    expect(written("it is ~~gon")).toBe(
      paragraph("it is <delete>gon</delete>"),
    );
  });

  test("an opener nothing follows yet is held back", () => {
    for (const opener of ["**", "*", "`", "``", "_", "[", "[[", "~~", "~"])
      expect(written(`so ${opener}`), opener).toBe(paragraph("so"));
    for (const opener of ["\\", "!", "<", "&", "&am"])
      expect(written(`so ${opener}`), opener).toBe(paragraph("so"));
  });

  test("a star a space follows opens nothing", () => {
    expect(written("2 * 3")).toBe(paragraph("2 * 3"));
    expect(written("2 ** 3")).toBe(paragraph("2 ** 3"));
  });

  test("a mark already closed is left as the reader reads it", () => {
    const text = "a **b** and `c` and ~~d~~ e";
    expect(written(text)).toBe(read(text));
  });

  test("a mark is closed over the line it was opened on", () => {
    expect(written("a **b\nc")).toBe(paragraph("a <strong>b\nc</strong>"));
  });
});

describe("a mark left open inside another", () => {
  test("each is closed, the inner one first", () => {
    expect(written("**bold and *nes")).toBe(
      paragraph("<strong>bold and <emphasis>nes</emphasis></strong>"),
    );
    expect(written("**bold `co")).toBe(
      paragraph("<strong>bold <inlineCode>co</inlineCode></strong>"),
    );
    expect(written("***both")).toBe(
      paragraph("<emphasis><strong>both</strong></emphasis>"),
    );
    expect(written("~~gone **and bo")).toBe(
      paragraph("<delete>gone <strong>and bo</strong></delete>"),
    );
  });

  test("a mark inside a link's words is closed inside them", () => {
    expect(written("see [the **do")).toBe(
      paragraph("see the <strong>do</strong>"),
    );
  });

  test("code holding a backtick is closed with the pair that opened it", () => {
    expect(written("use ``a ` b")).toBe(
      paragraph("use <inlineCode>a ` b</inlineCode>"),
    );
  });
});

describe("a star inside a word", () => {
  test("is not opened early, so a power is never drawn as bold", () => {
    for (const prefix of prefixes("2**10 is 1024, and 3*4 is 12."))
      expect(written(prefix), prefix).not.toMatch(/<emphasis>|<strong>/u);
    for (const text of ["2**10", "so**bo", "a*b", "é**b", "10***x"])
      expect(written(text), text).toBe(paragraph(text));
  });

  test("marks once its pair is whole, which takes back the stars it was drawn as", () => {
    expect(written("2**10*")).toBe(paragraph("2**10"));
    expect(written("2**10** is")).toBe(paragraph("2<strong>10</strong> is"));
    expect(written("x*y")).toBe(paragraph("x*y"));
    expect(written("x*y*z")).toBe(paragraph("x<emphasis>y</emphasis>z"));
  });

  test("is opened early after a space, a line's start or a mark of punctuation", () => {
    expect(written("so **bo")).toBe(paragraph("so <strong>bo</strong>"));
    expect(written("one\n**bo")).toBe(paragraph("one\n<strong>bo</strong>"));
    expect(written("(**bo")).toBe(paragraph("(<strong>bo</strong>"));
    expect(written("f(*args")).toBe(paragraph("f(<emphasis>args</emphasis>"));
    expect(written('"*so')).toBe(paragraph('"<emphasis>so</emphasis>'));
  });
});

describe("an underscore", () => {
  test("is never opened early, because a name is what it nearly always is", () => {
    expect(written("see count_wor")).toBe(paragraph("see count_wor"));
    expect(written("an _ita")).toBe(paragraph("an _ita"));
    for (const prefix of prefixes("Set _private_thing and __init__ here."))
      expect(written(prefix), prefix).not.toMatch(/<emphasis>|<strong>/u);
  });

  test("marks once its pair is whole, which takes back the one it opened with", () => {
    expect(written("an _ita_")).toBe(paragraph("an _ita"));
    expect(written("an _ita_ word")).toBe(
      paragraph("an <emphasis>ita</emphasis> word"),
    );
  });
});

describe("a link left open", () => {
  test("is its own words until its address is whole", () => {
    const words = paragraph("see the docs");
    expect(written("see [the do")).toBe(paragraph("see the do"));
    expect(written("see [the docs]")).toBe(words);
    expect(written("see [the docs](")).toBe(words);
    expect(written("see [the docs](https://exam")).toBe(words);
    expect(written("see [the docs](https://example.test)")).toBe(
      paragraph("see <link https://example.test>the docs</link>"),
    );
  });

  test("to nowhere a member could be sent never draws as a link or a bracket", () => {
    const text = "See [the brief](./console/BRIEF.md) for the rest of it.";
    let before = "";
    for (const prefix of prefixes(text)) {
      const now = drawn(blocksWritten(prefix)).characters;
      expect(written(prefix), prefix).not.toContain("<link");
      expect(now, prefix).not.toMatch(/[[\]()]/u);
      expect(now.startsWith(before), prefix).toBe(true);
      before = now;
    }
    expect(before).toBe("See the brief ./console/BRIEF.md for the rest of it.");
  });

  test("a picture is its description, and its mark is never drawn", () => {
    for (const prefix of prefixes("![a chart](https://example.test/a.png) x"))
      expect(drawn(blocksWritten(prefix)).characters, prefix).not.toMatch(
        /[![\]]/u,
      );
  });

  test("an address between angle brackets is drawn without them", () => {
    for (const text of [
      "Go to <https://example.test/a_b> now.",
      "Write to <someone@example.com> now.",
      "Write to <mailto:some.one+tag@example.com>.",
    ])
      for (const prefix of prefixes(text))
        expect(drawn(blocksWritten(prefix)).characters, prefix).not.toMatch(
          /[<>]/u,
        );
    expect(written("Write to <someone@example.com")).toBe(
      paragraph(
        "Write to <link mailto:someone@example.com>someone@example.com</link>",
      ),
    );
  });
});

describe("brackets that are not a link's", () => {
  test("words that were meant in brackets gain them once more is written", () => {
    expect(written("as [sic")).toBe(paragraph("as sic"));
    expect(written("as [sic] ")).toBe(paragraph("as [sic]"));
  });

  test("a bracket a word runs into is the word's own", () => {
    expect(written("take items[0")).toBe(paragraph("take items[0"));
  });

  test("a ticket's reference is drawn once it is whole and not before", () => {
    for (const half of [
      "[[",
      "[[tick",
      "[[ticket:4",
      "[[ticket:41",
      "[[ticket:41]",
    ])
      expect(written(`blocked by ${half}`), half).toBe(paragraph("blocked by"));
    expect(written("blocked by [[ticket:41]]")).toBe(
      paragraph("blocked by [[ticket:41]]"),
    );
  });
});

describe("a listed line, half written", () => {
  test("its marks are closed past what makes it a listed one", () => {
    expect(written("- one\n- **tw")).toBe(
      "<list><listItem><paragraph>one</paragraph></listItem><listItem><paragraph><strong>tw</strong></paragraph></listItem></list>",
    );
  });

  test("and three lists deep exactly as at the margin", () => {
    expect(written("- a\n  - b\n    1. **c and `d")).toContain(
      "<list ordered from 1><listItem><paragraph><strong>c and <inlineCode>d</inlineCode></strong></paragraph></listItem></list>",
    );
  });

  test("a line that is so far only its mark is held back", () => {
    for (const start of ["-", "- ", "*", "+", "1", "1.", "1. ", "  -", "  2."])
      expect(written(`- one\n${start}`), start).toBe(read("- one"));
  });

  test("a task is held until it has a word, so its box is never brackets", () => {
    for (const start of [
      "- [",
      "- [x",
      "- [x]",
      "- [x] ",
      "- [ ] `",
      "- [x] *",
    ])
      expect(written(`- one\n${start}`), start).toBe(read("- one"));
    expect(written("- one\n- [x] d")).toBe(
      "<list><listItem><paragraph>one</paragraph></listItem><listItem ticked><paragraph>d</paragraph></listItem></list>",
    );
  });
});

describe("a block's own mark, half written", () => {
  test("the start of a mark is held back until it is one", () => {
    for (const start of ["#", "##", "#### ", "-", "*", "1", "1.", ">", "> #"])
      expect(written(`Before.\n\n${start}`), start).toBe(read("Before."));
    for (const start of ["`", "``", "|", "---", "***", "- - "])
      expect(written(`Before.\n\n${start}`), start).toBe(read("Before."));
  });

  test("a heading's marks are closed like a paragraph's", () => {
    expect(written("## The **fo")).toBe(
      "<heading2>The <strong>fo</strong></heading>",
    );
  });

  test("a quote's are too, over the lines it runs", () => {
    expect(written("> a quoted **line\n> goes o")).toBe(
      "<blockquote><paragraph>a quoted <strong>line\ngoes o</strong></paragraph></blockquote>",
    );
  });
});

describe("a fence, half written", () => {
  test("reads as code to the end, without the fence it is closing on", () => {
    const code = "<code ts>const a = 1;</code>";
    for (const close of ["", "\n", "\n`", "\n``", "\n```"])
      expect(written(`\`\`\`ts\nconst a = 1;${close}`), close).toBe(code);
    expect(written("~~~\ncode\n~~")).toBe("<code>code</code>");
  });

  test("names its language once the line that says it is whole", () => {
    for (const start of ["```", "```t", "```ts"])
      expect(written(`Code:\n\n${start}`), start).toBe(
        "<paragraph>Code:</paragraph><code></code>",
      );
    expect(written("Code:\n\n```ts\n")).toBe(
      "<paragraph>Code:</paragraph><code ts></code>",
    );
  });

  test("marks inside it are code and are left alone", () => {
    expect(written("```\na **b and [c")).toBe("<code>a **b and [c</code>");
  });

  test("inside a listed line it is that line's", () => {
    expect(written("1. step\n\n   ```sh\n   npm c")).toBe(
      "<list ordered from 1><listItem><paragraph>step</paragraph><code sh>npm c</code></listItem></list>",
    );
  });
});

describe("a table, half written", () => {
  const head =
    "<tableRow><tableCell>Ticket</tableCell><tableCell>State</tableCell></tableRow>";

  test("a header is a table from its first cell", () => {
    expect(written("| Ticket")).toBe(
      "<table none><tableRow><tableCell>Ticket</tableCell></tableRow></table>",
    );
    expect(written("| Ticket | State |")).toBe(
      `<table none,none>${head}</table>`,
    );
  });

  test("a cell that opens on a mark is held until it has a word, and the table stands", () => {
    const one =
      "<table none><tableRow><tableCell>Option</tableCell></tableRow></table>";
    for (const mark of ["*", "**", "***", "`", "~~", "[", "\\"])
      expect(written(`| Option | ${mark}`), mark).toBe(one);
    expect(written("| Option | **V")).toBe(
      "<table none,none><tableRow><tableCell>Option</tableCell><tableCell><strong>V</strong></tableCell></tableRow></table>",
    );
  });

  test("a header is a table at every moment it grows, whatever its cells open with", () => {
    for (const header of [
      "| Option | **Verdict** |",
      "| `code` | *why* | ~~not~~ | [link](https://a.test) | _n_ |",
      "| a \\| b | [[ticket:4]] | <https://a.test> | 2**10 |",
    ])
      for (const prefix of prefixes(header).slice(3))
        expect(written(prefix), prefix).toMatch(
          prefix.length < 5 ? /^(?:$|<table )/u : /^<table [a-z,]+><tableRow>/u,
        );
  });

  test("the header stands while the row under it is written", () => {
    for (const under of ["", "|", "| ", "|:", "| --", "| --- |", "| --- | :"])
      expect(written(`| Ticket | State |\n${under}`), under).toBe(
        `<table none,none>${head}</table>`,
      );
    expect(written("| Ticket | State |\n| --- | --: |\n")).toBe(
      `<table none,right>${head}</table>`,
    );
  });

  test("a row is drawn as it is written, its marks closed", () => {
    expect(written("| Ticket | State |\n| --- | --- |\n| 41 | **Bl")).toBe(
      `<table none,none>${head}<tableRow><tableCell>41</tableCell><tableCell><strong>Bl</strong></tableCell></tableRow></table>`,
    );
  });

  test("under a paragraph's own line it is the table the grammar reads there", () => {
    expect(written("The shape:\n| a | b")).toBe(
      "<paragraph>The shape:</paragraph><table none,none><tableRow><tableCell>a</tableCell><tableCell>b</tableCell></tableRow></table>",
    );
  });

  test("inside a listed line it is that line's", () => {
    expect(written("- item\n\n  | a | b")).toBe(
      "<list><listItem><paragraph>item</paragraph><table none,none><tableRow><tableCell>a</tableCell><tableCell>b</tableCell></tableRow></table></listItem></list>",
    );
  });
});

/** Texts written to break the writing: marks that are not marks, marks inside
 * each other, and blocks inside blocks. */
const hostile: Readonly<Record<string, string>> = {
  linked: "See [the brief](https://example.com/brief) for the rest.",
  nested: "Pass `[[1, 2], [3, 4]]` and [[ticket:40]] to it.",
  snake: "Set my_var_name and _private_thing and __init__ here.",
  marks: "This is **bold and *nested* text** then *it* ends.",
  hash: "Use C# and #1 priority\n#hashtag here",
  table: "Here:\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\nAfter the table.",
  fence: "Code:\n\n```ts\nconst a = `x`;\nconst b = a * 2;\n```\n\nDone.",
  tildes: "~~~\ncode *here*\n~~~\nafter",
  ticks: "Use ``double `tick` code`` and `single` here.",
  quote: "> a quoted **line\n> goes on** here",
  dash: "Total\n-\nmore\n---\nrule",
  emoji: "Done 🎉 and 👩‍👩‍👧 family and é combining é.",
  address: "[wiki](https://en.wikipedia.org/wiki/A_(b)) end",
  entity: "AT&T and a &amp; b &lt; c.",
  strike: "This is ~~gone~~ and ~5 stays.",
  listed: "- item\n\n  | a | b |\n  | - | - |\n  | 1 | *2* |\n",
  task: "- [x] done\n- [ ] todo\n- [link](https://a.test) item",
  stepped: "1. step\n\n   ```sh\n   npm ci\n   ```\n\n2. next",
  header:
    "| Option | **Verdict** | `x` |\n| --- | --- | --- |\n| A | **take it** | y |\n\nAfter.",
  power: "So 2**10 is 1024 and 3*4 is a product, **not** bold.",
  mail: "Write to <someone@example.com> or <https://example.test/a> today.",
  returns: "# Title\rThe answer\r\ngoes on.\r\r- one\r- two\r\rEnd.",
};

/** Every prefix of a text as it is drawn, with the one before it. */
function moments(
  text: string,
  stride: number,
  each: (before: Drawn, now: Drawn, bones: readonly string[]) => void,
): void {
  let before: Drawn = { characters: "", marks: "" };
  for (const prefix of prefixes(text, stride)) {
    const blocks = blocksWritten(prefix);
    const now = drawn(blocks);
    each(before, now, skeleton(blocks));
    before = now;
  }
}

describe("every moment of an answer", () => {
  test.each(Object.keys(corpusAnswers))(
    "%s: whole, it reads as itself",
    (name) => {
      const text = corpusAnswers[name] ?? "";
      expect(written(text)).toBe(read(text));
    },
  );

  test.each(Object.keys(corpusAnswers))(
    "%s: no block turns into another, and nothing drawn is taken back",
    (name) => {
      const text = corpusAnswers[name] ?? "";
      let held: readonly string[] = [];
      moments(text, name === "longLine" ? 23 : 1, (before, now, bones) => {
        expect(bones.slice(0, held.length)).toEqual(held);
        expect(now.characters.startsWith(before.characters)).toBe(true);
        expect(now.marks.startsWith(before.marks)).toBe(true);
        held = bones;
      });
    },
  );

  test("read without the writing, the same answer takes back what it drew", () => {
    let before = "";
    const taken = prefixes(corpusReview).some((prefix) => {
      const now = drawn(markdownBlocksParsed(prefix) ?? []).characters;
      const back = !now.startsWith(before);
      before = now;
      return back;
    });
    expect(taken).toBe(true);
  });
});

describe("every moment of a text written to break it", () => {
  test.each(Object.keys(hostile))("%s", (name) => {
    const text = hostile[name] ?? "";
    let held: readonly string[] = [];
    moments(text, 1, (before, now, bones) => {
      expect(bones.slice(0, held.length)).toEqual(held);
      expect(within(before.characters, now.characters)).toBe(true);
      held = bones;
    });
  });

  test("a table with no pipe before it is a paragraph until its second row is whole", () => {
    expect(written("a | b\n--- | --")).toBe(paragraph("a | b"));
    expect(written("a | b\n--- | ---\n")).toBe(
      "<table none,none><tableRow><tableCell>a</tableCell><tableCell>b</tableCell></tableRow></table>",
    );
  });

  test("a piped line under words is drawn as a table, and is words again if no row follows", () => {
    expect(written("or a || b\n| not a table")).toContain("<table");
    expect(written("or a || b\n| not a table\nm")).toBe(
      paragraph("or a || b\n| not a table\nm"),
    );
  });
});
