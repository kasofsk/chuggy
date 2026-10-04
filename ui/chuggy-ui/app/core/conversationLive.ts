/**
 * A session's turn as it is being written, laid over the conversation its
 * transcript draws.
 *
 * THE STORE IS THE TRUTH AND WHAT IS HEARD IS A PREVIEW. A block is drawn from
 * what was heard only until the transcript holds it, and the two are matched
 * by position: the entries of one model message share its id and are written
 * one block each in the message's own order, so the transcript holds a heard
 * block once it holds more blocks of that message than the block's index.
 *
 * THE TWO PATHS ARRIVE IN EITHER ORDER, so more is held here than the wire's
 * own fold holds: a message another followed, or whose turn ended, is kept
 * until the transcript has it. What is kept is bounded.
 *
 * WHAT IS OVER IS FORGOTTEN, NOT HIDDEN. A turn the mailbox has settled is let
 * go of the first time the walk has nothing left to read, so text its store
 * never came to hold cannot return when the walk next falls behind.
 *
 * AND WHAT IS OVER IS NOT HEARD AGAIN. A runner whose turn failed sends the
 * turn's last words after it has settled it, and the hub goes on holding a
 * session's last message until its next turn begins, so a frame or a snapshot
 * naming a settled turn is an ordinary thing to hear. It is turned away where
 * it arrives: nothing of it is held, so nothing of it can be drawn, and it
 * cannot be taken for another turn being written, which would say the turn
 * that is being written had ended.
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
import { conversationExchangeContinued } from "./conversation.ts";
import type {
  ConversationActivity,
  ConversationBlock,
  ConversationExchange,
  ConversationItem,
  ConversationTurn,
} from "./conversation.ts";

/**
 * How many messages the transcript held when a message was first heard, where
 * the page had read all of it then. A message the transcript comes to hold
 * past that count arrived after this one began, which is the only thing that
 * places a message nobody heard after one nobody stored.
 */
export type ConversationLiveKnown = number | undefined;

/** The most messages kept for the transcript to catch up with, past which the
 * oldest leaves. */
export const conversationLiveMessagesMax = 8;

/** One block as it was heard. `stopped` is a block a gap has since been heard
 * in: what is held of it is all that will be until the transcript has it. */
export interface ConversationLiveBlock extends ThreadLiveBlock {
  readonly stopped?: boolean;
}

/** One message as it was heard. */
export interface ConversationLiveMessage {
  readonly turn: string;
  readonly message: string;
  readonly blocks: readonly ConversationLiveBlock[];
  readonly known?: number;
}

/** What a page holds of what it heard. */
export interface ConversationLiveHeld {
  /** The message being written, as the wire's own fold holds it. */
  readonly writing: ThreadLiveHeld;
  /** What the transcript held when the message being written was first heard. */
  readonly known?: number;
  /** Messages set aside for the transcript to catch up with, oldest first. */
  readonly written: readonly ConversationLiveMessage[];
  /** The turn whose last message is whole. */
  readonly ended?: string;
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

function conversationLiveSetAside(
  held: ConversationLiveHeld,
): readonly ConversationLiveMessage[] {
  const written = held.written;
  const message = conversationLiveMessageOf(held.writing, held.known);
  if (message === undefined) return written;
  return conversationLiveMessagesWith(written, message).slice(
    -conversationLiveMessagesMax,
  );
}

/**
 * The turn whose last message is whole: an `End` says so, and so does another
 * turn being written. Nothing held says nothing, and more heard of that turn
 * takes the word back.
 */
function conversationLiveEnded(
  held: ConversationLiveHeld,
  heard: ThreadLiveStreamEvent,
  writing: ThreadLiveHeld,
): string | undefined {
  if (heard.event === "live" && heard.data.event.live === "End")
    return heard.data.turn;
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

const conversationTurnsNone: ReadonlySet<string> = new Set();

/**
 * What is held once one frame of the stream is heard, where its turn is not in
 * `settled`: a snapshot replaces the fold's account of the message being
 * written, an event is folded by the wire's fold, and a message heard for the
 * first time is marked with `known`. What was heard before is set aside
 * rather than dropped wherever the fold is left holding less than was heard,
 * and an event the fold says changed nothing hands back what was held itself.
 */
export function conversationLiveHeard(
  held: ConversationLiveHeld,
  heard: ThreadLiveStreamEvent,
  known?: ConversationLiveKnown,
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
  const marked = same ? held.known : known;
  return {
    writing,
    ...(marked === undefined ? {} : { known: marked }),
    written: continued ? held.written : conversationLiveSetAside(held),
    ...(ended === undefined ? {} : { ended }),
  };
}

/**
 * What is held once what the mailbox says is over is forgotten: everything
 * heard of a turn it has settled, once `reached` — the walk has nothing left
 * to read — and the word that a turn ended, once that turn is waiting again.
 * What is held is handed back itself where nothing is forgotten.
 */
export function conversationLiveKept(
  held: ConversationLiveHeld,
  turns: readonly ConversationTurn[],
  reached: boolean,
): ConversationLiveHeld {
  const states = new Map(turns.map((turn) => [turn.turn, turn.state]));
  const over = (turn: string | undefined): boolean =>
    reached && turn !== undefined && conversationTurnSettled(states.get(turn));
  const written = held.written.filter((message) => !over(message.turn));
  const writingOver = over(held.writing.turn);
  const endedOver =
    held.ended !== undefined &&
    (over(held.ended) || states.get(held.ended) === "Queued");
  if (written.length === held.written.length && !writingOver && !endedOver)
    return held;
  return {
    writing: writingOver ? { blocks: [] } : held.writing,
    ...(writingOver || held.known === undefined ? {} : { known: held.known }),
    written,
    ...(endedOver || held.ended === undefined ? {} : { ended: held.ended }),
  };
}

/** What the transcript holds of the model's messages. */
export interface ConversationStored {
  /** How many blocks of each message it holds. */
  readonly blocks: ReadonlyMap<string, number>;
  /** The messages in the order it came to hold them. */
  readonly messages: readonly string[];
}

export function conversationStoredBlocks(
  items: readonly ConversationItem[],
): ConversationStored {
  const blocks = new Map<string, number>();
  for (const item of items) {
    if (item.item !== "Entry" || item.entry.message === undefined) continue;
    const held = item.entry.blocks.reduce(
      (count, block) => count + (block.block === "Capped" ? block.count : 1),
      0,
    );
    blocks.set(
      item.entry.message,
      (blocks.get(item.entry.message) ?? 0) + held,
    );
  }
  return { blocks, messages: [...blocks.keys()] };
}

/** What is still to draw of one turn from what was heard of it. */
export interface ConversationLiveTurn {
  readonly turn: string;
  /** The blocks the transcript does not hold yet, in the order written. */
  readonly blocks: readonly ConversationBlock[];
  /** Whether the last of them is one no more will be heard of. */
  readonly stopped: boolean;
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

/**
 * Whether the transcript holds a block of a message later than the one heard
 * at this place, which makes it a message the transcript will hold no more of:
 * the store is written in order, and a message the model abandoned is never
 * finished. A later message is one the transcript holds after this one, one
 * heard after it, or one nobody heard that the transcript came to hold after
 * this one began.
 */
function conversationLiveOver(
  heard: readonly ConversationLiveMessage[],
  at: number,
  stored: ConversationStored,
): boolean {
  const message = heard[at];
  if (message === undefined) return false;
  if (stored.blocks.has(message.message))
    return stored.messages.at(-1) !== message.message;
  if (heard.slice(at + 1).some((later) => stored.blocks.has(later.message)))
    return true;
  if (message.known === undefined) return false;
  const before = new Set(heard.slice(0, at).map((earlier) => earlier.message));
  return stored.messages.slice(message.known).some((held) => !before.has(held));
}

/** The blocks of one turn the transcript does not hold and is still to. */
function conversationLiveTurnBlocks(
  held: ConversationLiveHeld,
  turn: string,
  stored: ConversationStored,
): readonly ConversationLiveBlock[] {
  const heard = conversationLiveMessages(held);
  return heard.flatMap((message, at) => {
    if (message.turn !== turn || conversationLiveOver(heard, at, stored))
      return [];
    return message.blocks.filter(
      (block) =>
        block.index >= (stored.blocks.get(message.message) ?? 0) &&
        conversationLiveBlockDrawn(block),
    );
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
    const heard = conversationLiveTurnBlocks(held, turn, stored);
    const ended = held.ended === turn;
    if (heard.length === 0 && !ended) return [];
    const blocks = heard.map(conversationLiveBlockOf);
    return [{ turn, blocks, ended, stopped: heard.at(-1)?.stopped === true }];
  });
}

/** The turns something heard is still to be drawn for, which is what keeps an
 * answered one's exchange standing until the transcript's own arrives. */
export function conversationLiveTurnsHeard(
  live: readonly ConversationLiveTurn[],
): readonly string[] {
  return live.flatMap((turn) => (turn.blocks.length === 0 ? [] : [turn.turn]));
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
 * none of them knows, nor of a turn that is waiting, whatever was heard of it
 * before it went back to wait.
 */
function conversationLiveActivity(
  exchange: ConversationExchange,
  live: ConversationLiveTurn | undefined,
): ConversationActivity | undefined {
  const standing = exchange.standing;
  if (standing.standing !== "Running" || standing.state !== "Claimed")
    return undefined;
  if (live?.ended === true) return { activity: "Whole" };
  const heard =
    live?.stopped === true
      ? undefined
      : conversationLiveBlockActivity(live?.blocks.at(-1));
  if (heard !== undefined || exchange.answer !== undefined) return heard;
  const step = exchange.work.at(-1);
  return step?.step === "ToolCall" &&
    step.result === undefined &&
    step.name !== undefined
    ? { activity: "ToolUse", name: step.name }
    : undefined;
}

/**
 * A running exchange with its latest text in the answer's place. The fold
 * moves a text into the work once a step follows it, which is right for a
 * turn that is over and takes the words from under a reader while it is not:
 * they stay until a newer text begins or the turn settles.
 */
function conversationLiveTextKept(
  exchange: ConversationExchange,
): ConversationExchange {
  if (exchange.standing.standing !== "Running") return exchange;
  if (exchange.answer !== undefined) return exchange;
  const at = exchange.work.findLastIndex((step) => step.step === "Text");
  const text = exchange.work[at];
  if (text?.step !== "Text") return exchange;
  return {
    ...exchange,
    work: exchange.work.filter((_step, index) => index !== at),
    answer: text.text,
  };
}

function conversationExchangeLive(
  exchange: ConversationExchange,
  live: ConversationLiveTurn | undefined,
): ConversationExchange {
  const continued = conversationExchangeContinued(exchange, live?.blocks ?? []);
  const activity = conversationLiveActivity(continued, live);
  const kept = conversationLiveTextKept(continued);
  return activity === undefined ? kept : { ...kept, activity };
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
