/**
 * The worker's own report as blocks a screen can lay out, rather than a wall
 * of text left to whatever line-folding the browser happens to do.
 *
 * A report is markdown a worker wrote, at the wire's own cap
 * (`resultReportCharsMax`), so a scan over it is bounded by the read that
 * produced it. Recognising the shapes a work report is actually built from —
 * a heading, a listed line, a fenced block, a quoted line, a paragraph, a
 * pipe table — does not need a general markdown grammar, and drawing
 * anything unrecognised as its own paragraph is never wrong, only plain. A
 * run of lines is a table only once a delimiter row sits under its header;
 * short of that it stays the paragraph it would otherwise be, and a row the
 * delimiter's width does not match is cut or padded to it rather than
 * guessed at. Inline marks are read in one
 * pass rather than nested, so `**a *b* c**` reads as bold text naming its own
 * asterisks instead of a tree — the same plain-over-wrong choice at the
 * inline grain.
 *
 * A ticket named in the prose is one more inline node, read by the grammar the
 * contract owns rather than by a mark of this scanner's own — the console and
 * the agent writing that form have to agree about it, and a second reading of
 * it here is a second thing to keep in step.
 */

import { ticketReferenceSplit } from "../../../../src/contract/ticketReference.ts";

export type MarkdownInline =
  | { readonly kind: "Text"; readonly text: string }
  | { readonly kind: "Bold"; readonly text: string }
  | { readonly kind: "Italic"; readonly text: string }
  | { readonly kind: "Code"; readonly text: string }
  | { readonly kind: "Link"; readonly text: string; readonly href: string }
  | { readonly kind: "Reference"; readonly ticket: number };

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
  | { readonly kind: "CodeBlock"; readonly text: string }
  | {
      readonly kind: "Table";
      readonly header: readonly (readonly MarkdownInline[])[];
      readonly rows: readonly (readonly (readonly MarkdownInline[])[])[];
    };

/** A table wider than this many columns, or with more body rows than this,
 * is cut rather than read in full — a wall of pipes stays bounded. */
export const markdownTableColumnsMax = 32;
export const markdownTableRowsMax = 100;

const markdownInlineTokenPattern =
  /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^[\]]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * The ticket references inside the runs of plain text, drawn out after the
 * marks rather than beside them: a reference is only ever a reference where the
 * words are, so one written inside a code span or a link's own text stays the
 * characters a worker meant to show.
 */
function markdownInlineReferenced(
  nodes: readonly MarkdownInline[],
): readonly MarkdownInline[] {
  return nodes.flatMap((node) =>
    node.kind !== "Text"
      ? [node]
      : ticketReferenceSplit(node.text).map((segment): MarkdownInline =>
          segment.kind === "Text"
            ? { kind: "Text", text: segment.text }
            : { kind: "Reference", ticket: segment.ticket },
        ),
  );
}

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
  return markdownInlineReferenced(nodes);
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

/** A line's cells, stripped of the leading and trailing pipe a worker tends
 * to write. `undefined` when the line carries no pipe at all — not a row. */
function markdownTableRowCells(line: string): readonly string[] | undefined {
  if (!line.includes("|")) return undefined;
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

const markdownTableDelimiterCellPattern = /^:?-+:?$/;

/** Whether a line is only dashes, one per header column — the row that
 * turns a run of pipes into a table rather than leaving it a paragraph. */
function markdownTableDelimiterRow(line: string): boolean {
  const cells = markdownTableRowCells(line);
  return (
    cells !== undefined &&
    cells.length > 0 &&
    cells.every((cell) => markdownTableDelimiterCellPattern.test(cell))
  );
}

/** One row's cells, cut or padded to the header's own width. */
function markdownTableRowOf(
  cells: readonly string[],
  columns: number,
): readonly (readonly MarkdownInline[])[] {
  return Array.from({ length: columns }, (_unused, at) =>
    markdownInlineOf(cells[at] ?? ""),
  );
}

/** The header, already read, and the body rows under its delimiter — every
 * further line the same classifier still calls plain text, up to the row
 * bound. */
function markdownTableRead(
  lines: readonly string[],
  start: number,
  headerCells: readonly string[],
): { readonly block: MarkdownBlock; readonly next: number } {
  const columns = Math.min(headerCells.length, markdownTableColumnsMax);
  const header = markdownTableRowOf(headerCells, columns);
  const rows: (readonly (readonly MarkdownInline[])[])[] = [];
  let at = start + 2;
  while (at < lines.length && rows.length < markdownTableRowsMax) {
    const line = lines[at];
    if (line === undefined || markdownLineKindOf(line).kind !== "Text") break;
    const cells = markdownTableRowCells(line);
    if (cells === undefined) break;
    rows.push(markdownTableRowOf(cells, columns));
    at += 1;
  }
  return { block: { kind: "Table", header, rows }, next: at };
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
      const headerCells = markdownTableRowCells(line);
      const delimiter = lines[index + 1];
      if (
        headerCells !== undefined &&
        delimiter !== undefined &&
        markdownTableDelimiterRow(delimiter)
      ) {
        const table = markdownTableRead(lines, index, headerCells);
        blocks.push(table.block);
        index = table.next;
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
  }
  return blocks;
}
