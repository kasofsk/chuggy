/**
 * A section of a text still being written, as the blocks its reader is drawn.
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
 * THE SECTION IS PARSED ONCE, AND ONLY WHAT IT ENDS IN IS READ AGAIN. The words
 * of that paragraph, heading or cell are rewritten and read as a line of words,
 * and what they read into is put where the parser left the block. So a long
 * list being written costs its one parse and the words of its last line.
 *
 * A MARK IS OPENED EARLY ONLY IF THE FINISHED TEXT WILL HONOUR IT. A star and
 * a pair of tildes are closed as soon as they open, because their closing is
 * what a writer nearly always goes on to write. An underscore is not: it is a
 * name's own far more often, so it marks once its pair is whole and is never
 * guessed at. Nor is a star inside a word, which is a power or a pattern more
 * often than it is bold, and waits for its pair. A link is its own words until
 * its address is whole.
 *
 * WHERE A MARK COULD BECOME TWO THINGS IT IS READ AS THE LIKELIER. A bracket
 * a word does not run into is a link's until what follows says otherwise, so
 * words a writer did mean to put in brackets gain them a moment late.
 *
 * EVERY SCAN HERE IS ONE PASS. Nothing finds where a run ends with a pattern
 * that tries again from each place the run could begin, and a closing mark
 * does not look again under the open ones it has already failed against.
 */

import { markdownBlank, markdownBlankCut } from "./markdownPieces.ts";
import { markdownLineRead, markdownSectionRead } from "./markdownTree.ts";
import type {
  MarkdownBlock,
  MarkdownNode,
  MarkdownNodeOf,
  MarkdownParent,
} from "./markdownTree.ts";

type Code = MarkdownNodeOf<"code">;
type ListItem = MarkdownNodeOf<"listItem">;

/** One opened mark a writer has yet to close. */
interface MarkdownWritingOpen {
  readonly mark: "*" | "~";
  /** How long the run was written, which the rule of three is stated over. */
  readonly written: number;
  readonly both: boolean;
  readonly at: number;
  readonly end: number;
  /** Whether it stands inside a word, where only its writer closes it. */
  readonly waits: boolean;
  count: number;
}

/** What a character is drawn as when it is not simply itself: nothing, or
 * itself and no mark. */
const drawnRemoved = 1;
const drawnEscaped = 2;

/** What a scan of one block's text has come to. */
interface MarkdownWritingScan {
  readonly content: string;
  at: number;
  /** Where the text is cut, everything past it being held back. */
  cut: number;
  /** The backticks an open code span is closed with. */
  code: string;
  readonly drawn: Uint8Array;
  /** Whether the rest of the text is known to close no reference. */
  unreferenced: boolean;
  readonly opens: MarkdownWritingOpen[];
  /** Where in `opens` the tildes are. */
  readonly tildes: number[];
  /** For each kind of closing run, how many of `opens` from the first hold
   * nothing it pairs with. */
  readonly bottoms: number[];
  readonly brackets: { readonly at: number; readonly linked: boolean }[];
}

const markdownWritingSpacePattern = /\s/u;
const markdownWritingPunctuationPattern = /[\p{P}\p{S}]/u;
const markdownWritingWordPattern = /[\p{L}\p{N}_]/u;

/** Whether a character is one of a set, the end of a text being none. */
function markdownWritingAmong(set: string, character: string): boolean {
  return character !== "" && set.includes(character);
}

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
  const mark = content.charCodeAt(at);
  let end = at;
  while (content.charCodeAt(end) === mark) end += 1;
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

/** The open marks cut back to a count, and with them what was known of the
 * ones cut. */
function markdownWritingOpensCut(
  scan: MarkdownWritingScan,
  length: number,
): void {
  scan.opens.length = length;
  while ((scan.tildes.at(-1) ?? -1) >= length) scan.tildes.pop();
  for (let kind = 0; kind < scan.bottoms.length; kind += 1)
    scan.bottoms[kind] = Math.min(scan.bottoms[kind] ?? 0, length);
}

/**
 * Where in `opens` the innermost star a closing run pairs with is, or nothing.
 * A run that finds none leaves word of how far it looked, which only its
 * length in threes and its sides decide, so the next of its kind looks no
 * further down.
 */
function markdownWritingOpener(
  scan: MarkdownWritingScan,
  written: number,
  both: boolean,
): number | undefined {
  const kind = (written % 3) * 2 + (both ? 1 : 0);
  const bottom = scan.bottoms[kind] ?? 0;
  for (let at = scan.opens.length - 1; at >= bottom; at -= 1) {
    const open = scan.opens[at];
    if (open?.mark === "*" && markdownWritingPairs(open, written, both))
      return at;
  }
  scan.bottoms[kind] = scan.opens.length;
  return undefined;
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
    const at = markdownWritingOpener(scan, written, both);
    const open = at === undefined ? undefined : scan.opens[at];
    if (at === undefined || open === undefined) break;
    const used = open.count >= 2 && count >= 2 ? 2 : 1;
    open.count -= used;
    count -= used;
    markdownWritingOpensCut(scan, open.count === 0 ? at : at + 1);
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
  if (count === 0 || !flanks.opens) return;
  const before = scan.content.charAt(at - 1);
  const waits =
    !markdownWritingSpace(before) && !markdownWritingPunctuation(before);
  scan.opens.push({ mark: "*", written, both, at, end, waits, count });
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
  const open = scan.tildes.at(-1);
  if (flanks.closes && open !== undefined) markdownWritingOpensCut(scan, open);
  else if (flanks.opens) {
    scan.tildes.push(scan.opens.length);
    scan.opens.push({
      mark: "~",
      written: 2,
      both: false,
      at,
      end,
      waits: false,
      count: 2,
    });
  }
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
  let cut = content.length;
  while (cut > end && content.charCodeAt(cut - 1) === 96) cut -= 1;
  if (markdownBlank(content.slice(end, cut))) scan.cut = at;
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
  scan.drawn[at] = drawnRemoved;
  if (scan.content.charAt(at - 1) === "!") scan.drawn[at - 1] = drawnRemoved;
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
    scan.drawn[at] = drawnRemoved;
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

/** How much of an address's start is looked at to say whether it is one. */
const markdownWritingAddressStartChars = 8;

/** Whether what follows an angle bracket is, so far, an address with a scheme
 * a member could be sent to. */
function markdownWritingAddressBegun(rest: string): boolean {
  const written = rest.slice(0, markdownWritingAddressStartChars).toLowerCase();
  return markdownWritingAddressStarts.some(
    (start) => start.startsWith(written) || written.startsWith(start),
  );
}

const markdownWritingAngledPattern =
  /^(?:[A-Za-z][A-Za-z0-9+.-]{1,31}:|[A-Za-z0-9.+_-]+@[A-Za-z0-9.-]+$)/u;

/** The longest name an email is held back for while it is still only a name. */
const markdownWritingNameCharsMax = 64;

const markdownWritingNamePattern = /^[A-Za-z0-9.+_-]*$/u;
const markdownWritingEmailPattern = /^[A-Za-z0-9.+_-]+@[A-Za-z0-9.-]*$/u;

/**
 * An angle bracket: an address between two is skipped whole, and one still
 * being written is drawn without the bracket it will not keep. What may yet be
 * an email's name is held back until an `@` or anything else says which it is.
 */
function markdownWritingAngle(scan: MarkdownWritingScan): void {
  const content = scan.content;
  const at = scan.at;
  let end = at + 1;
  while (end < content.length) {
    const code = content.charCodeAt(end);
    if (code === 60 || code === 62 || markdownWritingSpace(content.charAt(end)))
      break;
    end += 1;
  }
  const held = content.slice(at + 1, end);
  scan.at = at + 1;
  if (end < content.length) {
    const whole = content.charCodeAt(end) === 62;
    if (whole && markdownWritingAngledPattern.test(held)) scan.at = end + 1;
    return;
  }
  const email = markdownWritingEmailPattern.test(held);
  if (markdownWritingAddressBegun(held) || email) scan.drawn[at] = drawnRemoved;
  else if (
    held.length <= markdownWritingNameCharsMax &&
    markdownWritingNamePattern.test(held)
  )
    scan.cut = at;
  else return;
  scan.at = content.length;
}

const markdownWritingBareTrail = "?!.,:*_~";

/** A bare address is one run to the grammar, so the marks inside it are its
 * own; the punctuation it ends on is not part of it. */
function markdownWritingBareEnd(content: string, at: number): number {
  if (markdownWritingWordPattern.test(content.charAt(at - 1))) return at;
  const head = content.slice(at, at + markdownWritingAddressStartChars);
  if (!/^(?:https?:\/\/|www\.)/iu.test(head)) return at;
  let end = at;
  while (end < content.length) {
    const character = content.charAt(end);
    if (character === "<" || markdownWritingSpace(character)) break;
    end += 1;
  }
  while (
    end > at &&
    markdownWritingAmong(markdownWritingBareTrail, content.charAt(end - 1))
  )
    end -= 1;
  return end;
}

/** The longest a character reference is while it is still being written. */
const markdownWritingReferenceCharsMax = 33;

/** Whether the text ends in a character reference still being written. */
function markdownWritingReferenceBegun(content: string, at: number): boolean {
  return (
    content.length - at <= markdownWritingReferenceCharsMax &&
    /^&#?[A-Za-z0-9]*$/u.test(content.slice(at))
  );
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
  } else if (character === "&" && markdownWritingReferenceBegun(content, at)) {
    scan.cut = at;
    scan.at = content.length;
  } else if (/[hw]/iu.test(character))
    scan.at = Math.max(markdownWritingBareEnd(content, at), at + 1);
  else scan.at = at + 1;
}

/** The scan's text up to a place, with what it removed left out and what it
 * escaped written as no mark. */
function markdownWritingKept(scan: MarkdownWritingScan, to: number): string {
  const parts: string[] = [];
  let from = 0;
  for (let at = 0; at < to; at += 1) {
    const drawn = scan.drawn[at] ?? 0;
    if (drawn === 0) continue;
    parts.push(scan.content.slice(from, at));
    if (drawn === drawnEscaped) parts.push("\\");
    from = drawn === drawnRemoved ? at + 1 : at;
  }
  parts.push(scan.content.slice(from, to));
  return parts.join("");
}

/** Whether nothing a reader would see is kept between two places. */
function markdownWritingBlank(
  scan: MarkdownWritingScan,
  from: number,
  to: number,
): boolean {
  for (let at = from; at < to; at += 1)
    if (
      scan.drawn[at] !== drawnRemoved &&
      !markdownWritingSpace(scan.content.charAt(at))
    )
      return false;
  return true;
}

/** How many kinds of closing run there are: a length in threes, and whether
 * the run could open too. */
const markdownWritingKinds = 6;

function markdownWritingScanned(content: string): MarkdownWritingScan {
  const scan: MarkdownWritingScan = {
    content,
    at: 0,
    cut: content.length,
    code: "",
    drawn: new Uint8Array(content.length),
    unreferenced: false,
    opens: [],
    tildes: [],
    bottoms: new Array<number>(markdownWritingKinds).fill(0),
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
    let last = end;
    while (
      last > start &&
      markdownWritingAmong(" \t>*~", kept.charAt(last - 1))
    )
      last -= 1;
    if (last > start) {
      while (markdownWritingAmong(" \t", kept.charAt(end - 1))) end -= 1;
      return end;
    }
    end = start - 1;
  }
  return -1;
}

/**
 * One block's words with their open marks closed. A mark with nothing after it
 * yet is held back with whatever it was waiting on, because closed around
 * nothing it would be read as something else; a star waiting inside a word is
 * written as no mark where others are closed around it.
 */
export function markdownWritingInline(content: string): string {
  const scan = markdownWritingScanned(content);
  const opens = scan.opens.filter((open) => open.at < scan.cut);
  let cut = scan.cut;
  let last = opens.at(-1);
  while (last !== undefined && markdownWritingBlank(scan, last.end, cut)) {
    cut = last.at;
    opens.pop();
    last = opens.at(-1);
  }
  const closing = opens
    .filter((open) => !open.waits)
    .toReversed()
    .map((open) => open.mark.repeat(open.count))
    .join("");
  if (closing !== "")
    for (const open of opens)
      if (open.waits)
        scan.drawn.fill(drawnEscaped, open.at, open.at + open.count);
  const kept = markdownWritingKept(scan, cut);
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
const markdownWritingTaskPattern = /^\[(?:[ xX]\]?)?[ \t\n]*$/u;

/** The block a text ends in, and the blocks holding it, outermost first. */
interface MarkdownWritingLeaf {
  readonly node: MarkdownNode;
  readonly held: readonly MarkdownParent[];
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

function markdownWritingLeaf(
  blocks: readonly MarkdownBlock[],
): MarkdownWritingLeaf | undefined {
  const held: MarkdownParent[] = [];
  let node: MarkdownNode | undefined = blocks.at(-1);
  while (node !== undefined) {
    const last: MarkdownNode | undefined = markdownWritingHolds(node)
      ? node.children.at(-1)
      : undefined;
    if (last === undefined || !markdownWritingHolds(node))
      return { node, held };
    held.push(node);
    node = last;
  }
  return undefined;
}

/** The blocks a holder holds, or the section's own, as what may be changed. */
function markdownWritingChildren(
  blocks: MarkdownBlock[],
  parent: MarkdownParent | undefined,
): MarkdownNode[] {
  return parent === undefined ? blocks : parent.children;
}

/** The block the text ends in put aside for others, or for nothing. */
function markdownWritingPlaced(
  blocks: MarkdownBlock[],
  leaf: MarkdownWritingLeaf,
  nodes: readonly MarkdownNode[],
): void {
  const children = markdownWritingChildren(blocks, leaf.held.at(-1));
  children.splice(children.length - 1, 1, ...nodes);
}

/** The block the text ends in taken away, and with it every block that held
 * nothing else: what the line it stands on wrote is not drawn yet. */
function markdownWritingPruned(
  blocks: MarkdownBlock[],
  leaf: MarkdownWritingLeaf,
): void {
  for (let at = leaf.held.length - 1; at >= -1; at -= 1) {
    const children = markdownWritingChildren(blocks, leaf.held[at]);
    children.pop();
    if (children.length > 0) return;
  }
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

/** What a line opens on that is its quote's or its list's and not its own. */
function markdownWritingLead(line: string): string {
  let at = 0;
  while (markdownWritingAmong(" \t>", line.charAt(at))) at += 1;
  return line.slice(0, at);
}

/**
 * A fence still open inside a list or a quote, written by its own rules: its
 * language is held until its line is whole, and so is a line that is so far
 * only part of its close. Nothing is said of code that is indented or closed.
 */
function markdownWritingFence(text: string, node: Code): void {
  const lines = text.slice(markdownWritingSpan(node).start).split("\n");
  const fence = /^(?:`{3,}|~{3,})/u.exec(lines[0] ?? "")?.[0];
  if (fence === undefined) return;
  if (lines.length === 1) {
    node.lang = null;
    node.meta = null;
    return;
  }
  const line = lines.at(-1) ?? "";
  const last = line.slice(markdownWritingLead(line).length);
  const mark = fence.charAt(0);
  if (last === "" || last !== mark.repeat(last.length)) return;
  if (last.length >= fence.length) return;
  const cut = node.value.lastIndexOf("\n");
  node.value = cut < 0 ? "" : node.value.slice(0, cut);
}

/** Where a line's last pipe that is not escaped is. */
function markdownWritingPipeLast(line: string): number {
  for (let at = line.length - 1; at >= 0; at -= 1)
    if (line.charAt(at) === "|" && line.charAt(at - 1) !== "\\") return at;
  return 0;
}

/** A cell's words: what follows its opening pipe, or nothing where its own
 * closing pipe has already ended them. */
function markdownWritingCellWords(cell: string): string | undefined {
  const lead = markdownWritingLead(cell);
  const piped = cell.charAt(lead.length) === "|";
  const content = cell.slice(lead.length + (piped ? 1 : 0));
  let end = content.length;
  while (markdownWritingAmong(" \t", content.charAt(end - 1))) end -= 1;
  const closed =
    content.charAt(end - 1) === "|" && content.charAt(end - 2) !== "\\";
  return closed ? undefined : content;
}

/** How many cells a header's line holds, or none where every one is empty. */
function markdownWritingCells(line: string): number {
  const cells = line
    .replace(/^[ \t]*\|/u, "")
    .replace(/(?<!\\)\|[ \t]*$/u, "")
    .split(/(?<!\\)\|/u);
  return cells.every((cell) => markdownBlank(cell)) ? 0 : cells.length;
}

/** A paragraph's last line read as the header of a table about to be. */
interface MarkdownWritingHeader {
  /** The lines above it, which stay a paragraph. */
  readonly above: string;
  /** The header with the cell being written closed, and under it the row the
   * next line will carry; nothing where no cell holds anything yet. */
  readonly table: string | undefined;
}

/**
 * A paragraph whose end is a table's header, as the table it is about to be.
 * The row under the header is given as many cells as the header has once its
 * last one is closed, so a cell that opens on a mark held back is not counted
 * before it is drawn.
 */
function markdownWritingHeader(
  lines: readonly string[],
): MarkdownWritingHeader | undefined {
  const above = lines.slice(0, -1);
  const header = lines.at(-1) ?? "";
  if (!header.startsWith("|")) return undefined;
  if ((above.at(-1) ?? "").startsWith("|")) return undefined;
  const at = markdownWritingPipeLast(header);
  const words = markdownWritingCellWords(header.slice(at));
  const cell = words === undefined ? "" : markdownWritingInline(words);
  const written =
    words === undefined ? header : `${header.slice(0, at)}|${cell}`;
  const cells = markdownWritingCells(written);
  return {
    above: above.join("\n"),
    table: cells === 0 ? undefined : `${written}\n|${" --- |".repeat(cells)}`,
  };
}

/** Whether a line of a paragraph is one its quote or its list did not open:
 * the grammar carries such a line along, and reads no table from it. */
function markdownWritingCarried(
  leaf: MarkdownWritingLeaf,
  line: string,
): boolean {
  const lead = markdownWritingLead(line);
  const quotes = leaf.held.filter((held) => held.type === "blockquote").length;
  const quoted = lead.split(">").length - 1;
  const listed = leaf.held.some((held) => held.type === "listItem");
  const column = (leaf.node.position?.start.column ?? 1) - 1;
  return quoted < quotes || (listed && lead.length < column);
}

/**
 * A paragraph's lines without what each opens on that is its quote's or its
 * list's, and the header its last line is where it is one. `ticked` says the
 * paragraph is a task's, whose box the grammar has already taken as its own.
 */
function markdownWritingLines(
  text: string,
  leaf: MarkdownWritingLeaf,
  ticked: boolean,
): {
  readonly lines: readonly string[];
  readonly header: MarkdownWritingHeader | undefined;
} {
  const span = markdownWritingSpan(leaf.node);
  const written = text.slice(span.start, span.end).split("\n");
  const lines = written.map((line, at) => {
    if (at > 0) return line.slice(markdownWritingLead(line).length);
    return ticked ? line.replace(/^\[[ xX]\][ \t]/u, "") : line;
  });
  const carried =
    written.length > 1 && markdownWritingCarried(leaf, written.at(-1) ?? "");
  return {
    lines,
    header: carried ? undefined : markdownWritingHeader(lines),
  };
}

/** The table a header is about to be, under the lines that stay a paragraph,
 * or nothing where either cannot be read. */
function markdownWritingTable(
  header: MarkdownWritingHeader,
): readonly MarkdownNode[] | undefined {
  const above = markdownLineRead(header.above);
  const table =
    header.table === undefined ? [] : markdownSectionRead(header.table);
  if (above === undefined || table === undefined) return undefined;
  if (header.table !== undefined && table.at(0)?.type !== "table")
    return undefined;
  const paragraph: MarkdownNode = { type: "paragraph", children: [...above] };
  return [...(above.length === 0 ? [] : [paragraph]), ...table];
}

/** A paragraph the text ends in, rewritten: its marks closed, or its last
 * line drawn as the table header it is, or all of it held where it is so far
 * only a task's box. */
function markdownWritingParagraph(
  text: string,
  blocks: MarkdownBlock[],
  leaf: MarkdownWritingLeaf,
  node: MarkdownNodeOf<"paragraph">,
): void {
  const after = text.slice(markdownWritingSpan(node).end);
  if (!/^[ \t]*(?:\n[ \t>]*)?$/u.test(after)) return;
  const above = leaf.held.at(-1);
  const item: ListItem | undefined =
    above?.type === "listItem" && above.children.length === 1
      ? above
      : undefined;
  const ticked = typeof item?.checked === "boolean";
  const { lines, header } = markdownWritingLines(text, leaf, ticked);
  const words = `${lines.join("\n")}${after.includes("\n") ? "\n" : ""}`;
  const written = header === undefined ? markdownWritingInline(words) : "";
  const drawn = header === undefined ? written : (header.table ?? header.above);
  const boxed =
    item !== undefined &&
    (markdownWritingTaskPattern.test(lines.join("\n")) ||
      markdownWritingTaskPattern.test(drawn) ||
      (ticked && markdownBlank(drawn)));
  if (boxed) markdownWritingPruned(blocks, leaf);
  else if (header !== undefined) {
    const nodes = markdownWritingTable(header);
    if (nodes !== undefined) markdownWritingPlaced(blocks, leaf, nodes);
  } else if (written !== words) {
    const read = markdownLineRead(written);
    if (read?.length === 0) markdownWritingPlaced(blocks, leaf, []);
    else if (read !== undefined) node.children = [...read];
  }
}

/** A heading's words: what its line holds between the marks it opens with
 * and the ones that may close it. */
function markdownWritingHeadingWords(line: string): string {
  let start = 0;
  while (line.charAt(start) === " ") start += 1;
  while (line.charAt(start) === "#") start += 1;
  while (markdownWritingAmong(" \t", line.charAt(start))) start += 1;
  let end = line.length;
  while (end > start && markdownWritingAmong(" \t", line.charAt(end - 1)))
    end -= 1;
  let marks = end;
  while (marks > start && line.charAt(marks - 1) === "#") marks -= 1;
  const closed =
    marks < end &&
    (marks === start || markdownWritingAmong(" \t", line.charAt(marks - 1)));
  return line.slice(start, closed ? marks : end);
}

/** A heading or a cell the text ends in, its words read again with their
 * marks closed: a line's end closes either. */
function markdownWritingLine(
  text: string,
  node: MarkdownNodeOf<"heading" | "tableCell">,
): void {
  const span = markdownWritingSpan(node);
  const after = text.slice(span.end);
  if (!markdownBlank(after) || after.includes("\n")) return;
  const block = text.slice(span.start, span.end);
  const words =
    node.type === "heading"
      ? markdownWritingHeadingWords(block)
      : markdownWritingCellWords(block);
  if (words === undefined) return;
  const written = markdownWritingInline(words);
  if (written === words) return;
  const read = markdownLineRead(
    node.type === "heading" ? written : written.replaceAll("\\|", "|"),
  );
  if (read !== undefined) node.children = [...read];
}

/** The block a section ends in rewritten, where it is one still open. */
function markdownWritingBlock(
  text: string,
  blocks: MarkdownBlock[],
  leaf: MarkdownWritingLeaf,
): void {
  const node = leaf.node;
  if (node.type === "code") markdownWritingFence(text, node);
  else if (node.type === "paragraph")
    markdownWritingParagraph(text, blocks, leaf, node);
  else if (node.type === "heading" || node.type === "tableCell")
    markdownWritingLine(text, node);
}

/** A text without the blank lines after the first it closes on: they say
 * nothing the first did not, and the parser reads every one. */
function markdownWritingBlanksCut(text: string): string {
  const closed = markdownBlankCut(text, 0, text.length);
  const blank = closed < text.length ? text.indexOf("\n", closed + 1) : -1;
  return blank < 0 ? text : text.slice(0, blank + 1);
}

/**
 * A section still being written as the blocks it is drawn as, or nothing
 * where `markdownTree.ts` will not read it. A last line that is so far only
 * the start of a mark is held back whole.
 */
export function markdownWritten(
  written: string,
): readonly MarkdownBlock[] | undefined {
  const raw = markdownWritingBlanksCut(written);
  const lastStart = raw.lastIndexOf("\n") + 1;
  const alone =
    raw.length - lastStart <= markdownWritingAloneCharsMax &&
    markdownWritingAlonePattern.test(raw.slice(lastStart));
  const text = alone ? raw.slice(0, lastStart) : raw;
  const read = markdownSectionRead(text);
  if (read === undefined) return undefined;
  const blocks = [...read];
  const leaf = markdownWritingLeaf(blocks);
  if (leaf !== undefined) markdownWritingBlock(text, blocks, leaf);
  return blocks;
}
