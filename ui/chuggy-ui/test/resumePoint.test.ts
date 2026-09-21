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
  resumePoints,
} from "../../../src/contract/rosters.ts";
import type { EscalationReason } from "../../../src/contract/rosters.ts";
import type { ResumeSituation } from "../app/core/resumePoint.ts";
import {
  resumeRerun,
  ticketResume,
  ticketResumePoint,
} from "../app/core/resumePoint.ts";
import type { ClosedSet } from "../app/core/ticketLedger.ts";

const failedFinalStage: ClosedSet = {
  taskKind: "Evaluation",
  stage: 0,
  verdict: "Failed",
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
    resumeAt: undefined,
  };
}

test("every wall the wire can name has a point or names none", () => {
  const named = escalationReasons.map((reason) => [
    reason,
    ticketResumePoint(parked(reason)),
  ]);
  expect(named).toEqual([
    ["WorkFailureEscalated", "ResumeWork"],
    ["EvaluationFailureEscalated", "ResumeRework"],
    ["WorkExecutionUnavailableEscalated", "ResumeEvaluation"],
  ]);
});

test("a blocked execution resumes into the phase that held the set it stopped", () => {
  expect(
    ticketResumePoint(
      parked("WorkExecutionUnavailableEscalated", cancelledWork),
    ),
  ).toBe("ResumeWork");
  expect(
    ticketResumePoint({
      ...parked("WorkExecutionUnavailableEscalated"),
      lastSet: undefined,
    }),
  ).toBeUndefined();
});

test("only a parked phase has anything to resume", () => {
  const resumable = phaseRoster.filter(
    (phase) =>
      ticketResumePoint({ ...parked("WorkFailureEscalated"), phase }) !==
      undefined,
  );
  expect(resumable).toEqual(["Escalated"]);
});

test("an escalation whose reason the read omits names no point", () => {
  expect(
    ticketResumePoint({ ...parked("WorkFailureEscalated"), reason: undefined }),
  ).toBeUndefined();
});

test("the machine's own answer wins over every rule here", () => {
  expect(
    ticketResumePoint({
      ...parked("WorkFailureEscalated"),
      resumeAt: "ResumeFinalization",
    }),
  ).toBe("ResumeFinalization");
});

test("an evaluation resume re-runs the program from its lowest stage", () => {
  expect(ticketResume(parked("WorkExecutionUnavailableEscalated"))).toEqual({
    point: "ResumeEvaluation",
    reruns: "evaluation",
    fromStage: 0,
    ofStages: 2,
  });
});

test("the rework wall's resume re-runs the work", () => {
  expect(ticketResume(parked("EvaluationFailureEscalated"))).toEqual({
    point: "ResumeRework",
    reruns: "work",
    fromStage: undefined,
    ofStages: undefined,
  });
});

test("each point is re-run in the ticket's own word for it", () => {
  const said = ([...resumePoints] as const).map((point) => [
    point,
    resumeRerun(point),
  ]);
  expect(said).toEqual([
    ["ResumeWork", "work"],
    ["ResumeRework", "work"],
    ["ResumeEvaluation", "evaluation"],
    ["ResumeFinalization", "finalization"],
  ]);
});
