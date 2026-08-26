/**
 * What the inbox keeps of the answers a reader has submitted, and what it lets
 * go of.
 *
 * The accumulation is bounded by clicks rather than by anything the project
 * does, so the case that matters is the one where a reader has answered more
 * rows than the cap allows: the finished answers go and the ones still in
 * flight do not, because a row whose operation is open has nothing else to say.
 */

import { expect, test } from "vitest";

import {
  inboxAnswerFinished,
  inboxAnswerInFlight,
  inboxAnswersEmpty,
  inboxAnswersFinishedMax,
  inboxAnswersWith,
} from "../app/core/inboxAnswers.ts";
import type { InboxAnswers } from "../app/core/inboxAnswers.ts";
import type { OperationStep } from "../app/core/operationFollow.ts";

const settled: OperationStep = {
  step: "Settled",
  operation: "op-one",
  state: "Succeeded",
  refusalCode: undefined,
};

const abandoned: OperationStep = {
  step: "Abandoned",
  reason: "the follow took more steps than it is allowed to take",
};

const following: OperationStep = {
  step: "Following",
  operation: "op-one",
  attempts: 1,
};

function answered(
  tickets: readonly number[],
  step: OperationStep,
  from: InboxAnswers = inboxAnswersEmpty,
): InboxAnswers {
  let held = from;
  for (const ticket of tickets) held = inboxAnswersWith(held, ticket, step);
  return held;
}

/** Numbered above the in-flight ticket below, because a record is walked in key
 * order and a case that shed the highest keys would prove nothing about the
 * lowest one surviving. */
const overCap = Array.from(
  { length: inboxAnswersFinishedMax + 5 },
  (_unused, at) => at + 2,
);

test("the latest step of a ticket replaces the one before it", () => {
  const held = inboxAnswersWith(
    inboxAnswersWith(inboxAnswersEmpty, 4, following),
    4,
    settled,
  );
  expect(Object.keys(held)).toStrictEqual(["4"]);
  expect(held["4"]).toStrictEqual(settled);
});

test("finished answers past the cap are shed and the count stops growing", () => {
  const held = answered(overCap, settled);
  expect(Object.keys(held).length).toBe(inboxAnswersFinishedMax + 1);
  expect(Object.keys(held)).toContain(String(overCap.at(-1)));
});

test("an answer still in flight is never shed, however many finish around it", () => {
  const held = answered(overCap, settled, answered([1], following));
  expect(held["1"]).toStrictEqual(following);
  expect(
    Object.values(held).filter((step) => inboxAnswerInFlight(step)).length,
  ).toBe(1);
});

test("the record is keyed by the ticket, so answering one twice is one entry", () => {
  const held = answered([4, 4, 7], settled);
  expect(Object.keys(held).sort()).toStrictEqual(["4", "7"]);
  const again = answered(overCap, settled, answered(overCap, settled));
  expect(Object.keys(again).length).toBe(inboxAnswersFinishedMax + 1);
});

test("a step is finished exactly when nothing more will be reported for it", () => {
  expect(inboxAnswerFinished(settled)).toBe(true);
  expect(inboxAnswerFinished(abandoned)).toBe(true);
  expect(inboxAnswerFinished(following)).toBe(false);
  expect(inboxAnswerInFlight(undefined)).toBe(false);
  expect(inboxAnswerInFlight(following)).toBe(true);
});
