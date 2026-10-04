/**
 * A text split into the pieces it is read as, before the parser sees any of
 * it.
 *
 * A PIECE IS ONE OF THREE THINGS. A fence opened at the margin is code, and
 * this splitter's own: a line of three or more backticks or tildes standing
 * first on its line opens one wherever the grammar would let it, so it is
 * found here, closed by this file's rule, and drawn without the parser. A run
 * of lines `markdownGuard.ts` reckons too dear is plain: its characters. And
 * everything else is a section, which is all the parser is ever handed.
 *
 * A SECTION IS THE RUNS THAT MAY BE ONE BLOCK. Runs are joined so that a list
 * spaced with blank lines is still one list, and a section ends where the next
 * run could not be reached into by what stands above it: it begins at the
 * margin with something other than a list's mark. A section shorter than
 * `markdownSectionCharsMin` goes on past such a run, because a call of the
 * parser costs what a few lines do and a text of one-word paragraphs would
 * otherwise be dearer than a list of its length. It ends sooner where joining
 * the next run would take it past the allowance one call may cost, and inside
 * a run where `markdownGuard.ts` ends one at a list's line. Either cut can
 * part a list in two: an odd drawing, and a safe one.
 *
 * WHERE A PIECE BEGINS IS DECIDED BY THE TEXT ABOVE IT AND NEVER MOVES. Every
 * verdict here is held to at each character, so a text that grows only ever
 * gains pieces after its last, and reading it again from where its last piece
 * begins comes to what reading all of it would.
 *
 * A WHOLE TEXT IS BOUNDED TOO. Past `markdownTextCharsMax`, or once its
 * sections have cost `markdownTextWorkMax` between them, what is left is plain.
 */

import {
  markdownBlankCode,
  markdownCost,
  markdownRunScanned,
} from "./markdownGuard.ts";

/** How much of a text is read as markdown, in characters. */
export const markdownTextCharsMax = 65_536;

/** What the sections of one text may cost between them, in the units
 * `markdownCost` charges in. */
export const markdownTextWorkMax = 160_000_000;

/** How long a section is before a run that begins at the margin ends it. */
export const markdownSectionCharsMin = 256;

/** One piece of a text: the parser's, the splitter's own code, or plain. */
export interface MarkdownPiece {
  readonly kind: "read" | "fence" | "plain";
  readonly start: number;
  /** Where the next piece begins, or the text ends. */
  readonly end: number;
  /** What the parser is reckoned to spend on it. */
  readonly work: number;
}

/** A fence as the code it holds. */
export interface MarkdownFence {
  /** What its opening line says after the marks. */
  readonly info: string;
  readonly value: string;
}

/** Whether a text holds nothing but spaces, tabs and line ends. */
export function markdownBlank(text: string): boolean {
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (!markdownBlankCode(code) && code !== 10) return false;
  }
  return true;
}

/** Where a stretch of a text ends once the blank lines it closes on are left
 * off: the end of its last line that holds anything. */
export function markdownBlankCut(
  text: string,
  from: number,
  to: number,
): number {
  let end = to;
  while (end > from) {
    const code = text.charCodeAt(end - 1);
    if (!markdownBlankCode(code) && code !== 10) break;
    end -= 1;
  }
  const newline = text.indexOf("\n", end);
  return newline < 0 || newline > to ? to : newline;
}

/** Where the first line at or after a place that is not blank begins, a blank
 * line being one of spaces and tabs only. */
function markdownBlankSkipped(text: string, from: number): number {
  let at = from;
  while (at < text.length) {
    let end = at;
    while (end < text.length && markdownBlankCode(text.charCodeAt(end)))
      end += 1;
    if (end === text.length) return end;
    if (text.charCodeAt(end) !== 10) return at;
    at = end + 1;
  }
  return at;
}

/** How many of one mark a line opens with, past at most three spaces. */
function markdownFenceMarks(text: string, line: number, mark: number): number {
  let at = line;
  while (at - line < 3 && text.charCodeAt(at) === 32) at += 1;
  const from = at;
  while (text.charCodeAt(at) === mark) at += 1;
  return at - from;
}

/** Whether a line is nothing but the marks it opens with and blanks after. */
function markdownFenceBare(text: string, line: number, end: number): boolean {
  let at = line;
  while (at < end && text.charCodeAt(at) === 32) at += 1;
  const mark = text.charCodeAt(at);
  while (at < end && text.charCodeAt(at) === mark) at += 1;
  while (at < end && markdownBlankCode(text.charCodeAt(at))) at += 1;
  return at === end;
}

/**
 * Where the line that closes a fence begins, or the end of the text where
 * none does: at most three spaces, the opening mark at least as many times,
 * and nothing after but blanks.
 */
function markdownFenceClose(text: string, start: number): number {
  const mark = text.charCodeAt(start);
  const width = markdownFenceMarks(text, start, mark);
  let line = text.indexOf("\n", start) + 1;
  while (line > 0 && line < text.length) {
    const newline = text.indexOf("\n", line);
    const end = newline < 0 ? text.length : newline;
    if (
      markdownFenceMarks(text, line, mark) >= width &&
      markdownFenceBare(text, line, end)
    )
      return line;
    line = newline + 1;
  }
  return text.length;
}

/**
 * A fence as its code. While more is coming a last line that is so far only
 * its marks is held back: it may be the fence's close, half written.
 */
export function markdownFenceRead(
  text: string,
  piece: MarkdownPiece,
  writing: boolean,
): MarkdownFence {
  const mark = text.charCodeAt(piece.start);
  const width = markdownFenceMarks(text, piece.start, mark);
  const opened = text.indexOf("\n", piece.start);
  const info = text.slice(piece.start + width, opened).trim();
  const close = markdownFenceClose(text, piece.start);
  let end = close < piece.end ? close - 1 : piece.end;
  const last = text.lastIndexOf("\n", end - 1) + 1;
  const held =
    close >= piece.end &&
    writing &&
    last > opened &&
    markdownFenceMarks(text, last, mark) > 0 &&
    markdownFenceBare(text, last, end);
  if (held) end = last - 1;
  else if (close >= piece.end && text.charCodeAt(end - 1) === 10) end -= 1;
  return { info, value: text.slice(opened + 1, Math.max(end, opened + 1)) };
}

/** The fence that opens at a place, to the end of the line that closes it. */
function markdownFencePiece(text: string, start: number): MarkdownPiece {
  const close = markdownFenceClose(text, start);
  const newline = close === text.length ? -1 : text.indexOf("\n", close);
  const end = newline < 0 ? text.length : newline + 1;
  return {
    kind: "fence",
    start,
    end: markdownBlankSkipped(text, end),
    work: 0,
  };
}

/** What the blank lines between two places cost the parser, which reads each
 * of them where a section goes on past it. */
function markdownBlankWork(text: string, from: number, to: number): number {
  let lines = 0;
  for (let at = text.indexOf("\n", from); at >= 0 && at < to; lines += 1)
    at = text.indexOf("\n", at + 1);
  return lines * markdownCost.blank + (to - from) * markdownCost.char;
}

/**
 * The piece that begins at a place: a fence, a plain run, or the section of
 * runs that are cheap together.
 */
function markdownPieceAt(text: string, start: number): MarkdownPiece {
  let at = start;
  let work: number = markdownCost.call;
  let blanks = 0;
  while (at < text.length) {
    const run = markdownRunScanned(text, at, work + blanks, at - start);
    const first = at === start;
    if (run.stop === "fence" && run.end === at)
      return first
        ? markdownFencePiece(text, at)
        : { kind: "read", start, end: at, work };
    const long = at - start >= markdownSectionCharsMin;
    if (!first && (run.apart || (run.fresh && long)))
      return { kind: "read", start, end: at, work };
    const end = markdownBlankSkipped(text, run.end);
    if (run.plain) return { kind: "plain", start, end, work: 0 };
    work += blanks + run.work + run.exits * markdownCost.exit * (at - start);
    if (run.stop === "cut") return { kind: "read", start, end, work };
    blanks = markdownBlankWork(text, run.end, end);
    at = end;
  }
  return { kind: "read", start, end: text.length, work };
}

/**
 * The pieces of a text from the place one begins, `spent` being what the
 * sections before that place cost between them.
 */
export function markdownPiecesFrom(
  text: string,
  from: number,
  spent: number,
): readonly MarkdownPiece[] {
  const bounded = text.length > markdownTextCharsMax;
  const head = bounded ? text.slice(0, markdownTextCharsMax) : text;
  const pieces: MarkdownPiece[] = [];
  let at = from === 0 ? markdownBlankSkipped(head, 0) : from;
  let left = markdownTextWorkMax - spent;
  while (at < head.length && left >= 0) {
    const piece = markdownPieceAt(head, at);
    pieces.push(piece);
    left -= piece.work;
    at = piece.end;
  }
  if (at < text.length)
    pieces.push({ kind: "plain", start: at, end: text.length, work: 0 });
  return pieces;
}
