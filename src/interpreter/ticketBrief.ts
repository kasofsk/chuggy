/**
 * The brief one ticket carries: the intent a human stated, the links they
 * pointed at, the branch the work happens on, and where a finalization lands
 * it.
 *
 * IT IS NOT AUTHORING. Authoring is the model's release event, and every value
 * of it decides how the machine runs the ticket. None of these do: they are
 * read by the agent, by the observation that names a target and by the
 * finalizer that lands the work, and no value of them is priced, metered or
 * decided on. The release reads one of them once, to refuse the pairing a
 * configuration that hands off and a finalization that proposes make, which is
 * a refusal to release and not a way for a brief to run the ticket. So they
 * live beside the draft rather than inside the event, and nothing here reaches
 * the domain.
 *
 * AN INTENT IS STORED AS IT RENDERS. Every value that gets this far has
 * already been split into the lines a briefing would print and refused unless
 * each of them passes the same line rule an authored line does, so a stored
 * brief cannot be one the scheduler will later be unable to render.
 *
 * A BRANCH IS A REFERENCE NAME AND SHARES ITS GRAMMAR. `handoffRef` is the one
 * statement of what a reference name is in this tree, and a second spelling of
 * it here would be a second answer to the same question. A finalization's
 * target is a reference name too and takes the same grammar.
 *
 * WHERE THE WORK LANDS IS SAID APART FROM WHERE IT STARTS. `branch` is the
 * branch the work happens on and the ref its executions are observed at; a
 * finalization's `target` is the reference the finalizer promotes onto. A
 * brief naming no finalization means `briefFinalizationDefault` and lands on
 * `branch`, so a ticket that named only a branch works and lands there.
 *
 * A MODE IS A VARIANT AND NOT A FLAG BESIDE AN OPTIONAL FIELD. A push may land
 * where the work happened and so may leave its target unsaid; a pull request
 * has to be opened into something, so the reference is part of what that mode
 * is rather than a field every reader re-asks about.
 *
 * A PULL REQUEST NAMES BOTH SIDES AND THEY ARE NOT THE SAME SIDE. The head is
 * the branch the work happened on and the base is the reference the mode names,
 * so a brief that proposes and names no branch has no head to propose from, and
 * one naming the target as its branch proposes a change into itself. Neither is
 * a brief: the pairing is refused where the whole is branded, on the wire by
 * the same statement of it, and by the brief's own relation.
 *
 * A RELEASED TICKET'S BRIEF NO LONGER MOVES, which is what lets a retry read it
 * rather than pin it: a revision is refused for a draft that is not one, so the
 * row a ticket reaches is frozen the moment the ticket exists. That refusal is
 * the server's, so the case for it is `test/postgres/authoring.test.ts`'s.
 */

import {
  briefBranchCharsMax,
  briefIntentCharsMax,
  briefIntentLinesMax,
  briefLandingIsWhole,
  briefLinkScheme,
  briefLinksMax,
} from "../contract/brief.ts";
import {
  briefFinalizationModes,
  type BriefFinalizationMode,
} from "../contract/rosters.ts";
import type { GitRefName } from "./finalizer.ts";
import { handoffRef } from "./handoffConfiguration.ts";
import type { Partition } from "./projectStore.ts";
import { taskConfigurationLineFault } from "./taskConfiguration.ts";

declare const briefIntentBrand: unique symbol;
declare const briefLinkUrlBrand: unique symbol;

export type BriefIntent = string & { readonly [briefIntentBrand]: true };
export type BriefLinkUrl = string & { readonly [briefLinkUrlBrand]: true };

/** Landing by advancing the reference itself, which is where a brief naming none lands. */
export interface BriefPushFinalization {
  readonly mode: Extract<BriefFinalizationMode, "Push">;
  readonly target?: GitRefName;
}

/** Landing by opening a change proposal into the reference, which one must always name. */
export interface BriefPullRequestFinalization {
  readonly mode: Extract<BriefFinalizationMode, "PullRequest">;
  readonly target: GitRefName;
}

/** How and where one ticket's work is landed, which is the finalizer's half of a brief. */
export type BriefFinalization =
  BriefPushFinalization | BriefPullRequestFinalization;

/** What a brief naming no finalization says, and what a row saying it reads back as none. */
export const briefFinalizationDefault: BriefFinalization = { mode: "Push" };

/** One ticket's brief, as everything but the wire holds it. */
export interface DraftBrief {
  readonly intent: BriefIntent;
  readonly links: readonly BriefLinkUrl[];
  readonly branch?: GitRefName;
  readonly finalization?: BriefFinalization;
}

/** The lines one intent renders as, which is the form it is bounded and stored in. */
export function briefIntentLines(intent: BriefIntent): readonly string[] {
  return intent.split("\n").filter((line) => line.trim().length > 0);
}

/**
 * A ticket's title: the first line of its own intent, already printable
 * because every stored line renders as one. `asBriefIntent` refuses an intent
 * with no line, so a branded one always has a first.
 */
export function briefTitle(intent: BriefIntent): string {
  const [first] = briefIntentLines(intent);
  if (first === undefined)
    throw new Error("ticket title: a stored intent renders no line");
  return first;
}

/** Normalizes line endings so a browser's newline is the one this tree bounds. */
function briefIntentNormalized(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

/**
 * Brands an intent, refusing anything a briefing could not print: an empty
 * statement, one longer than a draft stores, or one carrying a line no
 * authored line could carry.
 */
export function asBriefIntent(value: string): BriefIntent {
  const normalized = briefIntentNormalized(value);
  if (normalized.length === 0 || normalized.length > briefIntentCharsMax)
    throw new RangeError("ticket intent: the statement is empty or too long");
  const lines = briefIntentLines(normalized as BriefIntent);
  if (lines.length === 0 || lines.length > briefIntentLinesMax)
    throw new RangeError("ticket intent: the statement is empty or too long");
  for (const line of lines) {
    if (taskConfigurationLineFault(line) !== undefined)
      throw new RangeError("ticket intent: a line does not render");
  }
  return normalized as BriefIntent;
}

/**
 * Brands a link, refusing anything this tree would not fetch or could not
 * print. A link renders as one briefing line, so the line rule is the whole of
 * what bounds it and there is no second bound here to disagree with the wire.
 */
export function asBriefLinkUrl(value: string): BriefLinkUrl {
  if (
    !value.startsWith(briefLinkScheme) ||
    taskConfigurationLineFault(value) !== undefined
  )
    throw new RangeError("ticket link: the URL is not a printable https URL");
  return value as BriefLinkUrl;
}

/** Brands a branch through the one reference-name grammar this tree states. */
export function asBriefBranch(value: string): GitRefName {
  const ref =
    value.length > briefBranchCharsMax ? undefined : handoffRef(value);
  if (ref === undefined)
    throw new RangeError("ticket branch: the value is not a reference name");
  return ref;
}

/**
 * Brands a finalization, its target through the grammar a branch takes. The
 * variant a mode selects is what says whether that target is optional, so a
 * mode added to the roster and to no variant is refused by the compiler here.
 */
export function asBriefFinalization(value: {
  readonly mode: string;
  readonly target?: string;
}): BriefFinalization {
  const mode = briefFinalizationModes.find((known) => known === value.mode);
  if (mode === undefined)
    throw new RangeError(
      "ticket finalization: the mode is not one this tree lands under",
    );
  const target =
    value.target === undefined ? undefined : asBriefBranch(value.target);
  if (mode === "PullRequest") {
    if (target === undefined)
      throw new RangeError(
        "ticket finalization: a pull request names no reference to open it into",
      );
    return { mode, target };
  }
  return { mode, ...(target === undefined ? {} : { target }) };
}

/**
 * Brands one whole brief, which is the only way an unchecked one becomes a
 * stored one. The pairing of the branch and the finalization is the wire's own
 * rule read here, so a brief reaching this tree by any other door is refused by
 * the same statement of it.
 */
export function asDraftBrief(value: {
  readonly intent: string;
  readonly links: readonly string[];
  readonly branch?: string;
  readonly finalization?: { readonly mode: string; readonly target?: string };
}): DraftBrief {
  if (value.links.length > briefLinksMax)
    throw new RangeError("ticket brief: more links than one brief carries");
  const brief: DraftBrief = {
    intent: asBriefIntent(value.intent),
    links: value.links.map(asBriefLinkUrl),
    ...(value.branch === undefined
      ? {}
      : { branch: asBriefBranch(value.branch) }),
    ...(value.finalization === undefined
      ? {}
      : { finalization: asBriefFinalization(value.finalization) }),
  };
  if (!briefLandingIsWhole(brief))
    throw new RangeError(
      "ticket brief: a pull request opens from a branch of its own into another",
    );
  return brief;
}

/** The brief a ticket carries, behind a typed port, absent for a ticket authored without one. */
export interface TicketBriefPort {
  brief(partition: Partition, ticket: number): Promise<DraftBrief | undefined>;
}
