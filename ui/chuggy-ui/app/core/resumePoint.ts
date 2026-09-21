/**
 * Where a resume would put this ticket back, and what it would re-run.
 *
 * The machine stamps the point at the wall it escalated on and clears it on the
 * way out, so a parked ticket's wall and its last fan-out set name it between
 * them. The points are the contract's own roster; what is restated here is
 * which one each wall names, because a browser reaches only `src/contract/` and
 * no read carries that rule. `test/ui/resumePoint.test.ts` holds the
 * restatement against `src/domain/deciders.ts` — the arrangement
 * `no-console-sees-another` names for a value two trees both need.
 *
 * THE WIRE WINS WHERE IT SPEAKS. `resumeAt` is the machine's own answer and is
 * returned as given; the rules below are what answer when a ticket read does
 * not carry one.
 *
 * A RESUME NEEDS NOTHING BUT ITS POINT. Every parked ticket with a modeled
 * resume is retryable and every resume is free, so naming the point is the
 * whole of what this module or a reader of it has to settle.
 *
 * IT IS TOTAL OVER EVERY PHASE AND REASON THE ROSTERS ADMIT, and answers with
 * nothing for three different reasons. A phase that is not parked has nothing
 * to resume at all; the rework wall's own resume needs no further check, and a
 * revoked dependency is the one wall the model gives no exit but revoke; and
 * where the model does stamp one but the read is short of what it stamped — a
 * reason the ticket read omits, a set this page does not hold — the console
 * declines rather than guesses, and a read carrying the stamped point is what
 * settles it.
 */

import type {
  EscalationReason,
  ResumePoint,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { ClosedSet } from "./ticketLedger.ts";

/** Which of the ticket's three asks the resume issues again. */
export type ResumeRerun = "work" | "evaluation" | "finalization";

export interface ResumeSituation {
  readonly phase: TicketPhase;
  readonly reason: EscalationReason | undefined;
  readonly lastSet: ClosedSet | undefined;
  readonly stageCount: number;
  readonly resumeAt: ResumePoint | undefined;
}

export interface ResumeConsequence {
  readonly point: ResumePoint;
  readonly reruns: ResumeRerun;
  readonly fromStage: number | undefined;
  readonly ofStages: number | undefined;
}

/** A blocked execution resumes into the phase that held the set it interrupted. */
function interruptedPoint(set: ClosedSet | undefined): ResumePoint | undefined {
  if (set === undefined) return undefined;
  switch (set.taskKind) {
    case "Work":
      return "ResumeWorking";
    case "Evaluation":
      return "ResumeEvaluating";
  }
}

function walledPoint(
  reason: EscalationReason,
  situation: ResumeSituation,
): ResumePoint | undefined {
  switch (reason) {
    case "WorkFailed":
      return "ResumeWorking";
    case "ReworkBudgetExhausted":
      return "ResumeReworking";
    case "DependencyRevoked":
      return undefined;
    case "ExecutionPolicyDenied":
    case "TicketConfigIncompatible":
    case "ExecutionProfileUnavailable":
    case "RuntimeVersionUnsupported":
    case "RequiredCapabilityUnavailable":
      return interruptedPoint(situation.lastSet);
  }
}

/**
 * What a resume of this ticket would re-run. A phase that is not parked has
 * nothing to resume, and neither has a wall the model gives no exit but revoke.
 */
export function ticketResumePoint(
  situation: ResumeSituation,
): ResumePoint | undefined {
  if (situation.resumeAt !== undefined) return situation.resumeAt;
  if (situation.phase !== "Escalated") return undefined;
  const reason = situation.reason;
  return reason === undefined ? undefined : walledPoint(reason, situation);
}

/** The phase the resume re-enters, which is what the point is named for. */
export function resumeReenters(point: ResumePoint): TicketPhase {
  switch (point) {
    case "ResumeWorking":
    case "ResumeReworking":
      return "Working";
    case "ResumeEvaluating":
      return "Evaluating";
    case "ResumeFinalizing":
      return "Finalizing";
  }
}

/** Which ask is issued again, in the words a reader already has for the ticket. */
export function resumeRerun(point: ResumePoint): ResumeRerun {
  switch (point) {
    case "ResumeWorking":
    case "ResumeReworking":
      return "work";
    case "ResumeEvaluating":
      return "evaluation";
    case "ResumeFinalizing":
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
  const evaluating = point === "ResumeEvaluating";
  return {
    point,
    reruns: resumeRerun(point),
    fromStage: evaluating ? 0 : undefined,
    ofStages: evaluating ? situation.stageCount : undefined,
  };
}
