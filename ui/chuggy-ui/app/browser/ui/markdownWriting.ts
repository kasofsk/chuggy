/**
 * A text still being written, as the text its reader is drawn.
 *
 * `markdownTree.ts` reads marks that are whole, which is right for a text that
 * is: a mark half written is the characters it is. Read that way while the
 * rest is still arriving, an answer shows a star, a bracket or a row of pipes
 * that a moment later was never there. This closes what the block being
 * written leaves open and holds back what cannot be read yet, so each moment
 * of a text draws as what it is about to be. It is applied only while more is
 * coming, and the whole text is always read as itself.
 *
 * ONLY THE LAST BLOCK IS HALF WRITTEN, and inside it only the paragraph, the
 * heading, the cell or the fence the text ends in. The parser says which that
 * is, so a mark is closed inside a list three deep exactly as it is at the
 * margin.
 *
 * A MARK IS OPENED EARLY ONLY IF THE FINISHED TEXT WILL HONOUR IT. A star and
 * a pair of tildes are closed as soon as they open, because their closing is
 * what a writer nearly always goes on to write. An underscore is not: it is a
 * name's own far more often, so it marks once its pair is whole and is never
 * guessed at. A link is its own words until its address is whole, which is
 * also what it stays if the address turns out to be one nobody could follow.
 *
 * WHERE A MARK COULD BECOME TWO THINGS IT IS READ AS THE LIKELIER. A bracket
 * a word does not run into is a link's until what follows says otherwise, so
 * words a writer did mean to put in brackets gain them a moment late.
 */

import { markdownBlocksParsed } from "./markdownTree.ts";
import type {
  MarkdownBlock,
  MarkdownNode,
  MarkdownNodeOf,
  MarkdownParent,
} from "./markdownTree.ts";

type ListItem = MarkdownNodeOf<"listItem">;

/** A text as it is drawn while more is coming, and the first place it differs
 * from what was written. */
export interface MarkdownWritten {
  readonly text: string;
  readonly edited: number;
  /** What the text reads into, where finding its last block already read it
   * and left it as it was. */
  readonly blocks: readonly MarkdownBlock[] | undefined;
}

/** One opened mark a writer has yet to close. */
interface MarkdownWritingOpen {
  readonly mark: "*" | "~";
  /** How long the run was written, which the rule of three is stated over. */
  readonly written: number;
  readonly both: boolean;
  readonly at: number;
  readonly end: number;
  count: number;
}

/** What a scan of one block's text has come to. */
interface MarkdownWritingScan {
  readonly content: string;
  at: number;
  /** Where the text is cut, everything past it being held back. */
  cut: number;
  /** The backticks an open code span is closed with. */
  code: string;
  readonly removed: Set<number>;
  /** Whether the rest of the text is known to close no reference. */
  unreferenced: boolean;
  readonly opens: MarkdownWritingOpen[];
  readonly brackets: { readonly at: number; readonly linked: boolean }[];
}

const markdownWritingSpacePattern = /\s/u;
const markdownWritingPunctuationPattern = /[\p{P}\p{S}]/u;
const markdownWritingWordPattern = /[\p{L}\p{N}_]/u;

function markdownWritingSpace(character: string): boolean {
  return character === "" || markdownWritingSpacePattern.test(character);
}

function markdownWritingPunctuation(character: string): boolean {
  return markdownWritingPunctuationPattern.test(character);
}

/** Whether a run could open a mark and whether it could close one, by the
 * grammar's own rule about what stands on either side of it. */
function markdownWritingFlanks(
  content: string,
  at: number,
  end: number,
): { readonly opens: boolean; readonly closes: boolean } {
  const before = content.charAt(at - 1);
  const after = content.charAt(end);
  const spaceBefore = markdownWritingSpace(before);
  const spaceAfter = markdownWritingSpace(after);
  const markBefore = markdownWritingPunctuation(before);
  const markAfter = markdownWritingPunctuation(after);
  return {
    opens: !spaceAfter && (!markAfter || spaceBefore || markBefore),
    closes: !spaceBefore && (!markBefore || spaceAfter || markAfter),
  };
}

function markdownWritingRunEnd(content: string, at: number): number {
  const mark = content.charAt(at);
  let end = at;
  while (content.charAt(end) === mark) end += 1;
  return end;
}

/** The grammar's rule of three: a run that could open or close does not pair
 * with one whose length makes three with its own, unless both are threes. */
function markdownWritingPairs(
  open: MarkdownWritingOpen,
  written: number,
  both: boolean,
): boolean {
  if (!open.both && !both) return true;
  if ((open.written + written) % 3 !== 0) return true;
  return open.written % 3 === 0 && written % 3 === 0;
}

/** A closing run of stars spent against the stars still open, innermost
 * first; what it could not spend is handed back. */
function markdownWritingClosed(
  scan: MarkdownWritingScan,
  written: number,
  both: boolean,
): number {
  let count = written;
  while (count > 0) {
    const at = scan.opens.findLastIndex(
      (open) => open.mark === "*" && markdownWritingPairs(open, written, both),
    );
    const open = scan.opens[at];
    if (open === undefined) break;
    const used = open.count >= 2 && count >= 2 ? 2 : 1;
    open.count -= used;
    count -= used;
    scan.opens.length = open.count === 0 ? at : at + 1;
  }
  return count;
}

function markdownWritingStars(scan: MarkdownWritingScan): void {
  const at = scan.at;
  const end = markdownWritingRunEnd(scan.content, at);
  scan.at = end;
  if (end === scan.content.length) {
    scan.cut = at;
    return;
  }
  const flanks = markdownWritingFlanks(scan.content, at, end);
  const both = flanks.opens && flanks.closes;
  const written = end - at;
  const count = flanks.closes
    ? markdownWritingClosed(scan, written, both)
    : written;
  if (count > 0 && flanks.opens)
    scan.opens.push({ mark: "*", written, both, at, end, count });
}

/** A pair of tildes strikes and no other count of them does. */
function markdownWritingTildes(scan: MarkdownWritingScan): void {
  const at = scan.at;
  const end = markdownWritingRunEnd(scan.content, at);
  scan.at = end;
  if (end === scan.content.length) {
    scan.cut = at;
    return;
  }
  if (end - at !== 2) return;
  const flanks = markdownWritingFlanks(scan.content, at, end);
  const open = scan.opens.findLastIndex((held) => held.mark === "~");
  if (flanks.closes && open !== -1) scan.opens.length = open;
  else if (flanks.opens)
    scan.opens.push({ mark: "~", written: 2, both: false, at, end, count: 2 });
}

/** An underscore run is never guessed at, and one the text ends on is held
 * back: closed there it would mark, and a letter later be a name again. */
function markdownWritingUnderscores(scan: MarkdownWritingScan): void {
  const end = markdownWritingRunEnd(scan.content, scan.at);
  if (end === scan.content.length) scan.cut = scan.at;
  scan.at = end;
}

/** Where a run of exactly this many backticks next begins, which is what
 * closes a code span opened by one. */
function markdownWritingCodeClose(
  content: string,
  from: number,
  width: number,
): number {
  let at = content.indexOf("`", from);
  while (at !== -1) {
    const end = markdownWritingRunEnd(content, at);
    if (end - at === width) return at;
    at = content.indexOf("`", end);
  }
  return -1;
}

/** A code span: skipped where it is whole, and closed where it is not — less
 * the backticks the text ends on, which may be the start of its closing. */
function markdownWritingCode(scan: MarkdownWritingScan): void {
  const content = scan.content;
  const at = scan.at;
  const end = markdownWritingRunEnd(content, at);
  const close = markdownWritingCodeClose(content, end, end - at);
  if (close !== -1) {
    scan.at = close + (end - at);
    return;
  }
  scan.at = content.length;
  if (end === content.length) {
    scan.cut = at;
    return;
  }
  const held = /`+$/u.exec(content);
  const cut = held === null ? content.length : held.index;
  if (content.slice(end, cut).trim() === "") scan.cut = at;
  else {
    scan.cut = cut;
    scan.code = "`".repeat(end - at);
  }
}

const markdownWritingReferencePattern =
  /^\[\[\s*(?:t(?:i(?:c(?:k(?:e(?:t\s*(?::\s*(?:[1-9]\d*\s*\]?)?)?)?)?)?)?)?)?$/iu;

/** A bracket taken for a link's, along with the mark before it that makes the
 * link a picture. */
function markdownWritingBracketRemoved(
  scan: MarkdownWritingScan,
  at: number,
): void {
  scan.removed.add(at);
  if (scan.content.charAt(at - 1) === "!") scan.removed.add(at - 1);
}

function markdownWritingBracketOpen(scan: MarkdownWritingScan): void {
  const content = scan.content;
  const at = scan.at;
  if (content.charAt(at + 1) === "[" && !scan.unreferenced) {
    const close = content.indexOf("]]", at + 2);
    if (close !== -1) {
      scan.at = close + 2;
      return;
    }
    scan.unreferenced = true;
    if (markdownWritingReferencePattern.test(content.slice(at))) {
      scan.cut = at;
      scan.at = content.length;
      return;
    }
  }
  const linked = !markdownWritingWordPattern.test(content.charAt(at - 1));
  scan.brackets.push({ at, linked });
  scan.at = at + 1;
}

/** Where the address a link opens at this place ends, or nothing where it is
 * still being written. */
function markdownWritingAddressEnd(content: string, from: number): number {
  let depth = 1;
  for (let at = from; at < content.length; at += 1) {
    const character = content.charAt(at);
    if (character === "\\") at += 1;
    else if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    if (depth === 0) return at + 1;
  }
  return -1;
}

/** A closing bracket: a link whole is skipped, and one whose address has yet
 * to come or to finish is drawn as the words it will wear. */
function markdownWritingBracketClose(scan: MarkdownWritingScan): void {
  const content = scan.content;
  const at = scan.at;
  const open = scan.brackets.pop();
  scan.at = at + 1;
  if (open === undefined) return;
  if (at + 1 === content.length) {
    if (!open.linked) return;
    markdownWritingBracketRemoved(scan, open.at);
    scan.removed.add(at);
    return;
  }
  if (content.charAt(at + 1) !== "(") return;
  const end = markdownWritingAddressEnd(content, at + 2);
  if (end !== -1) {
    scan.at = end;
    return;
  }
  markdownWritingBracketRemoved(scan, open.at);
  scan.cut = at;
  scan.at = content.length;
}

const markdownWritingAddressStarts = ["http://", "https://", "mailto:"];

/** Whether what follows an angle bracket is, so far, an address between two
 * of them. */
function markdownWritingAddressBegun(rest: string): boolean {
  if (/[\s<>]/u.test(rest)) return false;
  const written = rest.toLowerCase();
  return markdownWritingAddressStarts.some(
    (start) => start.startsWith(written) || written.startsWith(start),
  );
}

/** An angle bracket: an address between two is skipped whole, and one still
 * being written is drawn without the bracket it will not keep. */
function markdownWritingAngle(scan: MarkdownWritingScan): void {
  const content = scan.content;
  const at = scan.at;
  const whole = /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/u.exec(
    content.slice(at),
  );
  if (whole !== null) {
    scan.at = at + whole[0].length;
    return;
  }
  scan.at = at + 1;
  if (!markdownWritingAddressBegun(content.slice(at + 1))) return;
  scan.removed.add(at);
  scan.at = content.length;
}

/** A bare address is one run to the grammar, so the marks inside it are its
 * own; the punctuation it ends on is not part of it. */
function markdownWritingBareEnd(content: string, at: number): number {
  if (markdownWritingWordPattern.test(content.charAt(at - 1))) return at;
  const bare = /^(?:https?:\/\/|www\.)[^\s<]*/iu.exec(content.slice(at));
  if (bare === null) return at;
  return at + bare[0].replace(/[?!.,:*_~]+$/u, "").length;
}

/** One character of the block taken into the scan. */
function markdownWritingStep(scan: MarkdownWritingScan): void {
  const content = scan.content;
  const at = scan.at;
  const character = content.charAt(at);
  const last = at === content.length - 1;
  if (character === "\\") {
    if (last) scan.cut = at;
    scan.at = at + 2;
  } else if (character === "`") markdownWritingCode(scan);
  else if (character === "*") markdownWritingStars(scan);
  else if (character === "~") markdownWritingTildes(scan);
  else if (character === "_") markdownWritingUnderscores(scan);
  else if (character === "[") markdownWritingBracketOpen(scan);
  else if (character === "]") markdownWritingBracketClose(scan);
  else if (character === "<") markdownWritingAngle(scan);
  else if (character === "!" && last) {
    scan.cut = at;
    scan.at = at + 1;
  } else if (
    character === "&" &&
    /^&#?[A-Za-z0-9]{0,31}$/u.test(content.slice(at))
  ) {
    scan.cut = at;
    scan.at = content.length;
  } else if (/[hw]/iu.test(character))
    scan.at = Math.max(markdownWritingBareEnd(content, at), at + 1);
  else scan.at = at + 1;
}

/** The scan's text with what it removed and cut left out, up to a place. */
function markdownWritingKept(scan: MarkdownWritingScan, to: number): string {
  const removed = [...scan.removed]
    .filter((at) => at < to)
    .sort((left, right) => left - right);
  let kept = "";
  let from = 0;
  for (const at of removed) {
    kept += scan.content.slice(from, at);
    from = at + 1;
  }
  return `${kept}${scan.content.slice(from, to)}`;
}

/** Whether nothing a reader would see is kept between two places. */
function markdownWritingBlank(
  scan: MarkdownWritingScan,
  from: number,
  to: number,
): boolean {
  for (let at = from; at < to; at += 1)
    if (!scan.removed.has(at) && !markdownWritingSpace(scan.content.charAt(at)))
      return false;
  return true;
}

function markdownWritingScanned(content: string): MarkdownWritingScan {
  const scan: MarkdownWritingScan = {
    content,
    at: 0,
    cut: content.length,
    code: "",
    removed: new Set(),
    unreferenced: false,
    opens: [],
    brackets: [],
  };
  while (scan.at < content.length && scan.cut === content.length)
    markdownWritingStep(scan);
  for (const bracket of scan.brackets)
    if (bracket.linked && bracket.at < scan.cut)
      markdownWritingBracketRemoved(scan, bracket.at);
  return scan;
}

/**
 * Where a block's closing marks are put: the end of its last line that holds
 * more than marks. A line of stars or tildes alone with more of them put after
 * it would be a rule or a fence, so a block that is marks alone gets none.
 */
function markdownWritingCloseAt(kept: string): number {
  let end = kept.length;
  while (end > 0) {
    const start = kept.lastIndexOf("\n", end - 1) + 1;
    const line = kept.slice(start, end);
    if (!/^[ \t>*~]*$/u.test(line)) return start + line.trimEnd().length;
    end = start - 1;
  }
  return -1;
}

/**
 * One block's text with its open marks closed. A mark with nothing after it
 * yet is held back with whatever it was waiting on, because closed around
 * nothing it would be read as something else.
 */
function markdownWritingInline(content: string): string {
  const scan = markdownWritingScanned(content);
  const opens = scan.opens.filter((open) => open.at < scan.cut);
  let cut = scan.cut;
  let last = opens.at(-1);
  while (last !== undefined && markdownWritingBlank(scan, last.end, cut)) {
    cut = last.at;
    opens.pop();
    last = opens.at(-1);
  }
  const kept = markdownWritingKept(scan, cut);
  const closing = opens
    .toReversed()
    .map((open) => open.mark.repeat(open.count))
    .join("");
  if (scan.code !== "") return `${kept}${scan.code}${closing}`;
  const at = markdownWritingCloseAt(kept);
  if (at === -1) return kept;
  return `${kept.slice(0, at)}${closing}${kept.slice(at)}`;
}

/** A line that is so far only the start of a mark — a heading's, a listed
 * line's, a rule's, a quote's, or the row under a table's header — past the
 * marks of whatever it is listed or quoted in. */
const markdownWritingAlonePattern =
  /^(?:[ \t>]|(?:[-+*]|\d{1,9}[.)])[ \t])*(?:#{1,6}|\+|[-*_:|](?:[ \t]*[-*_:|])*|\d{1,9}[.)]?)?[ \t]*$/u;

/** The longest line read as only the start of a mark, which bounds what the
 * pattern above is asked to try. */
const markdownWritingAloneCharsMax = 64;

/** A listed line that is so far only the box a task is ticked in. */
const markdownWritingTaskPattern = /^\[(?:[ xX]\]?)?$/u;

/** The block a text ends in, and the listed line holding it where one does. */
interface MarkdownWritingLeaf {
  readonly node: MarkdownNode;
  readonly item: ListItem | undefined;
}

function markdownWritingLeaf(
  blocks: readonly MarkdownBlock[],
): MarkdownWritingLeaf | undefined {
  let node: MarkdownNode | undefined = blocks.at(-1);
  let item: ListItem | undefined = undefined;
  while (node !== undefined) {
    const held: MarkdownNode | undefined = markdownWritingHolds(node)
      ? node.children.at(-1)
      : undefined;
    if (held === undefined) return { node, item };
    item =
      node.type === "listItem" && node.children.length === 1 ? node : undefined;
    node = held;
  }
  return undefined;
}

const markdownWritingHolderTypes: readonly string[] = [
  "list",
  "listItem",
  "blockquote",
  "table",
  "tableRow",
];

/** Whether a block is one that holds other blocks, a table's rows and a row's
 * cells among them. */
function markdownWritingHolds(node: MarkdownNode): node is MarkdownParent {
  return markdownWritingHolderTypes.includes(node.type);
}

function markdownWritingSpan(node: MarkdownNode): {
  readonly start: number;
  readonly end: number;
} {
  return {
    start: node.position?.start.offset ?? 0,
    end: node.position?.end.offset ?? 0,
  };
}

/**
 * A fence still open, written by its own rules: its language is held until
 * its line is whole, and so is a line that is so far only part of its close.
 * Nothing is said of code that is indented or already closed.
 */
function markdownWritingFence(
  raw: string,
  text: string,
  node: MarkdownNode,
): string | undefined {
  const span = markdownWritingSpan(node);
  const fence = /^(?:`{3,}|~{3,})/u.exec(text.slice(span.start))?.[0];
  if (fence === undefined) return undefined;
  const mark = fence.charAt(0);
  const closes = (line: string): boolean => {
    const run = line.replace(/^[ \t>]*/u, "").trimEnd();
    return run.length >= fence.length && run === mark.repeat(run.length);
  };
  const held = text.slice(span.start, span.end).split("\n");
  if (held.length > 1 && closes(held.at(-1) ?? "")) return undefined;
  const lines = raw.slice(span.start).split("\n");
  if (lines.length === 1) return `${raw.slice(0, span.start)}${fence}`;
  const last = (lines.at(-1) ?? "").replace(/^[ \t>]*/u, "");
  if (last === "" || last !== mark.repeat(last.length)) return raw;
  return raw.slice(0, -last.length);
}

/** One cell's text with its marks closed, or untouched where its own pipe
 * has already closed it. */
function markdownWritingCell(cell: string): string {
  const lead = /^[ \t>]*\|?/u.exec(cell)?.[0] ?? "";
  const content = cell.slice(lead.length);
  if (/(?<!\\)\|[ \t]*$/u.test(content)) return cell;
  return `${lead}${markdownWritingInline(content)}`;
}

/** How many cells a header's line holds, or none where every one is empty. */
function markdownWritingCells(line: string): number {
  const cells = line
    .replace(/^[ \t>]*\|/u, "")
    .replace(/(?<!\\)\|[ \t]*$/u, "")
    .split(/(?<!\\)\|/u);
  return cells.every((cell) => cell.trim() === "") ? 0 : cells.length;
}

function markdownWritingPiped(line: string): boolean {
  return /^[ \t>]*\|/u.test(line);
}

function markdownWritingPipeLast(line: string): number {
  for (let at = line.length - 1; at >= 0; at -= 1)
    if (line.charAt(at) === "|" && line.charAt(at - 1) !== "\\") return at;
  return 0;
}

/** What stands in front of a line's first cell, as the line under it has to
 * repeat it: a quote's mark kept, a list's mark as the space it takes. */
function markdownWritingLead(line: string): string {
  return (/^[^|]*/u.exec(line)?.[0] ?? "").replace(/[^>\s]/gu, " ");
}

/**
 * A paragraph whose end is a table's header, drawn as the table it is about
 * to be: the cell being written closed, and the row the next line will carry
 * written under it. `margin` is what the paragraph's own line opened on.
 */
function markdownWritingHeader(
  paragraph: string,
  margin: string,
): string | undefined {
  const lines = paragraph.replace(/\n[ \t>]*$/u, "").split("\n");
  const above = lines.slice(0, -1);
  const header = lines.at(-1) ?? "";
  if (!markdownWritingPiped(header)) return undefined;
  if (markdownWritingPiped(above.at(-1) ?? "")) return undefined;
  const cells = markdownWritingCells(header);
  if (cells === 0) return above.join("\n");
  const first = above.length === 0;
  const lead = markdownWritingLead(first ? `${margin}${header}` : header);
  const at = markdownWritingPipeLast(header);
  const written = `${header.slice(0, at)}${markdownWritingCell(header.slice(at))}`;
  return [...above, written, `${lead}|${" --- |".repeat(cells)}`].join("\n");
}

/** A paragraph the text ends in, rewritten: its marks closed, or its last
 * line drawn as the table header it is, or all of it held where it is so far
 * only a task's box. */
function markdownWritingParagraph(
  text: string,
  leaf: MarkdownWritingLeaf,
): string {
  const span = markdownWritingSpan(leaf.node);
  const after = text.slice(span.end);
  if (!/^[ \t]*(?:\n[ \t>]*)?$/u.test(after)) return text;
  const block = text.slice(span.start, span.end);
  const head = text.slice(0, span.start);
  const line = head.lastIndexOf("\n") + 1;
  const boxed = (words: string): boolean =>
    leaf.item !== undefined && markdownWritingTaskPattern.test(words.trimEnd());
  const paragraph = `${block}${after}`;
  const written =
    markdownWritingHeader(paragraph, head.slice(line)) ??
    markdownWritingInline(paragraph);
  const ticked = typeof leaf.item?.checked === "boolean";
  return boxed(block) || boxed(written) || (ticked && written.trim() === "")
    ? head.slice(0, line)
    : `${head}${written}`;
}

/** The block the text ends in rewritten, where it is one still open: a
 * blank line closes a paragraph, and a line's end a heading or a cell. */
function markdownWritingBlock(text: string, leaf: MarkdownWritingLeaf): string {
  const type = leaf.node.type;
  if (type === "paragraph") return markdownWritingParagraph(text, leaf);
  if (type !== "heading" && type !== "tableCell") return text;
  const span = markdownWritingSpan(leaf.node);
  const after = text.slice(span.end);
  if (after.trim() !== "" || after.includes("\n")) return text;
  const block = text.slice(span.start, span.end);
  const written =
    type === "heading"
      ? markdownWritingInline(block)
      : markdownWritingCell(block);
  return `${text.slice(0, span.start)}${written}${after}`;
}

function markdownWritingDiffers(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  let at = 0;
  while (at < length && left.charCodeAt(at) === right.charCodeAt(at)) at += 1;
  return at;
}

/** The text a report still being written is read from, and its blocks where
 * the text read to find its last one is the text drawn. */
function markdownWritingRead(
  raw: string,
): Pick<MarkdownWritten, "text" | "blocks"> {
  const lastStart = raw.lastIndexOf("\n") + 1;
  const alone =
    raw.length - lastStart <= markdownWritingAloneCharsMax &&
    markdownWritingAlonePattern.test(raw.slice(lastStart));
  const text = alone ? raw.slice(0, lastStart) : raw;
  const blocks = markdownBlocksParsed(text);
  if (blocks === undefined) return { text: raw, blocks };
  const leaf = markdownWritingLeaf(blocks);
  if (leaf === undefined) return { text, blocks };
  const written =
    leaf.node.type === "code"
      ? (markdownWritingFence(raw, text, leaf.node) ?? text)
      : markdownWritingBlock(text, leaf);
  return { text: written, blocks: written === text ? blocks : undefined };
}

/** A text still being written as it is drawn, and where that first departs
 * from what was written. */
export function markdownWritten(raw: string): MarkdownWritten {
  const read = markdownWritingRead(raw);
  return { ...read, edited: markdownWritingDiffers(raw, read.text) };
}
