/**
 * What a model's text reads into, whole: every construct a model writes as
 * the block or the mark it is, and the three places this reader departs from
 * the grammar on purpose — an underscore that is a name's own, a link nobody
 * could be sent down, and markup meant for a browser.
 *
 * A ticket named in the prose is not the grammar's to read. It stays the
 * characters it was written in, in one run, so the report can split it where
 * it draws words and nowhere else.
 */

import { describe, expect, test } from "vitest";

import { markdownBlocksParsed } from "../app/browser/ui/markdownTree.ts";
import {
  corpusEverything,
  corpusHowTo,
  corpusReview,
} from "./markdownCorpus.ts";
import { shape, skeleton } from "./markdownShape.ts";

function read(text: string): string {
  const blocks = markdownBlocksParsed(text);
  if (blocks === undefined) throw new Error("the text was not read");
  return shape(blocks);
}

function bones(text: string): readonly string[] {
  return skeleton(markdownBlocksParsed(text) ?? []);
}

describe("paragraphs and the marks inside them", () => {
  test("a paragraph keeps every line break it was written with", () => {
    expect(read("first line\nsecond line\nthird line")).toBe(
      "<paragraph>first line\nsecond line\nthird line</paragraph>",
    );
  });

  test("a blank line ends one paragraph and opens the next", () => {
    expect(read("the tests pass\n\nno further action is needed")).toBe(
      "<paragraph>the tests pass</paragraph><paragraph>no further action is needed</paragraph>",
    );
  });

  test("bold, italic, inline code and a link read as their own marks", () => {
    expect(
      read(
        "**bold** and *italic* and `code` and [a link](https://example.com)",
      ),
    ).toBe(
      "<paragraph><strong>bold</strong> and <emphasis>italic</emphasis> and <inlineCode>code</inlineCode> and <link https://example.com>a link</link></paragraph>",
    );
  });

  test("a mark holds another mark", () => {
    const everything = read(corpusEverything);
    for (const held of [
      "<emphasis><strong>bold italic</strong></emphasis>",
      "<strong>bold holding <inlineCode>code</inlineCode></strong>",
      "<strong>bold holding <link https://example.test/a>a link</link></strong>",
      "<link https://example.test/b><inlineCode>code</inlineCode> in a link</link>",
      "<delete>struck</delete>",
      "<inlineCode>code holding a ` backtick</inlineCode>",
      "an escaped *star*",
    ])
      expect(everything).toContain(held);
  });

  test("one tilde strikes nothing", () => {
    expect(read("about ~5 and ~6 of them")).toBe(
      "<paragraph>about ~5 and ~6 of them</paragraph>",
    );
  });

  test("an address written bare is a link to it", () => {
    expect(read("More at https://example.test/gates.")).toBe(
      "<paragraph>More at <link https://example.test/gates>https://example.test/gates</link>.</paragraph>",
    );
  });
});

describe("an underscore", () => {
  test("inside a name is the name's own", () => {
    for (const names of [
      "count_vowels in tally/__init__.py calls _parse_line with type_ and id_",
      "__init__.py and type_",
      "_private beside __init__",
      "x2_y_",
      "_tmp_1",
      "café_x_",
      "_x_é",
      "__bold__ is not, and neither is _one_two_",
    ])
      expect(read(names)).toBe(`<paragraph>${names}</paragraph>`);
  });

  test("marks as one pair around words holding none", () => {
    expect(read("an _italic_ word")).toBe(
      "<paragraph>an <emphasis>italic</emphasis> word</paragraph>",
    );
    expect(read("(_x_) and _two words_.")).toBe(
      "<paragraph>(<emphasis>x</emphasis>) and <emphasis>two words</emphasis>.</paragraph>",
    );
  });
});

describe("a link", () => {
  test("to somewhere a member could be sent is a link", () => {
    for (const address of [
      "https://example.test/a",
      "http://example.test/a",
      "HTTPS://EXAMPLE.TEST/A",
      "mailto:someone@example.test",
    ])
      expect(read(`[go](${address})`)).toBe(
        `<paragraph><link ${address}>go</link></paragraph>`,
      );
  });

  test("to anywhere else is the words it wore", () => {
    for (const address of [
      "javascript:alert(1)",
      "./console/BRIEF.md",
      "/acme/atlas",
      "#heading",
      "data:text/html,x",
      "vbscript:x",
      " javascript:alert(1)",
    ])
      expect(read(`see [the **brief**](${address}) first`)).toBe(
        "<paragraph>see the <strong>brief</strong> first</paragraph>",
      );
  });

  test("written between angle brackets to nowhere is what was written", () => {
    expect(read("call <javascript:alert(1)> now")).toBe(
      "<paragraph>call <javascript:alert(1)> now</paragraph>",
    );
    expect(read("call <https://example.test/a_b> now")).toBe(
      "<paragraph>call <link https://example.test/a_b>https://example.test/a_b</link> now</paragraph>",
    );
  });

  test("a picture is a link wearing its description, and never fetched", () => {
    expect(read("![a chart](https://example.test/a.png) above")).toBe(
      "<paragraph><link https://example.test/a.png>a chart</link> above</paragraph>",
    );
    expect(read("![a chart](javascript:alert(1)) above")).toBe(
      "<paragraph>a chart above</paragraph>",
    );
  });

  test("is never made by a line that defines one somewhere else", () => {
    expect(
      read("see [the brief] and a note[^1]\n\n[the brief]: /brief\n\n[^1]: it"),
    ).toBe(
      "<paragraph>see [the brief] and a note[^1]</paragraph><paragraph>[the brief]: /brief</paragraph><paragraph>[^1]: it</paragraph>",
    );
  });
});

describe("markup meant for a browser", () => {
  test("is the characters it is, in a line and on its own", () => {
    expect(read("a <b>bold</b> <script>alert(1)</script> tag")).toBe(
      "<paragraph>a <b>bold</b> <script>alert(1)</script> tag</paragraph>",
    );
    expect(read("<div>\n\n<img src=x onerror=alert(1)>\n\n</div>")).toBe(
      "<paragraph><div></paragraph><paragraph><img src=x onerror=alert(1)></paragraph><paragraph></div></paragraph>",
    );
  });
});

describe("headings, rules and quotes", () => {
  test("a heading is read at the level it was written", () => {
    expect(read("# One\n## Two\n### Three\n#### Four")).toBe(
      "<heading1>One</heading><heading2>Two</heading><heading3>Three</heading><heading4>Four</heading>",
    );
  });

  test("a line of marks under words is a rule or nothing, never their heading", () => {
    expect(read("Total\n===")).toBe("<paragraph>Total\n===</paragraph>");
    expect(read("Total\n---\nnext")).toBe(
      "<paragraph>Total</paragraph><rule><paragraph>next</paragraph>",
    );
  });

  test("a quote holds paragraphs and lists", () => {
    expect(read("> A quote.\n>\n> - and a list\n> - of two")).toBe(
      "<blockquote><paragraph>A quote.</paragraph><list><listItem><paragraph>and a list</paragraph></listItem><listItem><paragraph>of two</paragraph></listItem></list></blockquote>",
    );
  });

  test("a heading and a list, and a list and a quote, need no blank line between", () => {
    expect(read("## Summary\n- one\n- two")).toBe(
      "<heading2>Summary</heading><list><listItem><paragraph>one</paragraph></listItem><listItem><paragraph>two</paragraph></listItem></list>",
    );
    expect(read("1. first\n2. second\n> a quoted line")).toBe(
      "<list ordered from 1><listItem><paragraph>first</paragraph></listItem><listItem><paragraph>second</paragraph></listItem></list><blockquote><paragraph>a quoted line</paragraph></blockquote>",
    );
  });
});

describe("lists", () => {
  test("nest three deep, bullets and numbers mixed", () => {
    const review = bones(corpusReview).join("|");
    expect(review).toContain(
      "0 list|1 listItem|2 paragraph|2 list|3 listItem|4 paragraph|3 listItem|4 paragraph|4 list|5 listItem|6 paragraph|5 listItem|6 paragraph",
    );
  });

  test("a line holds a second paragraph and a block of code", () => {
    expect(read(corpusReview)).toContain(
      "<listItem><paragraph><strong>The retry never backs off.</strong> Each failure reconnects at once.</paragraph><paragraph>It should wait, and it should give up:</paragraph><code ts>const waitMilliseconds = Math.min(\n  retryBaseMilliseconds * 2 ** attempt,\n  retryCeilingMilliseconds,\n);</code></listItem>",
    );
  });

  test("a line goes on over the lines under it", () => {
    expect(read(corpusEverything)).toContain(
      "<listItem><paragraph>one\ncontinued on a second line</paragraph></listItem>",
    );
  });

  test("a numbered list starts where it says", () => {
    expect(read("7. starts at seven\n8. goes on")).toBe(
      "<list ordered from 7><listItem><paragraph>starts at seven</paragraph></listItem><listItem><paragraph>goes on</paragraph></listItem></list>",
    );
    expect(read(corpusHowTo)).toContain("<list ordered from 3>");
  });

  test("a task is ticked or not", () => {
    expect(read("- [x] done\n- [ ] todo\n- [link](https://a.test) item")).toBe(
      "<list><listItem ticked><paragraph>done</paragraph></listItem><listItem unticked><paragraph>todo</paragraph></listItem><listItem><paragraph><link https://a.test>link</link> item</paragraph></listItem></list>",
    );
  });
});

describe("code", () => {
  test("a fence keeps its body as written, no mark in it read", () => {
    expect(read("```\nconst x = 1;\n**not bold**\n```")).toBe(
      "<code>const x = 1;\n**not bold**</code>",
    );
  });

  test("a fence nothing closes is code to the end", () => {
    expect(read("```\nunterminated")).toBe("<code>unterminated</code>");
  });

  test("a fence names its language, in backticks or tildes", () => {
    expect(read("```python\nprint(1)\n```")).toBe(
      "<code python>print(1)</code>",
    );
    expect(read("~~~sh\njust hooks\n~~~")).toBe("<code sh>just hooks</code>");
  });

  test("a longer fence holds a shorter one", () => {
    expect(read("````markdown\n```sh\njust check\n```\n````")).toBe(
      "<code markdown>```sh\njust check\n```</code>",
    );
  });

  test("a fence inside a listed line loses the line's indent and no more", () => {
    expect(read("1. step\n\n   ```sh\n   npm ci\n     --offline\n   ```")).toBe(
      "<list ordered from 1><listItem><paragraph>step</paragraph><code sh>npm ci\n  --offline</code></listItem></list>",
    );
  });
});

describe("a table", () => {
  test("is read with the marks its cells carry", () => {
    expect(read("| Name | Note |\n| --- | --- |\n| **a** | `b` |")).toBe(
      "<table none,none><tableRow><tableCell>Name</tableCell><tableCell>Note</tableCell></tableRow><tableRow><tableCell><strong>a</strong></tableCell><tableCell><inlineCode>b</inlineCode></tableCell></tableRow></table>",
    );
  });

  test("says which side each column is set to", () => {
    expect(read("| L | C | R |\n| :-- | :-: | --: |\n| a | b | c |")).toContain(
      "<table left,center,right>",
    );
  });

  test("needs the row under its header", () => {
    expect(read("| A | B |\n| 1 | 2 |")).toBe(
      "<paragraph>| A | B |\n| 1 | 2 |</paragraph>",
    );
  });
});

describe("a ticket named in the prose", () => {
  test("stays the characters it was written in, in one run", () => {
    expect(read("filed [[ticket:15]] for it")).toBe(
      "<paragraph>filed [[ticket:15]] for it</paragraph>",
    );
    expect(read("- closed **[[ Ticket : 15 ]]**")).toBe(
      "<list><listItem><paragraph>closed <strong>[[ Ticket : 15 ]]</strong></paragraph></listItem></list>",
    );
  });

  test("inside code is the code", () => {
    expect(read("write `[[ticket:15]]` to name it")).toBe(
      "<paragraph>write <inlineCode>[[ticket:15]]</inlineCode> to name it</paragraph>",
    );
  });
});
