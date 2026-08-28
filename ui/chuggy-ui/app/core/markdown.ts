/**
 * The markdown an agent writes — a run report, a turn's own text — read as
 * blocks and inline spans a pane can draw instead of characters it prints
 * unread.
 *
 * The grammar covers what this tree's own reports use: headings, paragraphs,
 * fenced code, lists, and inline code, emphasis, strong and links. Nothing
 * here executes what it reads — a link whose scheme is not `http`, `https` or
 * `mailto` is drawn as the text it was written as, never as a place to go.
 */

export type MarkdownInline =
  | { readonly kind: "Text"; readonly text: string }
  | { readonly kind: "Code"; readonly text: string }
  | { readonly kind: "Strong"; readonly text: string }
  | { readonly kind: "Emphasis"; readonly text: string }
  | { readonly kind: "Link"; readonly text: string; readonly href: string };

export type MarkdownBlock =
  | {
      readonly kind: "Heading";
      readonly level: number;
      readonly inline: readonly MarkdownInline[];
    }
  | { readonly kind: "Paragraph"; readonly inline: readonly MarkdownInline[] }
  | { readonly kind: "CodeBlock"; readonly text: string }
  | {
      readonly kind: "List";
      readonly ordered: boolean;
      readonly items: readonly (readonly MarkdownInline[])[];
    };

const markdownHeadingPattern = /^(#{1,6})\s+(.*)$/;
const markdownListItemPattern = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/;
const markdownOrderedItemPattern = /^\s*\d+\.\s+/;
const markdownSafeHrefPattern = /^(?:https?:|mailto:)/i;

const markdownInlinePattern =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)/g;

function markdownInlineMatched(matched: RegExpMatchArray): MarkdownInline {
  if (matched[1] !== undefined) return { kind: "Code", text: matched[1] };
  if (matched[2] !== undefined) return { kind: "Strong", text: matched[2] };
  if (matched[3] !== undefined) return { kind: "Strong", text: matched[3] };
  if (matched[4] !== undefined) return { kind: "Emphasis", text: matched[4] };
  if (matched[5] !== undefined) return { kind: "Emphasis", text: matched[5] };
  const href = matched[7] ?? "";
  return markdownSafeHrefPattern.test(href)
    ? { kind: "Link", text: matched[6] ?? "", href }
    : { kind: "Text", text: matched[0] };
}

/** One line's text as the spans it carries — code, strong, emphasis and links
 * in the order they were written, with everything between them as text. */
export function markdownInlineOf(text: string): readonly MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let consumed = 0;
  for (const matched of text.matchAll(markdownInlinePattern)) {
    const at = matched.index ?? 0;
    if (at > consumed)
      nodes.push({ kind: "Text", text: text.slice(consumed, at) });
    nodes.push(markdownInlineMatched(matched));
    consumed = at + matched[0].length;
  }
  if (consumed < text.length)
    nodes.push({ kind: "Text", text: text.slice(consumed) });
  return nodes;
}

function markdownIsFence(line: string): boolean {
  return line.trim().startsWith("```");
}

function markdownHeadingOf(
  line: string,
):
  | { readonly level: number; readonly inline: readonly MarkdownInline[] }
  | undefined {
  const matched = markdownHeadingPattern.exec(line);
  return matched === null
    ? undefined
    : {
        level: (matched[1] ?? "").length,
        inline: markdownInlineOf(matched[2] ?? ""),
      };
}

function markdownListItemOf(
  line: string,
): { readonly ordered: boolean; readonly rest: string } | undefined {
  const matched = markdownListItemPattern.exec(line);
  return matched === null
    ? undefined
    : {
        ordered: markdownOrderedItemPattern.test(line),
        rest: matched[1] ?? "",
      };
}

function markdownReadCodeBlock(
  lines: readonly string[],
  start: number,
): { readonly block: MarkdownBlock; readonly next: number } {
  const collected: string[] = [];
  let at = start + 1;
  while (at < lines.length && !markdownIsFence(lines[at] ?? "")) {
    collected.push(lines[at] ?? "");
    at += 1;
  }
  return {
    block: { kind: "CodeBlock", text: collected.join("\n") },
    next: Math.min(at + 1, lines.length),
  };
}

function markdownReadList(
  lines: readonly string[],
  start: number,
): { readonly block: MarkdownBlock; readonly next: number } {
  const ordered = markdownListItemOf(lines[start] ?? "")?.ordered ?? false;
  const items: (readonly MarkdownInline[])[] = [];
  let at = start;
  for (
    let item = markdownListItemOf(lines[at] ?? "");
    item !== undefined;
    item = markdownListItemOf(lines[at] ?? "")
  ) {
    items.push(markdownInlineOf(item.rest));
    at += 1;
  }
  return { block: { kind: "List", ordered, items }, next: at };
}

function markdownStartsBlock(line: string): boolean {
  return (
    markdownIsFence(line) ||
    markdownHeadingOf(line) !== undefined ||
    markdownListItemOf(line) !== undefined
  );
}

function markdownReadParagraph(
  lines: readonly string[],
  start: number,
): { readonly block: MarkdownBlock; readonly next: number } {
  const collected: string[] = [];
  let at = start;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    if (line.trim().length === 0 || markdownStartsBlock(line)) break;
    collected.push(line);
    at += 1;
  }
  return {
    block: {
      kind: "Paragraph",
      inline: markdownInlineOf(collected.join("\n")),
    },
    next: at,
  };
}

/** A run report or a turn's text as the blocks it is made of, in the order it
 * was written. */
export function markdownBlocksOf(source: string): readonly MarkdownBlock[] {
  const lines = source.split("\n");
  const blocks: MarkdownBlock[] = [];
  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    const heading = markdownHeadingOf(line);
    if (line.trim().length === 0) {
      at += 1;
    } else if (markdownIsFence(line)) {
      const read = markdownReadCodeBlock(lines, at);
      blocks.push(read.block);
      at = read.next;
    } else if (heading !== undefined) {
      blocks.push({ kind: "Heading", ...heading });
      at += 1;
    } else if (markdownListItemOf(line) !== undefined) {
      const read = markdownReadList(lines, at);
      blocks.push(read.block);
      at = read.next;
    } else {
      const read = markdownReadParagraph(lines, at);
      blocks.push(read.block);
      at = read.next;
    }
  }
  return blocks;
}
