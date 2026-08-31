/**
 * The short labels the ledger page draws the wire's codes in.
 *
 * Every roster is walked, and each answer is held to the copy standard the
 * page is written to: a label is a noun phrase, a status is one or two words,
 * and nothing but a brief runs past the budget. A fallback is checked as a
 * fallback, because a code the console does not know must read as unknown
 * rather than as an explanation.
 */

import { expect, test } from "vitest";

import {
  escalationReasons,
  operationRefusalCodes,
  operationStates,
  phaseRoster,
} from "../../../src/contract/rosters.ts";
import {
  escalationDetailLine,
  escalationReasonLabel,
  mutationDeferralLabel,
  mutationRefusalLabel,
  operationFailureLabel,
  operationRefusalLabel,
  operationStateLabel,
  operationStepLabel,
  phaseLabel,
  ticketActionEffect,
} from "../app/core/codeLabels.ts";
import { mutationRefusalCodes } from "../app/core/codeSentences.ts";
import { resumeGasCharge } from "../app/core/resumePoint.ts";
import type { TicketActionName } from "../app/core/ticketActions.ts";

const ticketActionNames: readonly TicketActionName[] = [
  "Dispatch",
  "Resume",
  "Revoke",
  "Retry",
  "Abandon",
  "Approve",
  "Decline",
];

/** §1.1 rule 7: no string the console draws runs past this, except the brief. */
const copyBudgetChars = 60;

test("every wall, phase, state and refusal has a label inside the copy budget", () => {
  const drawn = [
    ...escalationReasons.map(escalationReasonLabel),
    ...phaseRoster.map(phaseLabel),
    ...operationStates.map(operationStateLabel),
    ...operationRefusalCodes.map(operationRefusalLabel),
    ...mutationRefusalCodes.map(mutationRefusalLabel),
  ];
  for (const label of drawn) {
    expect(label.length).toBeGreaterThan(0);
    expect(label.length).toBeLessThanOrEqual(copyBudgetChars);
    expect(label).not.toMatch(/[.:;]/u);
  }
});

test("the wall a reader met on ticket 21 reads as a noun and a fragment", () => {
  expect(escalationReasonLabel("ReworkBudgetExhausted")).toBe(
    "Rework budget exhausted",
  );
  expect(
    escalationDetailLine("ReworkBudgetExhausted", {
      lastSet: { taskKind: "Evaluation", stage: 0, verdict: "Failed" },
      stageCount: 2,
      reworkMax: 2,
      finalizationMax: undefined,
    }),
  ).toBe("Stage 1 of 2 failed · Rework 2/2 used");
});

test("a detail line names only the facts the page holds", () => {
  const bare = {
    lastSet: undefined,
    stageCount: 2,
    reworkMax: undefined,
    finalizationMax: undefined,
  };
  expect(escalationDetailLine("ReworkBudgetExhausted", bare)).toBe(undefined);
  expect(escalationDetailLine("GasExhausted", bare)).toBe(
    "Finalization failed",
  );
  expect(escalationDetailLine("DependencyRevoked", bare)).toBe(
    "Only Revoke exits this wall",
  );
  expect(escalationDetailLine("WorkFailed", bare)).toBe(
    "Failed work is not reworked",
  );
});

test("a resume states what it re-runs, what it costs, and what it keeps", () => {
  const effect = ticketActionEffect(
    "Resume",
    {
      point: "ResumeEvaluating",
      reruns: "evaluation",
      fromStage: 0,
      ofStages: 2,
      cost: 1,
    },
    { left: 0, max: 2 },
  );
  expect(effect.effect).toBe("Re-runs evaluation from stage 1");
  expect(effect.cost).toBe("costs 1 gas");
  expect(effect.more).toBe("Keeps the current artifact · rework stays 0/2");
});

/**
 * The rework wall buys a work cycle with the account refilled, and entry to
 * Working always meters — one gas under either pricing (`model/domain.qnt`,
 * `resumeCharge`).
 */
test("a rework-wall resume says it reworks, refills and charges", () => {
  const effect = ticketActionEffect(
    "Resume",
    {
      point: "ResumeReworking",
      reruns: "work",
      fromStage: undefined,
      ofStages: undefined,
      cost: resumeGasCharge("ResumeReworking", "RetryFree"),
    },
    { left: 0, max: 2 },
  );
  expect(effect.effect).toBe("Reworks · new artifact, rework refilled");
  expect(effect.cost).toBe("costs 1 gas");
  expect(effect.more).toBe("Rework returns to 0/2");
});

test("a wall with no resume point offers nothing and says which exit is left", () => {
  const effect = ticketActionEffect("Resume", undefined, undefined);
  expect(effect.effect).toBe("Nothing to resume");
  expect(effect.more).toBe("only Revoke exits this wall");
  expect(effect.offered).toBe(false);
  expect(ticketActionEffect("Revoke", undefined, undefined).cost).toBe("free");
});

/**
 * `DependencyRevoked` is the wall the model stamps no resume point on, and a
 * resume is the one answer that must not be offered into it.
 */
test("every action the phase enables is offered, except a resume with no point", () => {
  const resume = {
    point: "ResumeEvaluating",
    reruns: "evaluation",
    fromStage: 0,
    ofStages: 2,
    cost: 1,
  } as const;
  for (const action of ticketActionNames)
    expect(ticketActionEffect(action, resume, undefined).offered).toBe(true);
  for (const action of ticketActionNames)
    expect(ticketActionEffect(action, undefined, undefined).offered).toBe(
      action !== "Resume",
    );
});

test("a deferral and a failure this console does not know name themselves", () => {
  expect(mutationDeferralLabel("DispatchBacklog")).toBe("Dispatch backlog");
  expect(mutationDeferralLabel("Whatever")).toBe("Deferred (Whatever)");
  expect(
    operationFailureLabel({ outcome: "Unreachable", reason: "network" }),
  ).toBe("API unreachable · network");
  expect(
    operationFailureLabel({
      outcome: "Rejected",
      code: "NotEnabled",
      status: 409,
      body: undefined,
    }),
  ).toBe("Not allowed in this phase");
  expect(
    operationFailureLabel({
      outcome: "Rejected",
      code: "Nope",
      status: 409,
      body: undefined,
    }),
  ).toBe("Refused (Nope)");
});

test("every step of a follow draws one line, and only a settled one stops", () => {
  expect(
    operationStepLabel({ step: "Submitting", attempts: 1 }, "Resume"),
  ).toEqual({ text: "Submitting…", settled: false, wrong: false });
  expect(
    operationStepLabel(
      { step: "Confirming", operation: "o", minimumSequence: 169, attempts: 1 },
      "Resume",
    ).text,
  ).toBe("Syncing to seq 169…");
  const accepted = operationStepLabel(
    {
      step: "Settled",
      operation: "o",
      state: "Succeeded",
      refusalCode: undefined,
    },
    "Resume",
  );
  expect(accepted).toEqual({
    text: "Resume accepted",
    settled: true,
    wrong: false,
  });
  const refused = operationStepLabel(
    {
      step: "Settled",
      operation: "o",
      state: "Refused",
      refusalCode: "TicketChanged",
    },
    "Resume",
  );
  expect(refused.text).toBe("Resume refused · Ticket changed");
  expect(refused.wrong).toBe(true);
});
