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
 * THE QUESTION IS BOUNDED HERE IN THE MEASURE THE WIRE BOUNDS IT IN, which is
 * `String.length` because that is what zod's `max` reads — so the case that
 * proves it asks with characters outside the basic plane, the only way the two
 * measures can disagree and so the only way a bound counted the other way
 * reaches a reader as a rejection the box said would not happen.
 *
 * A QUESTION PAST THE BOUND IS SHOWN AND REFUSED, NEVER TRUNCATED. What a
 * reader pasted is theirs, and a box that silently dropped the end of it would
 * send a question they did not ask.
 *
 * A PAIR IS HELD UNTIL THE DOOR TAKES IT. The pair in the body is the whole of
 * what makes a retried post a retry, so a send that did not land is re-sent
 * under the pair it was sent under; a fresh draw would ask the door a second
 * question and spend the second of the asker's two on it.
 */

import type { z } from "zod";

import { inquiryQuestionCharsMax } from "../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type { leadInquirySchema } from "../../../../src/contract/requests.ts";
import type { LeadInquiryAccepted } from "../../../../src/contract/responses.ts";
import type { ApiResult } from "./apiRequest.ts";
import { panelReason } from "./freshness.ts";

/**
 * How much entropy an inquiry's pair is named with. It is its own constant
 * rather than a reuse of the operation id's, for the reason the two char bounds
 * are two constants — they are different doors, and one constant would move
 * both when only one was retuned.
 */
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
 * A draw and what it was drawn for, which travel together so that a held pair
 * cannot come to be sent for something the door would not recognise it by —
 * the question, and the project, because a session name is unique across the
 * whole installation while the door that takes it is one project's.
 */
export interface InquiryDraw {
  readonly drawn: string;
  readonly question: string;
  readonly partition: PartitionIdentity;
}

function inquiryDrawnFor(
  held: InquiryDraw,
  question: string,
  partition: PartitionIdentity,
): boolean {
  return (
    held.question === question &&
    held.partition.tenant === partition.tenant &&
    held.partition.project === partition.project
  );
}

/**
 * The draw a send goes out under: the held one where it was drawn for this
 * question and this project, and a fresh one otherwise — an edited question
 * being one the door would answer with the held pair's own ordinal, and another
 * project's door being one that would either answer for a fork it does not hold
 * or refuse a name the installation has already used, leaving a box that
 * re-sends the refused pair on every press.
 *
 * Nothing is held past an accepted send, and the caller is what forgets it.
 */
export function inquiryDraw(
  held: InquiryDraw | undefined,
  question: string,
  partition: PartitionIdentity,
  draw: () => string,
): InquiryDraw {
  if (held !== undefined && inquiryDrawnFor(held, question, partition))
    return held;
  return { drawn: draw(), question, partition };
}

/**
 * The fork and its one turn, named before either exists. Both come from one
 * draw because they name one question: the door is idempotent on the pair, so a
 * retry that sent a fresh turn beside a held session would be asking the
 * definer to reconcile two identities where it was promised one.
 */
export function inquiryAsking(
  draw: InquiryDraw,
): z.infer<typeof leadInquirySchema> {
  return {
    session: `inq-${draw.drawn}`,
    turn: `inq-turn-${draw.drawn}`,
    question: draw.question,
  };
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
