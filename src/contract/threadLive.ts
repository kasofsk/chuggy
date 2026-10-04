/**
 * A thread's live stream, as server-sent events: what the thread's session is
 * writing right now.
 *
 * `snapshot` opens every connection with what is held of the message being
 * written, and is sent again to a reader that fell behind. `live` carries one
 * event as the session's runner reported it, and `threadLiveHeard` is what a
 * reader holds after it. No frame carries an `id:`: nothing here is retained,
 * and a reader that reconnects is handed a new snapshot.
 */

import { z } from "zod";

import {
  sessionIdentityCharsMax,
  sessionLiveBlockCharsMax,
  sessionLiveBlocksMax,
  sessionLiveMessageCharsMax,
  sessionTurnToolNameCharsMax,
} from "./http.ts";
import {
  sessionLiveBlockKinds,
  sessionLiveEventSchema,
  type SessionLiveEvent,
} from "./sessionLive.ts";

export const threadLiveVersion = 1;

export const threadLiveEvents = ["snapshot", "live"] as const;
export type ThreadLiveEventName = (typeof threadLiveEvents)[number];

const versionSchema = z.literal(threadLiveVersion);

const turnSchema = z.string().min(1).max(sessionIdentityCharsMax);

/**
 * One block of the message being written: what it is, the text heard of it,
 * and whether some of its text was missed. A gapped block holds no text, and
 * hears none until its message begins it again.
 */
export const threadLiveBlockSchema = z.strictObject({
  index: z.number().int().nonnegative().lt(sessionLiveBlocksMax),
  kind: z.enum(sessionLiveBlockKinds),
  name: z.string().min(1).max(sessionTurnToolNameCharsMax).optional(),
  text: z.string().max(sessionLiveBlockCharsMax),
  gapped: z.boolean(),
});
export type ThreadLiveBlock = z.infer<typeof threadLiveBlockSchema>;

/** What is held of a turn in flight: the message being written and its blocks in index order, or no turn and no block. */
export const threadLiveHeldSchema = z.strictObject({
  turn: turnSchema.optional(),
  message: z.string().min(1).max(sessionLiveMessageCharsMax).optional(),
  blocks: z.array(threadLiveBlockSchema).max(sessionLiveBlocksMax),
});
export type ThreadLiveHeld = z.infer<typeof threadLiveHeldSchema>;

/** A session with nothing in flight. */
export const threadLiveNothing: ThreadLiveHeld = { blocks: [] };

export const threadLiveSnapshotDataSchema = z.strictObject({
  version: versionSchema,
  held: threadLiveHeldSchema,
});
export type ThreadLiveSnapshotData = z.infer<
  typeof threadLiveSnapshotDataSchema
>;

export const threadLiveEventDataSchema = z.strictObject({
  version: versionSchema,
  turn: turnSchema,
  event: sessionLiveEventSchema,
});
export type ThreadLiveEventData = z.infer<typeof threadLiveEventDataSchema>;

export type ThreadLiveStreamEvent =
  | { readonly event: "snapshot"; readonly data: ThreadLiveSnapshotData }
  | { readonly event: "live"; readonly data: ThreadLiveEventData };

/** One frame as a transport hands it over, before its `data:` is understood. */
export interface ThreadLiveFrame {
  readonly event: string;
  readonly data: unknown;
}

export function parseThreadLiveEvent(
  frame: ThreadLiveFrame,
): ThreadLiveStreamEvent {
  switch (frame.event) {
    case "snapshot":
      return {
        event: "snapshot",
        data: threadLiveSnapshotDataSchema.parse(frame.data),
      };
    case "live":
      return {
        event: "live",
        data: threadLiveEventDataSchema.parse(frame.data),
      };
    default:
      throw new RangeError("a thread live frame names an unknown event");
  }
}

type SessionLiveBlock = Extract<SessionLiveEvent, { readonly live: "Block" }>;
type SessionLiveText = Extract<SessionLiveEvent, { readonly live: "Text" }>;

/** A block once it is said to begin: the block held where it is already that one and whole, and otherwise that block with no text. */
function threadLiveBlockHeard(
  block: ThreadLiveBlock | undefined,
  event: SessionLiveBlock,
): ThreadLiveBlock {
  if (
    block !== undefined &&
    !block.gapped &&
    block.kind === event.kind &&
    block.name === event.name
  )
    return block;
  return {
    index: event.index,
    kind: event.kind,
    ...(event.name === undefined ? {} : { name: event.name }),
    text: "",
    gapped: false,
  };
}

/**
 * A block after more of its text is heard: text the block already holds where
 * it is placed changes nothing, text placed where the held text ends is
 * appended, and any other text placed inside it replaces what followed. Text
 * placed past the end, text for a block that never began, and text for a block
 * that is not text each leave the block gapped.
 */
function threadLiveTextHeard(
  block: ThreadLiveBlock | undefined,
  event: SessionLiveText,
): ThreadLiveBlock {
  if (block === undefined)
    return { index: event.index, kind: "Text", text: "", gapped: true };
  if (block.gapped || block.kind !== "Text" || event.offset > block.text.length)
    return block.gapped && block.text === ""
      ? block
      : { ...block, text: "", gapped: true };
  if (block.text.startsWith(event.text, event.offset)) return block;
  return { ...block, text: block.text.slice(0, event.offset) + event.text };
}

/**
 * What is held once `event` of `turn` is heard, which is `held` itself where
 * the event changes nothing: a sender's posts can arrive out of order, and one
 * heard again after a later one leaves what the later one wrote. An event of
 * another turn or another message begins that message with nothing held of it,
 * and the end of the turn held leaves nothing.
 */
export function threadLiveHeard(
  held: ThreadLiveHeld,
  turn: string,
  event: SessionLiveEvent,
): ThreadLiveHeld {
  if (event.live === "End")
    return held.turn === turn ? threadLiveNothing : held;
  const blocks =
    held.turn === turn && held.message === event.message ? held.blocks : [];
  const before = blocks.find((block) => block.index === event.index);
  const heard =
    event.live === "Block"
      ? threadLiveBlockHeard(before, event)
      : threadLiveTextHeard(before, event);
  if (heard === before) return held;
  return {
    turn,
    message: event.message,
    blocks: [
      ...blocks.filter((block) => block.index !== event.index),
      heard,
    ].sort((left, right) => left.index - right.index),
  };
}
