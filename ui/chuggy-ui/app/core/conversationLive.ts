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
 * until the transcript has it. What is kept is bounded, and a turn the mailbox
 * has settled is dropped once the transcript walk has nothing left to read.
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

/** The most messages kept for the transcript to catch up with, past which the
 * oldest leaves. */
export const conversationLiveMessagesMax = 8;

/** One message as it was heard. */
export interface ConversationLiveMessage {
  readonly turn: string;
  readonly message: string;
  readonly blocks: readonly ThreadLiveBlock[];
}

/** What a page holds of what it heard. */
export interface ConversationLiveHeld {
  /** The message being written, as the wire's own fold holds it. */
  readonly writing: ThreadLiveHeld;
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
): ConversationLiveMessage | undefined {
  if (held.turn === undefined || held.message === undefined) return undefined;
  return { turn: held.turn, message: held.message, blocks: held.blocks };
}

/**
 * Two hearings of one message as one. A later hearing of a block replaces an
 * earlier one unless it is gapped, so a message heard twice is drawn once and
 * a gap never takes away text heard before it.
 */
function conversationLiveBlocksMerged(
  earlier: readonly ThreadLiveBlock[],
  later: readonly ThreadLiveBlock[],
): readonly ThreadLiveBlock[] {
  const kept = earlier.filter(
    (block) =>
      !later.some((heard) => heard.index === block.index && !heard.gapped),
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
  written: readonly ConversationLiveMessage[],
  was: ThreadLiveHeld,
): readonly ConversationLiveMessage[] {
  const message = conversationLiveMessageOf(was);
  if (message === undefined) return written;
  return conversationLiveMessagesWith(written, message).slice(
    -conversationLiveMessagesMax,
  );
}

/**
 * The turn whose last message is whole: an `End` says so, and so does the turn
 * that was being written no longer being the one that is, which is how an end
 * nobody heard is read. More heard of that turn takes the word back.
 */
function conversationLiveEnded(
  held: ConversationLiveHeld,
  heard: ThreadLiveStreamEvent,
  writing: ThreadLiveHeld,
): string | undefined {
  if (heard.event === "live" && heard.data.event.live === "End")
    return heard.data.turn;
  const was = held.writing.turn;
  if (was !== undefined && was !== writing.turn) return was;
  return writing.turn !== undefined && writing.turn === held.ended
    ? undefined
    : held.ended;
}

/**
 * What is held once one frame of the stream is heard: a snapshot replaces the
 * fold's account of the message being written with the server's, and an event
 * is folded by the wire's fold. What was heard before is set aside rather than
 * dropped wherever the fold is left holding less than was heard here.
 */
export function conversationLiveHeard(
  held: ConversationLiveHeld,
  heard: ThreadLiveStreamEvent,
): ConversationLiveHeld {
  const writing =
    heard.event === "snapshot"
      ? heard.data.held
      : threadLiveHeard(held.writing, heard.data.turn, heard.data.event);
  const continued =
    heard.event === "live" && conversationLiveContinued(held.writing, writing);
  const ended = conversationLiveEnded(held, heard, writing);
  return {
    writing,
    written: continued
      ? held.written
      : conversationLiveSetAside(held.written, held.writing),
    ...(ended === undefined ? {} : { ended }),
  };
}

/** How many blocks of each model message the transcript holds. */
export function conversationStoredBlocks(
  items: readonly ConversationItem[],
): ReadonlyMap<string, number> {
  const stored = new Map<string, number>();
  for (const item of items) {
    if (item.item !== "Entry" || item.entry.message === undefined) continue;
    const blocks = item.entry.blocks.reduce(
      (count, block) => count + (block.block === "Capped" ? block.count : 1),
      0,
    );
    stored.set(
      item.entry.message,
      (stored.get(item.entry.message) ?? 0) + blocks,
    );
  }
  return stored;
}

/** What is still to draw of one turn from what was heard of it. */
export interface ConversationLiveTurn {
  readonly turn: string;
  /** The blocks the transcript does not hold yet, in the order written. */
  readonly blocks: readonly ConversationBlock[];
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

/** One turn's messages in the order they were heard, each once. */
function conversationLiveTurnMessages(
  held: ConversationLiveHeld,
  turn: string,
): readonly ConversationLiveMessage[] {
  const writing = conversationLiveMessageOf(held.writing);
  const heard =
    writing === undefined
      ? held.written
      : conversationLiveMessagesWith(held.written, writing);
  return heard.filter((message) => message.turn === turn);
}

/**
 * The blocks of one turn the transcript does not hold. The store is written in
 * order, so a message heard before one the transcript already holds part of is
 * a message it will hold no more of, and nothing of it is drawn.
 */
function conversationLiveTurnBlocks(
  held: ConversationLiveHeld,
  turn: string,
  stored: ReadonlyMap<string, number>,
): readonly ConversationBlock[] {
  const messages = conversationLiveTurnMessages(held, turn);
  const from = messages.findLastIndex(
    (message) => (stored.get(message.message) ?? 0) > 0,
  );
  return messages
    .slice(Math.max(from, 0))
    .flatMap((message) =>
      message.blocks
        .filter(
          (block) =>
            block.index >= (stored.get(message.message) ?? 0) &&
            conversationLiveBlockDrawn(block),
        )
        .map(conversationLiveBlockOf),
    );
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

/**
 * What a page draws from what it heard, turn by turn. A turn the mailbox has
 * settled is left out once `reached` — the walk has nothing left to read — so
 * what the store never came to hold does not outlive the turn it was heard in,
 * and what it is still to hold is not taken away before it arrives.
 */
export function conversationLiveTurns(
  held: ConversationLiveHeld,
  stored: ReadonlyMap<string, number>,
  turns: readonly ConversationTurn[],
  reached: boolean,
): readonly ConversationLiveTurn[] {
  return conversationLiveTurnNames(held).flatMap((turn) => {
    const state = turns.find((known) => known.turn === turn)?.state;
    if (state === undefined) return [];
    const running = state === "Queued" || state === "Claimed";
    if (reached && !running) return [];
    const blocks = conversationLiveTurnBlocks(held, turn, stored);
    const ended = held.ended === turn;
    return blocks.length === 0 && !ended ? [] : [{ turn, blocks, ended }];
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
 * What a running exchange is doing: its last message is whole, or what the
 * last block heard of it is, or — where nothing heard is left to draw — the
 * call its transcript holds no result for. Nothing is said where none of them
 * knows.
 */
function conversationLiveActivity(
  exchange: ConversationExchange,
  live: ConversationLiveTurn | undefined,
): ConversationActivity | undefined {
  if (exchange.standing.standing !== "Running") return undefined;
  if (live?.ended === true) return { activity: "Whole" };
  const heard = conversationLiveBlockActivity(live?.blocks.at(-1));
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
