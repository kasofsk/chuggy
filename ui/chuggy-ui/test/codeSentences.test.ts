/**
 * That every coded value the wire sends a person leaves as a sentence.
 *
 * The failure this catches is a screen printing `TicketChanged` at somebody: the
 * code is the API's word to another program, and there is nowhere for a reader
 * to look it up.
 */

import { expect, test } from "vitest";

import {
  escalationKinds,
  operationStates,
} from "../../../src/contract/rosters.ts";
import {
  escalationKindSentence,
  mutationDeferralCodes,
  mutationDeferralSentence,
  mutationRefusalCodes,
  mutationRefusalSentence,
  operationFailureSentence,
  operationStateSentence,
} from "../app/core/codeSentences.ts";
import { failureWords } from "../app/core/failureWords.ts";

/** A line is distinct and quotes no member of its own roster. */
function sentences(said: readonly string[], roster: readonly string[]): void {
  for (const sentence of said)
    for (const code of roster) expect(sentence).not.toContain(code);
  expect(new Set(said).size).toBe(said.length);
}

test("every escalation kind reads as a distinct sentence and not as its code", () => {
  sentences(escalationKinds.map(escalationKindSentence), escalationKinds);
});

/** A state's name is a plain word, which its sentence may be. */
test("every operation state reads as a distinct sentence", () => {
  sentences(operationStates.map(operationStateSentence), []);
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

/** The actor's refusals arrive on a settled operation, so a failure carrying
 * one of their codes is not read as the refusal it would have been. */
test("a failure carrying an actor's refusal code is named as unrecognised", () => {
  const said = operationFailureSentence({
    outcome: "Conflict",
    code: "TicketChanged",
    body: undefined,
  });
  expect(said).toContain("Unknown reason");
  expect(said).toContain("TicketChanged");
});

/** What was thrown is the failure's detail, drawn on hover of its word. */
test("a failure the wire has no refusal for is its word, and carries no thrown text", () => {
  for (const [failure, word] of [
    [
      { outcome: "Unreachable", reason: "the connection was closed" },
      "No connection",
    ],
    [
      { outcome: "Unreadable", reason: "expected string at title" },
      "Unreadable",
    ],
  ] as const) {
    expect(operationFailureSentence(failure)).toBe(word);
    expect(failureWords(failure)).toStrictEqual({
      word,
      detail: failure.reason,
    });
  }
});

/** The two fallbacks carry the same sentinel, which is what lets
 * `test/ui/mutationSentences.test.ts` tell a rostered answer from a fallback. */
test("a deferral belonging to no roster is named as one this console does not know", () => {
  const said = mutationDeferralSentence("SubmissionQuotaExhausted");
  expect(said).toContain("Unknown reason");
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
  expect(said).toContain("Unknown reason");
  expect(said).toContain("InvalidRequest");
});
