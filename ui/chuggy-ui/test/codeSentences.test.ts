/**
 * That every coded value the wire sends a person leaves as a sentence.
 *
 * The failure this catches is a screen printing `NotEnabled` at somebody: the
 * code is the API's word to another program, and there is nowhere for a reader
 * to look it up.
 */

import { expect, test } from "vitest";

import {
  escalationReasons,
  operationRefusalCodes,
  operationStates,
} from "../../../src/contract/rosters.ts";
import {
  escalationReasonSentence,
  mutationDeferralCodes,
  mutationDeferralSentence,
  mutationRefusalCodes,
  mutationRefusalSentence,
  operationFailureSentence,
  operationRefusalSentence,
  operationStateSentence,
} from "../app/core/codeSentences.ts";

/** A sentence is prose, is distinct, and quotes no member of its own roster. */
function sentences(said: readonly string[], roster: readonly string[]): void {
  for (const sentence of said) {
    expect(sentence).toContain(" ");
    for (const code of roster) expect(sentence).not.toContain(code);
  }
  expect(new Set(said).size).toBe(said.length);
}

test("every refusal code reads as a distinct sentence and not as its code", () => {
  sentences(
    operationRefusalCodes.map(operationRefusalSentence),
    operationRefusalCodes,
  );
});

test("every escalation reason reads as a distinct sentence and not as its code", () => {
  sentences(escalationReasons.map(escalationReasonSentence), escalationReasons);
});

test("every operation state reads as a distinct sentence and not as its name", () => {
  sentences(operationStates.map(operationStateSentence), operationStates);
});

test("every boundary refusal reads as a distinct sentence and not as its code", () => {
  sentences(mutationRefusalCodes.map(mutationRefusalSentence), [
    ...mutationRefusalCodes,
  ]);
});

test("every deferral reads as a distinct sentence and not as its code", () => {
  sentences(mutationDeferralCodes.map(mutationDeferralSentence), [
    ...mutationDeferralCodes,
  ]);
});

test("a refused cancellation reads as a sentence, not as its code", () => {
  const said = operationFailureSentence({
    outcome: "Conflict",
    code: "OperationNotPending",
    body: undefined,
  });
  expect(said).toBe(mutationRefusalSentence("OperationNotPending"));
  expect(said).not.toContain("OperationNotPending");
});

test("every refusal the two mutation routes answer with reaches a sentence", () => {
  for (const code of mutationRefusalCodes)
    expect(
      operationFailureSentence({ outcome: "Conflict", code, body: undefined }),
    ).not.toContain(code);
  for (const code of mutationDeferralCodes)
    expect(
      operationFailureSentence({
        outcome: "Retryable",
        code,
        retryAfterSeconds: 1,
      }),
    ).not.toContain(code);
});

test("a failure the actor named as a refusal reads as that refusal", () => {
  expect(
    operationFailureSentence({
      outcome: "Conflict",
      code: "NotEnabled",
      body: undefined,
    }),
  ).toBe(operationRefusalSentence("NotEnabled"));
});

test("a failure the wire has no refusal for still says what it was", () => {
  expect(
    operationFailureSentence({
      outcome: "Unreachable",
      reason: "the connection was closed",
    }),
  ).toContain("the connection was closed");
});

/** The two fallbacks carry the same sentinel, which is what lets
 * `test/ui/mutationSentences.test.ts` tell a rostered answer from a fallback. */
test("a deferral belonging to no roster is named as one this console does not know", () => {
  const said = mutationDeferralSentence("SubmissionQuotaExhausted");
  expect(said).toContain("does not know");
  expect(said).toContain("SubmissionQuotaExhausted");
});

/** An unrostered code is named as unrecognised rather than offered as the
 * reason, which is the one place a code may still reach a reader. */
test("a code belonging to no roster is named as one this console does not know", () => {
  const said = operationFailureSentence({
    outcome: "Rejected",
    code: "InvalidRequest",
    status: 400,
    body: undefined,
  });
  expect(said).toContain("does not know");
  expect(said).toContain("InvalidRequest");
});
