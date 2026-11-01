/**
 * What one review of a held decision comes to: the answer the server gave,
 * stale where the decision was no longer held, and failed as its own code
 * otherwise; and the note, sent only where it says something.
 */

import { expect, test } from "vitest";

import { selectorProposalNotHeldCode } from "../../../src/contract/rosters.ts";
import {
  inboxProposalAnswered,
  inboxProposalNoteClamped,
  inboxProposalReview,
  inboxProposalSentence,
  inboxProposalStepWord,
} from "../app/core/inboxProposals.ts";
import { selectorReviewFeedbackCharsMax } from "../../../src/contract/http.ts";

test("an answer is the outcome the server recorded", () => {
  const step = inboxProposalAnswered({
    outcome: "Ok",
    value: { decision: "dec-a", outcome: "Rejected" },
  });
  expect(step).toStrictEqual({ step: "Answered", outcome: "Rejected" });
  expect(inboxProposalStepWord(step)).toBe("Rejected");
});

test("a decision no longer held is stale, and any other conflict is not", () => {
  const stale = inboxProposalAnswered({
    outcome: "Conflict",
    code: selectorProposalNotHeldCode,
    body: undefined,
  });
  expect(stale).toStrictEqual({ step: "Stale" });
  expect(inboxProposalStepWord(stale)).toBe("Stale");
  expect(
    inboxProposalAnswered({
      outcome: "Conflict",
      code: "IdempotencyConflict",
      body: undefined,
    }),
  ).toStrictEqual({ step: "Failed", why: "IdempotencyConflict" });
});

test("a refusal with no code is said as its outcome", () => {
  expect(inboxProposalAnswered({ outcome: "Absent" })).toStrictEqual({
    step: "Failed",
    why: "Absent",
  });
  expect(
    inboxProposalAnswered({ outcome: "Unreachable", reason: "offline" }),
  ).toStrictEqual({ step: "Failed", why: "Unreachable" });
});

test("a note of nothing but space is no note, and a note is sent trimmed", () => {
  expect(inboxProposalReview("Approved", "   ")).toStrictEqual({
    outcome: "Approved",
  });
  expect(inboxProposalReview("Rejected", " later ")).toStrictEqual({
    outcome: "Rejected",
    feedback: "later",
  });
});

test("a note is held to what the wire takes", () => {
  const long = "n".repeat(selectorReviewFeedbackCharsMax + 3);
  expect(inboxProposalNoteClamped(long).length).toBe(
    selectorReviewFeedbackCharsMax,
  );
  expect(inboxProposalNoteClamped("short")).toBe("short");
});

test("a review's line names its decision's tickets, then the word, then why it failed", () => {
  const proposal = { decision: "dec-a", tickets: [7, 8] };
  expect(
    inboxProposalSentence({
      proposal,
      step: { step: "Answered", outcome: "Approved" },
    }),
  ).toBe("Proposal 7, 8 · Approved");
  expect(
    inboxProposalSentence({
      proposal,
      step: { step: "Failed", why: "InternalError" },
    }),
  ).toBe("Proposal 7, 8 · Failed · InternalError");
});
