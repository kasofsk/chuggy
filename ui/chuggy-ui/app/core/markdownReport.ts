/**
 * The worker's own report as blocks a screen can lay out, rather than a wall
 * of text left to whatever line-folding the browser happens to do.
 *
 * A report is markdown a worker wrote, at the wire's own cap
 * (`resultReportCharsMax`), so a scan over it is bounded by the read that
 * produced it. Recognising the shapes a work report is actually built from —
 * a heading, a listed line, a fenced block, a quoted line, a paragraph — does
 * not need a general markdown grammar, and drawing anything unrecognised as
 * its own paragraph is never wrong, only plain. Inline marks are read in one
 * pass rather than nested, so `**a *b* c**` reads as bold text naming its own
 * asterisks instead of a tree — the same plain-over-wrong choice at the
 * inline grain.
 */

export type MarkdownInline =
  | { readonly kind: "Text"; readonly text: string }
  | { readonly kind: "Bold"; readonly text: string }
  | { readonly kind: "Italic"; readonly text: string }
  | { readonly kind: "Code"; readonly text: string }
  | { readonly kind: "Link"; readonly text: string; readonly href: string };

export type MarkdownLines = readonly (readonly MarkdownInline[])[];

export type MarkdownBlock =
  | {
      readonly kind: "Heading";
      readonly level: number;
      readonly inline: readonly MarkdownInline[];
    }
  | { readonly kind: "Paragraph"; readonly lines: MarkdownLines }
  | { readonly kind: "Quote"; readonly lines: MarkdownLines }
  | {
      readonly kind: "BulletList";
      readonly items: readonly (readonly MarkdownInline[])[];
    }
  | {
      readonly kind: "OrderedList";
      readonly items: readonly (readonly MarkdownInline[])[];
    }
  | { readonly kind: "CodeBlock"; readonly text: string };

const markdownInlineTokenPattern =
  /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^[\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/** One line's marks, read left to right without nesting. */
export function markdownInlineOf(text: string): readonly MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  let consumed = 0;
  for (const match of text.matchAll(markdownInlineTokenPattern)) {
    const at = match.index ?? 0;
    if (at > consumed)
      nodes.push({ kind: "Text", text: text.slice(consumed, at) });
    const [, code, bold, italicStar, italicUnderscore, linkText, linkHref] =
      match;
    if (code !== undefined) nodes.push({ kind: "Code", text: code });
    else if (bold !== undefined) nodes.push({ kind: "Bold", text: bold });
    else if (italicStar !== undefined)
      nodes.push({ kind: "Italic", text: italicStar });
    else if (italicUnderscore !== undefined)
      nodes.push({ kind: "Italic", text: italicUnderscore });
    else if (linkText !== undefined && linkHref !== undefined)
      nodes.push({ kind: "Link", text: linkText, href: linkHref });
    consumed = at + match[0].length;
  }
  if (consumed < text.length)
    nodes.push({ kind: "Text", text: text.slice(consumed) });
  return nodes;
}

type MarkdownLineKind =
  | { readonly kind: "Blank" }
  | { readonly kind: "Fence" }
  | { readonly kind: "Heading"; readonly level: number; readonly rest: string }
  | { readonly kind: "Bullet"; readonly rest: string }
  | { readonly kind: "Ordered"; readonly rest: string }
  | { readonly kind: "Quote"; readonly rest: string }
  | { readonly kind: "Text"; readonly rest: string };

function markdownLineKindOf(line: string): MarkdownLineKind {
  if (line.trim() === "") return { kind: "Blank" };
  if (line.startsWith("```")) return { kind: "Fence" };
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading !== null && heading[1] !== undefined && heading[2] !== undefined)
    return { kind: "Heading", level: heading[1].length, rest: heading[2] };
  const bullet = /^[-*]\s+(.*)$/.exec(line);
  if (bullet !== null && bullet[1] !== undefined)
    return { kind: "Bullet", rest: bullet[1] };
  const ordered = /^\d+\.\s+(.*)$/.exec(line);
  if (ordered !== null && ordered[1] !== undefined)
    return { kind: "Ordered", rest: ordered[1] };
  const quote = /^>\s?(.*)$/.exec(line);
  if (quote !== null && quote[1] !== undefined)
    return { kind: "Quote", rest: quote[1] };
  return { kind: "Text", rest: line };
}

/** Consecutive lines the same classifier keeps naming, each read down to its
 * own `rest` — the run a paragraph, a quote or a list is drawn from. */
function markdownRunRead(
  lines: readonly string[],
  start: number,
  matches: (kind: MarkdownLineKind) => string | undefined,
): { readonly rest: readonly string[]; readonly next: number } {
  const rest: string[] = [];
  let at = start;
  while (at < lines.length) {
    const line = markdownRunLine(lines, at, matches);
    if (line === undefined) break;
    rest.push(line);
    at += 1;
  }
  return { rest, next: at };
}

function markdownRunLine(
  lines: readonly string[],
  at: number,
  matches: (kind: MarkdownLineKind) => string | undefined,
): string | undefined {
  const line = lines[at];
  return line === undefined ? undefined : matches(markdownLineKindOf(line));
}

function markdownFenceRead(
  lines: readonly string[],
  start: number,
): { readonly text: string; readonly next: number } {
  const body: string[] = [];
  let at = start;
  while (at < lines.length && !(lines[at] ?? "").startsWith("```")) {
    body.push(lines[at] ?? "");
    at += 1;
  }
  return { text: body.join("\n"), next: Math.min(at + 1, lines.length) };
}

function markdownParagraphLines(lines: readonly string[]): MarkdownLines {
  return lines.map(markdownInlineOf);
}

function markdownListItemsRead(
  lines: readonly string[],
  start: number,
  matches: (kind: MarkdownLineKind) => string | undefined,
): {
  readonly items: readonly (readonly MarkdownInline[])[];
  readonly next: number;
} {
  const run = markdownRunRead(lines, start, matches);
  return { items: run.rest.map(markdownInlineOf), next: run.next };
}

/** The report's blocks, in the order the worker wrote them. */
export function markdownReportBlocks(report: string): readonly MarkdownBlock[] {
  const lines = report.split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const kindLine = markdownLineKindOf(line);
    if (kindLine.kind === "Blank") {
      index += 1;
    } else if (kindLine.kind === "Fence") {
      const fence = markdownFenceRead(lines, index + 1);
      blocks.push({ kind: "CodeBlock", text: fence.text });
      index = fence.next;
    } else if (kindLine.kind === "Heading") {
      blocks.push({
        kind: "Heading",
        level: kindLine.level,
        inline: markdownInlineOf(kindLine.rest),
      });
      index += 1;
    } else if (kindLine.kind === "Bullet") {
      const list = markdownListItemsRead(lines, index, (kind) =>
        kind.kind === "Bullet" ? kind.rest : undefined,
      );
      blocks.push({ kind: "BulletList", items: list.items });
      index = list.next;
    } else if (kindLine.kind === "Ordered") {
      const list = markdownListItemsRead(lines, index, (kind) =>
        kind.kind === "Ordered" ? kind.rest : undefined,
      );
      blocks.push({ kind: "OrderedList", items: list.items });
      index = list.next;
    } else if (kindLine.kind === "Quote") {
      const run = markdownRunRead(lines, index, (kind) =>
        kind.kind === "Quote" ? kind.rest : undefined,
      );
      blocks.push({ kind: "Quote", lines: markdownParagraphLines(run.rest) });
      index = run.next;
    } else {
      const run = markdownRunRead(lines, index, (kind) =>
        kind.kind === "Text" ? kind.rest : undefined,
      );
      blocks.push({
        kind: "Paragraph",
        lines: markdownParagraphLines(run.rest),
      });
      index = run.next;
    }
  }
  return blocks;
}
