/**
 * That the console names the point a resume would rejoin the pipeline at, for
 * every phase and reason the wire can send.
 *
 * The rules are held against the model's own by `test/ui/resumePoint.test.ts`;
 * what this suite adds is the totality the model cannot be driven to — a reason
 * the read omits, a page holding no set for the wall to have interrupted, and a
 * ticket read that carries the machine's own answer.
 */

import { expect, test } from "vitest";

import {
  escalationReasons,
  phaseRoster,
} from "../../../src/contract/rosters.ts";
import type { EscalationReason } from "../../../src/contract/rosters.ts";
import type { ResumeSituation } from "../app/core/resumePoint.ts";
import { ticketResume, ticketResumePoint } from "../app/core/resumePoint.ts";
import type { ClosedSet } from "../app/core/ticketLedger.ts";

const failedFinalStage: ClosedSet = {
  taskKind: "Evaluation",
  stage: 0,
  verdict: "Failed",
};

const passedFinalStage: ClosedSet = {
  taskKind: "Evaluation",
  stage: 1,
  verdict: "Passed",
};

const cancelledWork: ClosedSet = {
  taskKind: "Work",
  stage: undefined,
  verdict: "Cancelled",
};

function parked(
  reason: EscalationReason,
  lastSet: ClosedSet | undefined = failedFinalStage,
): ResumeSituation {
  return {
    phase: "Escalated",
    reason,
    lastSet,
    stageCount: 2,
    resumePricing: "RetryCharged",
    resumeAt: undefined,
  };
}

test("every wall the wire can name has a point or names none", () => {
  const named = escalationReasons.map((reason) => [
    reason,
    ticketResumePoint(parked(reason)),
  ]);
  expect(named).toEqual([
    ["WorkFailed", "ResumeWorking"],
    ["ReworkBudgetExhausted", "ResumeEvaluating"],
    ["FinalizationBudgetExhausted", "ResumeFinalizing"],
    ["GasExhausted", "ResumeEvaluating"],
    ["DependencyRevoked", undefined],
    ["ExecutionPolicyDenied", "ResumeEvaluating"],
    ["TicketConfigIncompatible", "ResumeEvaluating"],
    ["ExecutionProfileUnavailable", "ResumeEvaluating"],
    ["RuntimeVersionUnsupported", "ResumeEvaluating"],
    ["RequiredCapabilityUnavailable", "ResumeEvaluating"],
  ]);
});

test("the gas wall is the finalization's where the program had already passed", () => {
  expect(ticketResumePoint(parked("GasExhausted", passedFinalStage))).toBe(
    "ResumeFinalizing",
  );
  expect(ticketResumePoint(parked("GasExhausted", failedFinalStage))).toBe(
    "ResumeEvaluating",
  );
});

test("the gas wall reads the program's own last stage, not any stage past it", () => {
  const beyond: ClosedSet = {
    taskKind: "Evaluation",
    stage: 5,
    verdict: "Passed",
  };
  expect(ticketResumePoint(parked("GasExhausted", beyond))).toBe(
    "ResumeEvaluating",
  );
});

test("the gas wall is the finalization's only where the final stage passed", () => {
  for (const verdict of [
    "Running",
    "Cancelled",
    "Blocked",
    "Failed",
  ] as const) {
    expect(
      ticketResumePoint(
        parked("GasExhausted", { ...passedFinalStage, verdict }),
      ),
    ).toBe("ResumeEvaluating");
  }
});

test("a blocked execution resumes into the phase that held the set it stopped", () => {
  expect(
    ticketResumePoint(parked("ExecutionPolicyDenied", cancelledWork)),
  ).toBe("ResumeWorking");
  expect(
    ticketResumePoint({
      ...parked("ExecutionPolicyDenied"),
      lastSet: undefined,
    }),
  ).toBeUndefined();
});

test("a blocked handoff resumes its publication, with no reason to read", () => {
  expect(
    ticketResumePoint({
      ...parked("WorkFailed"),
      phase: "HandoffBlocked",
      reason: undefined,
    }),
  ).toBe("ResumePublishingHandoff");
});

test("only a parked phase has anything to resume", () => {
  const resumable = phaseRoster.filter(
    (phase) =>
      ticketResumePoint({ ...parked("WorkFailed"), phase }) !== undefined,
  );
  expect(resumable).toEqual(["HandoffBlocked", "Escalated"]);
});

test("an escalation whose reason the read omits names no point", () => {
  expect(
    ticketResumePoint({ ...parked("WorkFailed"), reason: undefined }),
  ).toBeUndefined();
});

test("the machine's own answer wins over every rule here", () => {
  expect(
    ticketResumePoint({
      ...parked("DependencyRevoked"),
      resumeAt: "ResumeFinalizing",
    }),
  ).toBe("ResumeFinalizing");
});

test("an evaluation resume re-runs the program from its lowest stage", () => {
  expect(ticketResume(parked("ReworkBudgetExhausted"))).toEqual({
    point: "ResumeEvaluating",
    reruns: "evaluation",
    fromStage: 0,
    ofStages: 2,
    cost: 1,
  });
});

test("re-entering work always costs gas and a free retry costs none", () => {
  expect(
    ticketResume({ ...parked("WorkFailed"), resumePricing: "RetryFree" }),
  ).toEqual({
    point: "ResumeWorking",
    reruns: "work",
    fromStage: undefined,
    ofStages: undefined,
    cost: 1,
  });
  expect(
    ticketResume({
      ...parked("ReworkBudgetExhausted"),
      resumePricing: "RetryFree",
    })?.cost,
  ).toBe(0);
});

test("a wall with no resumption offers nothing at all", () => {
  expect(ticketResume(parked("DependencyRevoked"))).toBeUndefined();
});
