/**
 * The operation machine's transitions and the one budget they all draw from.
 *
 * The budget is the part that goes wrong quietly: a step that forgets to spend
 * it turns a server which never settles into a tab that polls forever, and a
 * screen showing "waiting" is what that looks like from outside.
 */

import { expect, test } from "vitest";

import { operationStates } from "../../../src/contract/rosters.ts";
import type { OperationState } from "../../../src/contract/rosters.ts";
import type { OperationResponse } from "../../../src/contract/responses.ts";
import {
  operationAdvanced,
  operationAnswered,
  operationAttemptsMax,
  operationConfirmationPage,
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
    refusal: undefined,
  });
});

test("a refusal settles carrying the code and the refusal that explain it", () => {
  const following = operationAdvanced(operationSubmitting(), {
    event: "Accepted",
    operation: "op-1",
  });
  const refusal = {
    type: "DependenciesIncomplete" as const,
    value: { ticket: 3, dependencies: [2] },
  };
  expect(
    operationAdvanced(following, {
      event: "Polled",
      operation: {
        operation: "op-1",
        acceptedAt,
        state: "Refused",
        code: "DependenciesIncomplete",
        refusal,
        refusedHead: 4,
        refusedLifecycleGeneration: 1,
      },
    }),
  ).toEqual({
    step: "Settled",
    operation: "op-1",
    state: "Refused",
    refusal,
  });
});

test("a refusal the boundary decided settles carrying its code alone", () => {
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
        code: "TicketChanged",
        refusedHead: 4,
        refusedLifecycleGeneration: 1,
      },
    }),
  ).toEqual({
    step: "Settled",
    operation: "op-1",
    state: "Refused",
    refusal: { type: "TicketChanged" },
  });
});

/** Each state as the wire's own union writes it, so every arm is polled. */
function answered(state: OperationState): OperationResponse {
  const identity = { operation: "op-1", acceptedAt };
  switch (state) {
    case "Pending":
      return { ...identity, state };
    case "Succeeded":
      return { ...identity, state, decidedSequence: 91 };
    case "Refused":
      return {
        ...identity,
        state,
        code: "TicketChanged",
        refusedHead: 4,
        refusedLifecycleGeneration: 1,
      };
    case "Answered":
    case "Cancelled":
      return { ...identity, state };
  }
}

test("every operation state the wire has is polled, and only Pending waits", () => {
  const following = operationAdvanced(operationSubmitting(), {
    event: "Accepted",
    operation: "op-1",
  });
  for (const state of operationStates) {
    const step = operationAdvanced(following, {
      event: "Polled",
      operation: answered(state),
    });
    if (state === "Pending") expect(step.step).toBe("Following");
    else if (state === "Succeeded") expect(step.step).toBe("Confirming");
    else expect(step).toMatchObject({ step: "Settled", state });
  }
});

test("a cancelled operation settles as cancelled and asks for nothing more", () => {
  const following = operationAdvanced(operationSubmitting(), {
    event: "Accepted",
    operation: "op-1",
  });
  const step = operationAdvanced(following, {
    event: "Polled",
    operation: answered("Cancelled"),
  });
  expect(step).toEqual({
    step: "Settled",
    operation: "op-1",
    state: "Cancelled",
    refusal: undefined,
  });
  expect(operationRequest(step)).toBeUndefined();
});

test("the confirmation addresses the first ticket without an exclusive cursor", () => {
  expect(operationConfirmationPage(1, 91)).toEqual({
    limit: 1,
    minimumSequence: 91,
  });
  expect(operationConfirmationPage(2, 91)).toEqual({
    after: 1,
    limit: 1,
    minimumSequence: 91,
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
    refused: false,
  });
  expect(operationRequest(step)).toBeUndefined();
  expect(operationAnswered(step)).toBe(false);
});

/** The two ways a follow ends without an operation to show for it, which a
 * screen holding the identity must tell apart: the API declining to make one,
 * and the console never learning whether it did. */
test("only a refusal says the identity will never be an operation", () => {
  const refused = operationAdvanced(operationSubmitting(), {
    event: "Refused",
    reason: "the ticket has moved on",
  });
  expect(refused).toEqual({
    step: "Abandoned",
    reason: "the ticket has moved on",
    refused: true,
  });
  expect(operationAnswered(refused)).toBe(true);
  expect(operationRequest(refused)).toBeUndefined();
});
