/**
 * The operation machine's transitions and the one budget they all draw from.
 *
 * The budget is the part that goes wrong quietly: a step that forgets to spend
 * it turns a server which never settles into a tab that polls forever, and a
 * screen showing "waiting" is what that looks like from outside.
 */

import { expect, test } from "vitest";

import {
  operationAdvanced,
  operationAttemptsMax,
  operationRequest,
  operationSubmitting,
} from "../app/core/operationFollow.ts";
import type {
  OperationEvent,
  OperationStep,
} from "../app/core/operationFollow.ts";

const acceptedAt = "2026-08-26T00:00:00Z";

function advancedThrough(
  step: OperationStep,
  events: readonly OperationEvent[],
): OperationStep {
  return events.reduce(operationAdvanced, step);
}

function repeated(event: OperationEvent, times: number): OperationEvent[] {
  return Array.from({ length: times }, () => event);
}

const deferred: OperationEvent = {
  event: "Deferred",
  code: "DispatchBacklog",
  retryAfterSeconds: 2,
};

const stillPending: OperationEvent = {
  event: "Polled",
  operation: { operation: "op-1", acceptedAt, state: "Pending" },
};

test("a submission waits on the operation the acceptance names", () => {
  const step = operationAdvanced(operationSubmitting(), {
    event: "Accepted",
    operation: "op-1",
  });
  expect(step).toEqual({ step: "Following", operation: "op-1", attempts: 0 });
  expect(operationRequest(step)).toBe("Poll");
});

test("a deferral is resubmitted with the wait the API asked for", () => {
  const step = operationAdvanced(operationSubmitting(), deferred);
  expect(step).toEqual({
    step: "Backlogged",
    code: "DispatchBacklog",
    retryAfterSeconds: 2,
    attempts: 1,
  });
  expect(operationRequest(step)).toBe("Submit");
});

test("a success is not settled until the projection has caught up", () => {
  const following = advancedThrough(operationSubmitting(), [
    { event: "Accepted", operation: "op-1" },
  ]);
  const confirming = operationAdvanced(following, {
    event: "Polled",
    operation: {
      operation: "op-1",
      acceptedAt,
      state: "Succeeded",
      decidedSequence: 91,
    },
  });
  expect(confirming).toEqual({
    step: "Confirming",
    operation: "op-1",
    minimumSequence: 91,
    attempts: 0,
  });
  expect(operationRequest(confirming)).toBe("Confirm");
  expect(operationAdvanced(confirming, { event: "Confirmed" })).toEqual({
    step: "Settled",
    operation: "op-1",
    state: "Succeeded",
    refusalCode: undefined,
  });
});

test("a refusal settles carrying the code that explains it", () => {
  const following = operationAdvanced(operationSubmitting(), {
    event: "Accepted",
    operation: "op-1",
  });
  expect(
    operationAdvanced(following, {
      event: "Polled",
      operation: {
        operation: "op-1",
        acceptedAt,
        state: "Refused",
        code: "NotEnabled",
        refusedHead: 4,
        refusedLifecycleGeneration: 1,
      },
    }),
  ).toEqual({
    step: "Settled",
    operation: "op-1",
    state: "Refused",
    refusalCode: "NotEnabled",
  });
});

test("a server that keeps deferring is abandoned at the budget", () => {
  const step = advancedThrough(
    operationSubmitting(),
    repeated(deferred, operationAttemptsMax),
  );
  expect(step.step).toBe("Abandoned");
  expect(operationRequest(step)).toBeUndefined();
});

test("an operation that stays pending is abandoned at the same budget", () => {
  const following = operationAdvanced(operationSubmitting(), {
    event: "Accepted",
    operation: "op-1",
  });
  const short = advancedThrough(
    following,
    repeated(stillPending, operationAttemptsMax - 1),
  );
  expect(short.step).toBe("Following");
  expect(operationAdvanced(short, stillPending).step).toBe("Abandoned");
});

test("deferring and polling draw from one budget, not two", () => {
  const spent = Math.floor(operationAttemptsMax / 2);
  const backlogged = advancedThrough(
    operationSubmitting(),
    repeated(deferred, spent),
  );
  const following = operationAdvanced(backlogged, {
    event: "Accepted",
    operation: "op-1",
  });
  const step = advancedThrough(
    following,
    repeated(stillPending, operationAttemptsMax - spent),
  );
  expect(step.step).toBe("Abandoned");
});

test("a projection that stays behind is abandoned rather than polled forever", () => {
  const confirming: OperationStep = {
    step: "Confirming",
    operation: "op-1",
    minimumSequence: 91,
    attempts: 0,
  };
  const short = advancedThrough(
    confirming,
    repeated({ event: "Behind" }, operationAttemptsMax - 1),
  );
  expect(short.step).toBe("Confirming");
  expect(operationAdvanced(short, { event: "Behind" }).step).toBe("Abandoned");
});

test("an answer arriving out of order is abandoned, never mistaken for one", () => {
  expect(operationAdvanced(operationSubmitting(), stillPending).step).toBe(
    "Abandoned",
  );
  expect(
    operationAdvanced(operationSubmitting(), { event: "Confirmed" }).step,
  ).toBe("Abandoned");
  expect(
    operationAdvanced(operationSubmitting(), { event: "Behind" }).step,
  ).toBe("Abandoned");
});

test("a fault carries its own reason and asks for nothing further", () => {
  const step = operationAdvanced(operationSubmitting(), {
    event: "Faulted",
    reason: "the API could not be reached",
  });
  expect(step).toEqual({
    step: "Abandoned",
    reason: "the API could not be reached",
  });
  expect(operationRequest(step)).toBeUndefined();
});
