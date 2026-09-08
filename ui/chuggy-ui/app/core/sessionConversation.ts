/**
 * One session's two reads as the conversation surface takes them: the
 * transcript walk as items, and a thread's mailbox tail as the turns overlaid
 * on them.
 *
 * WHAT THE WALK COULD NOT DRAW STANDS ABOVE THE CONVERSATION, in the words the
 * Holding and Log panels said it in. A partial record drawn as a whole one is
 * indistinguishable from a session that said little, and that is the one claim
 * a page has no grounds to make.
 *
 * NEITHER LIST NEEDS A BOUND OF ITS OWN: the pane caps the entries it holds and
 * the wire caps the turns it answers, so this maps what it is given and adds no
 * loop of its own.
 */

import type {
  LeadTurnResponse,
  ThreadTurnResponse,
} from "../../../../src/contract/responses.ts";
import { conversationBlocksOf } from "./conversation.ts";
import type {
  ConversationEntry,
  ConversationItem,
  ConversationMarker,
  ConversationTurn,
} from "./conversation.ts";
import type {
  LeadTranscriptEntry,
  LeadTranscriptHeld,
} from "./leadTranscript.ts";
import { runCountLabel } from "./runTotals.ts";

/** One session's store as a page holds it: what the walk gathered, the stream
 * the session's own read names, and whether the store's listing carries it. */
export interface SessionConversationRead {
  readonly held: LeadTranscriptHeld;
  readonly stream: string | undefined;
  readonly listed: boolean;
}

/**
 * The one word a walk that stopped short of the store's end is drawn as, and
 * the one a page whose own entries were cut is. A walk that fell short says
 * nothing more about the entries it did draw, so it is the only word said.
 */
function sessionConversationShortfall(
  held: LeadTranscriptHeld,
): ConversationMarker | undefined {
  if (held.unreached) return { marker: "Unreached" };
  return held.truncated ? { marker: "Truncated" } : undefined;
}

/**
 * An elided batch is carried as its own sentence rather than as an `Elision`,
 * whose `bytes` is a payload's size: `elided` counts batches whose row exists
 * and whose object could not be drawn, and a batch count under that name would
 * be a measurement nothing took.
 */
function sessionConversationElision(count: number): ConversationMarker {
  return {
    marker: "Capped",
    sentence: `Elided · ${runCountLabel(count)} batches`,
  };
}

function sessionConversationMarkers(
  read: SessionConversationRead,
): readonly ConversationMarker[] {
  if (read.stream === undefined) return [{ marker: "NoStore" }];
  const held = read.held;
  const shortfall = sessionConversationShortfall(held);
  const shortfalls: readonly ConversationMarker[] = [
    ...(held.failure === undefined
      ? []
      : [{ marker: "Failure", reason: held.failure } as const]),
    ...(shortfall === undefined ? [] : [shortfall]),
    ...(held.elided === 0 ? [] : [sessionConversationElision(held.elided)]),
    ...(held.entriesDropped === 0
      ? []
      : [{ marker: "Dropped", count: held.entriesDropped } as const]),
  ];
  return read.listed ? shortfalls : [...shortfalls, { marker: "Unlisted" }];
}

/** One entry, keyed by the uuid the store gave it and by its place in the chain
 * where it gave none. The route answers user and assistant lines and drops the
 * runtime's bookkeeping, which is why the role is a question with two answers. */
function sessionConversationEntry(
  entry: LeadTranscriptEntry,
  at: number,
): ConversationEntry {
  return {
    id: entry.uuid ?? `entry-${String(at)}`,
    role: entry.type === "user" ? "User" : "Assistant",
    ...(entry.timestamp === undefined ? {} : { at: entry.timestamp }),
    blocks: conversationBlocksOf(entry.message),
  };
}

/** The chain as items, with the seam above the entry the compaction cut at. */
export function sessionConversationItems(
  read: SessionConversationRead,
): readonly ConversationItem[] {
  const compaction = read.held.compaction;
  const seam: ConversationMarker = {
    marker: "Compaction",
    ...(compaction?.at === undefined ? {} : { at: compaction.at }),
  };
  const said: ConversationItem[] = sessionConversationMarkers(read).map(
    (marker) => ({ item: "Marker", marker }),
  );
  read.held.entries.forEach((entry, at) => {
    if (entry.uuid !== undefined && entry.uuid === compaction?.boundary)
      said.push({ item: "Marker", marker: seam });
    said.push({ item: "Entry", entry: sessionConversationEntry(entry, at) });
  });
  return said;
}

/**
 * One session's mailbox tail as the overlay reads it, a lead's turns and a
 * thread's alike; it lives beside the walk's own derivation rather than in
 * `threads.ts`, since `conversation.ts` already reads that module. A lead's
 * turn carries no input of its own — the decision log already holds it — so
 * none is invented, and `conversationAskOf` draws the kind's word instead.
 */
export function sessionConversationTurns(
  turns: readonly (ThreadTurnResponse | LeadTurnResponse)[],
): readonly ConversationTurn[] {
  return turns.map((turn) => ({
    turn: turn.turn,
    ordinal: turn.ordinal,
    inputKind: turn.inputKind,
    ...("input" in turn ? { input: turn.input } : {}),
    state: turn.state,
    ...(turn.failure === undefined ? {} : { failure: turn.failure }),
    ...(turn.tokens === undefined ? {} : { tokens: turn.tokens }),
    ...(turn.costMicros === undefined ? {} : { costMicros: turn.costMicros }),
    ...(turn.durationMs === undefined ? {} : { durationMs: turn.durationMs }),
  }));
}
