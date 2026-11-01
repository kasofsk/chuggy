/**
 * What an inbox row says of the answer it carries: whether its follow is still
 * going, and which endings are its refusal.
 */

import { expect, test } from "vitest";

import {
  inboxAnswerFinished,
  inboxAnswerInFlight,
  inboxAnswerRefusal,
  inboxStepSentence,
} from "../app/core/inboxAnswers.ts";
import type { OperationStep } from "../app/core/operationFollow.ts";

const settled: OperationStep = {
  step: "Settled",
  operation: "op-one",
  state: "Succeeded",
  refusal: undefined,
};

const abandoned: OperationStep = {
  step: "Abandoned",
  cause: { type: "Overstepped" },
  refused: false,
};

const following: OperationStep = {
  step: "Following",
  operation: "op-one",
  attempts: 1,
};

test("a step is finished exactly when nothing more will be reported for it", () => {
  expect(inboxAnswerFinished(settled)).toBe(true);
  expect(inboxAnswerFinished(abandoned)).toBe(true);
  expect(inboxAnswerFinished(following)).toBe(false);
  expect(inboxAnswerInFlight(undefined)).toBe(false);
  expect(inboxAnswerInFlight(following)).toBe(true);
});

test("a follow the actor accepted or answered is no refusal, and every other ending is one in the row's words", () => {
  expect(inboxAnswerRefusal(settled)).toBeUndefined();
  expect(inboxAnswerRefusal({ ...settled, state: "Answered" })).toBeUndefined();
  const cancelled: OperationStep = { ...settled, state: "Cancelled" };
  expect(inboxAnswerRefusal(cancelled)).toBe(inboxStepSentence(cancelled));
  expect(inboxAnswerRefusal(abandoned)).toBe("Status unknown");
});
