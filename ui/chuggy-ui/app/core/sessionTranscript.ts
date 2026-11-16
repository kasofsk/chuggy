/**
 * What a session's transcript pane draws, derived: the store's chain as a pane
 * holds it, the seam the last compaction cut at, and the subset the session
 * still holds.
 *
 * WHAT THE SESSION HOLDS IS A MARK ON ONE LIST AND NEVER A SECOND READ. The
 * route answers the chain and names which of its entries survive the last
 * compaction, so what is held and what is logged are two readings of one value
 * and cannot disagree about what the session is working from.
 *
 * `held` IS A FACT ABOUT THE STREAM, ANSWERED PER PAGE. The route decides it
 * from the last compaction in the whole stream and names the entries of that
 * page the session holds, which may be none of them. So two pages read under
 * one cut cannot contradict each other, and what a pane holds is their answers
 * gathered — nothing here guesses.
 *
 * A CUT THAT MOVES INVALIDATES EVERYTHING GATHERED UNDER THE OLD ONE. A pane
 * walks a stream that is being written and compacted beneath it, so answers it
 * gathered pages ago were decided against a cut that no longer exists. Keeping
 * them would leave the session marked as holding entries it dropped, and would
 * draw them above the seam the same page moved.
 *
 * SO THE PANE IS REPLACED RATHER THAN PATCHED, and the page that revealed the
 * move is dropped with the rest. Everything a pane holds was gathered under one
 * cut — the answers, the entries they were answered over, the counts of what
 * could not be drawn, and the cursors saying how far the walk got — so a fold
 * that reset some of them and kept others would be a pane in two eras at once:
 * that is how the oldest entries of a re-walked stream came back as its newest,
 * and how one undrawable batch came to be counted twice. What survives is the
 * new cut and the identity of the stream being walked, and the re-walk rebuilds
 * the rest in the order the chain gives it.
 *
 * THE RESET IS AN EVENT IN THE WALK AND NOT A STATE A READER IS SHOWN. It holds
 * nothing, and a pane drawn from it says the session has recorded nothing — the
 * claim a pane reserves for a session that really has. So what is drawn keeps
 * the last whole fold until the re-walk has one of its own, and says only the
 * thing the reset does make true: that what the session holds is no longer
 * known.
 *
 * THE RE-WALK COSTS THE READS THE MARK ALLOWS, which is the price of being
 * right: a pane part-way through a re-walk holds less than it did, and the next
 * rise of the store's batch count carries it further. A session compacting
 * faster than its own transcript can be paged is a session whose transcript no
 * reader can follow anyway.
 *
 * THE CURSOR AND THE ENTRIES ARE DIFFERENT QUESTIONS. A full page whose entries
 * were all elided or all meta draws nothing and still has batches above it, so
 * a walk that jumped to the high-water mark on an empty page would abandon the
 * rest of the store.
 *
 * A CURSOR THAT DOES NOT ADVANCE IS NOT A CURSOR, and the walk waits at it
 * rather than skipping past. A page answered at a cursor that hands the same one
 * back leaves the walk nowhere to go, since asking again returns the page just
 * read; so the pane keeps that cursor, records the mark it was read against, and
 * the store being written past that mark carries it on from exactly there.
 * Taking the mark as the cursor instead would abandon every batch between and
 * draw them as a session holding nothing rather than as a stream this pane has
 * not reached.
 *
 * `held` ABSENT IS UNKNOWN AND NEVER EMPTY. It is absent only where the route
 * could not reach the stream's end to decide it. Drawing that as "nothing held"
 * would tell a reader the session has forgotten everything at exactly the
 * moment the server said it could not tell.
 */

import { sessionChangeResourceSchema } from "../../../../src/contract/events.ts";
import type { SessionChangeResource } from "../../../../src/contract/events.ts";
import { sessionStorePageBatchesMax } from "../../../../src/contract/http.ts";
import type {
  LeadResponse,
  LeadTranscriptResponse,
} from "../../../../src/contract/responses.ts";
import type { ApiFailure } from "./apiRequest.ts";

/** The most entries a pane keeps, past which the oldest leave. */
export const sessionTranscriptEntriesHeldMax = 4096;

export type SessionTranscriptEntry = LeadTranscriptResponse["entries"][number];

export type SessionTranscriptCompaction = LeadTranscriptResponse["compaction"];

/** One cut among the entries a page sent, with what the store kept of it. */
export type SessionTranscriptCut = NonNullable<
  LeadTranscriptResponse["compactions"]
>[number];

/**
 * What one walk has gathered of one stream, under one cut. Every field here was
 * decided against `cut`, which is why a cut that moves replaces the whole of it
 * rather than patching part.
 */
export interface SessionTranscriptFold {
  readonly entries: readonly SessionTranscriptEntry[];
  readonly holding: readonly string[];
  readonly compaction: SessionTranscriptCompaction;
  /** Every cut among the entries gathered, each once, in the order the chain
   * gave them. */
  readonly compactions: readonly SessionTranscriptCut[];
  /** The batch the compaction this fold's answers are decided against falls in,
   * so a page answered under a different one can be told from one answered
   * under this. */
  readonly cut: number | undefined;
  readonly elided: number;
  readonly truncated: boolean;
  /**
   * Whether a page has answered no `held`, which is the route saying it could
   * not decide what the session holds rather than that it holds nothing. It
   * stands for the life of the fold, because a later page deciding for its own
   * entries says nothing about the page that could not.
   */
  readonly holdingUnknown: boolean;
  readonly entriesDropped: number;
  readonly readTo: number | undefined;
  /**
   * The high-water mark a page that would not move the cursor was read against,
   * and nothing where the last page moved it. The walk waits there rather than
   * asking again, and the store being written past that mark is what carries it
   * on from exactly where it stopped.
   */
  readonly stalledAt: number | undefined;
  /** Whether the last page left batches below the mark it was read against
   * unread, which is the walk not having reached the end of the store. */
  readonly more: boolean;
}

export const sessionTranscriptFoldEmpty: SessionTranscriptFold = {
  entries: [],
  holding: [],
  compaction: undefined,
  compactions: [],
  cut: undefined,
  elided: 0,
  truncated: false,
  holdingUnknown: false,
  entriesDropped: 0,
  readTo: undefined,
  stalledAt: undefined,
  more: false,
};

/**
 * One pane of one session's transcript: the fold the walk is building, the fold a
 * reader keeps while a re-walk has nothing to show them yet, and what the last
 * read failed with.
 *
 * `kept` IS SET EXACTLY WHILE A RE-WALK OWES A READER A FOLD: it is taken at
 * the reset from the fold that was being drawn, and released as soon as the
 * re-walk has entries of its own, so "is this pane rebuilding" is one field
 * being present rather than a flag beside it that can disagree.
 */
export interface SessionTranscriptPane {
  readonly stream: string | undefined;
  readonly fold: SessionTranscriptFold;
  readonly kept: SessionTranscriptFold | undefined;
  readonly failure: ApiFailure | undefined;
}

export const sessionTranscriptPaneEmpty: SessionTranscriptPane = {
  stream: undefined,
  fold: sessionTranscriptFoldEmpty,
  kept: undefined,
  failure: undefined,
};

/**
 * What a reader is shown: one fold, the stream it came from, the reason the
 * last read gave if it did not answer, and whether the walk got to the end of
 * the store.
 */
export interface SessionTranscriptHeld extends SessionTranscriptFold {
  readonly stream: string | undefined;
  readonly failure: ApiFailure | undefined;
  /**
   * Whether the walk has not reached the mark it was read against: batches
   * below it left unread, a cursor a page would not move, or a re-walk that
   * still owes this reader a fold. It is a fact about how far this pane got and
   * never about what the route could decide, which is a shortfall of the
   * server's own walk that nothing here draws.
   */
  readonly unreached: boolean;
}

/**
 * The batch the next read asks after, and nothing where the walk has read to
 * the mark the session's own read carries. THE MARK IS WHAT BOUNDS THE WALK:
 * asking nothing at or above it is what stops a store that keeps answering a
 * cursor from being paged forever, and what a store written past the mark
 * carries the walk on from.
 */
export function sessionTranscriptNextAfter(
  pane: SessionTranscriptPane,
  highWaterBatch: number,
): number | undefined {
  return sessionTranscriptFoldNextAfter(pane.fold, highWaterBatch);
}

function sessionTranscriptFoldNextAfter(
  fold: SessionTranscriptFold,
  highWaterBatch: number,
): number | undefined {
  if (fold.readTo === undefined) return highWaterBatch > 0 ? 0 : undefined;
  if (fold.stalledAt !== undefined && highWaterBatch <= fold.stalledAt)
    return undefined;
  return highWaterBatch > fold.readTo ? fold.readTo : undefined;
}

/** Whether a walk that gathered this fold has nothing left to ask below the
 * mark: it read that far, or it waits at a cursor only a store written past
 * the mark moves. */
export function sessionTranscriptReached(
  fold: SessionTranscriptFold,
  highWaterBatch: number,
): boolean {
  return sessionTranscriptFoldNextAfter(fold, highWaterBatch) === undefined;
}

/** How many reads one walk keeps in flight, which is what a prediction the
 * route does not follow costs. */
export const sessionTranscriptReadsInFlightMax = 16;

/**
 * The cursors a walk at `after` reads: that one, and the ones a full page's
 * `nextAfter` puts after it, below the mark and within the reads a walk keeps
 * in flight. A cursor named here that the walk never asks is a read spent, and
 * one it asks that is not named here is read when it asks.
 */
export function sessionTranscriptCursorsFrom(
  after: number,
  highWaterBatch: number,
): readonly number[] {
  const cursors: number[] = [];
  for (
    let cursor = after;
    cursor < highWaterBatch &&
    cursors.length < sessionTranscriptReadsInFlightMax;
    cursor += sessionStorePageBatchesMax
  )
    cursors.push(cursor);
  return cursors;
}

/**
 * Whether the page leaves batches below the mark unread: `nextAfter` says a
 * page filled its limit and so only that there MAY be more, and a page whose
 * cursor reaches the mark has read the store to its end. Neither a page with no
 * entries nor one whose cursor did not move can have filled a limit, so neither
 * leaves anything unread on that basis.
 */
function sessionTranscriptMore(
  page: LeadTranscriptResponse,
  asked: number,
  highWaterBatch: number,
): boolean {
  return (
    page.nextAfter !== undefined &&
    page.entries.length > 0 &&
    page.nextAfter > asked &&
    page.nextAfter < highWaterBatch
  );
}

/** Each uuid once, in the order the chain gave it, oldest first. */
function sessionTranscriptEntriesMerged(
  held: readonly SessionTranscriptEntry[],
  arriving: readonly SessionTranscriptEntry[],
): readonly SessionTranscriptEntry[] {
  const seen = new Set(
    held.flatMap((entry) => (entry.uuid === undefined ? [] : [entry.uuid])),
  );
  const merged = [...held];
  for (const entry of arriving) {
    if (entry.uuid !== undefined && seen.has(entry.uuid)) continue;
    if (entry.uuid !== undefined) seen.add(entry.uuid);
    merged.push(entry);
  }
  return merged;
}

/** Where the walk stands after a page: the cursor it asks next, and the mark it
 * is waiting at if a page would not move that cursor. */
function sessionTranscriptCursor(
  page: LeadTranscriptResponse,
  highWaterBatch: number,
  asked: number,
): { readonly readTo: number; readonly stalledAt: number | undefined } {
  if (page.nextAfter === undefined)
    return { readTo: highWaterBatch, stalledAt: undefined };
  if (page.nextAfter > asked)
    return { readTo: page.nextAfter, stalledAt: undefined };
  return { readTo: asked, stalledAt: highWaterBatch };
}

/**
 * Whether a page's answers were decided against a different compaction from the
 * ones already gathered. A page that decided nothing says nothing about the cut,
 * and a first page has nothing to differ from; everything else — including a
 * stream compacted for the first time under an open pane, where the cut goes
 * from absent to a batch — is answers that cannot be gathered together.
 */
function sessionTranscriptCutMoved(
  fold: SessionTranscriptFold,
  page: LeadTranscriptResponse,
): boolean {
  if (page.held === undefined) return false;
  return fold.readTo !== undefined && page.cut !== fold.cut;
}

/** Each cut once, by its boundary, in the order the chain gave them, and no
 * more of them than the entries a pane keeps. */
function sessionTranscriptCutsMerged(
  held: readonly SessionTranscriptCut[],
  arriving: readonly SessionTranscriptCut[],
): readonly SessionTranscriptCut[] {
  const seen = new Set(held.map((cut) => cut.boundary));
  const merged = [...held];
  for (const cut of arriving) {
    if (seen.has(cut.boundary)) continue;
    seen.add(cut.boundary);
    merged.push(cut);
  }
  return merged.slice(-sessionTranscriptEntriesHeldMax);
}

/** The uuids still worth holding: what is gathered, less any whose entry has
 * left at the cap, so the set is bounded by the entries and not by the walk. */
function sessionTranscriptHoldingPruned(
  holding: Iterable<string>,
  entries: readonly SessionTranscriptEntry[],
): readonly string[] {
  const present = new Set(
    entries.flatMap((entry) => (entry.uuid === undefined ? [] : [entry.uuid])),
  );
  return [...new Set(holding)].filter((uuid) => present.has(uuid));
}

/** One page gathered into the fold it belongs to, at the cursor it was asked
 * with. */
function sessionTranscriptGathered(
  fold: SessionTranscriptFold,
  page: LeadTranscriptResponse,
  highWaterBatch: number,
  asked: number,
): SessionTranscriptFold {
  const cursor = sessionTranscriptCursor(page, highWaterBatch, asked);
  const merged = sessionTranscriptEntriesMerged(fold.entries, page.entries);
  const kept = merged.slice(-sessionTranscriptEntriesHeldMax);
  return {
    entries: kept,
    holding: sessionTranscriptHoldingPruned(
      [...fold.holding, ...(page.held ?? [])],
      kept,
    ),
    cut: page.held === undefined ? fold.cut : page.cut,
    compaction: page.compaction ?? fold.compaction,
    compactions: sessionTranscriptCutsMerged(
      fold.compactions,
      page.compactions ?? [],
    ),
    elided: fold.elided + page.elided,
    truncated: fold.truncated || page.truncated,
    holdingUnknown: fold.holdingUnknown || page.held === undefined,
    entriesDropped: fold.entriesDropped + (merged.length - kept.length),
    readTo: cursor.readTo,
    stalledAt: cursor.stalledAt,
    more: sessionTranscriptMore(page, asked, highWaterBatch),
  };
}

/**
 * What happens to a pane. Every one of them is something the walk observed
 * rather than anything it decided: the reset is a transition the step takes on
 * a page, not an event anything can send.
 */
export type SessionTranscriptEvent =
  | {
      readonly event: "Page";
      readonly page: LeadTranscriptResponse;
      readonly highWaterBatch: number;
      /** The cursor the walk asked this page at, which is what it is folded
       * against — a read in flight is answered at a cursor the pane may have
       * passed since. */
      readonly after: number;
    }
  | { readonly event: "Failure"; readonly failure: ApiFailure }
  | { readonly event: "StreamChange"; readonly stream: string | undefined };

/**
 * The RESET transition: a page answered under a cut this pane has not been
 * reading under. Everything gathered goes, the cursor goes back to the start of
 * the stream, and the fold that was being drawn is kept for the reader until the
 * re-walk has one of its own — an empty fold is not one, so a re-walk whose own
 * pages draw nothing keeps them looking at the chain that does.
 */
function sessionTranscriptReset(
  pane: SessionTranscriptPane,
  page: LeadTranscriptResponse,
): SessionTranscriptPane {
  return {
    stream: page.stream,
    fold: { ...sessionTranscriptFoldEmpty, cut: page.cut },
    kept: pane.fold.entries.length > 0 ? pane.fold : pane.kept,
    failure: undefined,
  };
}

/** Whether a page was asked at a cursor this fold has read past, which is a
 * page it has already gathered. */
function sessionTranscriptPassed(
  fold: SessionTranscriptFold,
  after: number,
): boolean {
  return fold.readTo !== undefined && after < fold.readTo;
}

/**
 * The PAGE transition: a page gathered, and the kept fold released once the
 * walk has entries of its own again. A page the fold has read past has nothing
 * left to gather and still carries the stream's cut, so the cut is read from it
 * before it is dropped.
 */
function sessionTranscriptPaged(
  pane: SessionTranscriptPane,
  page: LeadTranscriptResponse,
  highWaterBatch: number,
  after: number,
): SessionTranscriptPane {
  if (sessionTranscriptCutMoved(pane.fold, page))
    return sessionTranscriptReset(pane, page);
  if (sessionTranscriptPassed(pane.fold, after)) return pane;
  const fold = sessionTranscriptGathered(
    pane.fold,
    page,
    highWaterBatch,
    after,
  );
  return {
    stream: page.stream,
    fold,
    kept: fold.entries.length > 0 ? undefined : pane.kept,
    failure: undefined,
  };
}

/**
 * One event, applied. FAILURE records the reason and touches nothing else,
 * because a read that did not answer establishes only that it did not; and a
 * STREAM-CHANGE is a different pane, so it starts from nothing.
 */
export function sessionTranscriptStep(
  pane: SessionTranscriptPane,
  event: SessionTranscriptEvent,
): SessionTranscriptPane {
  switch (event.event) {
    case "Page":
      return sessionTranscriptPaged(
        pane,
        event.page,
        event.highWaterBatch,
        event.after,
      );
    case "Failure":
      return { ...pane, failure: event.failure };
    case "StreamChange":
      return { ...sessionTranscriptPaneEmpty, stream: event.stream };
  }
}

/**
 * Whether the walk stopped short of the mark. Batches below it the last page
 * left unread say so, and so does a cursor a page would not move, which the
 * resumed walk clears by reaching the rest.
 */
function sessionTranscriptUnreached(fold: SessionTranscriptFold): boolean {
  return fold.more || fold.stalledAt !== undefined;
}

/**
 * What a reader is shown: the walk's own fold, except while a re-walk owes them
 * one, when it is the fold they were already looking at with the one thing the
 * reset makes true said as itself — the chain still stands, and what the session
 * holds of it is no longer known. The failure is carried either way, because a
 * read that did not answer is a fact about the walk and not a step in it.
 */
export function sessionTranscriptDrawn(
  pane: SessionTranscriptPane,
): SessionTranscriptHeld {
  const kept = pane.kept;
  if (kept === undefined)
    return {
      ...pane.fold,
      unreached: sessionTranscriptUnreached(pane.fold),
      stream: pane.stream,
      failure: pane.failure,
    };
  return {
    ...kept,
    holding: [],
    holdingUnknown: true,
    unreached: true,
    cut: pane.fold.cut,
    stream: pane.stream,
    failure: pane.failure,
  };
}

/**
 * What either read says about the session's store: the stream it is writing and
 * the listing of what the store holds. Stated as the fields rather than as the
 * lead's whole response, because a thread read carries the same two and the
 * walk below is the same walk over a different session.
 */
export interface SessionStreams {
  readonly agentReference?: string | undefined;
  readonly streams: LeadResponse["streams"];
}

/** The stream the transcript route defaults to, and how far its store has been written. */
export function sessionStreamBatches(session: SessionStreams): number {
  const named = session.agentReference;
  if (named === undefined) return 0;
  return session.streams.find((held) => held.stream === named)?.batches ?? 0;
}

/**
 * Whether the store's own listing carries the stream the session names. The
 * listing is bounded, so a session with many streams can name one that is not
 * on it, and a reader shown an empty log would read that as a session that has
 * said nothing.
 */
export function sessionStreamListed(session: SessionStreams): boolean {
  const named = session.agentReference;
  if (named === undefined) return false;
  return session.streams.some((held) => held.stream === named);
}

/**
 * Whether the store's listing carries a stream that is neither the one the
 * session names nor a stream under it: the session wrote to another before,
 * and the one it names is not its whole record. A listing cut short of such a
 * stream reads as a session that never did.
 */
export function sessionStreamReplaced(session: SessionStreams): boolean {
  const named = session.agentReference;
  if (named === undefined) return false;
  return session.streams.some(
    (held) => held.stream !== named && !held.stream.startsWith(`${named}/`),
  );
}

/**
 * What a `Session` frame names, and nothing where the frame does not name it —
 * a change frame being a pointer and never a body, so what a reader takes from
 * it is which session to re-read, and a resource this console cannot parse is a
 * frame it ignores rather than one it throws on, since a stream that ended on a
 * shape a console did not expect would stop carrying every other kind with it.
 *
 * THE PARSE IS HERE ONCE AND THE TWO QUESTIONS ASKED OF IT ARE ACCESSORS, a
 * panel watching one session and a panel watching one kind of session reading
 * one resource: two parses could disagree about whether a frame is one at all, and
 * the panel that said no would be the one that never updated.
 */
function sessionChangeNamed(
  resource: string,
): SessionChangeResource | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(resource);
  } catch {
    return undefined;
  }
  const read = sessionChangeResourceSchema.safeParse(parsed);
  return read.success ? read.data : undefined;
}

/** The session a `Session` frame is about. */
export function sessionChangeSessionNamed(
  resource: string,
): string | undefined {
  return sessionChangeNamed(resource)?.session;
}

/** What kind of session a `Session` frame names, so a panel can watch one kind. */
export function sessionChangeKindNamed(resource: string): string | undefined {
  return sessionChangeNamed(resource)?.kind;
}
