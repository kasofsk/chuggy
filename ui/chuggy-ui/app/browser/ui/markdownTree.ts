/**
 * A model's text read into the blocks it is written as: CommonMark with the
 * tables, strikethrough, task items and bare links of GFM, by a maintained
 * parser rather than a reader of this console's own.
 *
 * NOTHING IN THE TEXT IS MARKUP FOR THE BROWSER. HTML is switched off in the
 * grammar, so a tag is the characters it is, and what comes out is a tree the
 * report draws as its own React elements.
 *
 * WHAT A LATER LINE COULD CHANGE ABOUT AN EARLIER BLOCK IS SWITCHED OFF TOO. A
 * reference definition, a footnote and a setext underline each reach back
 * over text already read, and with them gone a block another block follows is
 * final. That is what lets `markdownReading.ts` read a long answer one block at
 * a time while it is being written.
 *
 * AN UNDERSCORE IS A NAME'S OWN FAR MORE OFTEN THAN IT IS A MARK. The grammar
 * reads `__init__` as bold and `_parse_line with type_` as italic, and the
 * agents writing here name code in prose all day. So an underscore pair marks
 * only as a single pair around words that hold no underscore of their own, and
 * every other one is given back as the characters it was.
 *
 * A LINK GOES WHERE A MEMBER COULD BE SENT. An address that is not `http`,
 * `https` or `mailto` is no link: its words are drawn as words, and a picture
 * is drawn as a link wearing its description, never fetched.
 *
 * A LINK NOBODY IS SENT DOWN STILL SAYS WHERE IT POINTED. A repository path is
 * what a reader was being told, so the words are followed by the address as
 * code, unless the words are the address already.
 *
 * THE PARSER IS REACHED THROUGH TWO DOORS IN THIS FILE AND NO OTHER. Each
 * holds the text to `markdownGuard.ts` before the parser sees it, so nothing
 * that draws a model's text can hand the parser one it has not reckoned: a
 * section `markdownPieces.ts` would not have made is drawn as its characters,
 * and so is one the parser gives up on.
 *
 * AND THE PARSER READS THE CHARACTERS THE GUARD RECKONED. Before it reads a
 * text the parser rewrites three things in it: it drops a byte order mark the
 * text opens with, reads a NUL as U+FFFD, and ends a line at a carriage
 * return. `markdownNormalised` does all three first, to every such character
 * and not only the first, because a piece opens wherever a section ends; and
 * the doors turn away a text that still holds one. A tab is the fourth the
 * parser treats apart, and the guard reads it as the columns the parser does.
 * Every other character the parser sorts by what stands beside a mark, with
 * the two patterns `markdownGuard.ts` sorts by.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import type { Options } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

import { markdownWordsPass } from "./markdownGuard.ts";
import {
  markdownBlank,
  markdownBlankCut,
  markdownFenceRead,
  markdownPiecesFrom,
} from "./markdownPieces.ts";
import type { MarkdownFence, MarkdownPiece } from "./markdownPieces.ts";

/** The tree a text is read into, named from what the reader returns so that
 * the console names no package it does not bundle. */
type Root = ReturnType<typeof fromMarkdown>;

/** One block of a text as the grammar reads it. */
export type MarkdownBlock = Root["children"][number];

/** Anything the tree holds, at any depth. */
export type MarkdownNode = Root | MarkdownBlock;

/** The nodes of one kind, or of several. */
export type MarkdownNodeOf<Kind extends MarkdownNode["type"]> = Extract<
  MarkdownNode,
  { readonly type: Kind }
>;

/** A node that holds others. */
export type MarkdownParent = Extract<
  MarkdownNode,
  { readonly children: readonly unknown[] }
>;

/** One run inside a block. */
export type MarkdownInline = MarkdownNodeOf<"paragraph">["children"][number];

const markdownOptions: Options = {
  extensions: [
    gfm({ singleTilde: false }),
    {
      disable: {
        null: [
          "htmlFlow",
          "htmlText",
          "definition",
          "setextUnderline",
          "gfmFootnoteDefinition",
          "gfmFootnoteCall",
          "gfmPotentialFootnoteCall",
        ],
      },
    },
  ],
  mdastExtensions: [gfmFromMarkdown()],
};

/** The blocks a line of words is never read as: with these off, a line is one
 * paragraph whatever it opens with. */
const markdownLineOptions: Options = {
  extensions: [
    ...(markdownOptions.extensions ?? []),
    {
      disable: {
        null: [
          "blockQuote",
          "list",
          "codeFenced",
          "codeIndented",
          "headingAtx",
          "thematicBreak",
          "table",
        ],
      },
    },
  ],
  mdastExtensions: markdownOptions.mdastExtensions ?? [],
};

const markdownRewrittenPattern = /[\r\0\uFEFF]/u;
const markdownRewritePattern = /\r\n?|\0|\uFEFF/gu;

/** Whether a text holds a character the parser rewrites before it reads. */
function markdownRewritten(text: string): boolean {
  return markdownRewrittenPattern.test(text);
}

/**
 * A text as the parser reads it, which is the text the guard reckons: a
 * carriage return, alone or before a line feed, is a line's end, a NUL is
 * U+FFFD, and a byte order mark is gone wherever it stands.
 */
export function markdownNormalised(text: string): string {
  if (!markdownRewritten(text)) return text;
  return text.replace(markdownRewritePattern, (found) => {
    if (found === "\0") return "\uFFFD";
    return found === "\uFEFF" ? "" : "\n";
  });
}

const markdownLinkSchemePattern = /^(?:https?:\/\/|mailto:)/iu;

/** Whether an address is one a member could be sent to. */
export function markdownLinkFollowed(url: string): boolean {
  return markdownLinkSchemePattern.test(url);
}

function markdownTextNode(value: string): MarkdownNodeOf<"text"> {
  return { type: "text", value };
}

/** What the source held between two offsets of a node, which is how a mark is
 * given back as the characters it was written in. */
function markdownSourceOf(node: MarkdownNode, source: string): string {
  const position = node.position;
  if (position === undefined) return "";
  return source.slice(position.start.offset, position.end.offset);
}

/** An underscore pair given back as its characters around what it held, unless
 * it is one pair around words with no underscore of their own. */
function markdownUnderscoreKept(
  node: MarkdownNodeOf<"emphasis" | "strong">,
  source: string,
): readonly MarkdownInline[] {
  const written = markdownSourceOf(node, source);
  if (!written.startsWith("_")) return [node];
  const width = node.type === "strong" ? 2 : 1;
  if (width === 1 && !written.slice(1, -1).includes("_")) return [node];
  const mark = "_".repeat(width);
  return [markdownTextNode(mark), ...node.children, markdownTextNode(mark)];
}

/** Everything a run says, without the marks it says it in. */
function markdownWordsOf(nodes: readonly MarkdownNode[]): string {
  const pending: MarkdownNode[] = nodes.toReversed();
  const words: string[] = [];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ("value" in node) words.push(node.value);
    if ("children" in node) pending.push(...node.children.toReversed());
  }
  return words.join("");
}

/** The words a link wore and then where it pointed, as code, where that is
 * not what the words already say. */
function markdownAddressKept(
  words: readonly MarkdownInline[],
  url: string,
): readonly MarkdownInline[] {
  if (url === "" || markdownWordsOf(words) === url) return words;
  return [...words, markdownTextNode(" "), { type: "inlineCode", value: url }];
}

/**
 * A link as it is drawn. One nobody could follow is its words and its address
 * or, written between angle brackets, exactly what was written; one inside
 * another link is its words, because a link holds no link.
 */
function markdownLinkKept(
  node: MarkdownNodeOf<"link">,
  source: string,
  linked: boolean,
): readonly MarkdownInline[] {
  if (linked) return node.children;
  if (markdownLinkFollowed(node.url)) return [node];
  const written = markdownSourceOf(node, source);
  if (written.startsWith("<")) return [markdownTextNode(written)];
  return markdownAddressKept(node.children, node.url);
}

/** A picture as it is drawn: a link wearing its description and never
 * fetched, or inside a link the description alone. */
function markdownImageKept(
  node: MarkdownNodeOf<"image">,
  linked: boolean,
): readonly MarkdownInline[] {
  const described = node.alt ?? "";
  const words = markdownTextNode(described === "" ? node.url : described);
  if (linked) return [words];
  return markdownLinkFollowed(node.url)
    ? [{ type: "link", url: node.url, children: [words] }]
    : markdownAddressKept([words], node.url);
}

/** One node as the report draws it: itself, or what stands in its place.
 * `linked` says it is inside a link's words. */
function markdownChildKept(
  node: MarkdownNode,
  source: string,
  linked: boolean,
): readonly MarkdownNode[] {
  if (node.type === "emphasis" || node.type === "strong")
    return markdownUnderscoreKept(node, source);
  if (node.type === "link") return markdownLinkKept(node, source, linked);
  return node.type === "image" ? markdownImageKept(node, linked) : [node];
}

/** Every node under a node put through `markdownChildKept`, children before
 * their parents, with the words that leaves side by side joined into one. */
function markdownSettle(
  parent: MarkdownParent,
  source: string,
  linked: boolean,
): void {
  const children: MarkdownNode[] = [];
  const within = linked || parent.type === "link";
  for (const child of parent.children) {
    if ("children" in child) markdownSettle(child, source, within);
    for (const kept of markdownChildKept(child, source, within)) {
      const last = children.at(-1);
      if (kept.type === "text" && last?.type === "text")
        children[children.length - 1] = markdownTextNode(
          `${last.value}${kept.value}`,
        );
      else children.push(kept);
    }
  }
  (parent as { children: MarkdownNode[] }).children = children;
}

/**
 * Whether two nodes read the same: every field of each and of everything they
 * hold, but where in a text each was read from. Two that do are drawn the same.
 */
export function markdownNodesAlike(
  left: MarkdownNode,
  right: MarkdownNode,
): boolean {
  const pending: (readonly [unknown, unknown])[] = [[left, right]];
  for (let pair = pending.pop(); pair !== undefined; pair = pending.pop()) {
    const [one, other] = pair;
    if (one === other) continue;
    if (typeof one !== "object" || typeof other !== "object") return false;
    if (one === null || other === null) return false;
    if (Array.isArray(one) !== Array.isArray(other)) return false;
    const fields = Object.keys(one).filter((field) => field !== "position");
    const others = Object.keys(other).filter((field) => field !== "position");
    if (fields.length !== others.length) return false;
    for (const field of fields) {
      if (!Object.hasOwn(other, field)) return false;
      pending.push([
        (one as Readonly<Record<string, unknown>>)[field],
        (other as Readonly<Record<string, unknown>>)[field],
      ]);
    }
  }
  return true;
}

/** How many lines of a text drawn as its characters one paragraph holds. */
export const markdownPlainLinesMax = 64;

/**
 * A text drawn as its characters, every line break kept. It is a paragraph
 * for each `markdownPlainLinesMax` lines, so one that grows is drawn again in
 * its last paragraph only.
 */
export function markdownPlainBlocks(text: string): readonly MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let from = 0;
  while (from < text.length) {
    let to = from;
    for (let lines = 0; lines < markdownPlainLinesMax && to >= 0; lines += 1)
      to = text.indexOf("\n", to) + 1 || -1;
    const next = to < 0 ? text.length : to;
    const value = text.slice(from, markdownBlankCut(text, from, next));
    if (!markdownBlank(value))
      blocks.push({ type: "paragraph", children: [markdownTextNode(value)] });
    from = next;
  }
  return blocks;
}

/** The parser, which nothing outside the two doors below may call. A text
 * that is not as `markdownNormalised` leaves one is not what was reckoned. */
function markdownParsed(text: string, options: Options): Root | undefined {
  if (markdownRewritten(text)) return undefined;
  try {
    const root: Root = fromMarkdown(text, options);
    markdownSettle(root, text, false);
    return root;
  } catch {
    return undefined;
  }
}

/**
 * The blocks of one section, each carrying where in it it was read from, or
 * nothing where the text is not one section by `markdownPieces.ts`'s own
 * reckoning or the parser gave up on it.
 */
export function markdownSectionRead(
  text: string,
): readonly MarkdownBlock[] | undefined {
  const pieces = markdownPiecesFrom(text, 0, 0);
  if (pieces.length === 0) return [];
  const only = pieces.length === 1 ? pieces[0] : undefined;
  if (only?.kind !== "read") return undefined;
  return markdownParsed(text, markdownOptions)?.children;
}

/** A text as one line: its lines, each without the spaces and tabs around
 * it, joined by a space where they hold anything. */
export function markdownLineJoined(text: string): string {
  const lines: string[] = [];
  for (const line of markdownNormalised(text).split("\n")) {
    let from = 0;
    let to = line.length;
    while (from < to && " \t".includes(line.charAt(from))) from += 1;
    while (to > from && " \t".includes(line.charAt(to - 1))) to -= 1;
    if (to > from) lines.push(line.slice(from, to));
  }
  return lines.join(" ");
}

/**
 * The runs of a text read as one line of words: no block is read in it, so
 * it is one paragraph by construction. Nothing where it is past what a line
 * may cost, or is not one paragraph after all.
 */
export function markdownLineRead(
  text: string,
): readonly MarkdownInline[] | undefined {
  if (markdownBlank(text)) return [];
  if (!markdownWordsPass(text)) return undefined;
  const blocks = markdownParsed(text, markdownLineOptions)?.children;
  const only = blocks?.length === 1 ? blocks[0] : undefined;
  return only?.type === "paragraph" ? only.children : undefined;
}

/** A fence as the block of code it is: its language the first word its
 * opening line says. */
function markdownFenceBlock(fence: MarkdownFence): MarkdownBlock {
  const space = fence.info.search(/[ \t]/u);
  const lang = space < 0 ? fence.info : fence.info.slice(0, space);
  const meta = space < 0 ? "" : fence.info.slice(space).trim();
  return {
    type: "code",
    lang: lang === "" ? null : lang,
    meta: meta === "" ? null : meta,
    value: fence.value,
  };
}

/** One piece of a text as the blocks it is drawn as, the blank lines a section
 * closes on left off. `writing` says more of the text is coming, which only a
 * fence reads differently here. */
export function markdownPieceBlocks(
  text: string,
  piece: MarkdownPiece,
  writing: boolean,
): readonly MarkdownBlock[] {
  if (piece.kind === "fence")
    return [markdownFenceBlock(markdownFenceRead(text, piece, writing))];
  const end = markdownBlankCut(text, piece.start, piece.end);
  const held = text.slice(piece.start, end);
  const read = piece.kind === "read" ? markdownSectionRead(held) : undefined;
  return read ?? markdownPlainBlocks(held);
}

/** What an ordered list a section ends in hands to a list that goes on from
 * it in the section below: the mark its numbers end in, and its next number. */
export interface MarkdownCount {
  readonly delimiter: number;
  readonly next: number;
}

/** A piece's blocks, and the count they hand to the piece below. */
export interface MarkdownCounted {
  readonly blocks: readonly MarkdownBlock[];
  readonly count: MarkdownCount | undefined;
}

/** The mark an ordered list's numbers end in, read where a piece's text has
 * its first item written. */
function markdownListDelimiter(
  text: string,
  piece: MarkdownPiece,
  list: MarkdownNodeOf<"list">,
): number {
  const offset = list.position?.start.offset;
  let at = offset === undefined ? text.length : piece.start + offset;
  while (text.charCodeAt(at) > 47 && text.charCodeAt(at) < 58) at += 1;
  return text.charCodeAt(at);
}

/**
 * A piece's blocks counted on from the piece above. Where that one ended in
 * an ordered list and this one opens at the margin with an item of the same
 * list, its numbers go on from that list's: one list read as several, which is
 * what a list longer than one call may cost is, still counts as one.
 */
export function markdownPieceCounted(
  text: string,
  piece: MarkdownPiece,
  read: readonly MarkdownBlock[],
  carried: MarkdownCount | undefined,
): MarkdownCounted {
  if (piece.kind !== "read") return { blocks: read, count: undefined };
  const first = read[0];
  const goes =
    carried !== undefined &&
    first?.type === "list" &&
    first.ordered === true &&
    first.position?.start.offset === 0 &&
    markdownListDelimiter(text, piece, first) === carried.delimiter;
  const blocks = goes
    ? [{ ...first, start: carried.next }, ...read.slice(1)]
    : read;
  const last = blocks.at(-1);
  if (last?.type !== "list" || last.ordered !== true)
    return { blocks, count: undefined };
  const delimiter = markdownListDelimiter(text, piece, last);
  const next = (last.start ?? 1) + last.children.length;
  return { blocks, count: { delimiter, next } };
}

/** A whole text as the blocks it is drawn as. */
export function markdownBlocksParsed(text: string): readonly MarkdownBlock[] {
  const read = markdownNormalised(text);
  const blocks: MarkdownBlock[] = [];
  let count: MarkdownCount | undefined;
  for (const piece of markdownPiecesFrom(read, 0, 0)) {
    const drawn = markdownPieceBlocks(read, piece, false);
    const counted = markdownPieceCounted(read, piece, drawn, count);
    blocks.push(...counted.blocks);
    count = counted.count;
  }
  return blocks;
}
