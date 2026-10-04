/**
 * Code fenced under a list item or inside a quote, followed a line at a time.
 *
 * A FENCE AT THE MARGIN IS `markdownPieces.ts`'s OWN. One opened under a list
 * item or inside a quote is the parser's, and the parser reads every line to
 * its close as code: no mark in it is looked back from, and no blank line in
 * it ends anything. `markdownGuard.ts` reckons a text before the parser sees
 * it, so it has to know which lines those are, and this says.
 *
 * A LINE IS CODE HERE ONLY WHERE THE GRAMMAR LEAVES NO DOUBT THAT IT IS. A line
 * read as code here and as words by the parser would be charged nothing for
 * its marks, so each rule is one the grammar keeps whatever else is open. A
 * fence opens where its line is within three columns of something sure to be
 * open: the margin, a quote's mark, or a list item this has seen open and no
 * line since has left. It holds every line indented as far as its opening
 * line, and a line indented less than what it is inside ends it.
 *
 * A LIST ITEM IS SURE WHERE NO PARAGRAPH CAN TAKE ITS LINE FOR WORDS. A bullet
 * or a `1` with words after it opens one wherever it stands. Any other number
 * opens one only where no words can be open, after a blank line or a fence's
 * close, or where its line leaves an item sure to be open, which is the one
 * case the parser lets any number begin a list beside an open paragraph.
 *
 * ONCE IN DOUBT, IN DOUBT TO THE END. A line that may open or close a fence
 * and cannot be placed leaves this and the parser out of step, and a close
 * read as an opening would turn every later line inside out. So from such a
 * line on nothing is code here, which is what the guard reckoned before it
 * knew of fences at all: every line as words.
 *
 * WHAT A LINE IS NEVER DEPENDS ON WHAT FOLLOWS ITS MARKS. A line the text ends
 * in may still grow, and the guard's verdict on a text has to hold for every
 * longer one, so a line is placed by how it opens and the guard charges the
 * last line of a text nothing a longer line could take back.
 *
 * HOW DEEP A LINE MAY BE HELD IS COUNTED THE OTHER WAY, AS THE MOST IT CAN BE.
 * The parser reads a blank line, and the blank a line opens with, once for
 * each list item open above it, and the guard charges both by that many. So
 * where the items sure to be open are the fewest there can be, `held` is the
 * most: one for each mark a line so far opened with and one for every two
 * columns of blank among them, since an item's words are indented by no less,
 * over every line that is not a followed fence's own.
 */

/** A fence this is following. */
interface Fence {
  /** Whether it is a quote's, each of whose lines opens with the quote's
   * mark. */
  readonly quoted: boolean;
  /** The column of what it is sure to be inside: a list item's words, the
   * quote's mark, or the margin. */
  readonly from: number;
  /** The column its opening line began at, counted from the quote's words
   * where it is a quote's. */
  readonly indent: number;
  readonly mark: number;
  readonly width: number;
  /** One more than the most quotes and list items it can be inside. */
  readonly depth: number;
}

/** What is known of what the parser holds open at the start of a line. */
export interface MarkdownNesting {
  /** The columns the words of the list items sure to be open begin at,
   * outermost first. */
  readonly items: number[];
  fence: Fence | undefined;
  /** Whether a fence may be open that is not followed here. */
  doubt: boolean;
  /** Whether no words can be open for a line to go on with: the line above is
   * blank or a fence's close, or there is none. */
  clear: boolean;
  /** Whether indented code may be open. */
  deep: boolean;
  /** Whether the line last taken opened a list item sure to be one. */
  item: boolean;
  /** The most list items the lines taken so far can have left open, which is
   * as many as may be holding the next one. */
  held: number;
}

/** What is known where a piece begins: nothing is open. */
export function markdownNestingBegun(): MarkdownNesting {
  return {
    items: [],
    fence: undefined,
    doubt: false,
    clear: true,
    deep: false,
    item: false,
    held: 0,
  };
}

/** How far a line may be indented under what holds it and still open a block
 * of its own. */
const nestedIndentMax = 3;

/** The deepest column a fence is followed at. Past it what the parser spends
 * on a line of code is no longer a rate for each thing the line is inside. */
export const markdownNestedColumnMax = 32;

/** Whether a character is a space or a tab, which is all this reader ever
 * means by blank. */
export function markdownBlankCode(code: number): boolean {
  return code === 32 || code === 9;
}

/** How many columns a blank character is counted as: a tab as far as one can
 * reach, so that no count of them falls short. */
export function markdownBlankColumns(code: number): number {
  return code === 9 ? 4 : 1;
}

function digit(code: number): boolean {
  return code > 47 && code < 58;
}

/** Where a line's first character that is not blank is, the column that is
 * at, and whether a tab stands before it. */
interface Lead {
  readonly at: number;
  readonly column: number;
  readonly tabbed: boolean;
}

function markdownLead(text: string, start: number, end: number): Lead {
  let at = start;
  let column = 0;
  let tabbed = false;
  for (; at < end; at += 1) {
    const code = text.charCodeAt(at);
    if (code === 9) tabbed = true;
    else if (code !== 32) break;
    column += code === 9 ? 4 - (column % 4) : 1;
  }
  return { at, column, tabbed };
}

/**
 * Where the list mark at a place ends, or the place itself where none is
 * there: a bullet, or as many as nine digits and their delimiter.
 */
function markdownListMarkEnd(text: string, at: number, end: number): number {
  const code = text.charCodeAt(at);
  if (code === 45 || code === 43 || code === 42) return at + 1;
  let after = at;
  while (after < end && after - at < 9 && digit(text.charCodeAt(after)))
    after += 1;
  const delimiter = text.charCodeAt(after);
  if (after === at || after === end) return at;
  return delimiter === 46 || delimiter === 41 ? after + 1 : at;
}

/** The quote and list marks a line opens with: where they end, and how many
 * of each there are. */
interface Marks {
  readonly at: number;
  readonly quotes: number;
  readonly items: number;
}

function markdownMarksSkipped(text: string, from: number, end: number): Marks {
  let at = from;
  let quotes = 0;
  let items = 0;
  while (at < end) {
    const quoted = text.charCodeAt(at) === 62;
    let after = quoted ? at + 1 : markdownListMarkEnd(text, at, end);
    if (!quoted && (after === at || after === end)) break;
    if (!quoted && !markdownBlankCode(text.charCodeAt(after))) break;
    if (quoted) quotes += 1;
    else items += 1;
    while (after < end && markdownBlankCode(text.charCodeAt(after))) after += 1;
    at = after;
  }
  return { at, quotes, items };
}

/** How many of one fence mark stand at a place. */
function markdownFenceRun(text: string, at: number, end: number): number {
  const mark = text.charCodeAt(at);
  if (mark !== 96 && mark !== 126) return 0;
  let after = at;
  while (after < end && text.charCodeAt(after) === mark) after += 1;
  return after - at;
}

/**
 * Whether the marks at a place open a fence: three or more, and after
 * backticks no other on the line. Marks the text ends in that could yet come
 * to three answer too.
 */
function markdownFenceOpens(text: string, at: number, end: number): boolean {
  const width = markdownFenceRun(text, at, end);
  if (width === 0) return false;
  if (width < 3) return at + width === end && end === text.length;
  if (text.charCodeAt(at) === 126) return true;
  return !text.slice(at + width, end).includes("`");
}

/** Whether a line opens, from a place on, with a fence's mark as many times
 * as would close it. */
function markdownFenceMarked(
  text: string,
  at: number,
  end: number,
  fence: Fence,
): boolean {
  if (text.charCodeAt(at) !== fence.mark) return false;
  return markdownFenceRun(text, at, end) >= fence.width;
}

/** Whether nothing but blanks follows the fence marks at a place. */
function markdownFenceBare(text: string, at: number, end: number): boolean {
  let after = at + markdownFenceRun(text, at, end);
  while (after < end && markdownBlankCode(text.charCodeAt(after))) after += 1;
  return after === end;
}

/** Nothing is sure from here on, and the line is no fence's own. */
function markdownNestingDoubted(nesting: MarkdownNesting): 0 {
  nesting.doubt = true;
  nesting.fence = undefined;
  nesting.items.length = 0;
  nesting.item = false;
  return 0;
}

/** A fence's close, which is its own line and leaves no words open. */
function markdownNestingClosed(nesting: MarkdownNesting, fence: Fence): number {
  nesting.fence = undefined;
  nesting.clear = true;
  nesting.deep = false;
  return fence.depth;
}

/**
 * A line under a fence held by a list item or the margin: the fence's own
 * where it is blank or indented as far as the opening line, and the end of the
 * fence, the line being none of it, where it is indented less than what the
 * fence is inside. Between the two nothing says which.
 */
function markdownNestingListed(
  nesting: MarkdownNesting,
  fence: Fence,
  text: string,
  lead: Lead,
  end: number,
): number | undefined {
  if (lead.at === end) return fence.depth;
  if (lead.column < fence.from) {
    nesting.fence = undefined;
    return undefined;
  }
  if (lead.column < fence.indent) return markdownNestingDoubted(nesting);
  if (!markdownFenceMarked(text, lead.at, end, fence)) return fence.depth;
  if (lead.column - fence.indent > nestedIndentMax) return fence.depth;
  if (lead.column - fence.from > nestedIndentMax)
    return markdownNestingDoubted(nesting);
  if (!markdownFenceBare(text, lead.at, end)) return fence.depth;
  return markdownNestingClosed(nesting, fence);
}

/**
 * A line under a fence held by a quote: the end of the fence, the line being
 * none of it, where the quote's mark does not open it, and the fence's own
 * where what follows the mark is blank or indented as far as the opening line.
 */
function markdownNestingQuoted(
  nesting: MarkdownNesting,
  fence: Fence,
  text: string,
  lead: Lead,
  end: number,
): number | undefined {
  if (lead.at === end || text.charCodeAt(lead.at) !== 62) {
    nesting.fence = undefined;
    return undefined;
  }
  const placed =
    !lead.tabbed && lead.column >= fence.from && lead.column <= nestedIndentMax;
  if (!placed) return markdownNestingDoubted(nesting);
  const from = lead.at + (text.charCodeAt(lead.at + 1) === 32 ? 2 : 1);
  const inner = markdownLead(text, from, end);
  if (inner.at === end) return fence.depth;
  const marked = markdownFenceMarked(text, inner.at, end, fence);
  if (inner.tabbed)
    return fence.indent === 0 && !marked
      ? fence.depth
      : markdownNestingDoubted(nesting);
  if (inner.column < fence.indent) return markdownNestingDoubted(nesting);
  if (!marked) return fence.depth;
  if (inner.column > nestedIndentMax) return markdownNestingDoubted(nesting);
  if (!markdownFenceBare(text, inner.at, end)) return fence.depth;
  return markdownNestingClosed(nesting, fence);
}

/** The list items a line is not indented under are no longer sure to be
 * open. Whether there were any. */
function markdownNestingPopped(
  nesting: MarkdownNesting,
  column: number,
): boolean {
  const held = nesting.items.length;
  while ((nesting.items.at(-1) ?? 0) > column) nesting.items.pop();
  return nesting.items.length < held;
}

/** Whether a line from a bullet on is a rule: nothing but that mark, three
 * times or more, and blanks. */
function markdownRuled(text: string, at: number, end: number): boolean {
  const mark = text.charCodeAt(at);
  if (mark !== 45 && mark !== 42) return false;
  let marks = 0;
  for (let next = at; next < end; next += 1) {
    const code = text.charCodeAt(next);
    if (code === mark) marks += 1;
    else if (!markdownBlankCode(code)) return false;
  }
  return marks > 2;
}

/**
 * Whether a line that opens with one list mark was kept as the item it opens,
 * which it is where that is sure: one to four spaces after the mark, then
 * something, on a line that is no rule and within reach of what holds it.
 * `free` says any number may open one here.
 */
function markdownNestingItem(
  nesting: MarkdownNesting,
  text: string,
  lead: Lead,
  end: number,
  free: boolean,
): boolean {
  const after = markdownListMarkEnd(text, lead.at, end);
  if (after === lead.at) return false;
  let words = after;
  while (words < end && text.charCodeAt(words) === 32) words += 1;
  const spaces = words - after;
  if (spaces === 0 || spaces > 4 || words === end) return false;
  if (text.charCodeAt(words) === 9) return false;
  if (lead.column - (nesting.items.at(-1) ?? 0) > nestedIndentMax) return false;
  if (markdownRuled(text, lead.at, end)) return false;
  const first = text.charCodeAt(lead.at);
  const one = after - lead.at === 2 && first === 49;
  if (digit(first) && !one && !free) return false;
  nesting.items.push(lead.column + (words - lead.at));
  nesting.deep = false;
  nesting.item = true;
  return true;
}

function markdownFenceDepth(column: number): number {
  return 1 + (column >> 1);
}

/** A fence opened inside a quote: one mark of a quote within reach of the
 * margin, and the fence within reach of that. */
function markdownNestingQuoteOpened(
  nesting: MarkdownNesting,
  text: string,
  lead: Lead,
  marks: Marks,
  end: number,
): number {
  if (lead.column > nestedIndentMax) return markdownNestingDoubted(nesting);
  const from = lead.at + (text.charCodeAt(lead.at + 1) === 32 ? 2 : 1);
  const inner = markdownLead(text, from, end);
  if (inner.tabbed || inner.column > nestedIndentMax || inner.at !== marks.at)
    return markdownNestingDoubted(nesting);
  markdownNestingPopped(nesting, lead.column);
  const depth =
    markdownFenceDepth(lead.column) + markdownFenceDepth(inner.column);
  nesting.fence = {
    quoted: true,
    from: lead.column,
    indent: inner.column,
    mark: text.charCodeAt(marks.at),
    width: markdownFenceRun(text, marks.at, end),
    depth,
  };
  return depth;
}

/**
 * A line that opens a fence, placed: under the margin or a list item sure to
 * be open where it opens with nothing else, under the item its one list mark
 * is sure to open, inside a quote where one mark of a quote stands first, and
 * in doubt anywhere else. How deep the fence is held, or nothing where it is
 * not followed.
 */
function markdownNestingOpened(
  nesting: MarkdownNesting,
  text: string,
  lead: Lead,
  marks: Marks,
  end: number,
): number {
  const width = markdownFenceRun(text, marks.at, end);
  if (width < 3) return 1;
  const clear = nesting.clear && !nesting.deep;
  const mixed = marks.quotes + marks.items > 1;
  if (lead.tabbed || mixed) return markdownNestingDoubted(nesting);
  if (marks.quotes === 0 && marks.items === 0 && lead.column === 0) return 0;
  nesting.clear = false;
  if (marks.quotes === 1)
    return markdownNestingQuoteOpened(nesting, text, lead, marks, end);
  const free = markdownNestingPopped(nesting, lead.column) || clear;
  let from = nesting.items.at(-1) ?? 0;
  let indent = lead.column;
  if (marks.items === 1) {
    if (!markdownNestingItem(nesting, text, lead, end, free))
      return markdownNestingDoubted(nesting);
    from = nesting.items.at(-1) ?? 0;
    indent = from;
  }
  if (indent - from > nestedIndentMax || indent > markdownNestedColumnMax)
    return markdownNestingDoubted(nesting);
  nesting.deep = false;
  const depth = markdownFenceDepth(indent);
  const mark = text.charCodeAt(marks.at);
  nesting.fence = { quoted: false, from, indent, mark, width, depth };
  return depth;
}

/** A line that opens no fence: the list items it leaves are forgotten, and
 * the one it is sure to open is kept. */
function markdownNestingPlain(
  nesting: MarkdownNesting,
  text: string,
  lead: Lead,
  marks: Marks,
  end: number,
): void {
  const clear = nesting.clear && !nesting.deep;
  nesting.clear = false;
  if (lead.tabbed) {
    nesting.items.length = 0;
    nesting.deep = true;
    return;
  }
  const free = markdownNestingPopped(nesting, lead.column) || clear;
  const marked = marks.quotes > 0 || marks.items > 0;
  const single = marks.quotes === 0 && marks.items === 1;
  if (single && markdownNestingItem(nesting, text, lead, end, free)) return;
  const near = lead.column - (nesting.items.at(-1) ?? 0) <= nestedIndentMax;
  nesting.deep = marked || !near;
}

/** A line placed among the fences followed: see `markdownNestingLine`. */
function markdownNestingPlaced(
  nesting: MarkdownNesting,
  text: string,
  start: number,
  end: number,
): number {
  nesting.item = false;
  if (nesting.doubt) return 0;
  const lead = markdownLead(text, start, end);
  const fence = nesting.fence;
  if (fence !== undefined) {
    const held = fence.quoted
      ? markdownNestingQuoted(nesting, fence, text, lead, end)
      : markdownNestingListed(nesting, fence, text, lead, end);
    if (held !== undefined) return held;
  }
  if (lead.at === end) {
    nesting.clear = true;
    return 0;
  }
  const marks = markdownMarksSkipped(text, lead.at, end);
  if (markdownFenceOpens(text, marks.at, end))
    return markdownNestingOpened(nesting, text, lead, marks, end);
  markdownNestingPlain(nesting, text, lead, marks, end);
  return 0;
}

/** The most list items a line can leave open: one for each quote or list mark
 * it opens with, and one for every two columns of blank before and between
 * them, which is the least a list item's words are indented by. */
function markdownHeldMost(text: string, start: number, end: number): number {
  let columns = 0;
  let marks = 0;
  let at = start;
  while (at < end) {
    const code = text.charCodeAt(at);
    const blank = markdownBlankCode(code);
    let after =
      blank || code === 62 ? at + 1 : markdownListMarkEnd(text, at, end);
    if (after < end && !blank && code !== 62)
      after = markdownBlankCode(text.charCodeAt(after)) ? after : at;
    if (after === at) break;
    if (blank) columns += markdownBlankColumns(code);
    else marks += 1;
    at = after;
  }
  return marks + (columns >> 1);
}

/**
 * One line taken: nothing where it is no fence's own, and otherwise one more
 * than the most quotes and list items the fence can be inside. A fence's own
 * is its opening, its code or its close, and a line the text ends in that may
 * yet open one answers so too, with nothing kept of it.
 */
export function markdownNestingLine(
  nesting: MarkdownNesting,
  text: string,
  start: number,
  end: number,
): number {
  const open = nesting.fence;
  const depth = markdownNestingPlaced(nesting, text, start, end);
  const coded =
    depth > 0 && open !== undefined && (nesting.fence ?? open) === open;
  if (!coded)
    nesting.held = Math.max(nesting.held, markdownHeldMost(text, start, end));
  return depth;
}
