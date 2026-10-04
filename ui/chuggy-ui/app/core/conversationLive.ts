/**
 * A session's turn as it is being written, laid over the conversation its
 * transcript draws.
 *
 * THE STORE IS THE TRUTH AND WHAT IS HEARD IS A PREVIEW. A block is drawn from
 * what was heard only until the transcript holds it. The entries of one model
 * message share its id and are written one block each in the message's own
 * order, so the transcript holds a heard block once it holds more blocks of
 * that message than the block's index. A block the page was never handed is
 * missing from that count and not from the message, and the text after it
 * would be drawn twice; so where the message was heard from its first block,
 * a block is also held once the transcript holds as many of that message's
 * blocks of its kind as were heard up to it. The store being written in
 * order, every block heard before one it holds is held too.
 *
 * THE TWO PATHS ARRIVE IN EITHER ORDER, so more is held here than the wire's
 * own fold holds: a message another followed, or whose turn ended, is kept
 * until the transcript has it. What is kept is bounded. A message that leaves
 * at the bound is remembered as heard and as nothing more, so it is not taken
 * for one nobody heard; that memory is bounded too, and a message that leaves
 * it is forgotten.
 *
 * WHAT IS OVER IS FORGOTTEN, NOT HIDDEN. A turn the mailbox has settled is let
 * go of the first time the walk has nothing left to read, so text its store
 * never came to hold cannot return when the walk next falls behind.
 *
 * A TURN A MEMBER STOPPED IS THE ONE KEPT. Its store holds whatever the
 * runtime had written when it was interrupted, which need not be the message
 * that was being written, so what was heard of it stays for as long as the
 * page lives. Its messages are held to a bound of their own, so a later turn
 * setting many aside does not push them out, and only a later message of the
 * stopped turn itself says one of them was abandoned: the next turn's being
 * stored says nothing about it.
 *
 * AND WHAT IS OVER IS NOT HEARD AGAIN. A runner whose turn failed sends the
 * turn's last words after it has settled it, and the hub goes on holding a
 * session's last message until its next turn begins, so a frame or a snapshot
 * naming a settled turn is an ordinary thing to hear. It is turned away where
 * it arrives: nothing of it is held, so nothing of it can be drawn, and it
 * cannot be taken for another turn being written, which would say the turn
 * that is being written had ended.
 *
 * A TURN THAT IS WAITING AGAIN HOLDS NOTHING HEARD. Its attempt ended without
 * settling it and the next one writes it from the start, so what was heard of
 * the first is let go of when a turn the mailbox said a runner held is said to
 * be waiting. A turn never seen held keeps what is heard of it: the mailbox
 * read can be behind the stream, and that is a turn being written.
 *
 * A MESSAGE THE MODEL ABANDONED IS TOLD BY WHAT REPLACED IT, AND ONLY WHERE
 * NOTHING BEFORE IT CAN HAVE GONE UNHEARD. A message is marked with how much
 * the transcript held the first time the page had read all of it with the
 * message held. A message nobody heard that its own turn came to store past
 * that mark is later than it only for a reader who heard everything the turn
 * wrote before it. A reader who joined while the message was being written,
 * or whose stream was opened again in the middle of the turn, may have missed
 * an earlier one, and the store catching up with that one says nothing about
 * this: such a message is never marked, and only a marked message can be told
 * abandoned this way. A reader whose first opening found the turn taken and
 * the hub holding nothing is taken to have missed nothing, which is the one
 * case here that is assumed. A page lets the stream go when its newest turn
 * settles, so the first opening is the first of each turn.
 *
 * AN END IS HEARD AND NEVER GUESSED. The hub tells a reader it holds nothing
 * whenever it forgets a session, which it does in the middle of a long tool as
 * readily as at a turn's end, so only an `End`, or another turn being written,
 * says a turn's last message is whole.
 */

import { threadLiveHeard } from "../../../../src/contract/threadLive.ts";
import type {
  ThreadLiveBlock,
  ThreadLiveHeld,
  ThreadLiveStreamEvent,
} from "../../../../src/contract/threadLive.ts";
import {
  conversationEntryOpens,
  conversationExchangeContinued,
  conversationTurnStopped,
} from "./conversation.ts";
import type {
  ConversationActivity,
  ConversationBlock,
  ConversationExchange,
  ConversationItem,
  ConversationTurn,
} from "./conversation.ts";

/**
 * How many messages the transcript held the first time a page had read all of
 * it with a message held. A message the transcript comes to hold past that
 * count arrived after this one began, which is the only thing that places a
 * message nobody heard after one nobody stored.
 */
export type ConversationLiveKnown = number | undefined;

/** The most messages kept for the transcript to catch up with, past which the
 * oldest leaves. */
export const conversationLiveMessagesMax = 8;

/** The most messages remembered as heard once they are kept no longer. */
export const conversationLiveLeftMax = 64;

/** The most messages kept of turns a member stopped, past which the oldest
 * of those leaves. */
export const conversationLiveStoppedMax = 32;

/** The most turns remembered as ones the stream was opened in the middle of:
 * one for each message kept, and the one being written. */
export const conversationLiveRejoinedMax = conversationLiveMessagesMax + 1;

/** One block as it was heard. `stopped` is a block a gap has since been heard
 * in: what is held of it is all that will be until the transcript has it. */
export interface ConversationLiveBlock extends ThreadLiveBlock {
  readonly stopped?: boolean;
}

/** One message as it was heard. `kept` is a message of a turn a member
 * stopped, which the transcript may never come to hold. */
export interface ConversationLiveMessage {
  readonly turn: string;
  readonly message: string;
  readonly blocks: readonly ConversationLiveBlock[];
  readonly known?: number;
  readonly kept?: true;
}

/** A message heard that is kept no longer. */
export interface ConversationLiveLeft {
  readonly turn: string;
  readonly message: string;
}

/** What a page holds of what it heard. */
export interface ConversationLiveHeld {
  /** The message being written, as the wire's own fold holds it. */
  readonly writing: ThreadLiveHeld;
  /** The mark of the message being written, once it has one. */
  readonly known?: number;
  /** Messages set aside for the transcript to catch up with, oldest first. */
  readonly written: readonly ConversationLiveMessage[];
  /** The messages that left `written` at its bound, oldest first. */
  readonly left?: readonly ConversationLiveLeft[];
  /** The turn whose last message is whole. */
  readonly ended?: string;
  /** The turns the stream was opened in the middle of, whose messages are
   * never marked. */
  readonly rejoined?: readonly string[];
  /** The turn the mailbox last said a runner holds, which is how one said to
   * be waiting afterwards is known to be waiting again. */
  readonly taken?: string;
  /** Whether a snapshot has been heard, which makes the next one a stream
   * opened again. */
  readonly opened?: true;
}

export const conversationLiveNothing: ConversationLiveHeld = {
  writing: { blocks: [] },
  written: [],
};

function conversationLiveMessageOf(
  held: ThreadLiveHeld,
  known: ConversationLiveKnown,
): ConversationLiveMessage | undefined {
  if (held.turn === undefined || held.message === undefined) return undefined;
  return {
    turn: held.turn,
    message: held.message,
    blocks: held.blocks,
    ...(known === undefined ? {} : { known }),
  };
}

/**
 * Two hearings of one message as one. A later hearing of a block replaces an
 * earlier one unless it is gapped, so a message heard twice is drawn once and
 * a gap never takes away text heard before it — it stops it.
 */
function conversationLiveBlocksMerged(
  earlier: readonly ConversationLiveBlock[],
  later: readonly ConversationLiveBlock[],
): readonly ConversationLiveBlock[] {
  const gapped = (index: number): boolean =>
    later.some((heard) => heard.index === index && heard.gapped);
  const kept = earlier
    .filter(
      (block) =>
        !later.some((heard) => heard.index === block.index && !heard.gapped),
    )
    .map((block) =>
      !block.gapped && gapped(block.index)
        ? { ...block, stopped: true }
        : block,
    );
  const added = later.filter(
    (block) =>
      !block.gapped || !earlier.some((heard) => heard.index === block.index),
  );
  return [...kept, ...added].sort((left, right) => left.index - right.index);
}

/** The messages with one more among them, joined to an earlier hearing of
 * itself where there is one. */
function conversationLiveMessagesWith(
  messages: readonly ConversationLiveMessage[],
  heard: ConversationLiveMessage,
): readonly ConversationLiveMessage[] {
  const same = (message: ConversationLiveMessage): boolean =>
    message.turn === heard.turn && message.message === heard.message;
  if (!messages.some(same)) return [...messages, heard];
  return messages.map((message) =>
    same(message)
      ? {
          ...message,
          blocks: conversationLiveBlocksMerged(message.blocks, heard.blocks),
        }
      : message,
  );
}

/**
 * Whether the fold went on with what it held: the same message, with no block
 * of it lost to a gap. Anything else leaves the fold holding less than was
 * heard, and what was heard is set aside first.
 */
function conversationLiveContinued(
  was: ThreadLiveHeld,
  now: ThreadLiveHeld,
): boolean {
  if (was.turn !== now.turn || was.message !== now.message) return false;
  return !now.blocks.some(
    (block) =>
      block.gapped &&
      was.blocks.some((held) => held.index === block.index && !held.gapped),
  );
}

/** The messages set aside and the ones remembered as having left them. */
interface ConversationLiveAside {
  readonly written: readonly ConversationLiveMessage[];
  readonly left: readonly ConversationLiveLeft[];
}

/** The messages past their bound, oldest first: those of stopped turns past
 * the bound on those, and the others past the bound on what is set aside. */
function conversationLiveLeaving(
  all: readonly ConversationLiveMessage[],
): readonly ConversationLiveMessage[] {
  const kept = all.filter((message) => message.kept === true);
  const others = all.filter((message) => message.kept !== true);
  const leaving = new Set([
    ...kept.slice(0, Math.max(0, kept.length - conversationLiveStoppedMax)),
    ...others.slice(
      0,
      Math.max(0, others.length - conversationLiveMessagesMax),
    ),
  ]);
  return all.filter((message) => leaving.has(message));
}

/** The messages held to their bounds, those that leave remembered as heard. */
function conversationLiveBounded(
  all: readonly ConversationLiveMessage[],
  left: readonly ConversationLiveLeft[],
): ConversationLiveAside {
  const leaving = conversationLiveLeaving(all);
  if (leaving.length === 0) return { written: all, left };
  const remembered = leaving.map((gone) => ({
    turn: gone.turn,
    message: gone.message,
  }));
  return {
    written: all.filter((message) => !leaving.includes(message)),
    left: [...left, ...remembered].slice(-conversationLiveLeftMax),
  };
}

/** What is set aside with the message being written among it, the oldest
 * past the bound leaving to be remembered as heard. */
function conversationLiveSetAside(
  held: ConversationLiveHeld,
): ConversationLiveAside {
  const left = held.left ?? [];
  const message = conversationLiveMessageOf(held.writing, held.known);
  if (message === undefined) return { written: held.written, left };
  return conversationLiveBounded(
    conversationLiveMessagesWith(held.written, message),
    left,
  );
}

/**
 * The turn whose last message is whole: an `End` says so, and so does another
 * turn being written. Nothing held says nothing, more heard of that turn takes
 * the word back, and the end of another turn never takes it from the turn a
 * runner holds.
 */
function conversationLiveEnded(
  held: ConversationLiveHeld,
  heard: ThreadLiveStreamEvent,
  writing: ThreadLiveHeld,
): string | undefined {
  if (heard.event === "live" && heard.data.event.live === "End")
    return held.ended !== undefined && held.ended === held.taken
      ? held.ended
      : heard.data.turn;
  const was = held.writing.turn;
  if (was !== undefined && writing.turn !== undefined && was !== writing.turn)
    return was;
  return writing.turn !== undefined && writing.turn === held.ended
    ? undefined
    : held.ended;
}

function conversationTurnSettled(
  state: ConversationTurn["state"] | undefined,
): boolean {
  return state !== undefined && state !== "Queued" && state !== "Claimed";
}

/** The turns the mailbox has settled, which is what a frame is asked at the
 * door. */
export function conversationTurnsSettled(
  turns: readonly ConversationTurn[],
): ReadonlySet<string> {
  return new Set(
    turns.flatMap((turn) =>
      conversationTurnSettled(turn.state) ? [turn.turn] : [],
    ),
  );
}

/** The turns a member stopped, which are the ones whose heard words a page
 * keeps. */
function conversationTurnsStopped(
  turns: readonly ConversationTurn[],
): ReadonlySet<string> {
  return new Set(
    turns.flatMap((turn) => (conversationTurnStopped(turn) ? [turn.turn] : [])),
  );
}

const conversationTurnsNone: ReadonlySet<string> = new Set();

/** The turns the stream was opened in the middle of, with the one a snapshot
 * is heard in: the one whose message it holds, else the one a runner held when
 * the stream was opened again, else the one being written. */
function conversationLiveRejoined(
  held: ConversationLiveHeld,
  snapshot: ThreadLiveHeld,
): readonly string[] {
  const before = held.rejoined ?? [];
  const turn =
    snapshot.turn ??
    (held.opened === true ? held.taken : undefined) ??
    held.writing.turn;
  if (turn === undefined || before.includes(turn)) return before;
  return [...before, turn].slice(-conversationLiveRejoinedMax);
}

/**
 * What is held once one frame of the stream is heard, where its turn is not in
 * `settled`: a snapshot replaces the fold's account of the message being
 * written and an event is folded by the wire's fold. What was heard before is
 * set aside rather than dropped wherever the fold is left holding less than
 * was heard, and an event the fold says changed nothing hands back what was
 * held itself.
 */
export function conversationLiveHeard(
  held: ConversationLiveHeld,
  heard: ThreadLiveStreamEvent,
  settled: ReadonlySet<string> = conversationTurnsNone,
): ConversationLiveHeld {
  const named =
    heard.event === "snapshot" ? heard.data.held.turn : heard.data.turn;
  if (named !== undefined && settled.has(named)) return held;
  const writing =
    heard.event === "snapshot"
      ? heard.data.held
      : threadLiveHeard(held.writing, heard.data.turn, heard.data.event);
  const ended = conversationLiveEnded(held, heard, writing);
  const live = heard.event === "live";
  if (live && writing === held.writing && ended === held.ended) return held;
  const continued = live && conversationLiveContinued(held.writing, writing);
  const same =
    held.writing.turn === writing.turn &&
    held.writing.message === writing.message;
  const rejoined = live
    ? (held.rejoined ?? [])
    : conversationLiveRejoined(held, writing);
  const aside = continued
    ? { written: held.written, left: held.left ?? [] }
    : conversationLiveSetAside(held);
  return {
    writing,
    ...(same && held.known !== undefined ? { known: held.known } : {}),
    written: aside.written,
    ...(aside.left.length === 0 ? {} : { left: aside.left }),
    ...(ended === undefined ? {} : { ended }),
    ...(rejoined.length === 0 ? {} : { rejoined }),
    ...(held.taken === undefined ? {} : { taken: held.taken }),
    ...(live && held.opened === undefined ? {} : { opened: true as const }),
  };
}

/**
 * What is held less everything heard of the turns `gone` names, and less the
 * word that a turn ended or was held by a runner where it is `waiting`. It is
 * handed back itself where nothing is forgotten.
 */
function conversationLiveForgotten(
  held: ConversationLiveHeld,
  gone: (turn: string | undefined) => boolean,
  waiting: (turn: string | undefined) => boolean,
): ConversationLiveHeld {
  const { known, ended, taken, left: remembered = [], ...rest } = held;
  const written = held.written.filter((message) => !gone(message.turn));
  const left = remembered.filter((heard) => !gone(heard.turn));
  const writingGone = gone(held.writing.turn);
  const endedGone = gone(held.ended) || waiting(held.ended);
  const takenGone = waiting(held.taken);
  const whole =
    written.length === held.written.length && left.length === remembered.length;
  if (whole && !writingGone && !endedGone && !takenGone) return held;
  return {
    ...rest,
    writing: writingGone ? { blocks: [] } : held.writing,
    written,
    ...(left.length === 0 ? {} : { left }),
    ...(writingGone || known === undefined ? {} : { known }),
    ...(endedGone || ended === undefined ? {} : { ended }),
    ...(takenGone || taken === undefined ? {} : { taken }),
  };
}

/** What is held with the turn the mailbox says a runner holds noted, handed
 * back itself where that is the turn already noted or there is none. */
function conversationLiveTaken(
  held: ConversationLiveHeld,
  turns: readonly ConversationTurn[],
): ConversationLiveHeld {
  const taken = turns.findLast((turn) => turn.state === "Claimed")?.turn;
  return taken === undefined || taken === held.taken
    ? held
    : { ...held, taken };
}

/** What is held less the word that a snapshot was heard, once the newest turn
 * the mailbox lists is settled: a page lets the stream go there, so the next
 * snapshot is the first opening of the turn after. */
function conversationLiveLetGo(
  held: ConversationLiveHeld,
  turns: readonly ConversationTurn[],
): ConversationLiveHeld {
  const { opened, ...rest } = held;
  if (opened === undefined) return held;
  const newest = turns.reduce<ConversationTurn | undefined>(
    (latest, turn) =>
      latest === undefined || turn.ordinal > latest.ordinal ? turn : latest,
    undefined,
  );
  return conversationTurnSettled(newest?.state) ? rest : held;
}

/** What is held with each message not yet marked given `known` for its mark,
 * but for those of a turn the stream was opened in the middle of. It is handed
 * back itself where none is owed one. */
function conversationLiveMarked(
  held: ConversationLiveHeld,
  known: number,
): ConversationLiveHeld {
  const rejoined = held.rejoined ?? [];
  const owed = (turn: string | undefined, mark: number | undefined): boolean =>
    mark === undefined && turn !== undefined && !rejoined.includes(turn);
  const writing =
    held.writing.message !== undefined && owed(held.writing.turn, held.known);
  const written = held.written.some((message) =>
    owed(message.turn, message.known),
  );
  if (!writing && !written) return held;
  return {
    ...held,
    ...(writing ? { known } : {}),
    written: held.written.map((message) =>
      owed(message.turn, message.known) ? { ...message, known } : message,
    ),
  };
}

/**
 * What is held with every message of the turns `stopped` names kept: the one
 * being written is set aside, since nothing more of it will be heard, and each
 * is held to the bound on stopped turns' messages from then. It is handed back
 * itself where every one of them is kept already.
 */
function conversationLiveStoppedKept(
  held: ConversationLiveHeld,
  stopped: ReadonlySet<string>,
): ConversationLiveHeld {
  const owed = (message: ConversationLiveMessage): boolean =>
    message.kept !== true && stopped.has(message.turn);
  const writing =
    held.writing.turn !== undefined && stopped.has(held.writing.turn);
  if (!writing && !held.written.some(owed)) return held;
  const { known, ...rest } = held;
  const aside = writing
    ? conversationLiveSetAside(held)
    : { written: held.written, left: held.left ?? [] };
  const bounded = conversationLiveBounded(
    aside.written.map((message) =>
      owed(message) ? { ...message, kept: true as const } : message,
    ),
    aside.left,
  );
  return {
    ...rest,
    writing: writing ? { blocks: [] } : held.writing,
    written: bounded.written,
    ...(bounded.left.length === 0 ? {} : { left: bounded.left }),
    ...(writing || known === undefined ? {} : { known }),
  };
}

/**
 * What is held once what the mailbox says is over is forgotten: everything
 * heard of a turn it has settled other than one a member stopped, once
 * `reached` — the walk has nothing left to read — and of a turn it said a
 * runner held that is waiting again, at once. A message not yet marked is
 * marked with `known` where the page gives one, which it does once it has read
 * everything, and what is held is handed back itself where nothing changed.
 */
export function conversationLiveKept(
  held: ConversationLiveHeld,
  turns: readonly ConversationTurn[],
  reached: boolean,
  known?: ConversationLiveKnown,
): ConversationLiveHeld {
  const states = new Map(turns.map((turn) => [turn.turn, turn.state]));
  const waiting = (turn: string | undefined): boolean =>
    turn !== undefined && states.get(turn) === "Queued";
  const again = waiting(held.taken) ? held.taken : undefined;
  const stopped = conversationTurnsStopped(turns);
  const over = (turn: string): boolean =>
    reached && conversationTurnSettled(states.get(turn)) && !stopped.has(turn);
  const gone = (turn: string | undefined): boolean =>
    turn !== undefined && (turn === again || over(turn));
  const kept = conversationLiveTaken(
    conversationLiveLetGo(
      conversationLiveForgotten(
        conversationLiveStoppedKept(held, stopped),
        gone,
        waiting,
      ),
      turns,
    ),
    turns,
  );
  return known === undefined ? kept : conversationLiveMarked(kept, known);
}

/** How many blocks of one message the transcript holds: of each kind a page
 * hears, and of every kind, with those an entry was cut of counted in. */
export interface ConversationStoredKinds {
  readonly Text: number;
  readonly Thinking: number;
  readonly ToolUse: number;
  readonly all: number;
}

/** What the transcript holds of the model's messages. */
export interface ConversationStored {
  readonly blocks: ReadonlyMap<string, ConversationStoredKinds>;
  /** The messages in the order it came to hold them. */
  readonly messages: readonly string[];
  /** The exchange each message falls in, by the entry that opened it. */
  readonly exchanges: ReadonlyMap<string, string>;
}

const conversationStoredNothing: ConversationStoredKinds = {
  Text: 0,
  Thinking: 0,
  ToolUse: 0,
  all: 0,
};

function conversationStoredWith(
  held: ConversationStoredKinds,
  block: ConversationBlock,
): ConversationStoredKinds {
  switch (block.block) {
    case "Text":
    case "Thinking":
    case "ToolUse":
      return {
        ...held,
        [block.block]: held[block.block] + 1,
        all: held.all + 1,
      };
    case "Capped":
      return { ...held, all: held.all + block.count };
    case "ToolResult":
    case "Other":
      return { ...held, all: held.all + 1 };
  }
}

export function conversationStoredBlocks(
  items: readonly ConversationItem[],
): ConversationStored {
  const blocks = new Map<string, ConversationStoredKinds>();
  const exchanges = new Map<string, string>();
  let open: string | undefined = undefined;
  for (const item of items) {
    if (item.item !== "Entry") continue;
    if (open === undefined || conversationEntryOpens(item.entry))
      open = item.entry.id;
    const message = item.entry.message;
    if (message === undefined) continue;
    exchanges.set(message, open);
    blocks.set(
      message,
      item.entry.blocks.reduce(
        conversationStoredWith,
        blocks.get(message) ?? conversationStoredNothing,
      ),
    );
  }
  return { blocks, messages: [...blocks.keys()], exchanges };
}

/** One message's blocks still to draw. */
export interface ConversationLiveRun {
  /** The blocks the transcript does not hold yet, in the order written. */
  readonly blocks: readonly ConversationBlock[];
  /** Whether the last of them is one no more will be heard of. */
  readonly stopped: boolean;
  /** The exchanges holding a stored message that, were the exchange this
   * message's own turn's, would say the message was abandoned. */
  readonly replacedIn: readonly string[];
}

/** What is still to draw of one turn from what was heard of it. */
export interface ConversationLiveTurn {
  readonly turn: string;
  /** What the transcript does not hold yet, message by message as heard. */
  readonly runs: readonly ConversationLiveRun[];
  /** Whether the turn's last message is whole. */
  readonly ended: boolean;
}

function conversationLiveBlockOf(block: ThreadLiveBlock): ConversationBlock {
  switch (block.kind) {
    case "Text":
      return { block: "Text", text: block.text };
    case "Thinking":
      return { block: "Thinking", text: "" };
    case "ToolUse":
      return {
        block: "ToolUse",
        id: "",
        name: block.name ?? "",
        input: undefined,
      };
  }
}

/** Whether a block heard is one to draw: a gapped block never is, and a text
 * block nothing has been heard of yet is not there to draw. */
function conversationLiveBlockDrawn(block: ThreadLiveBlock): boolean {
  return !block.gapped && (block.kind !== "Text" || block.text.length > 0);
}

/** Every message held, in the order they were heard, each once. */
function conversationLiveMessages(
  held: ConversationLiveHeld,
): readonly ConversationLiveMessage[] {
  const writing = conversationLiveMessageOf(held.writing, held.known);
  return writing === undefined
    ? held.written
    : conversationLiveMessagesWith(held.written, writing);
}

/** The turn each message heard was heard under, kept or remembered, which is
 * what tells a page's pairing that a stored message is a turn's own. */
export function conversationLiveHeardUnder(
  held: ConversationLiveHeld,
): readonly (readonly [message: string, turn: string])[] {
  return [...(held.left ?? []), ...conversationLiveMessages(held)].map(
    (message) => [message.message, message.turn] as const,
  );
}

/**
 * The index the transcript holds a message heard up to, every block at or
 * before it being held: the count of all its stored blocks reaches one, and so
 * does a block the transcript holds as many of its kind as were heard up to
 * it. The second is asked only of blocks heard with every block before them,
 * since a block's place among its kind is known of no other.
 */
function conversationLiveHeldTo(
  message: ConversationLiveMessage,
  kinds: ConversationStoredKinds | undefined,
): number {
  if (kinds === undefined) return -1;
  const seen = { Text: 0, Thinking: 0, ToolUse: 0 };
  let heldTo = kinds.all - 1;
  const ordered = [...message.blocks].sort(
    (left, right) => left.index - right.index,
  );
  for (const [place, block] of ordered.entries()) {
    if (block.index !== place) break;
    seen[block.kind] += 1;
    if (seen[block.kind] <= kinds[block.kind])
      heldTo = Math.max(heldTo, block.index);
  }
  return heldTo;
}

/** Whether the transcript holds, after a message it holds, another in the
 * same exchange, which is another of the same turn. */
function conversationStoredFollowed(
  stored: ConversationStored,
  message: string,
): boolean {
  const exchange = stored.exchanges.get(message);
  return stored.messages
    .slice(stored.messages.indexOf(message) + 1)
    .some((later) => stored.exchanges.get(later) === exchange);
}

/**
 * Whether the transcript holds a block of a message later than the one heard
 * at this place, which makes it a message the transcript will hold no more of:
 * the store is written in order, and a message the model abandoned is never
 * finished. A later message is one the transcript holds after this one, or one
 * heard after it; of a turn a member stopped, only a later one of that turn.
 */
function conversationLiveOver(
  heard: readonly ConversationLiveMessage[],
  at: number,
  stored: ConversationStored,
): boolean {
  const message = heard[at];
  if (message === undefined) return false;
  const kept = message.kept === true;
  if (stored.blocks.has(message.message))
    return kept
      ? conversationStoredFollowed(stored, message.message)
      : stored.messages.at(-1) !== message.message;
  return heard
    .slice(at + 1)
    .some(
      (later) =>
        (!kept || later.turn === message.turn) &&
        stored.blocks.has(later.message),
    );
}

/**
 * The exchanges of the stored messages that would say the message heard at
 * this place was abandoned: those nobody heard before it, `left` being the
 * ones heard and kept no longer, that the transcript came to hold after its
 * mark. Only a marked message has any, and whether one of them is its own
 * turn's is for the pairing to say, which is why the exchange is named and
 * nothing is decided here.
 */
function conversationLiveReplacedIn(
  heard: readonly ConversationLiveMessage[],
  at: number,
  stored: ConversationStored,
  left: readonly ConversationLiveLeft[],
): readonly string[] {
  const message = heard[at];
  if (message?.known === undefined || stored.blocks.has(message.message))
    return [];
  const before = new Set(
    [...left, ...heard.slice(0, at)].map((earlier) => earlier.message),
  );
  const exchanges = stored.messages
    .slice(message.known)
    .flatMap((held) => (before.has(held) ? [] : [stored.exchanges.get(held)]));
  return [...new Set(exchanges)].flatMap((exchange) =>
    exchange === undefined ? [] : [exchange],
  );
}

/** The messages of one turn with blocks the transcript does not hold and is
 * still to, or may never where a member stopped the turn. */
function conversationLiveTurnRuns(
  held: ConversationLiveHeld,
  turn: string,
  stored: ConversationStored,
): readonly ConversationLiveRun[] {
  const heard = conversationLiveMessages(held);
  return heard.flatMap((message, at) => {
    if (message.turn !== turn || conversationLiveOver(heard, at, stored))
      return [];
    const heldTo = conversationLiveHeldTo(
      message,
      stored.blocks.get(message.message),
    );
    const blocks = message.blocks.filter(
      (block) => block.index > heldTo && conversationLiveBlockDrawn(block),
    );
    if (blocks.length === 0) return [];
    return [
      {
        blocks: blocks.map(conversationLiveBlockOf),
        stopped: blocks.at(-1)?.stopped === true,
        replacedIn: conversationLiveReplacedIn(
          heard,
          at,
          stored,
          held.left ?? [],
        ),
      },
    ];
  });
}

function conversationLiveTurnNames(
  held: ConversationLiveHeld,
): readonly string[] {
  const named = [
    ...held.written.map((message) => message.turn),
    ...(held.writing.turn === undefined ? [] : [held.writing.turn]),
    ...(held.ended === undefined ? [] : [held.ended]),
  ];
  return [...new Set(named)];
}

/** What a page draws from what it holds of what it heard, turn by turn. */
export function conversationLiveTurns(
  held: ConversationLiveHeld,
  stored: ConversationStored,
): readonly ConversationLiveTurn[] {
  return conversationLiveTurnNames(held).flatMap((turn) => {
    const runs = conversationLiveTurnRuns(held, turn, stored);
    const ended = held.ended === turn;
    return runs.length === 0 && !ended ? [] : [{ turn, runs, ended }];
  });
}

/** The turns something heard is still to be drawn for, which is what keeps an
 * answered one's exchange standing until the transcript's own arrives. */
export function conversationLiveTurnsHeard(
  live: readonly ConversationLiveTurn[],
): readonly string[] {
  return live.flatMap((turn) => (turn.runs.length === 0 ? [] : [turn.turn]));
}

/** What the last block heard of a turn says it is doing. */
function conversationLiveBlockActivity(
  block: ConversationBlock | undefined,
): ConversationActivity | undefined {
  if (block?.block === "Text") return { activity: "Writing" };
  if (block?.block === "Thinking") return { activity: "Thinking" };
  if (block?.block === "ToolUse")
    return { activity: "ToolUse", name: block.name };
  return undefined;
}

/**
 * What an exchange a runner has taken is doing: its last message is whole, or
 * what the last block heard of it is, or — where nothing heard is left to
 * draw — the call its transcript holds no result for. Nothing is said where
 * none of them knows, nor of a turn that is waiting.
 */
function conversationLiveActivity(
  exchange: ConversationExchange,
  ended: boolean,
  last: ConversationLiveRun | undefined,
): ConversationActivity | undefined {
  const standing = exchange.standing;
  if (standing.standing !== "Running" || standing.state !== "Claimed")
    return undefined;
  if (ended) return { activity: "Whole" };
  const heard =
    last === undefined || last.stopped
      ? undefined
      : conversationLiveBlockActivity(last.blocks.at(-1));
  if (heard !== undefined || exchange.answer !== undefined) return heard;
  const step = exchange.work.at(-1);
  return step?.step === "ToolCall" &&
    step.result === undefined &&
    step.name !== undefined
    ? { activity: "ToolUse", name: step.name }
    : undefined;
}

/** The runs of a turn its own exchange does not say were abandoned: one is,
 * where the exchange holds a stored message that would have replaced it. */
function conversationLiveRunsDrawn(
  exchange: ConversationExchange,
  live: ConversationLiveTurn | undefined,
): readonly ConversationLiveRun[] {
  return (live?.runs ?? []).filter(
    (run) => !run.replacedIn.includes(exchange.id),
  );
}

/** A heard block is a text, a thought or a call, and nothing else of a
 * thought or a call is heard than its kind and its name. */
function conversationLiveBlockSame(
  left: ConversationBlock,
  right: ConversationBlock | undefined,
): boolean {
  if (left.block === "Text")
    return right?.block === "Text" && left.text === right.text;
  if (left.block === "ToolUse")
    return right?.block === "ToolUse" && left.name === right.name;
  return left.block === right?.block;
}

function conversationLiveRunSame(
  left: ConversationLiveRun,
  right: ConversationLiveRun | undefined,
): boolean {
  return (
    right !== undefined &&
    left.stopped === right.stopped &&
    left.blocks.length === right.blocks.length &&
    left.blocks.every((block, at) =>
      conversationLiveBlockSame(block, right.blocks[at]),
    )
  );
}

/** An exchange as it was last drawn over what was heard of its turn. */
interface ConversationLiveMade {
  readonly runs: readonly ConversationLiveRun[];
  readonly ended: boolean;
  readonly made: ConversationExchange;
}

const conversationLiveMade = new WeakMap<
  ConversationExchange,
  ConversationLiveMade
>();

/** An exchange with what was heard of its turn read after what it holds, the
 * same exchange each time while the same is heard of it. */
function conversationExchangeLive(
  exchange: ConversationExchange,
  live: ConversationLiveTurn | undefined,
): ConversationExchange {
  const runs = conversationLiveRunsDrawn(exchange, live);
  const ended = live?.ended === true;
  const before = conversationLiveMade.get(exchange);
  if (
    before?.ended === ended &&
    before.runs.length === runs.length &&
    runs.every((run, at) => conversationLiveRunSame(run, before.runs[at]))
  )
    return before.made;
  const continued = conversationExchangeContinued(
    exchange,
    runs.flatMap((run) => run.blocks),
  );
  const activity = conversationLiveActivity(continued, ended, runs.at(-1));
  const made = activity === undefined ? continued : { ...continued, activity };
  conversationLiveMade.set(exchange, { runs, ended, made });
  return made;
}

/**
 * The exchanges as a page that follows its turns draws them: what was heard of
 * a turn read after everything its transcript holds, by the fold a stored
 * block takes. An exchange nothing was heard of and no turn is running in is
 * handed back as it came.
 */
export function conversationExchangesLive(
  exchanges: readonly ConversationExchange[],
  live: readonly ConversationLiveTurn[],
): readonly ConversationExchange[] {
  return exchanges.map((exchange) => {
    const heard =
      exchange.turn === undefined
        ? undefined
        : live.find((turn) => turn.turn === exchange.turn);
    if (heard === undefined && exchange.standing.standing !== "Running")
      return exchange;
    return conversationExchangeLive(exchange, heard);
  });
}
