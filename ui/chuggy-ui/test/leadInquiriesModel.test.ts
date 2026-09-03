/**
 * What the Ask box decides before and after the wire: which questions it
 * refuses to send, what pair of identities it sends them under, and which of
 * the door's answers is the lead refusing rather than the console failing.
 *
 * The cases with teeth are the bound and the classification. A bound measured
 * differently from the schema's is a box that refuses what the route would take
 * or sends what it will reject; and a refusal drawn as a failure tells a reader
 * to try again when the answer is that they may not.
 */

import { expect, test } from "vitest";

import { inquiryQuestionCharsMax } from "../../../src/contract/http.ts";
import { leadInquirySchema } from "../../../src/contract/requests.ts";
import {
  inquiryAskAnswered,
  inquiryAsking,
  inquiryQuestion,
  inquiryQuestionFault,
  inquiryRefusalWordNoLead,
  inquiryRefusalWordUnknown,
  inquiryRefusalWords,
} from "../app/core/leadInquiries.ts";

const drawn = "GxUhK1TgQ2iWm4bB0jvA5w";

test("what is asked is what was typed, less the ends nobody meant to type", () => {
  expect(inquiryQuestion("  what is blocking ticket 41?\n")).toBe(
    "what is blocking ticket 41?",
  );
  expect(inquiryQuestion("   ")).toBe("");
});

/**
 * THE BOX AND THE SCHEMA BOUND THE SAME QUESTION THE SAME WAY. A question at the
 * bound is asked and one character past it is refused, and the schema is asked
 * the same two questions — so a bound that moved on one side alone fails here
 * rather than at a reader's `400`.
 */
test("a question is refused at the bound the wire refuses it at", () => {
  const atBound = "q".repeat(inquiryQuestionCharsMax);
  const past = `${atBound}q`;
  expect(inquiryQuestionFault(atBound)).toBeUndefined();
  expect(inquiryQuestionFault(past)).toBe("Too long");
  expect(inquiryQuestionFault("")).toBe("Empty");
  expect(leadInquirySchema.safeParse(inquiryAsking(atBound, drawn)).success).toBe(
    true,
  );
  expect(
    leadInquirySchema.safeParse(inquiryAsking(past, drawn)).success,
    "the box would have sent a question the schema rejects",
  ).toBe(false);
});

/** One question is one draw, so a retry of the same ask is the same pair and the
 * definer is asked to reconcile nothing. */
test("the fork and its turn are named from one draw", () => {
  const asked = inquiryAsking("why", drawn);
  expect(asked).toStrictEqual({
    session: `inq-${drawn}`,
    turn: `inq-turn-${drawn}`,
    question: "why",
  });
  expect(inquiryAsking("why", drawn)).toStrictEqual(asked);
});

test("the door's answer is drawn as the fork it opened", () => {
  expect(
    inquiryAskAnswered({
      outcome: "Ok",
      value: { session: "inq-1", turn: "inq-turn-1", ordinal: 1 },
    }),
  ).toStrictEqual({ ask: "Asked", session: "inq-1" });
});

/**
 * EVERY REFUSAL IN THE ROSTER IS DRAWN AS ITS OWN WORD. A code the roster does
 * not hold is still drawn as a refusal, because a box that went quiet on an
 * unrecognised code looks exactly like one that asked.
 */
test("each refusal the door states is drawn as one word", () => {
  const drawnAs = (code: string) =>
    inquiryAskAnswered({ outcome: "Conflict", code, body: undefined });
  for (const [code, word] of Object.entries(inquiryRefusalWords))
    expect(drawnAs(code), code).toStrictEqual({ ask: "Refused", word });
  expect(drawnAs("SomethingElse")).toStrictEqual({
    ask: "Refused",
    word: inquiryRefusalWordUnknown,
  });
  expect(
    inquiryAskAnswered({
      outcome: "Retryable",
      code: "InquiriesInFlight",
      retryAfterSeconds: 5,
    }),
  ).toStrictEqual({ ask: "Refused", word: "In flight" });
  expect(
    inquiryAskAnswered({ outcome: "Rejected", code: "X", status: 400, body: 1 }),
  ).toStrictEqual({ ask: "Refused", word: inquiryRefusalWordUnknown });
});

/** A `404` carries no code at all, so the word for it comes from the outcome. */
test("a project with no lead is refused in a word of its own", () => {
  expect(inquiryAskAnswered({ outcome: "Absent" })).toStrictEqual({
    ask: "Refused",
    word: inquiryRefusalWordNoLead,
  });
});

/**
 * A refusal and a failure are different news: one says the lead will not take
 * the question, the other says this console never got to ask. A reader told the
 * second as the first would stop asking.
 */
test("what never reached the lead is a failure with its reason, not a refusal", () => {
  for (const result of [
    { outcome: "Unauthenticated" } as const,
    { outcome: "Fault", code: "InternalError", status: 500 } as const,
    { outcome: "Unreachable", reason: "offline" } as const,
    { outcome: "Unreadable", reason: "not json" } as const,
  ]) {
    const answered = inquiryAskAnswered(result);
    expect(answered.ask, result.outcome).toBe("Failed");
  }
});
