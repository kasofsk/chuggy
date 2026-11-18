/**
 * The bound on refused device codes, on an injected clock: per person, held in
 * a map of bounded size that evicts the one refused least recently, reopening
 * as its window passes, and spent without the issuer being asked.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deviceApprovalGuesses,
  deviceApprovals,
  type DeviceUserCodeAnswer,
} from "../../src/interpreter/deviceApproval.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";

const bound = { refusalsMax: 3, windowMs: 60_000, principalsMax: 2 };
const stranger = asPrincipal("stranger");
const person = asPrincipal("person");

/** Approvals whose issuer answers `answer`, counting each call, at `clock.nowMs`. */
function approvalsAnswering(answer: DeviceUserCodeAnswer) {
  const clock = { nowMs: 0, asked: 0 };
  const approvals = deviceApprovals(
    {
      codes: {
        accept: () => {
          clock.asked += 1;
          return Promise.resolve(answer);
        },
      },
      nowMs: () => clock.nowMs,
    },
    bound,
  );
  return { clock, approvals };
}

test("a person's bound is spent by their own refusals and leaves another's untouched, without the issuer being asked", async () => {
  const { clock, approvals } = approvalsAnswering({ answer: "CodeRefused" });
  for (let tried = 0; tried < bound.refusalsMax; tried += 1)
    assert.deepEqual(await approvals.approve(stranger, "c", "X"), {
      answer: "CodeRefused",
    });
  clock.nowMs = 10_000;
  assert.deepEqual(await approvals.approve(stranger, "c", "X"), {
    answer: "TriesSpent",
    retryAfterSecs: 50,
  });
  assert.equal(clock.asked, bound.refusalsMax);
  assert.deepEqual(await approvals.approve(person, "c", "X"), {
    answer: "CodeRefused",
  });
});

test("the window reopens once the oldest refusal in it has passed", async () => {
  const { clock, approvals } = approvalsAnswering({ answer: "CodeRefused" });
  for (let tried = 0; tried < bound.refusalsMax; tried += 1) {
    clock.nowMs = tried * 1_000;
    await approvals.approve(stranger, "c", "X");
  }
  clock.nowMs = bound.windowMs - 1;
  assert.equal(
    (await approvals.approve(stranger, "c", "X")).answer,
    "TriesSpent",
  );
  clock.nowMs = bound.windowMs;
  assert.equal(
    (await approvals.approve(stranger, "c", "X")).answer,
    "CodeRefused",
  );
});

test("only a refused code counts: an approval, an expired link and a fault give their place back", async () => {
  for (const answer of [
    { answer: "Accepted", redirectTo: "https://auth.invalid/next" },
    { answer: "LinkExpired" },
    { answer: "Unavailable" },
  ] as const) {
    const { clock, approvals } = approvalsAnswering(answer);
    for (let tried = 0; tried <= bound.refusalsMax; tried += 1)
      assert.deepEqual(await approvals.approve(stranger, "c", "X"), answer);
    assert.equal(clock.asked, bound.refusalsMax + 1);
  }
});

test("calls sent together hold their places, so no more than the bound reach the issuer", async () => {
  const { clock, approvals } = approvalsAnswering({ answer: "CodeRefused" });
  const answered = await Promise.all(
    Array.from({ length: bound.refusalsMax + 2 }, () =>
      approvals.approve(stranger, "c", "X"),
    ),
  );
  assert.equal(clock.asked, bound.refusalsMax);
  assert.equal(answered.filter((one) => one.answer === "TriesSpent").length, 2);
});

test("the map keeps its size bound, evicting the person refused least recently", () => {
  const guesses = deviceApprovalGuesses({ ...bound, refusalsMax: 1 });
  const first = asPrincipal("first");
  const second = asPrincipal("second");
  const third = asPrincipal("third");
  assert.equal(guesses.take(first, 0).taken, "Taken");
  assert.equal(guesses.take(second, 1).taken, "Taken");
  assert.equal(guesses.take(first, 2).taken, "Spent");
  assert.equal(guesses.take(third, 3).taken, "Taken");
  assert.equal(guesses.held(), bound.principalsMax);
  assert.equal(guesses.take(first, 4).taken, "Taken");
  assert.equal(guesses.take(third, 5).taken, "Spent");
  assert.equal(guesses.held(), bound.principalsMax);
});

test("a bound that is not a positive integer refuses the composition", () => {
  for (const broken of [
    { refusalsMax: 0 },
    { windowMs: 1.5 },
    { principalsMax: -1 },
  ])
    assert.throws(
      () => deviceApprovalGuesses({ ...bound, ...broken }),
      RangeError,
    );
});
