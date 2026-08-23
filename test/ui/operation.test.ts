/**
 * Following a manual dispatch from its submission to a state that stops.
 *
 * The refusal codes and the attempt budget are the two things a reviewer of
 * issue #194 looks for: a refusal must reach the operator by its code, and a
 * pending operation must stop being followed.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  operationAdvanced,
  operationAttemptsMax,
  operationPolls,
  operationSubmitting,
  operationTerminalStates,
} from "../../ui/app/operation.js";
import { submissionEvent } from "../../ui/app/outcomes.js";
import { candidateRows, manualDispatchMutation } from "../../ui/app/views.js";
import { parseDispatchView } from "../../ui/app/resources.js";

const page = parseDispatchView({
  result: "Page",
  token: {
    tenant: "acme",
    project: "atlas",
    recoveryEpoch: "e1",
    schemaVersion: 1,
    watermark: 12,
    digest: "d",
  },
  candidates: [
    { ticket: 4, ticketVersion: 7, workFanout: 2, configurationRevision: "r1" },
  ],
  notificationCursor: 5,
});

function rows() {
  assert.equal(page.result, "Page");
  return page.result === "Page" ? candidateRows(page) : [];
}

test("a manual dispatch echoes the version the candidate row carried", () => {
  const row = rows()[0];
  assert.ok(row !== undefined);
  assert.deepEqual(manualDispatchMutation(row), {
    mutation: "ManualDispatch",
    ticket: 4,
    expectedTicketVersion: 7,
  });
  assert.equal(row.watermark, 12);
});

test("an accepted submission is followed until the state is terminal", () => {
  let step = operationAdvanced(operationSubmitting(4), {
    event: "Accepted",
    operation: "o1",
    state: "Pending",
  });
  assert.equal(step.step, "Following");
  assert.equal(operationPolls(step), true);
  step = operationAdvanced(step, {
    event: "Polled",
    state: "Succeeded",
    refusalCode: undefined,
  });
  assert.deepEqual(step, {
    step: "Settled",
    ticket: 4,
    operation: "o1",
    state: "Succeeded",
    refusalCode: undefined,
  });
  assert.equal(operationPolls(step), false);
});

test("a submission already terminal settles without a poll", () => {
  for (const state of operationTerminalStates) {
    const step = operationAdvanced(operationSubmitting(4), {
      event: "Accepted",
      operation: "o1",
      state,
    });
    assert.equal(step.step, "Settled");
  }
});

test("a refusal reaches the operator by its code", () => {
  const following = operationAdvanced(operationSubmitting(4), {
    event: "Accepted",
    operation: "o1",
    state: "Pending",
  });
  const step = operationAdvanced(following, {
    event: "Polled",
    state: "Refused",
    refusalCode: "TicketChanged",
  });
  assert.equal(step.step, "Settled");
  assert.equal(
    step.step === "Settled" ? step.refusalCode : undefined,
    "TicketChanged",
  );
});

test("a backlogged submission is a state the caller must act on again", () => {
  const step = operationAdvanced(operationSubmitting(4), {
    event: "Deferred",
    code: "DispatchBacklog",
    retryAfterSeconds: 9,
  });
  assert.deepEqual(step, {
    step: "Backlogged",
    ticket: 4,
    code: "DispatchBacklog",
    retryAfterSeconds: 9,
    attempts: 1,
  });
  assert.equal(operationPolls(step), true);
});

test("a server that keeps deferring is abandoned inside the same budget", () => {
  let step = operationSubmitting(4);
  let sends = 0;
  while (operationPolls(step) || step.step === "Submitting") {
    step = operationAdvanced(
      step,
      submissionEvent({
        outcome: "Retryable",
        code: "DispatchBacklog",
        retryAfterSeconds: 1,
      }),
    );
    sends += 1;
    assert.ok(
      sends <= operationAttemptsMax,
      "the backlog retry was not bounded",
    );
  }
  assert.equal(step.step, "Abandoned");
  assert.equal(sends, operationAttemptsMax);
});

test("a deferral then an acceptance keeps the budget already spent", () => {
  const backlogged = operationAdvanced(operationSubmitting(4), {
    event: "Deferred",
    code: "DispatchBacklog",
    retryAfterSeconds: 1,
  });
  const following = operationAdvanced(backlogged, {
    event: "Accepted",
    operation: "o1",
    state: "Pending",
  });
  assert.equal(following.step, "Following");
  assert.equal(following.step === "Following" ? following.attempts : -1, 1);
});

test("an operation that stays pending is abandoned inside the attempt budget", () => {
  let step = operationAdvanced(operationSubmitting(4), {
    event: "Accepted",
    operation: "o1",
    state: "Pending",
  });
  let polls = 0;
  while (step.step === "Following") {
    step = operationAdvanced(step, {
      event: "Polled",
      state: "Pending",
      refusalCode: undefined,
    });
    polls += 1;
    assert.ok(
      polls <= operationAttemptsMax,
      "the attempt budget did not stop the follow",
    );
  }
  assert.equal(step.step, "Abandoned");
  assert.equal(polls, operationAttemptsMax);
});

test("a vanished or faulted operation stops being followed", () => {
  const following = operationAdvanced(operationSubmitting(4), {
    event: "Accepted",
    operation: "o1",
    state: "Pending",
  });
  assert.equal(
    operationAdvanced(following, { event: "Absent" }).step,
    "Abandoned",
  );
  assert.equal(
    operationAdvanced(following, {
      event: "Faulted",
      reason: "the read failed",
    }).step,
    "Abandoned",
  );
});

test("a poll before acceptance is abandoned rather than silently followed", () => {
  const step = operationAdvanced(operationSubmitting(4), {
    event: "Polled",
    state: "Pending",
    refusalCode: undefined,
  });
  assert.equal(step.step, "Abandoned");
});
