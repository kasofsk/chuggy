/**
 * That the console names the point a resume would rejoin the pipeline at, for
 * every phase and kind the wire can send.
 *
 * The rules are held against the model's own by `test/ui/resumePoint.test.ts`;
 * what this suite adds is the totality the model cannot be driven to — a kind
 * the read omits and a ticket read short of an escalation at all.
 */

import { expect, test } from "vitest";

import { escalationKinds, phaseRoster } from "../../../src/contract/rosters.ts";
import type { EscalationKind } from "../../../src/contract/rosters.ts";
import type { ResumeSituation } from "../app/core/resumePoint.ts";
import {
  resumeRerun,
  ticketResume,
  ticketResumePoint,
} from "../app/core/resumePoint.ts";
import { resumePoints } from "../../../src/contract/rosters.ts";

function parked(kind: EscalationKind): ResumeSituation {
  return {
    phase: "Escalated",
    kind,
    stageCount: 2,
  };
}

test("every wall the wire can name has a point", () => {
  const named = escalationKinds.map((kind) => [
    kind,
    ticketResumePoint(parked(kind)),
  ]);
  expect(named).toEqual([
    ["WorkFailureEscalated", "ResumeWork"],
    ["WorkExecutionUnavailableEscalated", "ResumeWork"],
    ["EvaluationFailureEscalated", "ResumeRework"],
    ["EvaluationBlockedEscalated", "ResumeEvaluation"],
    ["FinalizationUnavailableEscalated", "ResumeFinalization"],
  ]);
});

test("only a parked phase has anything to resume", () => {
  const resumable = phaseRoster.filter(
    (phase) =>
      ticketResumePoint({ ...parked("WorkFailureEscalated"), phase }) !==
      undefined,
  );
  expect(resumable).toEqual(["Escalated"]);
});

test("an escalation whose kind the read omits names no point", () => {
  expect(
    ticketResumePoint({ ...parked("WorkFailureEscalated"), kind: undefined }),
  ).toBeUndefined();
});

test("an evaluation resume re-runs the program from its lowest stage", () => {
  expect(ticketResume(parked("EvaluationBlockedEscalated"))).toEqual({
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
