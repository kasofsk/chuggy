/**
 * The brief a ticket carries beside its authoring: what a human asked for,
 * what to read first, the branch the work happens on, and where a finalization
 * lands it.
 *
 * A brief is not authoring. `authoringSchema` is the model's own release event
 * and every value of it decides how the machine runs the ticket; none of these
 * do. So they are written beside that event rather than inside it, and the
 * bounds below are the wire's half of bounds the server states once — a suite
 * holds each of them to the interpreter constant it is taken from, because
 * this module reaches nothing outside itself but the parser.
 */

import { z } from "zod";

/**
 * The longest line a briefing renders, which is the whole of what a brief is
 * measured in: an intent renders as lines and a link renders as one, so this
 * is the bound the wire publishes, the server enforces and the CHECK stores.
 */
export const briefLineCharsMax = 512;

/** The longest intent a draft stores, an intent being a paragraph and not a line. */
export const briefIntentCharsMax = 16_384;

/** The most lines an intent renders as, which is what the two bounds above divide out to. */
export const briefIntentLinesMax = briefIntentCharsMax / briefLineCharsMax;

/** The most links one brief carries, a link list being a briefing list like any other. */
export const briefLinksMax = 8;

/** The longest branch one brief names, a branch being a stored reference name. */
export const briefBranchCharsMax = 256;

/** The one scheme a brief's links are read over. */
export const briefLinkScheme = "https://";

/** The one reference namespace a brief's branch may name. */
export const briefBranchPrefix = "refs/heads/";

export const briefLinkSchema = z
  .string()
  .max(briefLineCharsMax)
  .startsWith(briefLinkScheme);

export const briefBranchSchema = z
  .string()
  .max(briefBranchCharsMax)
  .startsWith(briefBranchPrefix);

/**
 * How and where a finalization lands the work, as one variant per mode: a push
 * names the reference it lands on only where that is not the branch the work
 * happened on, and a pull request must name one, because a proposal opened into
 * nothing is not a proposal. The target shares the branch's grammar, being the
 * same kind of name.
 */
export const briefFinalizationSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("Push"),
    target: briefBranchSchema.optional(),
  }),
  z.strictObject({
    mode: z.literal("PullRequest"),
    target: briefBranchSchema,
  }),
]);

/**
 * The brief as a write states it, its finalization omitted where the work
 * lands where it happened. The intent cannot be empty, because a ticket nobody
 * stated a purpose for is the one thing an agent cannot be briefed on.
 */
export const briefSchema = z.strictObject({
  intent: z.string().min(1).max(briefIntentCharsMax),
  links: z.array(briefLinkSchema).max(briefLinksMax),
  branch: briefBranchSchema.optional(),
  finalization: briefFinalizationSchema.optional(),
});

export type TicketBriefBody = z.infer<typeof briefSchema>;

/** The same brief read back, dropping a field the reader does not know. */
export const briefResponseSchema = briefSchema.strip();
