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
  resumePoints,
} from "../../../src/contract/rosters.ts";
import {
  resumeActionEffect,
  resumeNotReadReason,
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
import { resumeGasCharge, resumeRerun } from "../app/core/resumePoint.ts";
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
      kind: "Offered",
      consequence: {
        point: "ResumeEvaluating",
        reruns: "evaluation",
        fromStage: 0,
        ofStages: 2,
        refillsReworkTo: undefined,
        cost: 1,
      },
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
      kind: "Offered",
      consequence: {
        point: "ResumeReworking",
        reruns: "work",
        fromStage: undefined,
        ofStages: undefined,
        refillsReworkTo: 2,
        cost: resumeGasCharge("ResumeReworking", "RetryFree"),
      },
    },
    undefined,
  );
  expect(effect.effect).toBe("Reworks · new artifact, rework refilled");
  expect(effect.cost).toBe("costs 1 gas");
  expect(effect.more).toBe("Rework returns to 0/2");
});

test("a wall with no resume point offers nothing and says which exit is left", () => {
  const effect = ticketActionEffect("Resume", { kind: "NoPoint" }, undefined);
  expect(effect.effect).toBe("Nothing to resume");
  expect(effect.more).toBe("only Revoke exits this wall");
  expect(effect.offered).toBe(false);
  expect(
    ticketActionEffect("Revoke", { kind: "NoPoint" }, undefined).cost,
  ).toBe("free");
});

/**
 * `retryableIn` wants affordable gas as well as a stamped point, and the rework
 * wall's own decider says a ticket out of gas there is parked for good under
 * both pricings. A wall with no gas is as revoke-only as one with no point.
 */
test("a wall the ticket cannot pay for offers nothing, and says why", () => {
  const effect = ticketActionEffect("Resume", { kind: "NoGas" }, undefined);
  expect(effect.effect).toBe("No gas left");
  expect(effect.more).toBe("only Revoke exits this wall");
  expect(effect.offered).toBe(false);
  expect(effect.refusedBecause).toBe(undefined);
});

/**
 * A screen that has not finished reading knows neither term, so it disables the
 * control with its reason rather than claiming anything about the wall.
 */
test("a resume this page has not read enough for is refused, not denied", () => {
  const effect = ticketActionEffect("Resume", { kind: "NotRead" }, undefined);
  expect(effect.offered).toBe(true);
  expect(effect.refusedBecause).toBe(resumeNotReadReason);
  expect(effect.more).toBe(undefined);
  expect(effect.effect).not.toContain("Revoke");
});

/**
 * Every point the machine can stamp, against what its own decider does with it
 * (`model/domain.qnt`): both work resumes respawn the work set, only the rework
 * one refills the account, and only the evaluating one keeps the artifact.
 */
test("every resume point draws the effect and the consequence the machine gives it", () => {
  const drawn = resumePoints.map((point) => {
    const effect = resumeActionEffect(
      {
        kind: "Offered",
        consequence: {
          point,
          reruns: resumeRerun(point),
          fromStage: point === "ResumeEvaluating" ? 0 : undefined,
          ofStages: point === "ResumeEvaluating" ? 2 : undefined,
          refillsReworkTo: point === "ResumeReworking" ? 2 : undefined,
          cost: resumeGasCharge(point, "RetryCharged"),
        },
      },
      { left: 0, max: 2 },
    );
    return [point, effect.effect, effect.more ?? ""];
  });
  expect(drawn).toEqual([
    ["ResumeWorking", "Re-runs the work · new artifact", ""],
    [
      "ResumeReworking",
      "Reworks · new artifact, rework refilled",
      "Rework returns to 0/2",
    ],
    [
      "ResumeEvaluating",
      "Re-runs evaluation from stage 1",
      "Keeps the current artifact · rework stays 0/2",
    ],
    ["ResumeFinalizing", "Re-runs finalization", ""],
    ["ResumePublishingHandoff", "Republishes the handoff", ""],
  ]);
});

test("a free answer says free and a charged one names its gas", () => {
  const free = resumeActionEffect(
    {
      kind: "Offered",
      consequence: {
        point: "ResumeEvaluating",
        reruns: "evaluation",
        fromStage: 0,
        ofStages: 2,
        refillsReworkTo: undefined,
        cost: 0,
      },
    },
    undefined,
  );
  expect(free.cost).toBe("free");
  expect(
    ticketActionEffect("Revoke", { kind: "NoPoint" }, undefined).cost,
  ).toBe("free");
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
    refillsReworkTo: undefined,
    cost: 1,
  } as const;
  for (const action of ticketActionNames)
    expect(
      ticketActionEffect(
        action,
        { kind: "Offered", consequence: resume },
        undefined,
      ).offered,
    ).toBe(true);
  for (const action of ticketActionNames)
    expect(
      ticketActionEffect(action, { kind: "NoPoint" }, undefined).offered,
    ).toBe(action !== "Resume");
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
