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
import { copyTextEn } from "../app/copy/catalog.ts";

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
  expect(inboxAnswerRefusal(settled, copyTextEn)).toBeUndefined();
  expect(
    inboxAnswerRefusal({ ...settled, state: "Answered" }, copyTextEn),
  ).toBeUndefined();
  const cancelled: OperationStep = { ...settled, state: "Cancelled" };
  expect(inboxAnswerRefusal(cancelled, copyTextEn)).toBe(
    inboxStepSentence(cancelled, copyTextEn),
  );
  expect(inboxAnswerRefusal(abandoned, copyTextEn)).toBe("Status unknown");
});
