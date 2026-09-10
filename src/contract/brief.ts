/**
 * The brief a ticket carries beside its authoring: what a human called it and
 * asked for, what to read first, the check lines it adds, the repository and
 * branch the work happens in, and where a finalization lands it.
 *
 * A brief is not authoring. `authoringSchema` is the model's own release event
 * and every value of it decides how the machine runs the ticket; none of these
 * do. So they are written beside that event rather than inside it, and the
 * bounds below are the wire's half of bounds the server states once — a suite
 * holds each of them to the interpreter constant it is taken from, because
 * this module reaches nothing outside itself but the parser.
 */

import { z } from "zod";

import { textCodePointsCount } from "./http.ts";

/**
 * The longest line a briefing renders, which is the whole of what a brief is
 * measured in: an intent renders as lines and a link renders as one, so this
 * is the bound the wire publishes, the server enforces and the CHECK stores.
 */
export const briefLineCharsMax = 512;

/**
 * The longest title a brief names. A title is one line and takes the line
 * rule, and it is shorter than a line because it is what a table of tickets is
 * read down.
 */
export const briefTitleCharsMax = 256;

/** The longest intent a draft stores, an intent being a paragraph and not a line. */
export const briefIntentCharsMax = 16_384;

/** The most lines an intent renders as, which is what the two bounds above divide out to. */
export const briefIntentLinesMax = briefIntentCharsMax / briefLineCharsMax;

/** The most links one brief carries, a link list being a briefing list like any other. */
export const briefLinksMax = 8;

/**
 * The most command lines one brief appends to its check stage. A ticket only
 * ever adds to the configuration's list, so this and the configuration's own
 * bound add up to the longest list a stage is ever handed.
 */
export const briefChecksMax = 8;

/** The longest branch one brief names, a branch being a stored reference name. */
export const briefBranchCharsMax = 256;

/**
 * The longest repository one brief names, a repository being the same opaque
 * identity the binding stores and the finalizer lands in.
 */
export const briefRepositoryCharsMax = 256;

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
 * The repository the work happens in, optional because a draft may be filed
 * before it is known; the server refuses one the project does not bind, and
 * refuses a release that names none. The wire says nothing about its grammar
 * because a repository identity is opaque here, exactly as it is everywhere
 * else.
 */
export const briefRepositorySchema = z
  .string()
  .min(1)
  .max(briefRepositoryCharsMax);

/**
 * One command line a ticket appends to its check stage. It renders as one
 * briefing line and runs as one shell command, so the line bound is the whole
 * of what the wire says about it and the server decides the rest.
 */
export const briefCheckSchema = z.string().min(1).max(briefLineCharsMax);

/**
 * What a person calls this ticket. It renders as one line under the shorter
 * title bound, and the server decides the rest; it is optional because a brief
 * written before tickets had titles is still a brief.
 */
export const briefTitleSchema = z.string().min(1).max(briefTitleCharsMax);

/**
 * The lines an intent renders as, over the newline a browser sends as well as
 * the one this tree bounds. A blank line prints nothing, so it is neither
 * bounded nor counted.
 */
function briefIntentWireLines(intent: string): readonly string[] {
  return intent
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

/**
 * What this ticket is for, stored as the lines a briefing prints. Each of them
 * takes the line rule an authored line takes, so a paragraph written as one long
 * line is refused here rather than branded and thrown on.
 */
export const briefIntentSchema = z
  .string()
  .min(1)
  .max(briefIntentCharsMax)
  .refine(
    (intent) =>
      briefIntentWireLines(intent).every(
        (line) => textCodePointsCount(line) <= briefLineCharsMax,
      ),
    {
      error: `an intent line is longer than the ${String(briefLineCharsMax)} characters a briefing line renders: break the sentence across lines rather than shorten it`,
    },
  )
  .refine(
    (intent) => briefIntentWireLines(intent).length <= briefIntentLinesMax,
    {
      error: `an intent renders as more than the ${String(briefIntentLinesMax)} lines a briefing prints`,
    },
  );

/**
 * How and where a finalization lands the work, as one variant per mode: a push
 * names the reference it lands on only where that is not the branch the work
 * happened on, and a pull request must name one, because a proposal opened into
 * nothing is not a proposal. The target shares the branch's grammar, being the
 * same kind of name.
 */
const briefFinalizationShapes = {
  Push: { mode: z.literal("Push"), target: briefBranchSchema.optional() },
  PullRequest: {
    mode: z.literal("PullRequest"),
    target: briefBranchSchema,
  },
} as const;

export const briefFinalizationSchema = z.discriminatedUnion("mode", [
  z.strictObject(briefFinalizationShapes.Push),
  z.strictObject(briefFinalizationShapes.PullRequest),
]);

/**
 * Whether one brief's branch and its finalization stand together. A proposal is
 * opened from the branch the work happened on into the reference it names, so a
 * brief that proposes names a branch of its own and names a different one; a
 * brief that lands any other way pairs with either.
 */
export function briefLandingIsWhole(value: {
  readonly branch?: string | undefined;
  readonly finalization?:
    { readonly mode: string; readonly target?: string | undefined } | undefined;
}): boolean {
  const finalization = value.finalization;
  if (finalization?.mode !== "PullRequest") return true;
  return value.branch !== undefined && value.branch !== finalization.target;
}

/**
 * The brief as a write states it, its finalization omitted where the work lands
 * where it happened and its checks where a ticket appends none. The intent
 * cannot be empty, because a ticket nobody stated a purpose for is the one thing
 * an agent cannot be briefed on, and the pairing above is refused here so that a
 * brief the finalizer could not open a proposal for is never a brief at all.
 */
export const briefSchema = z
  .strictObject({
    title: briefTitleSchema.optional(),
    intent: briefIntentSchema,
    links: z.array(briefLinkSchema).max(briefLinksMax),
    checks: z.array(briefCheckSchema).max(briefChecksMax).optional(),
    repository: briefRepositorySchema.optional(),
    branch: briefBranchSchema.optional(),
    finalization: briefFinalizationSchema.optional(),
  })
  .refine(briefLandingIsWhole, {
    error: "a pull request is opened from a branch of its own into another",
  });

export type TicketBriefBody = z.infer<typeof briefSchema>;

/** The same finalization read back, each variant dropping a field the reader does not know. */
export const briefFinalizationResponseSchema = z.discriminatedUnion("mode", [
  z.object(briefFinalizationShapes.Push),
  z.object(briefFinalizationShapes.PullRequest),
]);

/**
 * The same brief read back, dropping a field the reader does not know at either
 * depth and carrying the pairing forward, a brief being one thing in both
 * directions.
 */
export const briefResponseSchema = briefSchema.strip().safeExtend({
  finalization: briefFinalizationResponseSchema.optional(),
});
