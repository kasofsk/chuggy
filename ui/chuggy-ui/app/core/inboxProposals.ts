/**
 * The lead's decisions held for approval, as the inbox draws and answers them.
 *
 * A DECISION IS ANSWERED WHOLE, so a decision naming two tickets puts the same
 * question on both rows, and either row's answer is the other's too.
 *
 * NO FRAME NAMES A HELD DECISION, so the read is polled while anything draws
 * it and read again as soon as this tab answers.
 */

import { selectorReviewFeedbackCharsMax } from "../../../../src/contract/http.ts";
import type {
  SelectorProposalResponse,
  SelectorProposalReviewResponse,
  SelectorProposalsResponse,
} from "../../../../src/contract/responses.ts";
import {
  selectorProposalNotHeldCode,
  type SelectorReviewOutcome,
} from "../../../../src/contract/rosters.ts";
import type { ApiResult } from "./apiRequest.ts";
import type { PanelState } from "./freshness.ts";

/** How often the held decisions are read again while the inbox or its badge is drawn. */
export const inboxProposalsPolledMs = 15_000;

/**
 * What the inbox holds of the read: its answer, nothing where the reader may
 * not dispatch, and unread otherwise. Absence is the server declining to show
 * the reader a question they cannot answer, which is no proposal for them.
 */
export function inboxProposalsHeld(
  state: PanelState<SelectorProposalsResponse>,
): SelectorProposalsResponse | undefined {
  if (state.state === "Ready") return state.value;
  return state.state === "Absent" ? { proposals: [], more: false } : undefined;
}

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
