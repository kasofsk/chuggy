/**
 * The lead's decisions held for approval, as the inbox draws and answers them.
 *
 * A DECISION IS ANSWERED WHOLE, so a decision naming two tickets puts the same
 * question on both rows, and either row's answer is the other's too.
 *
 * NO FRAME NAMES A HELD DECISION, so the inbox is polled while anything draws
 * it and read again as soon as this tab answers.
 */

import { selectorReviewFeedbackCharsMax } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  SelectorProposalResponse,
  SelectorProposalReviewResponse,
} from "../../../../src/contract/responses.ts";
import {
  selectorProposalNotHeldCode,
  type SelectorReviewOutcome,
} from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";

/** How often the inbox is read again for its held decisions while it or its badge is drawn. */
export const inboxProposalsPolledMs = 15_000;

/** What one review came to: answered, refused as no longer held, or failed. */
export type InboxProposalStep =
  | { readonly step: "Answered"; readonly outcome: SelectorReviewOutcome }
  | { readonly step: "Stale" }
  | { readonly step: "Failed"; readonly why: string };

/** One review this tab sent, and the tickets its decision named. */
export interface InboxProposalAnswer {
  readonly proposal: SelectorProposalResponse;
  readonly step: InboxProposalStep;
}

/** A refusal is said as the code the server named it by, or as the outcome where it named none. */
export function inboxProposalAnswered(
  result: ApiResult<SelectorProposalReviewResponse>,
): InboxProposalStep {
  if (result.outcome === "Ok")
    return { step: "Answered", outcome: result.value.outcome };
  if (
    result.outcome === "Conflict" &&
    result.code === selectorProposalNotHeldCode
  )
    return { step: "Stale" };
  return {
    step: "Failed",
    why: "code" in result ? result.code : result.outcome,
  };
}

/** The one word a review's standing is drawn as. */
export function inboxProposalStepWord(step: InboxProposalStep): string {
  switch (step.step) {
    case "Answered":
      return step.outcome;
    case "Stale":
      return "Stale";
    case "Failed":
      return "Failed";
  }
}

/** The line one review leaves behind once its row may have left: the tickets
 * its decision named, then the word, then why where it failed. */
export function inboxProposalSentence(answer: InboxProposalAnswer): string {
  const why = answer.step.step === "Failed" ? ` · ${answer.step.why}` : "";
  return `Proposal ${answer.proposal.tickets.join(", ")} · ${inboxProposalStepWord(answer.step)}${why}`;
}

/** A note is held to what the wire takes as it is typed, so a review is never refused for its length. */
export function inboxProposalNoteClamped(typed: string): string {
  return typed.slice(0, selectorReviewFeedbackCharsMax);
}

/** A note of nothing but space is sent as no note at all, which the wire requires. */
export function inboxProposalReview(
  outcome: SelectorReviewOutcome,
  note: string,
): { readonly outcome: SelectorReviewOutcome; readonly feedback?: string } {
  const feedback = note.trim();
  return feedback === "" ? { outcome } : { outcome, feedback };
}

/** The tickets a decision names besides the row's own, which its answer moves too. */
export function inboxProposalOthers(
  proposal: SelectorProposalResponse,
  ticket: number,
): readonly number[] {
  return proposal.tickets.filter((named) => named !== ticket);
}

/**
 * What a project's drawn inbox has heard of its reviews: how many inboxes of it
 * are drawn, and the answer the server gave last while one was. An answer is
 * heard as the server gives it, so an inbox drawn after the press hears it too,
 * and one given while none was drawn is heard by nobody.
 */
export interface InboxProposalHeard {
  readonly drawn: number;
  readonly last: InboxProposalAnswer | undefined;
}

/** A record per project, kept only while an inbox of it is drawn, so there are
 * never more of them than inboxes drawn. */
export type InboxProposalHeards = Readonly<Record<string, InboxProposalHeard>>;

export const inboxProposalHeardNone: InboxProposalHeard = {
  drawn: 0,
  last: undefined,
};

/** What a project's record is filed under, its two names encoded rather than
 * joined so that no two projects share one. */
function inboxProposalHeardName(partition: PartitionIdentity): string {
  return JSON.stringify([partition.tenant, partition.project]);
}

export function inboxProposalHeardOf(
  heards: InboxProposalHeards,
  partition: PartitionIdentity,
): InboxProposalHeard {
  return heards[inboxProposalHeardName(partition)] ?? inboxProposalHeardNone;
}

/** An inbox of the project drawn, which starts hearing its answers. */
export function inboxProposalDrawn(
  heards: InboxProposalHeards,
  partition: PartitionIdentity,
): InboxProposalHeards {
  const held = inboxProposalHeardOf(heards, partition);
  return {
    ...heards,
    [inboxProposalHeardName(partition)]: { ...held, drawn: held.drawn + 1 },
  };
}

/** An inbox of the project gone, and the answer it said with the last of them,
 * which is when the line dies. */
export function inboxProposalLeft(
  heards: InboxProposalHeards,
  partition: PartitionIdentity,
): InboxProposalHeards {
  const name = inboxProposalHeardName(partition);
  const held = inboxProposalHeardOf(heards, partition);
  const written: Record<string, InboxProposalHeard> = { ...heards };
  if (held.drawn > 1) written[name] = { ...held, drawn: held.drawn - 1 };
  else delete written[name];
  return written;
}

/** An answer the server gave, kept where an inbox of its project is drawn to
 * say it and dropped where none is. */
export function inboxProposalHeardWith(
  heards: InboxProposalHeards,
  partition: PartitionIdentity,
  answer: InboxProposalAnswer,
): InboxProposalHeards {
  const held = inboxProposalHeardOf(heards, partition);
  if (held.drawn === 0) return heards;
  return {
    ...heards,
    [inboxProposalHeardName(partition)]: { ...held, last: answer },
  };
}
