/**
 * A report still being written, as the text its reader is drawn.
 *
 * `markdownReportBlocks` reads marks that are whole, which is right for a
 * report that is: a mark half written is the characters it is. Read that way
 * while the rest is still arriving, an answer shows a star, a bracket or a row
 * of pipes that a moment later was never there. This closes what the last line
 * leaves open and holds back what cannot be read yet, so each moment of a
 * report draws as what it is about to be. It is applied only while more is
 * coming, and the whole text is always read as itself.
 *
 * ONLY THE LAST LINE IS HALF WRITTEN. Marks are read a line at a time, so
 * every line above it is already what it will be. What spans lines is a fence,
 * which the reader already draws to the end of the text while unclosed, and a
 * table, whose header is a paragraph until the delimiter under it is whole.
 *
 * WHERE A MARK COULD BECOME TWO THINGS IT IS READ AS THE LIKELIER. A bracket
 * is a link's until what follows says otherwise, so words a writer did mean to
 * put in brackets gain them a moment late.
 */

import {
  markdownLinePlain,
  markdownTableDelimiterRow,
  markdownTableRowCells,
} from "./markdownReport.ts";

/** What one mark comes to: the place reading goes on from where it is closed
 * or is no mark at all, and the whole line as drawn where it is left open. */
type MarkdownWritingRead =
  { readonly next: number } | { readonly written: string };

function markdownWritingCode(text: string, at: number): MarkdownWritingRead {
  const close = text.indexOf("`", at + 1);
  if (close !== -1) return { next: close + 1 };
  return { written: at + 1 === text.length ? text.slice(0, at) : `${text}\`` };
}

/** Whether a mark at this place opens anything, which one a space follows
 * does not: `2 * 3` multiplies. */
function markdownWritingOpens(text: string, body: number): boolean {
  return body === text.length || !/\s/u.test(text.charAt(body));
}

function markdownWritingBold(text: string, at: number): MarkdownWritingRead {
  const body = at + 2;
  if (!markdownWritingOpens(text, body)) return { next: body };
  const star = text.indexOf("*", body);
  if (star === -1)
    return { written: body === text.length ? text.slice(0, at) : `${text}**` };
  if (star === body) return { next: at + 1 };
  if (text.startsWith("**", star)) return { next: star + 2 };
  return star === text.length - 1 ? { written: `${text}*` } : { next: body };
}

function markdownWritingItalic(text: string, at: number): MarkdownWritingRead {
  const body = at + 1;
  if (!markdownWritingOpens(text, body)) return { next: body };
  const close = text.indexOf("*", body);
  if (close !== -1) return { next: close + 1 };
  return { written: body === text.length ? text.slice(0, at) : `${text}*` };
}

const markdownWritingWordPattern = /[\p{L}\p{N}_]/u;

/** An underscore marks only at a word's edge, so one inside a name opens
 * nothing and one a name follows closes nothing. */
function markdownWritingUnderscore(
  text: string,
  at: number,
): MarkdownWritingRead {
  const body = at + 1;
  const edged =
    at === 0 || !markdownWritingWordPattern.test(text.charAt(at - 1));
  if (!edged || !markdownWritingOpens(text, body)) return { next: body };
  const close = text.indexOf("_", body);
  if (close !== -1) return { next: close + 1 };
  return { written: body === text.length ? text.slice(0, at) : `${text}_` };
}

/** A ticket's reference is drawn once it is whole and not before, because
 * nothing short of the whole of it names a ticket. */
function markdownWritingReference(
  text: string,
  at: number,
): MarkdownWritingRead {
  const close = text.indexOf("]]", at + 2);
  return close === -1 ? { written: text.slice(0, at) } : { next: close + 2 };
}

/** A link is its own words until its address is whole. */
function markdownWritingLink(text: string, at: number): MarkdownWritingRead {
  const before = text.slice(0, at);
  const close = text.indexOf("]", at + 1);
  if (close === -1) return { written: `${before}${text.slice(at + 1)}` };
  const words = text.slice(at + 1, close);
  if (close === text.length - 1) return { written: `${before}${words}` };
  if (text.charAt(close + 1) !== "(") return { next: close + 1 };
  const end = text.indexOf(")", close + 2);
  return end === -1 ? { written: `${before}${words}` } : { next: end + 1 };
}

function markdownWritingRead(text: string, at: number): MarkdownWritingRead {
  const mark = text.charAt(at);
  if (mark === "`") return markdownWritingCode(text, at);
  if (mark === "_") return markdownWritingUnderscore(text, at);
  if (mark === "*")
    return text.charAt(at + 1) === "*"
      ? markdownWritingBold(text, at)
      : markdownWritingItalic(text, at);
  if (mark === "[")
    return text.charAt(at + 1) === "["
      ? markdownWritingReference(text, at)
      : markdownWritingLink(text, at);
  return { next: at + 1 };
}

/** One line's marks read left to right as the reader reads them, without
 * nesting, up to the first one left open. */
function markdownWritingInline(text: string): string {
  let at = 0;
  while (at < text.length) {
    const read = markdownWritingRead(text, at);
    if ("written" in read) return read.written;
    at = read.next;
  }
  return text;
}

const markdownWritingLeadPattern = /^(?:#{1,6}\s+|[-*]\s+|\d+\.\s+|>\s?)/u;

/** The last line with its marks closed, past whatever makes it a heading, a
 * listed line or a quoted one; a fence's own line holds no marks to close. */
function markdownWritingLine(line: string): string {
  if (line.startsWith("```")) return line;
  const lead = markdownWritingLeadPattern.exec(line)?.[0] ?? "";
  return `${lead}${markdownWritingInline(line.slice(lead.length))}`;
}

/** A line that is so far only the start of a mark: a heading's, a listed
 * line's, a fence's or a table row's. */
const markdownWritingAlonePattern = /^(?:#{1,6}|[-*|]|\d+\.?|`{1,2})$/u;

const markdownWritingDelimiterPattern = /^\s*\|[\s:|-]*$/u;

function markdownWritingPiped(line: string): boolean {
  return line.trimStart().startsWith("|");
}

/**
 * The lines with the table they end on read as one from its header's first
 * cell: a header nothing is under yet is given its delimiter, and a delimiter
 * half written is given whole.
 */
function markdownWritingTable(written: readonly string[]): readonly string[] {
  const lines = written.at(-1) === "" ? written.slice(0, -1) : written;
  const start = lines.findLastIndex((line) => !markdownWritingPiped(line)) + 1;
  const [header, under, ...rows] = lines.slice(start);
  if (header === undefined || rows.length > 0) return written;
  if (start > 0 && markdownLinePlain(lines[start - 1] ?? "")) return written;
  const cells = markdownTableRowCells(header) ?? [];
  const delimiter = `|${cells.map(() => " --- |").join("")}`;
  if (under === undefined) return [...lines, delimiter];
  if (markdownTableDelimiterRow(under)) return written;
  return markdownWritingDelimiterPattern.test(under)
    ? [...lines.slice(0, -1), delimiter]
    : written;
}

/** The text a report still being written is read from. */
export function markdownWritingText(text: string): string {
  const lines = text.split("\n");
  const above = lines.slice(0, -1);
  const last = lines.at(-1) ?? "";
  const fences = above.filter((line) => line.startsWith("```")).length;
  if (fences % 2 === 1) return /^`{1,2}$/u.test(last) ? above.join("\n") : text;
  const shown = markdownWritingAlonePattern.test(last)
    ? above
    : [...above, markdownWritingLine(last)];
  return markdownWritingTable(shown).join("\n");
}
