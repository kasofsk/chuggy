/**
 * A text read a piece at a time, so that reading it again as it grows costs
 * what its last piece costs.
 *
 * An answer is drawn once a frame for as long as it is being written, and
 * parsing all of it each time makes every frame cost more than the last. So a
 * reading keeps the blocks of every piece another has begun after, and where
 * in the text the last piece begins, and the next reading of a longer text
 * reads only what follows that place. A block kept is the same object from
 * then on, which is what lets the report skip drawing it again.
 *
 * WHERE A PIECE BEGINS IS `markdownPieces.ts`'s TO SAY, and it says so from
 * the text above the place alone. So a piece another has begun after is
 * final, the text read from where the last one begins reads as it would with
 * all of it read, and nothing is kept unless the place moves past it.
 *
 * A LINE ENDS WHERE ITS WRITER ENDED IT. A carriage return, alone or before a
 * line feed, is made a line feed before anything here looks at the text, so
 * no part of this reader has an idea of a line the others do not share.
 *
 * A TEXT THAT IS WHOLE IS READ BY WHAT READ IT WHILE IT WAS WRITTEN: the same
 * pieces, each read as final. Only the piece a text still being written ends
 * in is read through `markdownWriting.ts`, so the answer a transcript stores
 * and the answer that was heard are one reading once the last word is in.
 *
 * A BLOCK THAT READS THE SAME IS KEPT AS THE OBJECT IT WAS. The last piece is
 * read again whole each time, and a text that stops being written is read
 * once more, and either draws again only the blocks that changed.
 *
 * A READING GIVES THE FRAME BACK. A piece is never read in parts, but a text
 * still being written is not read past one once a frame's share is spent: the
 * rest is read by the next call, and where one reading cost more than that
 * share the next waits a multiple of the cost, so a text that is dear to read
 * arrives in steps and the page stays live between them. A text that is whole
 * is read at once.
 */

import { markdownPiecesFrom } from "./markdownPieces.ts";
import type { MarkdownPiece } from "./markdownPieces.ts";
import {
  markdownNodesAlike,
  markdownNormalised,
  markdownPieceBlocks,
  markdownPlainBlocks,
} from "./markdownTree.ts";
import type { MarkdownBlock } from "./markdownTree.ts";
import { markdownWritten } from "./markdownWriting.ts";

/** What a reading may spend of one frame before it gives the rest back, in
 * milliseconds. */
export const markdownReadingShareMs = 8;

/** How many times its own cost a reading that went past its share is not
 * taken again for. */
export const markdownReadingRest = 3;

/** The time, in milliseconds, from wherever its giver counts. */
export type MarkdownClock = () => number;

/** A clock that never moves, under which every reading is taken whole. */
const markdownClockStill: MarkdownClock = () => 0;

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
  /** Where the piece the open blocks are read from begins, in the text with
   * its line ends made one: the start of a line. */
  readonly offset: number;
  /** What the sections before that place cost between them. */
  readonly spent: number;
  /** Whether the reading stopped short of the text's end to give the frame
   * back. */
  readonly behind: boolean;
  /** The times between which the text is not read again while it is
   * written: when this reading ended, and when its rest does. */
  readonly since: number;
  readonly until: number;
}

const markdownReadingEmpty: MarkdownReading = {
  text: "",
  writing: true,
  settled: [],
  open: [],
  offset: 0,
  spent: 0,
  behind: false,
  since: 0,
  until: 0,
};

/** Every block of a reading, in the order the text holds them. */
export function markdownReadingBlocks(
  reading: MarkdownReading,
): readonly MarkdownBlock[] {
  return [...reading.settled, ...reading.open];
}

/** Whether a reading is all there is to read of a text as it stands. */
export function markdownReadingCurrent(
  reading: MarkdownReading,
  text: string,
  writing: boolean,
): boolean {
  return (
    reading.text === text && reading.writing === writing && !reading.behind
  );
}

/** Whether a reading is resting at a time: it went past its share, and the
 * rest that earned it is not over. A clock that has gone back is no rest. */
export function markdownReadingRests(
  reading: MarkdownReading,
  now: number,
): boolean {
  return reading.since <= now && now < reading.until;
}

/** Blocks, each the object held in its place where the two read the same. */
function markdownBlocksKept(
  blocks: readonly MarkdownBlock[],
  held: readonly MarkdownBlock[],
  from: number,
): readonly MarkdownBlock[] {
  return blocks.map((block, at) => {
    const was = held[from + at];
    return was !== undefined && markdownNodesAlike(was, block) ? was : block;
  });
}

/** The piece a text still being written ends in, as the blocks it is drawn. */
function markdownPieceWritten(
  text: string,
  piece: MarkdownPiece,
): readonly MarkdownBlock[] {
  if (piece.kind !== "read") return markdownPieceBlocks(text, piece, true);
  const held = text.slice(piece.start, piece.end);
  return markdownWritten(held) ?? markdownPlainBlocks(held);
}

/** Whether an earlier reading is one this text goes on from. */
function markdownReadingKept(
  before: MarkdownReading | undefined,
  text: string,
): before is MarkdownReading {
  return before !== undefined && before.writing && text.startsWith(before.text);
}

/** What a reading goes on from: where the last one left off and the blocks
 * it held from there, or the text's start and every block it held. */
function markdownReadingFrom(
  before: MarkdownReading | undefined,
  text: string,
): {
  readonly from: MarkdownReading;
  readonly held: readonly MarkdownBlock[];
} {
  if (markdownReadingKept(before, text))
    return { from: before, held: before.open };
  return {
    from: markdownReadingEmpty,
    held: before === undefined ? [] : markdownReadingBlocks(before),
  };
}

/**
 * A text read, going on from an earlier reading of it where that one was of a
 * text still being written that this one begins with. `writing` says more is
 * coming, which is what has the open marks of its last block closed, and what
 * lets the reading stop short or wait: `clock` is what it tells a frame's
 * share by, and with none it never does either.
 */
export function markdownReadingNext(
  before: MarkdownReading | undefined,
  text: string,
  writing: boolean,
  clock: MarkdownClock = markdownClockStill,
): MarkdownReading {
  if (before !== undefined && markdownReadingCurrent(before, text, writing))
    return before;
  const { from, held } = markdownReadingFrom(before, text);
  const began = clock();
  if (writing && from === before && markdownReadingRests(from, began))
    return from;
  const read = markdownNormalised(text);
  const pieces = markdownPiecesFrom(read, from.offset, from.spent);
  const settled = [...from.settled];
  let { offset, spent } = from;
  let taken = 0;
  let drawn = 0;
  while (taken < pieces.length - (writing ? 1 : 0)) {
    const piece = pieces[taken];
    if (piece === undefined) break;
    if (writing && taken > 0 && clock() - began > markdownReadingShareMs) break;
    const blocks = markdownPieceBlocks(read, piece, false);
    settled.push(...markdownBlocksKept(blocks, held, drawn));
    drawn += blocks.length;
    offset = piece.end;
    spent += piece.work;
    taken += 1;
  }
  const last = pieces[taken];
  const behind = last !== undefined && taken < pieces.length - 1;
  const open =
    last === undefined || behind
      ? []
      : markdownBlocksKept(markdownPieceWritten(read, last), held, drawn);
  const since = clock();
  const cost = since - began;
  const until =
    cost > markdownReadingShareMs ? since + cost * markdownReadingRest : 0;
  return { text, writing, settled, open, offset, spent, behind, since, until };
}
