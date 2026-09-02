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
 * A BATCH THAT CANNOT BE DRAWN IS ELIDED, NOT FATAL. Only an outage refuses the
 * page: a batch that is gone or fails its digest is counted, because a run that
 * died leaves exactly that and the batches beside it are what a reader came
 * for. `nativeRunTranscriptBatches` answers the same situation the same way.
 *
 * THE PAGE IS BOUNDED TWICE, by batches and by entries, because one batch's
 * ceiling is bytes and a stream of small entries reaches the entry bound first.
 * A page that had to drop entries says so rather than shortening in silence.
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
 * One page of one stream. `held` names which of the entries the lead still
 * holds rather than sending them twice, and `truncated` says the chain was
 * longer than a page of entries.
 */
export interface LeadTranscriptPage {
  readonly stream: SessionStoreStream;
  readonly entries: readonly SessionStoreEntry[];
  readonly held: readonly string[];
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

/**
 * The page one stream's drawn batches make. The batches arrive in the order
 * they were appended, so their texts concatenate into the stream the walk
 * expects, and a batch nobody could draw contributes nothing but a count.
 */
export function leadTranscriptPage(input: {
  readonly stream: SessionStoreStream;
  readonly drawn: readonly SessionStoreRead[];
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
  const held = new Set(
    sessionTranscriptHeld(stored).flatMap((entry) =>
      entry.uuid === undefined ? [] : [entry.uuid],
    ),
  );
  const entries = chain.slice(0, sessionTranscriptEntriesMax);
  const compaction = sessionTranscriptCompaction(stored);
  const boundary = compaction?.boundary.uuid;
  return {
    stream: input.stream,
    entries,
    held: entries.flatMap((entry) =>
      entry.uuid !== undefined && held.has(entry.uuid) ? [entry.uuid] : [],
    ),
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
    truncated: chain.length > entries.length,
    ...(input.nextAfter === undefined ? {} : { nextAfter: input.nextAfter }),
  };
}
