/**
 * Wire outcome to drawn state: the mapping the honest-states requirement is
 * actually made of.
 *
 * The case that matters most is a body the console cannot read. Every response
 * reaches a panel through `readResult`, and a parse that threw past it would
 * leave that panel reading forever — which is unavailable presented as
 * in-flight, the one thing issue #194 names outright.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  operationEvent,
  readResult,
  submissionEvent,
  unavailableReason,
  unreadableReason,
} from "../../ui/console/app/outcomes.js";
import { panelForKind } from "../../ui/console/app/panels.js";
import {
  notificationKinds,
  parseOperation,
} from "../../ui/console/app/resources.js";

const ok = (body: unknown) => ({ outcome: "Ok" as const, body });
const accepted = (body: unknown) => ({
  outcome: "Accepted" as const,
  body,
  location: undefined,
});
const retryable = {
  outcome: "Retryable" as const,
  code: "DispatchBacklog",
  retryAfterSeconds: 9,
};
const absent = { outcome: "Absent" as const };

test("a body the console cannot read is a reason, not a thrown promise", () => {
  const read = readResult(ok({ nonsense: true }), parseOperation);
  assert.deepEqual(read, { result: "Unavailable", reason: unreadableReason });
});

test("a readable body is the parsed value", () => {
  assert.deepEqual(
    readResult(ok({ operation: "o1", state: "Pending" }), parseOperation),
    {
      result: "Value",
      value: { operation: "o1", state: "Pending", refusalCode: undefined },
    },
  );
});

test("a deferral keeps the server's code and delay rather than becoming a failure", () => {
  assert.deepEqual(readResult(retryable, parseOperation), {
    result: "Deferred",
    code: "DispatchBacklog",
    retryAfterSeconds: 9,
  });
});

test("absent and inaccessible read as one sentence, and it is not 'forbidden'", () => {
  const reason = unavailableReason(absent);
  assert.match(reason, /absent/u);
  assert.doesNotMatch(reason, /forbidden|denied/iu);
  assert.deepEqual(readResult(absent, parseOperation), {
    result: "Unavailable",
    reason,
  });
});

test("every failing outcome names why, and none of them is empty", () => {
  const outcomes = [
    absent,
    { outcome: "Unauthenticated" as const },
    { outcome: "Conflict" as const, code: "ProjectionBehind", body: undefined },
    {
      outcome: "Rejected" as const,
      code: "InvalidRequest",
      status: 400,
      body: undefined,
    },
    { outcome: "Fault" as const, code: "Unreachable", status: 0 },
  ];
  for (const outcome of outcomes) {
    const reason = unavailableReason(outcome);
    assert.ok(reason.length > 0, outcome.outcome);
    assert.equal(readResult(outcome, parseOperation).result, "Unavailable");
  }
});

test("a submission's 202 becomes an acceptance, and an unreadable one a fault", () => {
  assert.deepEqual(
    submissionEvent(accepted({ operation: "o1", state: "Pending" })),
    {
      event: "Accepted",
      operation: "o1",
      state: "Pending",
    },
  );
  assert.deepEqual(
    submissionEvent(accepted({ operation: "o1", state: "Airborne" })),
    {
      event: "Faulted",
      reason: unreadableReason,
    },
  );
});

test("a backlogged submission is deferred with its delay, not failed", () => {
  assert.deepEqual(submissionEvent(retryable), {
    event: "Deferred",
    code: "DispatchBacklog",
    retryAfterSeconds: 9,
  });
});

test("a vanished submission or operation is the absent event", () => {
  assert.deepEqual(submissionEvent(absent), { event: "Absent" });
  assert.deepEqual(operationEvent(absent), { event: "Absent" });
});

test("an operation read becomes a poll carrying the refusal code", () => {
  assert.deepEqual(
    operationEvent(
      ok({ operation: "o1", state: "Refused", code: "TicketChanged" }),
    ),
    { event: "Polled", state: "Refused", refusalCode: "TicketChanged" },
  );
  assert.deepEqual(operationEvent(ok({ state: "Pending" })), {
    event: "Faulted",
    reason: unreadableReason,
  });
});

test("every notification kind routes to a panel or to nothing, and none throws", () => {
  const routed = notificationKinds.map((kind) => panelForKind(kind));
  assert.deepEqual(routed, [
    "candidates",
    "tickets",
    undefined,
    undefined,
    "tickets",
  ]);
});
