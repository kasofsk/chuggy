/**
 * One page of one session's transcript, drawn over the session's store rows and
 * read against what the whole stream says the session still holds.
 *
 * A BATCH THAT CANNOT BE DRAWN IS ELIDED, NOT FATAL. Only an outage on the
 * page's OWN batches refuses the page: a batch that is gone or fails its digest
 * is counted, because a run that died leaves exactly that and the batches beside
 * it are what a reader came for. `nativeRunTranscriptBatches` answers the same
 * situation the same way.
 *
 * THE PAGE IS BOUNDED TWICE, by batches and by entries, because one batch's
 * ceiling is bytes and a stream of small entries reaches the entry bound first.
 * A page that had to drop entries says so rather than shortening in silence.
 *
 * WHAT IS HELD IS A FACT ABOUT THE STREAM, NOT ABOUT THE PAGE. It is decided by
 * the last compaction in the whole stream, so the walk that finds it reads the
 * stream's own batches rather than the page's: a page carrying an older cut, or
 * no cut at all, would otherwise answer a set the session does not hold. Every
 * page then names the subset of its own entries that stream-scoped set
 * contains, which is empty on a page the last cut dropped entirely.
 *
 * THE WALK IS BOUNDED AND SAYS SO WHEN IT ENDS SHORT. A stream longer than
 * `sessionTranscriptHeldBatchesMax`, or one holding a batch the walk cannot draw
 * for any reason, is one this read cannot decide what is held from; the page
 * then names no held set, because a held set answered off a partial walk is the
 * very thing this rule exists to stop. A batch the walk needed and the page did
 * not never refuses the page: what the reader asked for drew, and only what the
 * walk was for goes unanswered.
 */

import {
  sessionStoreEntries,
  sessionTranscriptBoundaries,
  sessionTranscriptChain,
  sessionTranscriptCompaction,
  sessionTranscriptHeld,
  type SessionStoreEntry,
  type SessionTranscriptBoundary,
} from "./sessionTranscript.ts";
import {
  sessionStorePageBatchesMax,
  sessionTranscriptEntriesMax,
  sessionTranscriptHeldBatchesMax,
} from "../contract/http.ts";
import type { SessionId, SessionStoreStream } from "./agentSession.ts";
import type { SessionStoreBatchRow } from "./sessionPlane.ts";
import type { SessionStoreRead } from "./sessionStore.ts";
import type { Partition } from "./projectStore.ts";

/**
 * Where one session's store rows are read from, SESSION-KEYED rather than
 * keyed on a kind: it is the one row read every session's transcript is drawn
 * through, because 062 retired the definer that was fenced on `kind='Lead'`
 * for `read_session_store_batches` — a name of its own because
 * `read_session_store` is already the worker plane's, authenticated by a bearer
 * digest rather than by project access.
 */
export interface SessionStoreRowsRead {
  batches(input: {
    readonly partition: Partition;
    readonly session: SessionId;
    readonly stream: SessionStoreStream;
    readonly after: number;
    readonly limit: number;
  }): Promise<readonly SessionStoreBatchRow[]>;
}

/** What a transcript read needs of the session behind it: which one, and its main stream. */
export interface SessionTranscriptSubject {
  readonly session: SessionId;
  readonly agentReference?: string;
}

export interface SessionTranscriptQuery {
  /** Defaults to the session's own agent reference, which is its main stream. */
  readonly stream?: SessionStoreStream;
  readonly after: number;
  readonly limit: number;
}

/**
 * One page of one stream, with `held` naming the entries of this page the
 * session still holds and absent only where the stream-scoped walk could not decide it.
 */
export interface SessionTranscriptPage {
  readonly stream: SessionStoreStream;
  readonly entries: readonly SessionStoreEntry[];
  readonly held?: readonly string[];
  /** The batch the stream's last cut fell in, beside the held set it decided. */
  readonly cut?: number;
  readonly compaction?: { readonly boundary: string; readonly at?: string };
  /** Every cut among the page's entries, in the order they were appended, absent where it holds none. */
  readonly compactions?: readonly SessionTranscriptBoundary[];
  readonly elided: number;
  readonly truncated: boolean;
  readonly nextAfter?: number;
}

export type SessionTranscriptRead =
  | { readonly read: "NotFound" }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Page"; readonly page: SessionTranscriptPage };

export function checkedSessionTranscriptQuery(
  query: SessionTranscriptQuery,
): SessionTranscriptQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > sessionStorePageBatchesMax
  )
    throw new RangeError(
      `session transcript limit must be between 1 and ${String(sessionStorePageBatchesMax)}`,
    );
  if (!Number.isSafeInteger(query.after) || query.after < 0)
    throw new RangeError("session transcript cursor must be a batch number");
  return query;
}

/** What a whole-stream walk decided: the held uuids, and where the last cut fell. */
export interface SessionHeldWalk {
  readonly held: ReadonlySet<string>;
  /** The batch the stream's last compaction boundary was written in. */
  readonly cut?: number;
}

/**
 * What a whole stream says the session holds, and which batch its last cut fell
 * in — one uuid is written in one batch, so the first batch holding the boundary
 * is the only one. The batch lets a reader notice a compaction that happened
 * while it was paging: a `cut` it has not seen before invalidates every held set
 * it holds.
 */
export function sessionHeldWalk(
  batches: readonly { readonly batch: number; readonly content: string }[],
): SessionHeldWalk {
  const read = batches.map((batch) => ({
    batch: batch.batch,
    entries: sessionStoreEntries(batch.content),
  }));
  const stored = read.flatMap((batch) => batch.entries);
  const held = new Set(
    sessionTranscriptHeld(stored).flatMap((entry) =>
      entry.uuid === undefined ? [] : [entry.uuid],
    ),
  );
  const boundary = sessionTranscriptCompaction(stored)?.boundary.uuid;
  const cut =
    boundary === undefined
      ? undefined
      : read.find((batch) =>
          batch.entries.some((entry) => entry.uuid === boundary),
        )?.batch;
  return { held, ...(cut === undefined ? {} : { cut }) };
}

/**
 * How many batches a held walk may ask for next, having read `batchesRead`, and
 * zero once it has passed its bound. It allows one past the bound so a stream
 * standing exactly at the bound is read to its end rather than called undecided.
 */
export function sessionHeldWalkAsks(batchesRead: number): number {
  return Math.max(
    0,
    Math.min(
      sessionStorePageBatchesMax,
      sessionTranscriptHeldBatchesMax + 1 - batchesRead,
    ),
  );
}

/**
 * The page one stream's drawn batches make, against what the whole stream says
 * is held. `held` is absent exactly where that walk could not reach the stream's
 * end, and `truncated` says that this page's own entries, or its compaction
 * boundaries, were cut at their bound.
 */
export function sessionTranscriptPage(input: {
  readonly stream: SessionStoreStream;
  readonly drawn: readonly SessionStoreRead[];
  readonly walk?: SessionHeldWalk;
  readonly nextAfter?: number;
}): SessionTranscriptPage {
  let elided = 0;
  const texts: string[] = [];
  for (const batch of input.drawn) {
    if (batch.read === "Content") texts.push(batch.content);
    else elided += 1;
  }
  const stored = sessionStoreEntries(texts.join("\n"));
  const chain = sessionTranscriptChain(stored);
  const entries = chain.slice(0, sessionTranscriptEntriesMax);
  const compaction = sessionTranscriptCompaction(stored);
  const boundary = compaction?.boundary.uuid;
  const boundaries = sessionTranscriptBoundaries(stored);
  const compactions = boundaries.slice(0, sessionTranscriptEntriesMax);
  const held = input.walk?.held;
  const cut = input.walk?.cut;
  return {
    stream: input.stream,
    entries,
    ...(held === undefined
      ? {}
      : {
          held: entries.flatMap((entry) =>
            entry.uuid !== undefined && held.has(entry.uuid)
              ? [entry.uuid]
              : [],
          ),
        }),
    ...(cut === undefined ? {} : { cut }),
    ...(boundary === undefined
      ? {}
      : {
          compaction: {
            boundary,
            ...(compaction?.boundary.timestamp === undefined
              ? {}
              : { at: compaction.boundary.timestamp }),
          },
        }),
    ...(compactions.length === 0 ? {} : { compactions }),
    elided,
    truncated:
      chain.length > entries.length || boundaries.length > compactions.length,
    ...(input.nextAfter === undefined ? {} : { nextAfter: input.nextAfter }),
  };
}
