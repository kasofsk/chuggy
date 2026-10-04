/**
 * A text read a block at a time, so that reading it again as it grows costs
 * what its last block costs.
 *
 * An answer is drawn once a frame for as long as it is being written, and
 * parsing all of it each time makes every frame cost more than the last. So a
 * reading keeps the blocks that are final and where in the text they end, and
 * the next reading of a longer text parses only what follows that place. A
 * block kept is the same object from then on, which is what lets the report
 * skip drawing it again.
 *
 * A BLOCK IS FINAL ONCE A LATER BLOCK HAS BEGUN ON A WHOLE LINE WITH NOTHING
 * WAITING ON IT. The grammar reads a line at a time, and with what reaches
 * backwards switched off in `markdownTree.ts` nothing written after such a
 * line can reopen what stood before it. The line still being written decides
 * nothing: `#` is a heading and `#a` is the paragraph above going on.
 *
 * AND THE TEXT FROM THAT LINE ON IS READ AS IF IT WERE THE WHOLE TEXT, which is
 * only right where the grammar would read the line the same with nothing above
 * it. It does not where a paragraph, a table or indented code is still waiting
 * to see whether the line is its own: a numbered line that cannot interrupt one
 * of those begins a list when it stands first. So the cut is made only under a
 * blank line, a heading, a rule or a closed fence, and never under indented
 * code, which waits across blank lines.
 *
 * A TEXT THAT IS WHOLE IS READ WHOLE. Only a text still being written is read
 * a block at a time, so the answer a transcript stores and the answer that was
 * heard are one reading by construction once the last word is in. That the two
 * agree at every moment before it is what the suite walks every prefix of its
 * fixtures, and a seeded soup of marks, to hold this to.
 *
 * AND WHAT THE WHOLE READING AGREES WITH IS KEPT AS THE OBJECT IT WAS. A block
 * of the whole text that reads the same as the block an earlier reading held
 * in its place is that reading's own, so a text that stops being written is
 * parsed once more and draws again only the blocks the stop changed.
 */

import {
  markdownBlocksParsed,
  markdownGuardInitial,
  markdownGuardNext,
  markdownNodesAlike,
  markdownPlainBlocks,
} from "./markdownTree.ts";
import type { MarkdownBlock, MarkdownGuard } from "./markdownTree.ts";
import { markdownWritten } from "./markdownWriting.ts";

/** One reading of a text. */
export interface MarkdownReading {
  readonly text: string;
  /** Whether more of the text was still coming when it was read. */
  readonly writing: boolean;
  /** The blocks nothing written later can change, each the object it was
   * when it was first kept. */
  readonly settled: readonly MarkdownBlock[];
  /** The blocks after them, read anew each time. */
  readonly open: readonly MarkdownBlock[];
  /** Where in the text the open blocks begin, which is the start of a line. */
  readonly offset: number;
  /** The guard's scan of everything before that place. */
  readonly guard: MarkdownGuard;
}

const markdownReadingEmpty: MarkdownReading = {
  text: "",
  writing: true,
  settled: [],
  open: [],
  offset: 0,
  guard: markdownGuardInitial,
};

/** A text past parsing, drawn as its characters and remembered as such: a
 * longer text that begins with it is past parsing too. */
function markdownReadingPlain(text: string, writing: boolean): MarkdownReading {
  return {
    text,
    writing,
    settled: [],
    open: markdownPlainBlocks(text),
    offset: 0,
    guard: { ...markdownGuardInitial, unreadable: true },
  };
}

function markdownBlockStart(block: MarkdownBlock): number {
  return block.position?.start.offset ?? 0;
}

/** Whether a block is fenced code, which is closed wherever a block follows
 * it; indented code begins at its line's own indent instead. */
function markdownBlockFenced(block: MarkdownBlock, tail: string): boolean {
  const start = markdownBlockStart(block);
  return (
    block.type === "code" &&
    (tail.startsWith("```", start) || tail.startsWith("~~~", start))
  );
}

/** Whether the line above a line is blank, which ends whatever paragraph or
 * table was being written above it. */
function markdownLineUnderBlank(tail: string, line: number): boolean {
  if (line === 0) return false;
  const above = line === 1 ? 0 : tail.lastIndexOf("\n", line - 2) + 1;
  return tail.slice(above, line - 1).trim() === "";
}

/**
 * Whether the grammar reads a block's first line as it would with nothing
 * above it: nothing is waiting to see whether the line is its own. `above` is
 * the block before it.
 */
function markdownBlockFresh(
  above: MarkdownBlock,
  tail: string,
  line: number,
): boolean {
  if (above.type === "heading" || above.type === "thematicBreak") return true;
  if (above.type === "code") return markdownBlockFenced(above, tail);
  return markdownLineUnderBlank(tail, line);
}

/**
 * How many of a tail's blocks are final: every block before the last one that
 * begins fresh, on a whole line above the first line the writing rewrote.
 */
function markdownBlocksFinal(
  blocks: readonly MarkdownBlock[],
  tail: string,
  edited: number,
): number {
  const limit = Math.min(
    tail.lastIndexOf("\n") + 1,
    tail.lastIndexOf("\n", edited - 1) + 1,
  );
  for (let at = blocks.length - 1; at > 0; at -= 1) {
    const block = blocks[at];
    const above = blocks[at - 1];
    if (block === undefined || above === undefined) continue;
    const start = markdownBlockStart(block);
    if (start >= limit) continue;
    const line = tail.lastIndexOf("\n", start - 1) + 1;
    if (markdownBlockFresh(above, tail, line)) return at;
  }
  return 0;
}

/** A whole text read in one step, every block of it final, and each the
 * object `before` held in its place where the two read the same. */
function markdownReadingWhole(
  text: string,
  before: MarkdownReading | undefined,
): MarkdownReading {
  const guard = markdownGuardNext(markdownGuardInitial, text, 0, text.length);
  const blocks = guard.unreadable ? undefined : markdownBlocksParsed(text);
  if (blocks === undefined) return markdownReadingPlain(text, false);
  const held = before === undefined ? [] : markdownReadingBlocks(before);
  return {
    text,
    writing: false,
    settled: blocks.map((block, at) => {
      const was = held[at];
      return was !== undefined && markdownNodesAlike(was, block) ? was : block;
    }),
    open: [],
    offset: text.length,
    guard,
  };
}

/** Whether an earlier reading is one this text, still being written, goes on
 * from. */
function markdownReadingKept(
  before: MarkdownReading | undefined,
  text: string,
): before is MarkdownReading {
  return before !== undefined && before.writing && text.startsWith(before.text);
}

/**
 * A text read, going on from an earlier reading of it where both were still
 * being written and it begins with the text that reading was of. `writing`
 * says more is coming, which is what has the open marks of its last block
 * closed.
 */
export function markdownReadingNext(
  before: MarkdownReading | undefined,
  text: string,
  writing: boolean,
): MarkdownReading {
  if (before?.text === text && before.writing === writing) return before;
  if (!writing) return markdownReadingWhole(text, before);
  const from = markdownReadingKept(before, text)
    ? before
    : markdownReadingEmpty;
  const scanned = markdownGuardNext(from.guard, text, from.offset, text.length);
  if (scanned.unreadable) return markdownReadingPlain(text, writing);
  const tail = text.slice(from.offset);
  const written = markdownWritten(tail);
  const blocks = written.blocks ?? markdownBlocksParsed(written.text);
  if (blocks === undefined) return markdownReadingPlain(text, writing);
  const final = markdownBlocksFinal(blocks, tail, written.edited);
  const next = blocks[final];
  if (final === 0 || next === undefined)
    return { ...from, text, writing, open: blocks };
  const offset =
    from.offset + tail.lastIndexOf("\n", markdownBlockStart(next) - 1) + 1;
  return {
    text,
    writing,
    settled: [...from.settled, ...blocks.slice(0, final)],
    open: blocks.slice(final),
    offset,
    guard: markdownGuardNext(from.guard, text, from.offset, offset),
  };
}

/** Every block of a reading, in the order the text holds them. */
export function markdownReadingBlocks(
  reading: MarkdownReading,
): readonly MarkdownBlock[] {
  return [...reading.settled, ...reading.open];
}
