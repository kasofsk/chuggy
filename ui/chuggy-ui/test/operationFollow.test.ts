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
  operationAttemptsMax,
  operationConfirmationPage,
  operationRequest,
  operationSubmitting,
  ticketConfirmed,
} from "../app/core/operationFollow.ts";
import type {
  OperationEvent,
  OperationStep,
} from "../app/core/operationFollow.ts";
import { ticketInstants } from "./ticketInstants.ts";

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
        code: "NotEnabled",
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
    refusalCode: undefined,
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

test("a confirmation keeps the fields the project row does not carry", () => {
  const brief = { intent: "ship it", links: [] };
  expect(
    ticketConfirmed(
      { ticket: 7, phase: "Escalated", sequence: 4, brief, ...ticketInstants },
      { ticket: 7, phase: "Working", sequence: 9, ...ticketInstants },
    ),
  ).toEqual({
    ticket: 7,
    phase: "Working",
    sequence: 9,
    brief,
    ...ticketInstants,
  });
});

test("a confirmation drops the fields the project row supersedes", () => {
  expect(
    ticketConfirmed(
      {
        ticket: 7,
        phase: "Escalated",
        sequence: 4,
        reason: "WorkFailed",
        ...ticketInstants,
      },
      { ticket: 7, phase: "Working", sequence: 9, ...ticketInstants },
    ).reason,
  ).toBeUndefined();
});

test("a confirmation older than what is held does not put it back", () => {
  const newer = {
    ticket: 7,
    phase: "Done",
    sequence: 12,
    ...ticketInstants,
  } as const;
  expect(
    ticketConfirmed(newer, {
      ticket: 7,
      phase: "Working",
      sequence: 9,
      ...ticketInstants,
    }),
  ).toBe(newer);
});

test("a confirmation at the same sequence is written, not dropped", () => {
  expect(
    ticketConfirmed(
      { ticket: 7, phase: "Working", sequence: 9, ...ticketInstants },
      { ticket: 7, phase: "Done", sequence: 9, ...ticketInstants },
    ).phase,
  ).toBe("Done");
});

test("a confirmation with nothing held is what the page reads", () => {
  const confirmed = {
    ticket: 7,
    phase: "Done",
    sequence: 9,
    ...ticketInstants,
  } as const;
  expect(ticketConfirmed(undefined, confirmed)).toBe(confirmed);
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
