/**
 * What an abandoned follow says: one word for each cause, drawn the same in
 * every place that draws a follow, and never a term of the machinery behind
 * it. A refusal keeps the code it was answered with, for its hover.
 */

import { expect, test } from "vitest";

import { nativeHttpMediaType } from "../../../src/contract/http.ts";
import type { ApiFailure, ApiPorts } from "../app/core/apiRequest.ts";
import {
  operationAbandonWords,
  operationStepLabel,
} from "../app/core/codeLabels.ts";
import {
  inboxAnswerRefusal,
  inboxStepDetail,
  inboxStepSentence,
} from "../app/core/inboxAnswers.ts";
import {
  followOperation,
  operationAbandonFailure,
  operationAbandoned,
  operationAdvanced,
  operationAttemptsMax,
  operationFollowing,
  operationSubmitting,
} from "../app/core/operationFollow.ts";
import type {
  OperationAbandonCause,
  OperationEvent,
  OperationStep,
} from "../app/core/operationFollow.ts";
import { parkedOverridesRefusal } from "../app/core/parkedOverrides.ts";
import { creationStepSentence } from "../app/core/ticketCreation.ts";

const failures: readonly ApiFailure[] = [
  { outcome: "Unauthenticated" },
  { outcome: "Absent" },
  { outcome: "Conflict", code: "TicketVersionStale", body: {} },
  { outcome: "Retryable", code: "DispatchBacklog", retryAfterSeconds: 1 },
  { outcome: "Rejected", code: "Invalid", status: 400, body: {} },
  { outcome: "Fault", code: "InternalError", status: 500 },
  { outcome: "Unreachable", reason: "the API could not be reached" },
  { outcome: "Unreadable", reason: "the actor's answer would not parse" },
];

/** One of every cause, keyed by its type so that a cause gained is a cause
 * this table does not compile without. */
const causeOfEveryType = {
  Deferred: { type: "Deferred" },
  Pending: { type: "Pending" },
  Unaccepted: { type: "Unaccepted" },
  Behind: { type: "Behind" },
  OutOfOrder: { type: "OutOfOrder" },
  Overstepped: { type: "Overstepped" },
  Failed: { type: "Failed", failure: { outcome: "Absent" } },
  Thrown: { type: "Thrown", reason: "the projection budget ran out" },
} as const satisfies {
  readonly [T in OperationAbandonCause["type"]]: OperationAbandonCause & {
    readonly type: T;
  };
};

const causes: readonly OperationAbandonCause[] = [
  ...Object.values(causeOfEveryType),
  ...failures.map((failure) => ({ type: "Failed" as const, failure })),
];

function repeated(
  from: OperationStep,
  event: OperationEvent,
  times: number,
): OperationStep {
  let step = from;
  for (let turn = 0; turn < times; turn += 1)
    step = operationAdvanced(step, event);
  return step;
}

/** A submission the API never names, made again at every poll until the
 * budget runs out. */
function neverAccepted(): OperationStep {
  let step = operationFollowing("op-1");
  for (
    let turn = 0;
    turn < operationAttemptsMax && step.step === "Following";
    turn += 1
  ) {
    step = operationAdvanced(step, { event: "Unaccepted" });
    if (step.step === "Submitting")
      step = operationAdvanced(step, { event: "Accepted", operation: "op-1" });
  }
  return step;
}

const confirming: OperationStep = {
  step: "Confirming",
  operation: "op-1",
  minimumSequence: 9,
  attempts: 0,
};

/** Every abandonment the machine reaches by its own steps. */
const abandonedByTheMachine: readonly OperationStep[] = [
  repeated(
    operationSubmitting(),
    { event: "Deferred", code: "DispatchBacklog", retryAfterSeconds: 1 },
    operationAttemptsMax,
  ),
  repeated(
    operationFollowing("op-1"),
    {
      event: "Polled",
      operation: {
        operation: "op-1",
        acceptedAt: "2026-08-26T00:00:00Z",
        state: "Pending",
      },
    },
    operationAttemptsMax,
  ),
  neverAccepted(),
  repeated(confirming, { event: "Behind" }, operationAttemptsMax),
  operationAdvanced(operationSubmitting(), { event: "Confirmed" }),
  operationAdvanced(operationSubmitting(), { event: "Behind" }),
  operationAdvanced(operationSubmitting(), { event: "Unaccepted" }),
  ...failures.map((failure) =>
    operationAdvanced(operationSubmitting(), { event: "Refused", failure }),
  ),
];

const abandonedSteps: readonly OperationStep[] = [
  ...abandonedByTheMachine,
  ...causes.map((cause) => operationAbandoned(cause)),
];

/** Every line drawn for a step, in every place that draws one. */
function linesDrawn(step: OperationStep): readonly string[] {
  return [
    operationStepLabel(step, "Resume").text,
    inboxStepSentence(step),
    inboxAnswerRefusal(step) ?? "",
    parkedOverridesRefusal(step) ?? "",
    creationStepSentence(step),
    creationStepSentence(step, "Update"),
  ];
}

test("every abandon cause has a word of at most two words", () => {
  for (const cause of causes) {
    const { word } = operationAbandonWords(cause);
    expect(word.trim()).not.toBe("");
    expect(word.split(" ").length).toBeLessThanOrEqual(2);
  }
});

test("the machine abandons each wait in that wait's word", () => {
  expect(
    abandonedByTheMachine
      .slice(0, 7)
      .map((step) => operationStepLabel(step, "Resume").text),
  ).toStrictEqual([
    "Busy",
    "Still pending",
    "Not accepted",
    "Still updating",
    "Status unknown",
    "Status unknown",
    "Status unknown",
  ]);
});

test("no line drawn for an abandoned follow carries the API, the projection, a budget or the actor", () => {
  for (const step of abandonedSteps) {
    expect(step.step).toBe("Abandoned");
    for (const line of linesDrawn(step))
      expect(line).not.toMatch(/\bAPI\b|projection|budget|actor/iu);
  }
});

test("an inbox answer under way is one word at each step", () => {
  const underWay: readonly OperationStep[] = [
    operationSubmitting(),
    {
      step: "Backlogged",
      code: "DispatchBacklog",
      retryAfterSeconds: 1,
      attempts: 1,
    },
    operationFollowing("op-1"),
    confirming,
  ];
  expect(underWay.map(inboxStepSentence)).toStrictEqual([
    "Submitting",
    "Busy",
    "Waiting",
    "Updating",
  ]);
});

test("a thrown follow says one word, and its message is only the detail", () => {
  const step = operationAbandoned({
    type: "Thrown",
    reason: "the clock stopped",
  });
  expect(operationStepLabel(step, "Resume")).toStrictEqual({
    text: "Failed",
    detail: "the clock stopped",
    settled: true,
    wrong: true,
  });
  expect(inboxStepDetail(step)).toBe("the clock stopped");
  expect(operationAbandonFailure(step)).toBeUndefined();
});

function refusingPorts(): ApiPorts {
  return {
    fetch: () =>
      Promise.resolve({
        status: 409,
        headers: { get: () => nativeHttpMediaType },
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { code: "TicketVersionStale" } }),
          ),
      } as unknown as Response),
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
}

test("a refused submission is still refused, and keeps its code for the hover", async () => {
  const followed = await followOperation(
    refusingPorts(),
    { tenant: "acme", project: "atlas" },
    {
      operation: "op-1",
      mutation: { mutation: "RevokeTicket", ticket: 2 },
    },
    2,
    () => undefined,
  );
  const step = followed.step;
  expect(step).toMatchObject({ step: "Abandoned", refused: true });
  expect(operationAbandonFailure(step)).toMatchObject({
    outcome: "Conflict",
    code: "TicketVersionStale",
  });
  expect(operationStepLabel(step, "Revoke")).toMatchObject({
    text: "Refused",
    detail: "TicketVersionStale",
  });
  expect(inboxStepDetail(step)).toBe("TicketVersionStale");
  for (const line of linesDrawn(step))
    expect(line).not.toContain("TicketVersionStale");
});
