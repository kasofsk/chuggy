/**
 * A session's live events: what a model is writing of a turn, as the runner
 * holding the session reports it while it happens.
 *
 * A live event is a preview of what the session's store will hold. Nothing
 * stores one, numbers one or sends one again, so a reader that missed any reads
 * the store.
 */

import { z } from "zod";

import {
  isBoundedText,
  jsonTextBytes,
  sessionLiveBlockCharsMax,
  sessionLiveBlocksMax,
  sessionLiveMessageCharsMax,
  sessionLiveTextBytesMax,
  sessionTurnToolNameCharsMax,
} from "./http.ts";

/** What a content block of a model's message is, as a live event names one. */
export const sessionLiveBlockKinds = ["Text", "Thinking", "ToolUse"] as const;
export type SessionLiveBlockKind = (typeof sessionLiveBlockKinds)[number];

/** The model's own identity for the message a block belongs to. */
const sessionLiveMessageSchema = z
  .string()
  .refine((value) => isBoundedText(value, sessionLiveMessageCharsMax));

/** Where a block sits in its message. */
const sessionLiveIndexSchema = z
  .number()
  .int()
  .nonnegative()
  .lt(sessionLiveBlocksMax);

/**
 * Whether `text` is what one live event carries: well formed, holding no NUL,
 * and no heavier than an event's text may be. The weight is the bound; a text
 * within it holds fewer characters than it weighs.
 */
export function isSessionLiveText(text: string): boolean {
  return (
    isBoundedText(text, sessionLiveTextBytesMax) &&
    jsonTextBytes(text) <= sessionLiveTextBytesMax
  );
}

/** A content block began. A tool's block names its tool, and no other block names one. */
export const sessionLiveBlockSchema = z
  .strictObject({
    live: z.literal("Block"),
    message: sessionLiveMessageSchema,
    index: sessionLiveIndexSchema,
    kind: z.enum(sessionLiveBlockKinds),
    name: z
      .string()
      .refine((value) => isBoundedText(value, sessionTurnToolNameCharsMax))
      .optional(),
  })
  .refine((block) => (block.kind === "ToolUse") === (block.name !== undefined));

/** More of a text block, placed by how many UTF-16 units of the block come before it. */
export const sessionLiveTextSchema = z
  .strictObject({
    live: z.literal("Text"),
    message: sessionLiveMessageSchema,
    index: sessionLiveIndexSchema,
    offset: z.number().int().nonnegative().max(sessionLiveBlockCharsMax),
    text: z.string().refine((value) => isSessionLiveText(value)),
  })
  .refine(
    (event) => event.offset + event.text.length <= sessionLiveBlockCharsMax,
  );

/** The turn's last message is whole, and nothing more of the turn will be written. */
export const sessionLiveEndSchema = z.strictObject({
  live: z.literal("End"),
});

export const sessionLiveEventSchema = z.union([
  sessionLiveBlockSchema,
  sessionLiveTextSchema,
  sessionLiveEndSchema,
]);
export type SessionLiveEvent = z.infer<typeof sessionLiveEventSchema>;
