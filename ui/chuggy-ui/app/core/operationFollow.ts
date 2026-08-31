/**
 * Following a submitted mutation from its acceptance to a ticket this page can
 * read its own write in.
 *
 * The machine is a pure step over what the last request answered, and the
 * runner below owns the requests and the waiting. ONE ATTEMPT BUDGET SPANS THE
 * WHOLE FOLLOW: a server that keeps deferring the submission, an operation that
 * stays pending, and a projection that has not reached the decided sequence all
 * draw from the same count, so every way of not finishing ends in a state a
 * screen can draw rather than in a loop. The confirmation is a step of the
 * machine and not a second loop after it, because a bound nobody shares is a
 * bound somebody forgets.
 */

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import type {
  OperationRefusalCode,
  OperationState,
} from "../../../../src/contract/rosters.ts";
import type { submissionSchema } from "../../../../src/contract/requests.ts";
import type {
  OperationResponse,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { z } from "zod";

import { apiOperation, apiProject, apiSubmitOperation } from "./apiRoutes.ts";
import type { ProjectPage } from "./apiRoutes.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { operationFailureSentence } from "./codeSentences.ts";

/** How much entropy an operation identity is drawn with. It is also the
 * idempotency key the route refuses a submission without, so every screen that
 * builds one draws it the same size. */
export const operationIdBytesCount = 16;

export const operationAttemptsMax = 40;
export const operationPollIntervalMs = 1_000;

/** The steps a follow may take, which the budget alone can never bound. */
export const operationStepsMax = operationAttemptsMax * 2 + 4;

export type OperationSubmission = z.infer<typeof submissionSchema>;

export type OperationStep =
  | { readonly step: "Submitting"; readonly attempts: number }
  | {
      readonly step: "Backlogged";
      readonly code: string;
      readonly retryAfterSeconds: number;
      readonly attempts: number;
    }
  | {
      readonly step: "Following";
      readonly operation: string;
      readonly attempts: number;
    }
  | {
      readonly step: "Confirming";
      readonly operation: string;
      readonly minimumSequence: number;
      readonly attempts: number;
    }
  | {
      readonly step: "Settled";
      readonly operation: string;
      readonly state: OperationState;
      readonly refusalCode: OperationRefusalCode | undefined;
    }
  | { readonly step: "Abandoned"; readonly reason: string };

export type OperationEvent =
  | { readonly event: "Accepted"; readonly operation: string }
  | {
      readonly event: "Deferred";
      readonly code: string;
      readonly retryAfterSeconds: number;
    }
  | { readonly event: "Polled"; readonly operation: OperationResponse }
  | { readonly event: "Confirmed" }
  | { readonly event: "Behind" }
  | { readonly event: "Faulted"; readonly reason: string };

/** What the caller does next for this step, and nothing about how. */
export type OperationRequest = "Submit" | "Poll" | "Confirm";

export function operationSubmitting(): OperationStep {
  return { step: "Submitting", attempts: 0 };
}

/**
 * Where a follow begins when the submission was already accepted: a screen
 * before this one made it, so this one polls rather than submits. Resubmitting
 * the same identity would answer `IdempotencyConflict` and disclose no
 * operation, which is why picking the accepted one back up is the only way to
 * follow it.
 */
export function operationFollowing(operation: string): OperationStep {
  return { step: "Following", operation, attempts: 0 };
}

export function operationRequest(
  step: OperationStep,
): OperationRequest | undefined {
  switch (step.step) {
    case "Submitting":
    case "Backlogged":
      return "Submit";
    case "Following":
      return "Poll";
    case "Confirming":
      return "Confirm";
    case "Settled":
    case "Abandoned":
      return undefined;
  }
}

/** A follow with nothing left to do, whichever of the two ways it ended. */
export function operationFinished(
  step: OperationStep,
): step is Extract<OperationStep, { readonly step: "Settled" | "Abandoned" }> {
  return step.step === "Settled" || step.step === "Abandoned";
}

/** The budget a step has spent; a finished follow has none left to spend. */
function operationAttempts(step: OperationStep): number {
  return operationFinished(step) ? 0 : step.attempts;
}

function operationAbandoned(reason: string): OperationStep {
  return { step: "Abandoned", reason };
}

function operationSettled(
  operation: string,
  answered: OperationResponse,
): OperationStep {
  return {
    step: "Settled",
    operation,
    state: answered.state,
    refusalCode: answered.state === "Refused" ? answered.code : undefined,
  };
}

/** One more turn of the same wait, or the end of the budget that allowed it. */
function operationSpent(
  step: OperationStep,
  exhausted: string,
  next: (attempts: number) => OperationStep,
): OperationStep {
  const attempts = operationAttempts(step) + 1;
  return attempts >= operationAttemptsMax
    ? operationAbandoned(exhausted)
    : next(attempts);
}

function operationDeferred(
  step: OperationStep,
  event: Extract<OperationEvent, { event: "Deferred" }>,
): OperationStep {
  return operationSpent(
    step,
    "the API is still deferring this submission after the attempt budget",
    (attempts) => ({
      step: "Backlogged",
      code: event.code,
      retryAfterSeconds: event.retryAfterSeconds,
      attempts,
    }),
  );
}

function operationPolled(
  step: OperationStep,
  answered: OperationResponse,
): OperationStep {
  if (step.step !== "Following")
    return operationAbandoned(
      "a poll arrived before the operation was accepted",
    );
  const operation = step.operation;
  if (answered.state === "Succeeded")
    return {
      step: "Confirming",
      operation,
      minimumSequence: answered.decidedSequence,
      attempts: step.attempts,
    };
  if (answered.state !== "Pending")
    return operationSettled(operation, answered);
  return operationSpent(
    step,
    "the operation is still pending after the attempt budget",
    (attempts) => ({ step: "Following", operation, attempts }),
  );
}

function operationBehind(step: OperationStep): OperationStep {
  if (step.step !== "Confirming")
    return operationAbandoned(
      "a projection answered before a decision was made",
    );
  const { operation, minimumSequence } = step;
  return operationSpent(
    step,
    "the projection has not reached the decided sequence within the attempt budget",
    (attempts) => ({
      step: "Confirming",
      operation,
      minimumSequence,
      attempts,
    }),
  );
}

function operationConfirmed(step: OperationStep): OperationStep {
  if (step.step !== "Confirming")
    return operationAbandoned(
      "a confirmation arrived before a decision was made",
    );
  return {
    step: "Settled",
    operation: step.operation,
    state: "Succeeded",
    refusalCode: undefined,
  };
}

export function operationAdvanced(
  step: OperationStep,
  event: OperationEvent,
): OperationStep {
  switch (event.event) {
    case "Accepted":
      return {
        step: "Following",
        operation: event.operation,
        attempts: operationAttempts(step),
      };
    case "Deferred":
      return operationDeferred(step, event);
    case "Polled":
      return operationPolled(step, event.operation);
    case "Confirmed":
      return operationConfirmed(step);
    case "Behind":
      return operationBehind(step);
    case "Faulted":
      return operationAbandoned(event.reason);
  }
}

/** What the follow learned about the ticket it moved, once it moved it. */
export interface OperationFollowed {
  readonly step: OperationStep;
  readonly ticket: TicketResponse | undefined;
}

function operationEventOf<T>(
  result: ApiResult<T>,
  accepted: (value: T) => OperationEvent,
): OperationEvent {
  if (result.outcome === "Ok") return accepted(result.value);
  if (result.outcome === "Retryable")
    return {
      event: "Deferred",
      code: result.code,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  return { event: "Faulted", reason: operationFailureSentence(result) };
}

/**
 * What the confirmation's answer does to the ticket the page is already
 * holding. The project row is a narrower projection than the ticket's own read
 * — it carries no `brief` — so the field the row cannot carry survives, and a
 * row older than what a live frame has already written is dropped, because the
 * frames are the only other writer and they arrive in sequence order.
 */
export function ticketConfirmed(
  held: TicketResponse | undefined,
  confirmed: TicketResponse,
): TicketResponse {
  if (held === undefined) return confirmed;
  if (held.sequence > confirmed.sequence) return held;
  return {
    ...confirmed,
    ...(confirmed.brief === undefined && held.brief !== undefined
      ? { brief: held.brief }
      : {}),
  };
}

/** The route's `after` is exclusive and names a ticket, so the first has none. */
export function operationConfirmationPage(
  ticket: number,
  minimumSequence: number,
): ProjectPage {
  return {
    ...(ticket > 1 ? { after: ticket - 1 } : {}),
    limit: 1,
    minimumSequence,
  };
}

/**
 * The projection read that makes the page read its own write: one ticket, at a
 * head no lower than the sequence the decision was recorded at.
 */
async function operationConfirmation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  minimumSequence: number,
  signal: AbortSignal | undefined,
): Promise<{
  readonly event: OperationEvent;
  readonly ticket?: TicketResponse;
}> {
  const answered = await apiProject(
    ports,
    partition,
    operationConfirmationPage(ticket, minimumSequence),
    signal,
  );
  if (answered.outcome === "Conflict") return { event: { event: "Behind" } };
  const event = operationEventOf(answered, () => ({ event: "Confirmed" }));
  if (answered.outcome !== "Ok") return { event };
  const found = answered.value.tickets.find((row) => row.ticket === ticket);
  return found === undefined
    ? {
        event: {
          event: "Faulted",
          reason: "the project no longer lists this ticket",
        },
      }
    : { event, ticket: found };
}

interface OperationTurn {
  readonly event: OperationEvent;
  readonly ticket?: TicketResponse;
}

async function operationTurn(
  ports: ApiPorts,
  partition: PartitionIdentity,
  submission: OperationSubmission,
  ticket: number,
  step: OperationStep,
  signal: AbortSignal | undefined,
): Promise<OperationTurn> {
  const request = operationRequest(step);
  if (request === "Submit") {
    const answered = await apiSubmitOperation(
      ports,
      partition,
      submission,
      signal,
    );
    return {
      event: operationEventOf(answered, (value) => ({
        event: "Accepted",
        operation: value.operation,
      })),
    };
  }
  if (request === "Poll" && step.step === "Following") {
    const answered = await apiOperation(
      ports,
      partition,
      step.operation,
      signal,
    );
    return {
      event: operationEventOf(answered, (value) => ({
        event: "Polled",
        operation: value,
      })),
    };
  }
  if (request === "Confirm" && step.step === "Confirming")
    return operationConfirmation(
      ports,
      partition,
      ticket,
      step.minimumSequence,
      signal,
    );
  return {
    event: {
      event: "Faulted",
      reason: "the follow reached a step with no request",
    },
  };
}

/** The wait precedes the request the CURRENT step will make, so it is read
 * from that step and never from the one it replaced. */
function operationWaitMs(step: OperationStep): number {
  return step.step === "Backlogged"
    ? step.retryAfterSeconds * 1_000
    : operationPollIntervalMs;
}

/**
 * The whole follow: submit, poll to settlement, confirm the projection, and
 * report every step it passed through so a screen can say where it is. It
 * begins at the submission unless the caller names a step it already reached,
 * and the budget is that step's, so a picked-up follow is bounded like any
 * other.
 */
export async function followOperation(
  ports: ApiPorts,
  partition: PartitionIdentity,
  submission: OperationSubmission,
  ticket: number,
  onStep: (step: OperationStep) => void,
  signal?: AbortSignal,
  startedFrom: OperationStep = operationSubmitting(),
): Promise<OperationFollowed> {
  let step = startedFrom;
  let confirmed: TicketResponse | undefined;
  onStep(step);
  for (let taken = 0; taken < operationStepsMax; taken += 1) {
    if (operationRequest(step) === undefined)
      return { step, ticket: confirmed };
    const turn = await operationTurn(
      ports,
      partition,
      submission,
      ticket,
      step,
      signal,
    );
    if (turn.ticket !== undefined) confirmed = turn.ticket;
    step = operationAdvanced(step, turn.event);
    onStep(step);
    if (operationRequest(step) === undefined)
      return { step, ticket: confirmed };
    try {
      await ports.sleepMs(operationWaitMs(step), signal);
    } catch {
      const abandoned = operationAbandoned(
        "the screen that asked for this is gone",
      );
      onStep(abandoned);
      return { step: abandoned, ticket: confirmed };
    }
  }
  const exhausted = operationAbandoned(
    "the follow took more steps than it is allowed to take",
  );
  onStep(exhausted);
  return { step: exhausted, ticket: confirmed };
}
