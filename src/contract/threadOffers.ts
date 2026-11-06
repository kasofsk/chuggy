/**
 * What a thread offers its member and what the member answers: the arguments
 * `offer_release` and `offer_revoke` are called with, and the reply a member's
 * confirmation or decline of one arrives as.
 *
 * IT IS THE CONTRACT BECAUSE MORE THAN ONE SIDE READS IT. The image validates
 * an offer's arguments as the agent calls the tool, and the console reads the
 * same arguments off the transcript to draw the offer as a card; the console
 * posts the reply, the server writes it into the thread's mailbox as an
 * `OfferReply` turn, and the console reads that turn back to draw the card
 * settled.
 *
 * AN OFFER NAMES THE VERSION IT WAS MADE AT. A draft's authoring version or a
 * ticket's revision moving past it is the thing offered no longer being what
 * the agent described, so what the member confirms is exactly what they read.
 */

import { z } from "zod";

import { countSchema, ticketNumberSchema } from "./http.ts";

/** What `offer_release` names: one draft, by its ticket, at the exact authoring version a confirmation releases. */
export const threadOfferReleaseSchema = z.strictObject({
  ticket: ticketNumberSchema,
  authoringVersion: countSchema,
});
export type ThreadOfferRelease = z.infer<typeof threadOfferReleaseSchema>;

/** What `offer_revoke` names: one ticket, at the revision a confirmation revokes it at. */
export const threadOfferRevokeSchema = z.strictObject({
  ticket: ticketNumberSchema,
  revision: ticketNumberSchema,
});
export type ThreadOfferRevoke = z.infer<typeof threadOfferRevokeSchema>;

/** The identity of the call a reply answers, as the agent runtime minted it,
 * bounded short enough that a turn identity derived from it still fits one. */
export const threadOfferCallSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/u);

export const threadOfferDecisions = ["Confirmed", "Declined"] as const;
export type ThreadOfferDecision = (typeof threadOfferDecisions)[number];

/**
 * What the member's own operation came to once they confirmed: settled as
 * done, settled as refused, or given up on before the console saw it settle.
 */
export const threadOfferOutcomes = [
  "Succeeded",
  "Refused",
  "Unsettled",
] as const;
export type ThreadOfferOutcome = (typeof threadOfferOutcomes)[number];

/** The code a refused operation was refused with, in the API's own spelling. */
const threadOfferRefusalSchema = z.string().regex(/^[A-Za-z]{1,64}$/u);

/**
 * One reply as the member's console posts it: the call it answers, and a
 * decline, or a confirmation and what the operation it ran came to, with the
 * refusal's code where it was refused.
 */
export const threadOfferReplySchema = z.discriminatedUnion("decision", [
  z.strictObject({
    call: threadOfferCallSchema,
    decision: z.literal("Declined"),
  }),
  z.strictObject({
    call: threadOfferCallSchema,
    decision: z.literal("Confirmed"),
    outcome: z.enum(threadOfferOutcomes),
    refusal: threadOfferRefusalSchema.optional(),
  }),
]);
export type ThreadOfferReply = z.infer<typeof threadOfferReplySchema>;

/** The version every reply document this release writes carries. */
export const threadOfferReplyVersion = 1;

const threadOfferReplyDocumentSchema = z.strictObject({
  version: z.literal(threadOfferReplyVersion),
  offerReply: threadOfferReplySchema,
});

/** One reply as an `OfferReply` turn's input holds it. */
export function threadOfferReplyText(reply: ThreadOfferReply): string {
  return JSON.stringify({
    version: threadOfferReplyVersion,
    offerReply: reply,
  });
}

/** One `OfferReply` turn's input read back, or nothing where it is not a reply this release writes. */
export function threadOfferReplyRead(
  text: string,
): ThreadOfferReply | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const read = threadOfferReplyDocumentSchema.safeParse(parsed);
  return read.success ? read.data.offerReply : undefined;
}
