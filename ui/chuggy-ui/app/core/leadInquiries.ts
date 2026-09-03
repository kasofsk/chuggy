/**
 * What the inquiries panel draws, derived: the pair of identities a question is
 * asked under, why a question cannot be asked as typed, and what the door
 * answered.
 *
 * THE ORDER IS THE ROUTE'S AND THIS MODULE DOES NOT SORT. The listing answers
 * newest first and at most `inquiriesAnsweredMax` of them, so a client sort
 * would reorder a bounded page it did not choose the members of — and the
 * ordinal it would sort on counts turns of one session rather than inquiries of
 * one lead, so sorting on it would put every inquiry at ordinal 1 in whatever
 * order the sort happened to be stable in.
 *
 * THE QUESTION IS BOUNDED HERE IN THE MEASURE THE WIRE BOUNDS IT IN. The
 * schema's `max` counts the string's own units, so this counts the same ones:
 * a console refusing what the route accepts, or accepting what it refuses,
 * would be a bound that means something different on each side of the wire.
 *
 * A QUESTION PAST THE BOUND IS SHOWN AND REFUSED, NEVER TRUNCATED. What a
 * reader pasted is theirs, and a box that silently dropped the end of it would
 * send a question they did not ask.
 */

import type { z } from "zod";

import { inquiryQuestionCharsMax } from "../../../../src/contract/http.ts";
import type { leadInquirySchema } from "../../../../src/contract/requests.ts";
import type { LeadInquiryAccepted } from "../../../../src/contract/responses.ts";
import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";

/** How much entropy an inquiry is named with, which is an operation id's own. */
export const inquiryIdentityBytesCount = 16;

/**
 * The session kind an inquiry's change frames carry, which the trigger reads
 * from the session row. It is spelt here rather than imported because the
 * roster lives in `src/interpreter/` and a console may reach only
 * `src/contract/`; publishing the roster where both sides read it is the
 * follow-up.
 */
export const inquirySessionKind = "Inquiry";

/** What a question typed into the box is asked as, which is what it is bounded
 * as: the ends a reader did not mean to type are not part of it. */
export function inquiryQuestion(typed: string): string {
  return typed.trim();
}

/** Why a question cannot be asked, in the one word the box refuses it with. */
export function inquiryQuestionFault(question: string): string | undefined {
  if (question === "") return "Empty";
  if (question.length > inquiryQuestionCharsMax) return "Too long";
  return undefined;
}

/**
 * The fork and its one turn, named before either exists. Both are drawn from
 * one draw because they name one question: the door is idempotent on the pair,
 * so a retry that sent a fresh turn beside a held session would be asking the
 * definer to reconcile two identities where it was promised one.
 */
export function inquiryAsking(
  question: string,
  drawn: string,
): z.infer<typeof leadInquirySchema> {
  return { session: `inq-${drawn}`, turn: `inq-turn-${drawn}`, question };
}

/**
 * The words the door's own refusals are drawn as. A code this console does not
 * know is drawn as a refusal rather than as nothing, because a box that went
 * quiet on an unrecognised code would look exactly like one that had asked.
 */
export const inquiryRefusalWords: Readonly<Record<string, string>> = {
  LeadNotStarted: "Not started",
  LeadClosed: "Closed",
  InquiriesInFlight: "In flight",
};

export const inquiryRefusalWordUnknown = "Refused";

/** The 404 arm carries no code — `classify` keeps none for an absence — so the
 * word for it is chosen from the outcome instead. */
export const inquiryRefusalWordNoLead = "No lead";

/** What the last ask did, in the one line the box says it in. */
export type InquiryAsk =
  | { readonly ask: "Idle" }
  | { readonly ask: "Asking" }
  | { readonly ask: "Asked"; readonly session: string }
  | { readonly ask: "Refused"; readonly word: string }
  | { readonly ask: "Failed"; readonly reason: string };

function inquiryRefused(code: string): InquiryAsk {
  return {
    ask: "Refused",
    word: inquiryRefusalWords[code] ?? inquiryRefusalWordUnknown,
  };
}

/**
 * What the door answered, as the box draws it. A refusal is the lead's own
 * answer and is drawn as a word; everything else is this console or the network
 * failing, and is drawn with the reason, because the two are not the same news
 * and a reader who cannot tell them apart cannot tell whether to ask again.
 */
export function inquiryAskAnswered(
  result: ApiResult<LeadInquiryAccepted>,
): InquiryAsk {
  switch (result.outcome) {
    case "Ok":
      return { ask: "Asked", session: result.value.session };
    case "Absent":
      return { ask: "Refused", word: inquiryRefusalWordNoLead };
    case "Conflict":
    case "Retryable":
    case "Rejected":
      return inquiryRefused(result.code);
    case "Unauthenticated":
    case "Fault":
    case "Unreachable":
    case "Unreadable":
      return { ask: "Failed", reason: panelReason(result) };
  }
}
