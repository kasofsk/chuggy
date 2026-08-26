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
  expect(
    operationFailureSentence({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    }),
  ).toContain("InvalidRequest");
});
