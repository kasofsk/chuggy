/**
 * Where a resume would put this ticket back, and what it would re-run.
 *
 * The machine's `resumeOf` (`src/domain/ticket.ts`) is total over the sum: it
 * stamps the point from the wall alone, with no fact of the ticket's own
 * history left to read — every kind the model admits resumes somewhere.
 * `walledPoint` restates that one switch, because a browser reaches only
 * `src/contract/` and no read carries the rule; `test/ui/resumePoint.test.ts`
 * holds it against `resumeOf` — the arrangement `no-console-sees-another`
 * names for a value two trees both need.
 *
 * THE WIRE CARRIES ITS OWN ANSWER TOO, and a ticket read is where a page gets
 * it: `escalation.resumeAt` is read straight off the ticket, not recomputed
 * through this module — see `ticketPageFacts.ts`. What is here is the
 * standing proof that the two never disagree, and the two smaller facts a
 * resume still needs once its point is known: which phase it re-enters and
 * which of the ticket's three asks it reissues.
 */

import type {
  EscalationKind,
  ResumePoint,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";

/** Which of the ticket's three asks the resume issues again. */
export type ResumeRerun = "work" | "evaluation" | "finalization";

export interface ResumeSituation {
  readonly phase: TicketPhase;
  readonly kind: EscalationKind | undefined;
  readonly stageCount: number;
}

export interface ResumeConsequence {
  readonly point: ResumePoint;
  readonly reruns: ResumeRerun;
  readonly fromStage: number | undefined;
  readonly ofStages: number | undefined;
}

/** Where each wall's resume rejoins the pipeline, restating `resumeOf`. */
function walledPoint(kind: EscalationKind): ResumePoint {
  switch (kind) {
    case "WorkFailureEscalated":
    case "WorkExecutionUnavailableEscalated":
      return "ResumeWork";
    case "EvaluationFailureEscalated":
      return "ResumeRework";
    case "EvaluationBlockedEscalated":
      return "ResumeEvaluation";
    case "FinalizationUnavailableEscalated":
      return "ResumeFinalization";
  }
}

/**
 * What a resume of this ticket would re-run. A phase that is not parked has
 * nothing to resume, and neither has a park whose kind the read omits.
 */
export function ticketResumePoint(
  situation: ResumeSituation,
): ResumePoint | undefined {
  if (situation.phase !== "Escalated") return undefined;
  const kind = situation.kind;
  return kind === undefined ? undefined : walledPoint(kind);
}

/** The phase the resume re-enters, which is what the point is named for. */
export function resumeReenters(point: ResumePoint): TicketPhase {
  switch (point) {
    case "ResumeWork":
    case "ResumeRework":
      return "Work";
    case "ResumeEvaluation":
      return "Evaluation";
    case "ResumeFinalization":
      return "Finalization";
  }
}

/** Which ask is issued again, in the words a reader already has for the ticket. */
export function resumeRerun(point: ResumePoint): ResumeRerun {
  switch (point) {
    case "ResumeWork":
    case "ResumeRework":
      return "work";
    case "ResumeEvaluation":
      return "evaluation";
    case "ResumeFinalization":
      return "finalization";
  }
}

/**
 * What a resume would do, as the facts a page draws it from. An evaluation
 * resume is a fresh fan-out of the lowest stage and never a pick-up
 * mid-sequence; the rework wall's is a fresh cycle, same as a resumed work set.
 */
export function ticketResume(
  situation: ResumeSituation,
): ResumeConsequence | undefined {
  const point = ticketResumePoint(situation);
  if (point === undefined) return undefined;
  const evaluating = point === "ResumeEvaluation";
  return {
    point,
    reruns: resumeRerun(point),
    fromStage: evaluating ? 0 : undefined,
    ofStages: evaluating ? situation.stageCount : undefined,
  };
}
