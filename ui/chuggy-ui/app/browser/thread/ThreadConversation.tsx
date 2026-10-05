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
 * A MESSAGE THE READER SENT IS DRAWN BEFORE THE MAILBOX LISTS IT, at the foot
 * of the column and under its turn's name, and from the read that lists that
 * turn the mailbox's own exchange stands in the same place.
 *
 * A TURN THE READER STOPPED IS DRAWN STOPPED BEFORE THE MAILBOX SAYS SO, with
 * everything heard of it and nothing heard after the press, and from the read
 * that lists it ended the mailbox's own word stands there.
 *
 * A TURN THE PAGE WATCHED STOP STAYS AS IT STOOD. What the page drew of a turn
 * when it first drew it stopped is all it draws of it from then on, whoever
 * pressed: what stands at the stop is what the member stopped, so nothing the
 * store comes to hold of the turn and nothing heard of it afterwards is added,
 * and a turn stopped before a word of it was drawn stays without one. A call
 * that stood is the one thing that goes on being read: the store's own account
 * of it, what it was asked and what it answered, is what opening its line
 * shows. A page opened afterwards draws what was stored, which may be a few
 * words longer than the stopping page showed, and so does a page that had
 * shown nobody the turn when it stopped: one nobody was looking at, or one
 * still reading the thread for the first time.
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
  conversationExchangeSent,
  conversationExchangesStood,
  conversationExchangesStopped,
  conversationExchangesWaiting,
  conversationExchangesWithSent,
  conversationSeenNothing,
  conversationSeenWith,
  conversationWatchedNothing,
  conversationWatchedWith,
} from "../../core/conversation.ts";
import type {
  ConversationExchange,
  ConversationItem,
  ConversationRecord,
  ConversationTurn,
} from "../../core/conversation.ts";
import {
  conversationExchangesLive,
  conversationItemsHeard,
  conversationLiveHeardUnder,
  conversationLiveNothing,
  conversationLiveStoppedHeard,
  conversationLiveTurns,
  conversationLiveTurnsHeard,
  conversationStoredBlocks,
} from "../../core/conversationLive.ts";
import type { ConversationLiveHeld } from "../../core/conversationLive.ts";
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
  threadTurnsEnded,
  threadTurnsWait,
  threadWriting,
} from "../../core/threads.ts";
import { Conversation } from "../conversation/Conversation.tsx";
import { useLeadTranscript } from "../lead/LeadTranscript.tsx";
import type { LeadTranscriptWalk } from "../lead/LeadTranscript.tsx";
import { useThreadLive } from "./threadLive.ts";
import { useConversationMentions } from "./threadMentions.ts";
import { useThreadDoor, useThreadSend } from "./threadSend.tsx";
import type { ThreadKeptAway } from "./threadSend.tsx";
import type { ThreadSendHeld } from "./threadSend.tsx";

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

/** The transcript with what was heard of each stopped turn where its store
 * holds less, the same items while the same was heard of those turns: a frame
 * of another turn changes neither what is set aside nor a message being
 * written that a stop turns frames away from. */
function useItemsHeard(
  items: readonly ConversationItem[],
  heard: ConversationLiveHeld,
  stopping: ReadonlySet<string>,
): readonly ConversationItem[] {
  const written = heard.written;
  const stopped =
    heard.writing.turn !== undefined && stopping.has(heard.writing.turn);
  const writing = stopped ? heard.writing : conversationLiveNothing.writing;
  const longer = useMemo(
    () => conversationLiveStoppedHeard({ writing, written }, stopping),
    [writing, written, stopping],
  );
  return useMemo(() => conversationItemsHeard(items, longer), [items, longer]);
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

/** The thread's exchanges, and the turns the page began hearing part way
 * through. */
interface ThreadExchanges {
  readonly exchanges: readonly ConversationExchange[];
  readonly joined: readonly string[];
}

const threadJoinedNone: readonly string[] = [];

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
  stops: Pick<ThreadSendHeld, "stopping" | "takenBack">,
): ThreadExchanges {
  const held = walked.held;
  const stream = thread.agentReference;
  const listed = leadStreamListed(thread);
  const turned = threadStoreDue(thread);
  const kept = useMemo(
    () => sessionConversationItems({ held, stream, listed, turned }),
    [held, stream, listed, turned],
  );
  const turns = useMemo(
    () => sessionConversationTurns(thread.turns),
    [thread.turns],
  );
  const stored = useMemo(() => conversationStoredBlocks(kept), [kept]);
  const reached =
    !walked.reading && leadTranscriptReached(held, leadStreamBatches(thread));
  const heard = useThreadLive({
    partition,
    session: thread.session,
    open: threadWriting(thread),
    turns,
    reached,
    known: reached ? stored.messages.length : undefined,
    stopping: stops.stopping,
    takenBack: stops.takenBack,
  });
  const items = useItemsHeard(kept, heard, stops.stopping);
  const live = conversationLiveTurns(heard, stored);
  const heardTurns = useTurnsNamed(conversationLiveTurnsHeard(live));
  const heardUnder = useHeardUnder(conversationLiveHeardUnder(heard));
  const record = useThreadRecord(thread, items, turns, reached);
  const exchanges = useMemo(
    () => conversationExchanges(items, turns, heardTurns, heardUnder, record),
    [items, turns, heardTurns, heardUnder, record],
  );
  return {
    exchanges: conversationExchangesLive(exchanges, live),
    joined: heard.rejoined ?? threadJoinedNone,
  };
}

/** The exchanges with each turn this page watched stop left as it stood when
 * the page first drew it stopped, where it is not still `reading` the thread
 * for the first time. */
function useThreadStood(
  exchanges: readonly ConversationExchange[],
  reading: boolean,
  joined: readonly string[],
): readonly ConversationExchange[] {
  const [watched, setWatched] = useState(conversationWatchedNothing);
  const next = conversationWatchedWith(
    watched,
    exchanges,
    !reading && document.visibilityState !== "hidden",
    joined,
  );
  if (next !== watched) setWatched(next);
  return conversationExchangesStood(exchanges, next);
}

export function ThreadConversation(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadResponse;
  /** Whether the reader named this thread rather than arriving at it, which is
   * what puts the caret in the composer as it mounts. */
  readonly named?: boolean;
  /** What whoever mounts the thread keeps for it while it is not drawn. */
  readonly away?: ThreadKeptAway;
}): ReactNode {
  const thread = props.thread;
  const walked = useLeadTranscript({
    partition: props.partition,
    session: thread.session,
    stream: thread.agentReference,
    highWaterBatch: leadStreamBatches(thread),
  });
  const sends = useThreadSend({
    partition: props.partition,
    session: thread.session,
    takes: threadTakesMessages(thread),
    listed: thread.turns.map((turn) => turn.turn),
    ended: threadTurnsEnded(thread),
    away: props.away,
  });
  const sent = useMemo(
    () => sends.sending.map(conversationExchangeSent),
    [sends.sending],
  );
  const mentions = useConversationMentions(props.partition);
  const door = useThreadDoor(props.partition).door;
  const drawn = useThreadExchanges(props.partition, thread, walked, sends);
  const [read, setRead] = useState(false);
  if (!walked.reading && !read) setRead(true);
  const exchanges = useThreadStood(
    conversationExchangesStopped(
      conversationExchangesWithSent(drawn.exchanges, sent),
      sends.stopping,
    ),
    walked.reading && !read,
    drawn.joined,
  );
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
                ...sends.composer,
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
