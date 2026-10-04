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
 * A TEXT NO WRITER WRITES IS DRAWN AS ITS CHARACTERS. The parser's cost grows
 * faster than a run of emphasis marks does, so a text carrying a longer run,
 * or more of them in one block, than `markdownGuardNext` allows is not parsed
 * at all, and neither is one the parser gives up on.
 */

import { fromMarkdown } from "mdast-util-from-markdown";
import type { Options } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";

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

/** The longest run of emphasis marks a text may carry and still be parsed. */
export const markdownMarkRunMax = 128;

/** The most emphasis marks one run of lines with no blank line between them
 * may carry and still be parsed. */
export const markdownMarksMax = 8192;

/**
 * What a scan of a text's lines has come to: the fence it is inside, the marks
 * counted since the last blank line, and whether it is past parsing. It is
 * carried so a text being written is scanned from where its last scan ended.
 */
export interface MarkdownGuard {
  readonly fence: string | undefined;
  readonly marks: number;
  readonly unreadable: boolean;
}

export const markdownGuardInitial: MarkdownGuard = {
  fence: undefined,
  marks: 0,
  unreadable: false,
};

const markdownGuardUnreadable: MarkdownGuard = {
  fence: undefined,
  marks: 0,
  unreadable: true,
};

const markdownFenceOpenPattern = /^(?:(`{3,})[^`]*|(~{3,}).*)$/u;

function markdownFenceCloses(line: string, fence: string): boolean {
  const run = line.trim();
  return (
    run.length >= fence.length &&
    run === fence.charAt(0).repeat(run.length) &&
    line.length - line.trimStart().length < 4
  );
}

/** One line taken into the scan. A fence opened at the margin holds code, and
 * code is exempt: a banner of stars in it costs the parser nothing. */
function markdownGuardLine(guard: MarkdownGuard, line: string): MarkdownGuard {
  if (guard.fence !== undefined)
    return markdownFenceCloses(line, guard.fence)
      ? { ...guard, fence: undefined }
      : guard;
  const opened = markdownFenceOpenPattern.exec(line);
  const fence = opened?.[1] ?? opened?.[2];
  if (fence !== undefined) return { fence, marks: 0, unreadable: false };
  if (line.trim() === "")
    return guard.marks === 0 ? guard : { ...guard, marks: 0 };
  let marks = guard.marks;
  for (const run of line.match(/[*_]+/gu) ?? []) {
    if (run.length > markdownMarkRunMax) return markdownGuardUnreadable;
    marks += run.length;
  }
  if (marks > markdownMarksMax) return markdownGuardUnreadable;
  return marks === guard.marks ? guard : { ...guard, marks };
}

/** The scan carried over the lines between two places in a text, the first of
 * which is the start of a line. */
export function markdownGuardNext(
  guard: MarkdownGuard,
  text: string,
  from: number,
  to: number,
): MarkdownGuard {
  let next = guard;
  let at = from;
  while (at < to && !next.unreadable) {
    const newline = text.indexOf("\n", at);
    const end = newline === -1 || newline > to ? to : newline;
    next = markdownGuardLine(next, text.slice(at, end));
    at = end + 1;
  }
  return next;
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

/** A link nobody could follow, as the words it wore — or, where it was
 * written between angle brackets, as exactly what was written. */
function markdownLinkKept(
  node: MarkdownNodeOf<"link">,
  source: string,
): readonly MarkdownInline[] {
  if (markdownLinkFollowed(node.url)) return [node];
  const written = markdownSourceOf(node, source);
  return written.startsWith("<") ? [markdownTextNode(written)] : node.children;
}

/** One node as the report draws it: itself, or what stands in its place. */
function markdownChildKept(
  node: MarkdownNode,
  source: string,
): readonly MarkdownNode[] {
  if (node.type === "emphasis" || node.type === "strong")
    return markdownUnderscoreKept(node, source);
  if (node.type === "link") return markdownLinkKept(node, source);
  if (node.type !== "image") return [node];
  const described = node.alt ?? "";
  const words = markdownTextNode(described === "" ? node.url : described);
  return markdownLinkFollowed(node.url)
    ? [{ type: "link", url: node.url, children: [words] }]
    : [words];
}

/** Every node under a node put through `markdownChildKept`, children before
 * their parents, with the words that leaves side by side joined into one. */
function markdownSettle(parent: MarkdownParent, source: string): void {
  const children: MarkdownNode[] = [];
  for (const child of parent.children) {
    if ("children" in child) markdownSettle(child, source);
    for (const kept of markdownChildKept(child, source)) {
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

/** A text drawn as its characters: one paragraph holding all of it. */
export function markdownPlainBlocks(text: string): readonly MarkdownBlock[] {
  return text.trim() === ""
    ? []
    : [{ type: "paragraph", children: [markdownTextNode(text)] }];
}

/**
 * The blocks of a text, each carrying where in the text it was read from, or
 * nothing where the parser gave up on it — which a nesting deep enough to
 * exhaust its stack makes it do.
 */
export function markdownBlocksParsed(
  text: string,
): readonly MarkdownBlock[] | undefined {
  try {
    const root: Root = fromMarkdown(text, markdownOptions);
    markdownSettle(root, text);
    return root.children;
  } catch {
    return undefined;
  }
}
