/**
 * One thread's conversation, wherever it is drawn: the transcript with the
 * mailbox over it, and the composer where the thread is the reader's own.
 *
 * The store holds everything that was said and the mailbox holds what the
 * transcript cannot — a turn nobody has claimed, the word a failure ended on,
 * the measures — and the two meet by the input text the worker handed the
 * runtime verbatim. The thread page draws this in the middle of the shell and
 * the chat pane draws it in its own column, so it takes a thread already read
 * and reaches for nothing about where it sits.
 *
 * A queued turn of the reader's own thread reads as waiting where its turns go
 * to runners and none of theirs can take one now; another member's thread
 * runs on their runner, which no read here answers for.
 *
 * WHAT IS HEARD OF A TURN IS LAID OVER BOTH. The newest turn is drawn as it is
 * written, every reader of the thread alike, and each block of it is drawn
 * from the transcript instead from the moment the transcript holds it.
 *
 * THE COLUMN IS READ ONCE. A walk begins again when the runner names the
 * thread's store, which is in the middle of its first turn, and saying
 * `Loading…` over a turn being written would take the words away to say it.
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadResponse } from "../../../../../src/contract/responses.ts";
import {
  conversationExchanges,
  conversationExchangesWaiting,
  conversationSeenNothing,
  conversationSeenWith,
} from "../../core/conversation.ts";
import type {
  ConversationExchange,
  ConversationItem,
  ConversationRecord,
  ConversationTurn,
} from "../../core/conversation.ts";
import {
  conversationExchangesLive,
  conversationLiveHeardUnder,
  conversationLiveTurns,
  conversationLiveTurnsHeard,
  conversationStoredBlocks,
} from "../../core/conversationLive.ts";
import {
  leadStreamBatches,
  leadStreamListed,
  leadStreamReplaced,
  leadTranscriptReached,
} from "../../core/leadTranscript.ts";
import {
  sessionConversationItems,
  sessionConversationTurns,
} from "../../core/sessionConversation.ts";
import {
  threadStoreDue,
  threadTakesMessages,
  threadTurnsWait,
  threadWriting,
} from "../../core/threads.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { useLeadTranscript } from "../lead/LeadTranscript.tsx";
import type { LeadTranscriptWalk } from "../lead/LeadTranscript.tsx";
import { useThreadLive } from "./threadLive.ts";
import { useConversationMentions } from "./threadMentions.ts";
import { useThreadDoor, useThreadSend } from "./threadSend.tsx";

/** The turns named, as one set that is the same set while they are the same
 * turns. */
function useTurnsNamed(turns: readonly string[]): ReadonlySet<string> {
  const named = JSON.stringify(turns);
  return useMemo(
    () => new Set(JSON.parse(named) as readonly string[]),
    [named],
  );
}

/** The turn each message heard was heard under, as one map that is the same
 * map while they are the same messages. */
function useHeardUnder(
  heard: readonly (readonly [message: string, turn: string])[],
): ReadonlyMap<string, string> {
  const named = JSON.stringify(heard);
  return useMemo(
    () => new Map(JSON.parse(named) as readonly [string, string][]),
    [named],
  );
}

/** What the page knows of the record that its items do not say: which
 * exchanges it held before each turn was listed, and whether the thread wrote
 * to a stream before the one drawn. */
function useThreadRecord(
  thread: ThreadResponse,
  items: readonly ConversationItem[],
  turns: readonly ConversationTurn[],
  reached: boolean,
): ConversationRecord {
  const [seen, setSeen] = useState(conversationSeenNothing);
  const next = useMemo(
    () => conversationSeenWith(seen, items, turns, reached),
    [seen, items, turns, reached],
  );
  if (next !== seen) setSeen(next);
  const replaced = leadStreamReplaced(thread);
  return useMemo(() => ({ seen: next, replaced }), [next, replaced]);
}

/**
 * The thread's exchanges: its transcript, its mailbox over that, and what is
 * heard of its newest turn over both. Everything but the last is kept between
 * renders, so a frame of what is being written redraws the one exchange it is
 * written in.
 */
function useThreadExchanges(
  partition: PartitionIdentity,
  thread: ThreadResponse,
  walked: LeadTranscriptWalk,
): readonly ConversationExchange[] {
  const held = walked.held;
  const stream = thread.agentReference;
  const listed = leadStreamListed(thread);
  const turned = threadStoreDue(thread);
  const items = useMemo(
    () => sessionConversationItems({ held, stream, listed, turned }),
    [held, stream, listed, turned],
  );
  const turns = useMemo(
    () => sessionConversationTurns(thread.turns),
    [thread.turns],
  );
  const stored = useMemo(() => conversationStoredBlocks(items), [items]);
  const reached =
    !walked.reading && leadTranscriptReached(held, leadStreamBatches(thread));
  const heard = useThreadLive({
    partition,
    session: thread.session,
    open: threadWriting(thread),
    turns,
    reached,
    known: reached ? stored.messages.length : undefined,
  });
  const live = conversationLiveTurns(heard, stored);
  const heardTurns = useTurnsNamed(conversationLiveTurnsHeard(live));
  const heardUnder = useHeardUnder(conversationLiveHeardUnder(heard));
  const record = useThreadRecord(thread, items, turns, reached);
  const exchanges = useMemo(
    () => conversationExchanges(items, turns, heardTurns, heardUnder, record),
    [items, turns, heardTurns, heardUnder, record],
  );
  return conversationExchangesLive(exchanges, live);
}

export function ThreadConversation(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadResponse;
  /** Whether the reader named this thread rather than arriving at it, which is
   * what puts the caret in the composer as it mounts. */
  readonly named?: boolean;
}): ReactNode {
  const thread = props.thread;
  const walked = useLeadTranscript({
    partition: props.partition,
    session: thread.session,
    stream: thread.agentReference,
    highWaterBatch: leadStreamBatches(thread),
  });
  const composer = useThreadSend({
    partition: props.partition,
    session: thread.session,
    takes: threadTakesMessages(thread),
  });
  const mentions = useConversationMentions(props.partition);
  const door = useThreadDoor(props.partition).door;
  const exchanges = useThreadExchanges(props.partition, thread, walked);
  const [read, setRead] = useState(false);
  if (!walked.reading && !read) setRead(true);
  return (
    <div
      role="region"
      aria-label="Conversation"
      data-fills-page
      className="min-h-0 min-w-0 flex-1"
    >
      <Conversation
        exchanges={
          thread.mine && threadTurnsWait(door)
            ? conversationExchangesWaiting(exchanges)
            : exchanges
        }
        {...(thread.mine
          ? {
              composer: {
                ...composer,
                focusOnMount: props.named === true,
                mentions,
              },
            }
          : {})}
        reading={walked.reading && !read}
        paced
        pane
      />
    </div>
  );
}
