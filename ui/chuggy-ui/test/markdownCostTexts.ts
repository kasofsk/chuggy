/**
 * Texts for the suite that holds the report to what reading one may cost.
 *
 * Three kinds, each written out as the unit it repeats: the texts that made
 * the parser look back from every mark or read a line once for everything it
 * is nested in, which is what a text built to stall a reader looks like;
 * ordinary texts of the same size, which are what the cost of those is held
 * against; and texts dear enough to come close to what `markdownGuard.ts`
 * allows and still be read.
 */

/** The size every text here is made to: the most of a text that is read. */
export const costChars = 65_536;

/** A unit repeated to a size, the last one cut where the size is reached. */
export function costFill(unit: string, chars = costChars): string {
  return unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
}

/** Runs of one more code mark each time, so no two are a pair. */
function ticksDistinct(): string {
  let text = "";
  for (let width = 1; text.length < costChars; width += 1)
    text += `${"`".repeat(width)}a`;
  return text.slice(0, costChars);
}

/** Runs of one fewer code mark each time, the widest first. */
function ticksNarrowing(): string {
  let text = "";
  for (let width = 360; width > 0; width -= 1) text += `${"`".repeat(width)}a`;
  return text;
}

/** A list whose every item is indented under the one before it. */
function listDeep(): string {
  let text = "";
  for (let depth = 0; text.length < costChars; depth += 1)
    text += `${" ".repeat(depth * 2)}- a\n`;
  return text.slice(0, costChars);
}

const half = costChars / 2;

/** Marks that make the parser look back: emphasis, code and escapes. */
const hostileMarks: Readonly<Record<string, string>> = {
  stars: costFill("*"),
  "stars apart": costFill("* "),
  "star then word": costFill("*a "),
  "word then star": costFill("a*"),
  "stars in words": costFill("a**b "),
  "star and underscore": costFill("*a_ "),
  "openers then closers": `${"*a ".repeat(10_922)}${"a* ".repeat(10_922)}`,
  "strong openers then closers": `${"a**b ".repeat(6_553)}${"c*d ".repeat(8_192)}`,
  "a hundred stars a side": `${"*".repeat(100)}a${"*".repeat(100)}`,
  underscores: costFill("_"),
  "underscore then word": costFill("_a "),
  "emphasis in words": costFill("a*b*c_d_e "),
  "emphasis of every kind": costFill("*a* _b_ **c** __d__ "),
  "paragraphs of word then star": costFill(`${"a*".repeat(8_190)}\n\n`),
  tildes: costFill("~"),
  "tilde pairs": costFill("~~a "),
  strikes: costFill("~~a~~"),
  ticks: costFill("`"),
  "ticks apart": costFill("` "),
  "ticks of every width": ticksDistinct(),
  "ticks of every width, widest first": ticksNarrowing(),
  "a tick then ticks": `\`a${"`".repeat(costChars)}b`,
  backslashes: costFill("\\"),
  "escaped stars": costFill("\\*"),
  entities: costFill("&amp;"),
  "half entities": costFill("&a"),
  "numbered entities": costFill("&#x41;"),
  ampersands: costFill("&"),
};

/** Brackets, links and addresses. */
const hostileLinks: Readonly<Record<string, string>> = {
  "open brackets": costFill("["),
  "close brackets": costFill("]"),
  "bracket pairs": costFill("[a]"),
  "link openings": costFill("]("),
  "link halves": costFill("[a]("),
  "brackets nested": `${"[".repeat(half)}${"]".repeat(half)}`,
  "brackets nested then links": `${"[".repeat(half)}a${"](x)".repeat(8_192)}`,
  "picture openings": costFill("!["),
  "footnote calls": costFill("[^a]"),
  "reference links": costFill("[a][b]"),
  definitions: costFill("[a]: b\n"),
  "titles never closed": costFill('[a](b "c'),
  angles: costFill("<"),
  "angle schemes": costFill("<a:"),
  "angle emails": costFill("<a@"),
  tags: costFill("<div>"),
  comments: costFill("<!--"),
  "character data": costFill("<![CDATA["),
  "an address of dots": `https://a${".".repeat(costChars)}a`,
  "an address of open parentheses": `https://a${"(".repeat(costChars)}`,
  "an address of close parentheses": `https://a${")".repeat(costChars)}`,
  "an address of entities": `https://a${costFill("&a;")}`,
  "addresses the grammar does not take": costFill("hwww."),
  "www addresses": costFill("www.a.b "),
  "one www address": `www.${costFill("a.")}`,
  emails: costFill("a@b.c "),
  "one long email": `${costFill("a.")}@${costFill("b.", 1_000)}c`,
  "email halves": costFill("a@"),
};

/** Quotes, lists, tables and lines. */
const hostileBlocks: Readonly<Record<string, string>> = {
  quotes: costFill(">"),
  "quotes apart": costFill("> "),
  "quotes five hundred deep": `${">".repeat(500)} a\n`.repeat(130),
  "a quote then lines it may carry": `> a\n${costFill("b\n")}`,
  "quotes and lists in one line": costFill("> - > - "),
  "quotes and lists in every line": costFill("> - > - a\n"),
  dashes: costFill("-"),
  "list marks": costFill("- "),
  "a list indented ever deeper": listDeep(),
  "a list of one letter": costFill("- a\n"),
  "a spaced list of one letter": costFill("- a\n\n"),
  "a numbered list of one letter": costFill("1. a\n"),
  "tasks of one letter": costFill("- [x] a\n"),
  "headings of one letter": costFill("# a\n"),
  hashes: costFill("#"),
  pipes: costFill("|"),
  "rows with no header": costFill("|a|b|\n"),
  "a table of one wide row": `|${"a|".repeat(8_000)}\n|${"-|".repeat(8_000)}\n|${"c|".repeat(8_000)}\n`,
  "a table of wide rows": `|${"a|".repeat(3_000)}\n|${"-|".repeat(3_000)}\n${`|${"c|".repeat(3_000)}\n`.repeat(8)}`,
  "a table of ten thousand rows": `|a|b|\n|-|-|\n${"|c|d|\n".repeat(10_000)}`,
  "one line of one letter": "x".repeat(costChars),
  "lines of one letter": costFill("a\n"),
  "lines ended twice": costFill("a\r\n"),
  "indented lines": costFill("    a\n"),
  tabs: costFill("\t"),
  spaces: costFill(" "),
  "line ends": costFill("\n"),
  "a fence of code never closed": `\`\`\`ts\n${costFill("const a = 1;\n")}`,
  "a fence of one line never closed": `\`\`\`\n${"x".repeat(costChars)}`,
  "a fence indented, then marks": ` \`\`\`\n\`\`\`\n${costFill("a*")}`,
};

const mark = "\uFEFF";

/** A character the parser drops where a text opens, and the marks after it. */
const hostileOpened: Readonly<Record<string, string>> = {
  "a byte order mark then list marks": `${mark}${"- ".repeat(8_000)}a`,
  "a byte order mark then stars": `${mark}${"* ".repeat(8_000)}a`,
  "a byte order mark then numbers": `${mark}${"1. ".repeat(5_333)}a`,
  "a byte order mark then quoted list marks": `${mark}${"> - ".repeat(4_000)}a`,
  "a byte order mark then list marks, after a fence": `\`\`\`\ncode\n\`\`\`\n${mark}${"- ".repeat(8_000)}a`,
  "a byte order mark then list marks, after words": `Some words.\n\n${mark}${"- ".repeat(8_000)}a`,
  "four sections that each open with a byte order mark":
    `${mark}${"- ".repeat(8_000)}a\n\n`.repeat(4),
  "a byte order mark on every line": costFill(`${mark}- a\n`),
};

/** A word that holds an address, written or made by an escape or a
 * reference, and then what an address may be cut back over. */
const hostileTrails: Readonly<Record<string, string>> = {
  "addresses after a colon, then braces": ` :www.a.b/${"}".repeat(16_360)}x\n\n`
    .repeat(4)
    .slice(0, costChars),
  "an address after a colon, then braces": `:www.a.b/${"}".repeat(16_370)}x`,
  "an address of a dot, then braces": `http://.${"}".repeat(16_370)}x`,
  "an address after a letter, then marks": `xhttp://a/${"!".repeat(16_370)}x`,
  "an address an escape writes, then braces": `www\\.a.b/${"}".repeat(16_360)}x`,
  "an address a reference writes, then braces": `&#119;ww.a.b/${"}".repeat(16_360)}x`,
  "addresses and braces as far as they are read": costFill(
    `:www.a.b/${"}".repeat(7_600)}x\n\n`,
  ),
  "braces and an escaped one": costFill("}}}\\}"),
  "braces then a reference": costFill(`${"}".repeat(100)}&gt;`),
  "names then an escaped dot": costFill(`${"a.".repeat(50)}\\.`),
  "a word then dots": `words${".".repeat(16_370)}x`,
  "addresses escapes write, then a mark": `${"www\\.".repeat(3_275)}_`,
  "addresses escapes write, as far as they are read": costFill(
    `${"www\\.".repeat(1_249)}_\n\n`,
  ),
};

/** Lines that open with as many quote and list marks as a line may. */
const hostileOpenings: Readonly<Record<string, string>> = {
  "sixteen list marks a line": costFill(`${"- ".repeat(16)}a\n`),
  "fifteen numbers a line": costFill(`${"1) ".repeat(15)}a b\n`),
  "fifteen list marks and a reference a line": costFill(
    `${"+ ".repeat(15)}&amp;\n`,
  ),
  "sixteen quote marks a line": costFill(`${"> ".repeat(16)}a\n`),
  "quote and list marks, sixteen a line": costFill(`${"> - ".repeat(8)}a\n`),
  "list and quote marks, sixteen a line": costFill(`${"- > ".repeat(8)}a\n`),
  "a list mark then fifteen quote marks a line": costFill(
    `- ${"> ".repeat(15)}a\n`,
  ),
  "eight quote marks then eight list marks a line": costFill(
    `${"> ".repeat(8)}${"- ".repeat(8)}a\n`,
  ),
  "sixteen quote marks a line, each closed by a list mark": costFill(
    `${"> ".repeat(16)}a\n- b\n`,
  ),
  "sixteen quote marks a line, a blank line apart": costFill(
    `${"> ".repeat(16)}a\n\n`,
  ),
  "eight list marks a line": costFill(`${"- ".repeat(8)}a\n`),
};

/** Code fenced under a list item or in a quote, and what it is made of. */
const hostileFenced: Readonly<Record<string, string>> = {
  "a fence under an item, of marks": `1. a\n\n   \`\`\`\n${costFill("   a* b* [c](d `e\n", 60_000)}   \`\`\`\n`,
  "a fence under an item, never closed": `- a\n  \`\`\`\n${costFill("  *a* `b` [c](\n")}`,
  "a fence under an item, of one line": `- a\n  \`\`\`\n  ${"a*".repeat(30_000)}`,
  "a fence in a quote, never closed": `> \`\`\`\n${costFill("> a*\n")}`,
  "a fence in a quote, of blank lines": `> \`\`\`\n${costFill(">\n")}`,
  "fences under items, one after another": costFill(
    "- a\n  ```\n  b*\n  ```\n",
  ),
  "fences under items, each of blank lines": costFill(
    `1. a\n\n   \`\`\`\n${"\n".repeat(40)}   \`\`\`\n\n`,
  ),
  "a fence sixteen marks deep": `${"- ".repeat(15)}\`\`\`\n${costFill(`${" ".repeat(30)}a*\n`)}`,
  "fences opened under an item and never closed": costFill(
    "- a\n  ```\n- b\n  ~~~\n",
  ),
};

/** A list of so many items, each under the one before it, and the blank a
 * line under the last of them opens with. */
export function costNested(depth: number, mark = "- "): string {
  let text = "";
  for (let at = 0; at < depth; at += 1)
    text += `${costSunk(at, mark)}${mark}a\n`;
  return text;
}

export function costSunk(depth: number, mark = "- "): string {
  return " ".repeat(mark.length * depth);
}

/** What list items nested deep may be left holding, a count of each at a
 * depth: blank lines, blank lines of spaces, and lines a blank line apart. */
function heldBlank(depth: number, lines: number, mark = "- "): string {
  const under = costSunk(depth, mark);
  return `${costNested(depth, mark)}${"\n".repeat(lines)}${under}b\n`;
}

function heldSpaces(depth: number, lines: number): string {
  const under = costSunk(depth);
  return `${costNested(depth)}${`${under}\n`.repeat(lines)}${under}b\n`;
}

function heldApart(depth: number, lines: number): string {
  return `${costNested(depth)}${`\n${costSunk(depth)}b\n`.repeat(lines)}`;
}

/** List items nested deep, and what they are then left holding. */
const hostileDeep: Readonly<Record<string, string>> = {
  "items four deep, then blank lines": heldBlank(4, 14_000),
  "items sixteen deep, then blank lines": heldBlank(16, 14_000),
  "items sixty deep, then blank lines": heldBlank(60, 14_000),
  "items a hundred deep, then blank lines": heldBlank(100, 13_000),
  "numbered items sixty deep, then blank lines": heldBlank(60, 14_000, "1. "),
  "items sixteen deep, then blank lines of spaces": heldSpaces(16, 1_900),
  "items sixty deep, then blank lines of spaces": heldSpaces(60, 500),
  "items a hundred deep, then blank lines of spaces": heldSpaces(100, 270),
  "items sixty deep, then lines a blank line apart": heldApart(60, 80),
  "items a hundred deep, then lines a blank line apart": heldApart(100, 48),
  "items a hundred deep": costNested(100),
  "items a hundred and twenty deep": costNested(120),
};

/** The texts built to stall a reader, each by what it is made of. */
export const costHostile: Readonly<Record<string, string>> = {
  ...hostileMarks,
  ...hostileLinks,
  ...hostileBlocks,
  ...hostileOpened,
  ...hostileTrails,
  ...hostileOpenings,
  ...hostileFenced,
  ...hostileDeep,
};

const sentence =
  "The reader keeps what it has already read and only looks again at what is new, so the cost is the cost of the last block. ";
const item =
  "- **`src/contract/threadLive.ts`** — the fold drops a late frame, see [the fold](https://example.test/fold#L41)\n";
const nested =
  "- parent item with some words in it\n  - child item with `code` and **bold**\n    1. numbered grandchild one\n    2. numbered grandchild two\n";
const row =
  "| `server-sent events` | 35 ms | 180 ms | ~1 s | $0.55 | a proxy that does not buffer | *recommended* |\n";
const tableHead =
  "| Option | p50 | p99 | Cold | Cost | Burden | Verdict |\n| :-- | --: | --: | :-: | --: | :-- | :-- |\n";
const codeLine =
  "  const waitMilliseconds = Math.min(retryBaseMilliseconds * 2 ** attempt, retryCeilingMilliseconds);\n";
const step = `1. Run it, and read what it prints:\n\n   \`\`\`sh\n   npm ci --offline\n\n   just check\n   \`\`\`\n\n`;

/** Ordinary texts, as a model writes them, each all of one thing. */
export const costOrdinary: Readonly<Record<string, string>> = {
  words: costFill("word "),
  "words of a line": costFill("lorem ipsum dolor sit amet "),
  "one paragraph on one line": costFill(sentence),
  "one paragraph on wrapped lines": costFill(
    sentence.replace(/(.{60,70}) /gu, "$1\n"),
  ),
  "short paragraphs": costFill(`${sentence}\n\n`),
  "a list": costFill(item),
  "a nested list": costFill(nested),
  "a spaced numbered list": costFill(`1. ${sentence}\n\n`),
  "a quote": costFill(`> ${sentence}\n`),
  "one table": `${tableHead}${costFill(row)}`,
  "tables of a hundred rows": costFill(`${tableHead}${row.repeat(100)}\n`),
  "a fence of code": `\`\`\`ts\n${costFill(codeLine)}`,
  "a fence of code in no language": `\`\`\`\n${costFill(codeLine)}`,
  "words in brackets": costFill(
    "see items[0], items[1] and map[key] then [sic] ",
  ),
  "headings over paragraphs": costFill(`## A heading\n\n${sentence}\n\n`),
  "headings over words with no line between": costFill(
    `## A heading\n${sentence}\n`,
  ),
  "steps that each hold code": costFill(step),
  "one step holding a long block of code": `1. Run it:\n\n   \`\`\`ts\n${costFill(`   ${codeLine}\n`, 20_000)}   \`\`\`\n\nThen read what it printed.\n`,
  "a quote holding code": costFill(
    `> As the file has it:\n>\n> \`\`\`ts\n>${codeLine}> \`\`\`\n\n`,
  ),
  "steps after an indented block": `1. Do it\n\n   This step needs a word more.\n${Array.from({ length: 1_200 }, (_unused, at) => `${String(at + 2)}. step with **bold** words\n`).join("")}`,
};

/** Texts whose every run is dear to read, and is read. */
export const costDear: Readonly<Record<string, string>> = {
  "runs of emphasis": costFill(`${"*a* ".repeat(1_000).trimEnd()}\n\n`),
  "runs of links": costFill(`${"[a](https://b.c) ".repeat(120)}\n\n`),
  "runs of every mark": costFill(`${"`a` **b** _c_ ~~d~~ ".repeat(100)}\n\n`),
  "runs of addresses": costFill(
    `${"https://a.b/c?d=e&f=g www.h.i j@k.l ".repeat(50)}\n\n`,
  ),
  "runs of escapes": costFill(`${"\\* \\_ \\` &amp; &#x41; ".repeat(90)}\n\n`),
  "tables of narrow rows": costFill(
    `| a | b | c |\n| - | - | - |\n${"| d | e | f |\n".repeat(150)}\n`,
  ),
  "quotes three deep": costFill(`${"> > > a quoted line\n".repeat(60)}\n`),
  "lists four deep": costFill(
    `${"- a\n  - b\n    - c\n      - d\n".repeat(30)}\n`,
  ),
  "items of two paragraphs": costFill("1. a\n\n   b\n\n"),
  "tasks holding links and code": costFill(
    `${"- [ ] a [b](https://c.d) `e`\n".repeat(80)}\n`,
  ),
};

/** Every text here, by what it is made of. */
export const costTexts: Readonly<Record<string, string>> = {
  ...costHostile,
  ...costOrdinary,
  ...costDear,
};

/** What a paragraph, a heading or a cell may end in while it is written: the
 * words the writing scan is handed, each as the unit it repeats. */
export const costWords: Readonly<Record<string, string>> = {
  "an address of dots": "see https://a...................................",
  commas: ",",
  ticks: "`",
  "tick pairs": "`a ",
  spaces: " ",
  stars: "*",
  "star then word": "*a ",
  "word then star": "a* ",
  "stars in words": "a*b",
  "strong openings": "**a ",
  "strike openings": "~~a ",
  "strike and star openings": "~~*a ",
  backslashes: "\\",
  tildes: "~",
  underscores: "_",
  "underscore then word": "_a ",
  "open brackets": "[",
  "open brackets in twos": "[[a ",
  "bracket then word": "[a ",
  "bracket pairs": "[a]",
  "picture openings": "![",
  "link halves": "[a](",
  "close brackets": "]",
  "close parentheses": ")",
  pipes: "|",
  angles: "<",
  "angle then name": "<a ",
  "angle emails": "<a@",
  ampersands: "&",
  "half entities": "&a",
  words: "word ",
  "letters an address begins with": "h w ",
  "addresses the grammar does not take": "hwww.",
  "www addresses": "www.a.b ",
  addresses: "http://a ",
  "addresses and what may end one": "http://a.,:*_~?! ",
  lines: "a\n",
  "letters that are not ASCII": "é ü* ",
};
