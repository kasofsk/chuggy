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
import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { leadInquirySchema } from "../../../src/contract/requests.ts";
import {
  inquiryAskAnswered,
  inquiryAskerAbsent,
  inquiryAskerNamed,
  inquiryAsking,
  inquiryDraw,
  inquiryQuestion,
  inquiryQuestionFault,
  inquiryRefusalWordNoLead,
  inquiryRefusalWordUnknown,
  inquiryRefusalWords,
} from "../app/core/leadInquiries.ts";
import type { InquiryDraw } from "../app/core/leadInquiries.ts";

const drawn = "GxUhK1TgQ2iWm4bB0jvA5w";

const partition = { tenant: "acme", project: "atlas" };

function asking(question: string): unknown {
  return inquiryAsking({ drawn, question, partition });
}

test("what is asked is what was typed, less the ends nobody meant to type", () => {
  expect(inquiryQuestion("  what is blocking ticket 41?\n")).toBe(
    "what is blocking ticket 41?",
  );
  expect(inquiryQuestion("   ")).toBe("");
});

/**
 * THE BOX AND THE SCHEMA BOUND THE SAME QUESTION THE SAME WAY. A question at the
 * bound is asked and one unit past it is refused, and the schema is asked the
 * same two questions — so a bound that moved on one side alone fails here rather
 * than at a reader's `400`.
 */
test("a question is refused at the bound the wire refuses it at", () => {
  const atBound = "q".repeat(inquiryQuestionCharsMax);
  const past = `${atBound}q`;
  expect(inquiryQuestionFault(atBound)).toBeUndefined();
  expect(inquiryQuestionFault(past)).toBe("Too long");
  expect(inquiryQuestionFault("")).toBe("Empty");
  expect(leadInquirySchema.safeParse(asking(atBound)).success).toBe(true);
  expect(
    leadInquirySchema.safeParse(asking(past)).success,
    "the box would have sent a question the schema rejects",
  ).toBe(false);
});

/**
 * THE ONLY WAY THE TWO MEASURES CAN DISAGREE IS OUTSIDE THE BASIC PLANE, so an
 * ASCII case cannot tell them apart: an astral character is one code point and
 * two of the units zod counts, so a question of half the bound's worth of them
 * sits exactly at the bound and one more of them is past it.
 */
test("the bound is counted in the units the schema counts, not in characters", () => {
  const astral = "\u{1f600}";
  const atBound = astral.repeat(inquiryQuestionCharsMax / 2);
  const past = `${atBound}${astral}`;
  expect(atBound.length).toBe(inquiryQuestionCharsMax);
  expect(inquiryQuestionFault(atBound)).toBeUndefined();
  expect(leadInquirySchema.safeParse(asking(atBound)).success).toBe(true);
  expect(
    inquiryQuestionFault(past),
    "a question the schema rejects was drawn as one the box would send",
  ).toBe("Too long");
  expect(leadInquirySchema.safeParse(asking(past)).success).toBe(false);
});

/** One question is one draw, so a retry of the same ask is the same pair and the
 * definer is asked to reconcile nothing. */
test("the fork and its turn are named from one draw", () => {
  expect(inquiryAsking({ drawn, question: "why", partition })).toStrictEqual({
    session: `inq-${drawn}`,
    turn: `inq-turn-${drawn}`,
    question: "why",
  });
});

/**
 * THE PAIR IS THE KEY THE DOOR IS IDEMPOTENT ON, so a re-send of one question
 * reuses it and an edited question does not — the door would answer an edited
 * question with the held pair's own ordinal, which is the first question's
 * answer under the second question's text.
 */
function drawing(): () => string {
  let draws = 0;
  return () => {
    draws += 1;
    return `drawn-${String(draws)}`;
  };
}

test("a re-send keeps its pair and an edit takes a new one", () => {
  const draw = drawing();
  const first = inquiryDraw(undefined, "why", partition, draw);
  expect(first).toStrictEqual({ drawn: "drawn-1", question: "why", partition });
  expect(
    inquiryDraw(first, "why", partition, draw),
    "a re-sent question asked the door a second question",
  ).toStrictEqual(first);
  expect(inquiryDraw(first, "why not", partition, draw)).toStrictEqual({
    drawn: "drawn-2",
    question: "why not",
    partition,
  });
  expect(
    inquiryDraw(undefined, "why", partition, draw),
    "a pair the door has taken was sent again",
  ).toStrictEqual({ drawn: "drawn-3", question: "why", partition });
});

/**
 * A DRAW NAMES THE PROJECT IT WAS ASKED FOR, WHICHEVER ARM ANSWERED. A fresh
 * draw records the project it was drawn for and a held one is returned only
 * after its own project was found equal, so a caller may address the send, the
 * write of its answer and the re-read of its listing by the draw or by the
 * project it pressed in and get the same door either way.
 */
test("a draw names the project it was asked for", () => {
  const draw = drawing();
  const elsewhere = { tenant: "acme", project: "beta" };
  const asked: readonly PartitionIdentity[] = [
    partition,
    elsewhere,
    { tenant: "acme/beta", project: "" },
  ];
  let held: InquiryDraw | undefined = undefined;
  for (const at of asked)
    for (const question of ["why", "why not"]) {
      held = inquiryDraw(held, question, at, draw);
      expect(
        { tenant: held.partition.tenant, project: held.partition.project },
        "a draw was sent to a door other than the one it was asked for",
      ).toStrictEqual({ tenant: at.tenant, project: at.project });
    }
});

/**
 * A SESSION NAME IS UNIQUE ACROSS THE INSTALLATION AND THE DOOR THAT TAKES IT
 * IS ONE PROJECT'S, so the project is the other half of what a pair is
 * recognised by. A pair carried to another project's door is answered for a
 * fork that door does not hold, or refused as a name already used — and a
 * refused pair still held is a box that re-sends it on every press.
 */
test("a pair drawn for one project is not sent to another's door", () => {
  const draw = drawing();
  const first = inquiryDraw(undefined, "why", partition, draw);
  const elsewhere = { tenant: "acme", project: "beta" };
  expect(
    inquiryDraw(first, "why", elsewhere, draw),
    "a pair drawn for one project was sent to another's door",
  ).toStrictEqual({ drawn: "drawn-2", question: "why", partition: elsewhere });
  expect(
    inquiryDraw(first, "why", { tenant: "other", project: "atlas" }, draw),
  ).toStrictEqual({
    drawn: "drawn-3",
    question: "why",
    partition: { tenant: "other", project: "atlas" },
  });
  expect(
    inquiryDraw(first, "why", { ...partition }, draw),
    "a pair was re-drawn for the project it was already drawn for",
  ).toStrictEqual(first);
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
    inquiryAskAnswered({
      outcome: "Rejected",
      code: "X",
      status: 400,
      body: 1,
    }),
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

/**
 * THE LISTING MAY NAME NO ASKER. `asker` is the membership's own authority
 * subject and the route omits it where that membership is gone, so a row that
 * drew the field as it stands would put a blank where a person stood — and one
 * that could not read the body at all would draw no inquiries whatever.
 */
test("an inquiry the listing names no asker for is drawn as absent", () => {
  expect(inquiryAskerNamed("geoff")).toBe("geoff");
  expect(inquiryAskerNamed(undefined)).toBe(inquiryAskerAbsent);
  expect(
    inquiryAskerAbsent.split(" ").length,
    "the absent asker is a word",
  ).toBe(1);
});
