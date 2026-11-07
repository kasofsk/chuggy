/**
 * The brief a ticket carries beside its authoring: what a human called it and
 * asked for, what to read first, the project images it carries, the check
 * lines it adds, the repository and branch the work happens in, and where a
 * finalization lands it.
 *
 * A brief is not authoring. `authoringSchema` is the model's own release event
 * and every value of it decides how the machine runs the ticket; none of these
 * do. So they are written beside that event rather than inside it, and the
 * bounds below are the wire's half of bounds the server states once — a suite
 * holds each of them to the interpreter constant it is taken from, because
 * this module reaches nothing outside itself but the parser.
 */

import { z } from "zod";

import { identitySchema, repositoryIdentityCharsMax } from "./http.ts";
import {
  briefFinalizationProposes,
  briefGitMergeModes,
  briefGitMergePolicies,
  type BriefFinalizationMode,
  type BriefGitMergeMode,
  type BriefGitMergePolicy,
} from "./rosters.ts";

/**
 * The longest line a briefing renders, which bounds each thing a brief states
 * as one line: a link and a check line. It is the bound the wire publishes,
 * the server enforces and the CHECK stores.
 */
export const briefLineCharsMax = 512;

/**
 * The longest title a brief names. A title is one line and takes the line
 * rule, and it is shorter than a line because it is what a table of tickets is
 * read down.
 */
export const briefTitleCharsMax = 256;

/** The longest intent a draft stores, which is the whole of what bounds one. */
export const briefIntentCharsMax = 16_384;

/** The most links one brief carries, a link list being a briefing list like any other. */
export const briefLinksMax = 8;

/**
 * The most project-owned images one brief carries, an image list being a
 * briefing list like any other.
 */
export const briefImagesMax = 8;

/**
 * The most command lines one brief appends to its check stage. A ticket only
 * ever adds to the configuration's list, so this and the configuration's own
 * bound add up to the longest list a stage is ever handed.
 */
export const briefChecksMax = 8;

/** The longest branch one brief names, a branch being a stored reference name. */
export const briefBranchCharsMax = 256;

/** The longest repository one brief names, which is the longest repository identity. */
export const briefRepositoryCharsMax = repositoryIdentityCharsMax;

/** The one scheme a brief's links are read over. */
export const briefLinkScheme = "https://";

/** The one reference namespace a brief's branch may name. */
export const briefBranchPrefix = "refs/heads/";

export const briefLinkSchema = z
  .string()
  .max(briefLineCharsMax)
  .startsWith(briefLinkScheme);

/**
 * One project-owned artifact a brief names, by the identity its upload
 * answered. The wire says nothing about its grammar, an artifact identity
 * being opaque here exactly as a repository identity is.
 */
export const briefImageSchema = identitySchema;

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
 * What this ticket is for, in its author's words: one text bounded as a whole
 * and by nothing a line at a time, because whatever draws it breaks its lines
 * at the width it draws at. The server decides the rest, which is that it says
 * something and that every character of it prints.
 */
export const briefIntentSchema = z
  .string()
  .min(1, { error: "the statement is empty, so say what the ticket is for" })
  .max(briefIntentCharsMax, {
    error: `the statement is longer than the ${String(briefIntentCharsMax)} characters an intent holds`,
  });

/**
 * How and where a finalization lands the work, as one variant per kind: a
 * `GitMerge` names its mode and the policy it is ordered under, a push naming a
 * target only where it is not the branch the work happened on and a merged
 * proposal only where it is not the repository's default; a `PullRequest` names
 * a base the same way and no policy, because a person merges it and nothing
 * orders that; and `None` names nothing, having nothing to advance onto. A
 * target shares the branch's grammar, being the same kind of name.
 */
const briefFinalizationShapes = {
  GitMerge: {
    kind: z.literal("GitMerge"),
    mode: z.enum(briefGitMergeModes),
    target: briefBranchSchema.optional(),
    policy: z.enum(briefGitMergePolicies),
  },
  PullRequest: {
    kind: z.literal("PullRequest"),
    target: briefBranchSchema.optional(),
  },
  None: { kind: z.literal("None") },
} as const;

export const briefFinalizationSchema = z.discriminatedUnion("kind", [
  z.strictObject(briefFinalizationShapes.GitMerge),
  z.strictObject(briefFinalizationShapes.PullRequest),
  z.strictObject(briefFinalizationShapes.None),
]);

export type BriefFinalizationBody = z.output<typeof briefFinalizationSchema>;

/**
 * A finalization as it was written before it named a kind: one variant per
 * mode, its ordering a `landing` beside it on the brief. The wire still reads
 * it, and `briefFinalizationForward` maps it forward.
 */
export const briefFinalizationModeSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("Push"),
    target: briefBranchSchema.optional(),
  }),
  z.strictObject({
    mode: z.literal("PullRequest"),
    target: briefBranchSchema.optional(),
  }),
  z.strictObject({
    mode: z.literal("PullRequestMerge"),
    target: briefBranchSchema.optional(),
  }),
  z.strictObject({ mode: z.literal("None") }),
]);

/** A finalization in its kind's shape, over whatever spelling of a reference its reader holds. */
export type BriefFinalizationOf<Target> =
  | {
      readonly kind: "GitMerge";
      readonly mode: BriefGitMergeMode;
      readonly target?: Target;
      readonly policy: BriefGitMergePolicy;
    }
  | { readonly kind: "PullRequest"; readonly target?: Target }
  | { readonly kind: "None" };

/** What mapping one finalization written by its mode forward came to. */
export type BriefFinalizationForward<Target> =
  | {
      readonly forward: "Mapped";
      readonly finalization?: BriefFinalizationOf<Target>;
    }
  | { readonly forward: "Refused"; readonly reason: string };

/** Why a `Serialized` landing written with no finalization has no representation by kind. */
export const briefSerializedUnfinalizedError =
  "a Serialized landing orders a finalization, so a brief naming one names the finalization it orders";

/** Why a pull request written by its mode and ordered `Serialized` has no representation by kind. */
export const briefPullRequestSerializedError =
  "a pull request is merged by a person and nothing orders it, so it lands under no Serialized landing";

/** Why a landing of nothing written by its mode and ordered `Serialized` has no representation by kind. */
export const briefNoneSerializedError =
  "a landing of nothing has nothing to order, so it lands under no Serialized landing";

/**
 * Maps a finalization written by its mode, and the landing written beside it,
 * forward to its kind: a push or a merged proposal is a `GitMerge` under that
 * landing, `Direct` where it names none, a pull request is a `PullRequest` and
 * landing nothing is `None`. A pull request or a landing of nothing ordered
 * `Serialized` has no representation, and nor has a `Serialized` landing with
 * no finalization to order, so each is refused with the reason.
 */
export function briefFinalizationForward<Target extends string>(
  finalization:
    | {
        readonly mode: BriefFinalizationMode;
        readonly target?: Target | undefined;
      }
    | undefined,
  landing: BriefGitMergePolicy | undefined,
): BriefFinalizationForward<Target> {
  const serialized = landing === "Serialized";
  if (finalization === undefined)
    return serialized
      ? {
          forward: "Refused",
          reason: briefSerializedUnfinalizedError,
        }
      : { forward: "Mapped" };
  const target =
    finalization.target === undefined ? {} : { target: finalization.target };
  switch (finalization.mode) {
    case "Push":
    case "PullRequestMerge":
      return {
        forward: "Mapped",
        finalization: {
          kind: "GitMerge",
          mode: finalization.mode,
          ...target,
          policy: landing ?? "Direct",
        },
      };
    case "PullRequest":
      return serialized
        ? {
            forward: "Refused",
            reason: briefPullRequestSerializedError,
          }
        : {
            forward: "Mapped",
            finalization: { kind: "PullRequest", ...target },
          };
    case "None":
      return serialized
        ? {
            forward: "Refused",
            reason: briefNoneSerializedError,
          }
        : { forward: "Mapped", finalization: { kind: "None" } };
  }
}

/**
 * Whether a finalization opens a change proposal: a `PullRequest` does, and a
 * `GitMerge` that merges one, and so does one written by a mode that proposes.
 */
export function briefFinalizationOpensProposal(
  finalization:
    | { readonly kind?: string | undefined; readonly mode?: string | undefined }
    | undefined,
): boolean {
  return (
    finalization?.kind === "PullRequest" ||
    briefFinalizationProposes(finalization?.mode)
  );
}

/**
 * Whether one brief's branch and its finalization stand together. A proposal is
 * opened from the branch the work happened on, so a brief that proposes names a
 * branch of its own and a different base where it names a base at all, a brief
 * that lands any other way pairs with either, and a base left unnamed is the
 * repository's default branch — which only the remote knows, so the finalizer
 * is what holds a branch that is itself that default.
 */
export function briefLandingIsWhole(value: {
  readonly branch?: string | undefined;
  readonly finalization?:
    | {
        readonly kind?: string | undefined;
        readonly mode?: string | undefined;
        readonly target?: string | undefined;
      }
    | undefined;
}): boolean {
  const finalization = value.finalization;
  if (
    finalization === undefined ||
    !briefFinalizationOpensProposal(finalization)
  )
    return true;
  if (value.branch === undefined) return false;
  return (
    finalization.target === undefined || value.branch !== finalization.target
  );
}

/** What `briefLandingIsWhole` refuses, said once for every door that refuses it. */
const briefLandingWholeError =
  "a pull request is opened from a branch of its own, into another where it names one";

/** Every field a brief states but how it lands. */
const briefFields = {
  title: briefTitleSchema.optional(),
  intent: briefIntentSchema,
  links: z.array(briefLinkSchema).max(briefLinksMax),
  checks: z.array(briefCheckSchema).max(briefChecksMax).optional(),
  images: z.array(briefImageSchema).max(briefImagesMax).optional(),
  repository: briefRepositorySchema.optional(),
  branch: briefBranchSchema.optional(),
} as const;

/**
 * Why a written brief's finalization and the landing beside it have no kind to
 * map forward to, where they have none; one naming its kind maps as it is.
 */
function briefWrittenRefusal(value: {
  readonly finalization?:
    | z.output<typeof briefFinalizationSchema>
    | z.output<typeof briefFinalizationModeSchema>
    | undefined;
  readonly landing?: BriefGitMergePolicy | undefined;
}): string | undefined {
  const { finalization, landing } = value;
  if (finalization !== undefined && "kind" in finalization) return undefined;
  const forward = briefFinalizationForward(finalization, landing);
  return forward.forward === "Refused" ? forward.reason : undefined;
}

/** Whether a written brief names a `landing` beside a finalization naming its kind, whose policy is its own. */
function briefLandingBesideKind(value: {
  readonly finalization?: object | undefined;
  readonly landing?: string | undefined;
}): boolean {
  return (
    value.landing !== undefined &&
    value.finalization !== undefined &&
    "kind" in value.finalization
  );
}

/** Why a written brief's `landing` beside a finalization naming its kind is refused. */
export const briefLandingBesideKindError =
  "a finalization naming its kind names its own policy, so no landing is named beside it";

/**
 * The brief as a write states it, its finalization omitted where the work lands
 * where it happened and its checks where a ticket appends none. The intent
 * cannot be empty, because a ticket nobody stated a purpose for is the one thing
 * an agent cannot be briefed on, and the pairing above is refused here so that a
 * brief the finalizer could not open a proposal for, or whose finalization
 * written by its mode has no kind to map forward to, is never a brief at all.
 */
export const briefSchema = z
  .strictObject({
    ...briefFields,
    finalization: z
      .union([briefFinalizationSchema, briefFinalizationModeSchema])
      .optional(),
    landing: z.enum(briefGitMergePolicies).optional(),
  })
  .refine(briefLandingIsWhole, { error: briefLandingWholeError })
  .refine((value) => !briefLandingBesideKind(value), {
    error: briefLandingBesideKindError,
  })
  .refine(
    (value) => briefWrittenRefusal(value) !== briefSerializedUnfinalizedError,
    { error: briefSerializedUnfinalizedError },
  )
  .refine(
    (value) => briefWrittenRefusal(value) !== briefPullRequestSerializedError,
    { error: briefPullRequestSerializedError },
  )
  .refine((value) => briefWrittenRefusal(value) !== briefNoneSerializedError, {
    error: briefNoneSerializedError,
  });

export type TicketBriefBody = z.infer<typeof briefSchema>;

/** The same finalization read back, each variant dropping a field the reader does not know. */
export const briefFinalizationResponseSchema = z.discriminatedUnion("kind", [
  z.object(briefFinalizationShapes.GitMerge),
  z.object(briefFinalizationShapes.PullRequest),
  z.object(briefFinalizationShapes.None),
]);

/**
 * The same brief read back, dropping a field the reader does not know at either
 * depth and carrying the pairing forward, a brief being one thing in both
 * directions.
 */
export const briefResponseSchema = z
  .object({
    ...briefFields,
    finalization: briefFinalizationResponseSchema.optional(),
  })
  .refine(briefLandingIsWhole, { error: briefLandingWholeError });
