/**
 * What a project's owner may read of its lead: the session's standing, the tail
 * of its mailbox, and a page of the transcript behind it.
 *
 * THE NOTE IS PREVIEWED RATHER THAN CARRIED. A handoff note may weigh a whole
 * wire body on its own, and this read carries a mailbox tail and a stream
 * listing beside it, so the note crosses as its size and its leading
 * characters. A reader that needs the note whole is the lead itself, and it is
 * given the note in its observation rather than over the wire.
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
 * no cut at all, would otherwise answer a set the lead does not hold. Every page
 * then names the subset of its own entries that stream-scoped set contains,
 * which is empty on a page the last cut dropped entirely.
 *
 * THE WALK IS BOUNDED AND SAYS SO WHEN IT ENDS SHORT. A stream longer than
 * `sessionTranscriptHeldBatchesMax`, or one holding a batch the walk cannot draw
 * for any reason, is one this read cannot decide what is held from; the page
 * then names no held set and reports itself truncated, because a held set
 * answered off a partial walk is the very thing this rule exists to stop. A
 * batch the walk needed and the page did not never refuses the page: what the
 * reader asked for drew, and only what the walk was for goes unanswered.
 */

import {
  sessionStoreEntries,
  sessionTranscriptChain,
  sessionTranscriptCompaction,
  sessionTranscriptHeld,
  type SessionStoreEntry,
} from "./sessionTranscript.ts";
import {
  sessionStorePageBatchesMax,
  sessionTranscriptEntriesMax,
  sessionTranscriptHeldBatchesMax,
  selectorHandoffNotePreviewCharsMax,
} from "../contract/http.ts";
import type {
  SessionId,
  SessionState,
  SessionStoreStream,
  SessionTurnFailure,
  SessionTurnId,
  SessionTurnInputKind,
  SessionTurnMeasured,
  SessionTurnState,
} from "./agentSession.ts";
import type {
  SessionStoreBatchRow,
  SessionStoreStreamRow,
} from "./sessionPlane.ts";
import type { SessionStoreRead } from "./sessionStore.ts";
import type { Partition } from "./projectStore.ts";
import type { JsonValue, SelectorProjectState } from "./selector.ts";

/** One turn of the lead's mailbox as a reader sees it; its input is not a reader's business. */
export interface LeadTurnRecord {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly state: SessionTurnState;
  readonly failure?: SessionTurnFailure;
  readonly measured?: SessionTurnMeasured;
  readonly batchFirst?: number;
  readonly batchLast?: number;
}

/** The project's lead, what it decided under, and the tail of its mailbox. */
export interface LeadStanding {
  readonly session: SessionId;
  readonly state: SessionState;
  readonly agentReference?: string;
  readonly attention: SelectorProjectState["attention"];
  readonly notificationCursor: number;
  readonly handoffNote: JsonValue;
  readonly turns: readonly LeadTurnRecord[];
}

/** The API's own door onto one project's lead and the rows of its store. */
/**
 * Where one session's store rows are read from, SESSION-KEYED so that one walk
 * serves the lead and a member's thread both. `LeadReadStore.batches` below is
 * the lead's own definer and answers for the project's lead alone; migration
 * 062's `read_session_store` is that read taking the session it reads.
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

export interface LeadReadStore {
  /** The lead's standing with at most `turnsMax` of its mailbox, newest last. */
  standing(
    partition: Partition,
    turnsMax: number,
  ): Promise<LeadStanding | undefined>;
  /** Every stream the lead's store holds, with the batches standing under each. */
  streams(
    partition: Partition,
    limit: number,
  ): Promise<readonly SessionStoreStreamRow[]>;
  /** One page of one stream's batch rows, without the bytes they point at. */
  batches(input: {
    readonly partition: Partition;
    readonly stream: SessionStoreStream;
    readonly after: number;
    readonly limit: number;
  }): Promise<readonly SessionStoreBatchRow[]>;
}

/** How large the handoff note is, and as much of it as the lead read carries. */
export interface HandoffNotePreview {
  readonly bytes: number;
  readonly preview: string;
  readonly truncated: boolean;
}

export type LeadRead =
  | { readonly result: "NotFound" }
  | {
      readonly result: "Found";
      readonly lead: LeadStanding;
      readonly streams: readonly SessionStoreStreamRow[];
    };

export interface LeadTranscriptQuery {
  /** Defaults to the session's own agent reference, which is its main stream. */
  readonly stream?: SessionStoreStream;
  readonly after: number;
  readonly limit: number;
}

/**
 * One page of one stream, with `held` naming the entries of this page the lead
 * still holds and absent only where the stream-scoped walk could not decide it.
 */
export interface LeadTranscriptPage {
  readonly stream: SessionStoreStream;
  readonly entries: readonly SessionStoreEntry[];
  readonly held?: readonly string[];
  /** The batch the stream's last cut fell in, beside the held set it decided. */
  readonly cut?: number;
  readonly compaction?: { readonly boundary: string; readonly at?: string };
  readonly elided: number;
  readonly truncated: boolean;
  readonly nextAfter?: number;
}

export type LeadTranscriptRead =
  | { readonly read: "NotFound" }
  | { readonly read: "Unavailable"; readonly retryAfterSeconds: number }
  | { readonly read: "Page"; readonly page: LeadTranscriptPage };

/** The note as the lead read carries it: its whole size, and its leading characters. */
export function handoffNotePreview(note: JsonValue): HandoffNotePreview {
  const text = JSON.stringify(note ?? null) ?? "null";
  return {
    bytes: new TextEncoder().encode(text).byteLength,
    preview: text.slice(0, selectorHandoffNotePreviewCharsMax),
    truncated: text.length > selectorHandoffNotePreviewCharsMax,
  };
}

export function checkedLeadTranscriptQuery(
  query: LeadTranscriptQuery,
): LeadTranscriptQuery {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > sessionStorePageBatchesMax
  )
    throw new RangeError(
      `lead transcript limit must be between 1 and ${String(sessionStorePageBatchesMax)}`,
    );
  if (!Number.isSafeInteger(query.after) || query.after < 0)
    throw new RangeError("lead transcript cursor must be a batch number");
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
 * end, and the page then reports itself truncated.
 */
export function leadTranscriptPage(input: {
  readonly stream: SessionStoreStream;
  readonly drawn: readonly SessionStoreRead[];
  readonly walk?: SessionHeldWalk;
  readonly nextAfter?: number;
}): LeadTranscriptPage {
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
    elided,
    truncated: chain.length > entries.length || held === undefined,
    ...(input.nextAfter === undefined ? {} : { nextAfter: input.nextAfter }),
  };
}
