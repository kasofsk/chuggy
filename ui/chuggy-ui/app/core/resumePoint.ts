/**
 * Where a resume would put this ticket back, what it would re-run, and what it
 * would charge.
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
 * THE REWORK WALL BUYS A WORK CYCLE, not a re-run of the evaluation: the model
 * respawns the work set with the eval-rework account refilled to the authored
 * budget, and a ticket authored no budget declined that economy and is
 * revoke-only like the cascade wall. The budget is the one fact a phase and a
 * reason do not carry, so a page that reads the authoring hands it over and a
 * page that does not gets the answer for a ticket that has one.
 *
 * IT IS TOTAL OVER EVERY PHASE AND REASON THE ROSTERS ADMIT, and answers with
 * nothing for three different reasons. A phase that is not parked has nothing
 * to resume at all; a revoked dependency is the one wall the model itself
 * stamps no point on; and where the model does stamp one but the read is short
 * of what it stamped — a reason the ticket read omits, a set this page does not
 * hold — the console declines rather than guesses, and a read carrying the
 * stamped point is what settles it.
 */

import type {
  EscalationReason,
  ResumePoint,
  ResumePricing,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";
import type { ClosedSet } from "./ticketLedger.ts";

/** Which of the ticket's four asks the resume issues again. */
export type ResumeRerun = "work" | "evaluation" | "finalization" | "handoff";

export interface ResumeSituation {
  readonly phase: TicketPhase;
  readonly reason: EscalationReason | undefined;
  readonly lastSet: ClosedSet | undefined;
  readonly stageCount: number;
  readonly resumePricing: ResumePricing;
  readonly resumeAt: ResumePoint | undefined;
  readonly reworkBudget?: number | undefined;
}

export interface ResumeConsequence {
  readonly point: ResumePoint;
  readonly reruns: ResumeRerun;
  readonly fromStage: number | undefined;
  readonly ofStages: number | undefined;
  readonly cost: number;
}

/** The gas wall stamps the finalization only when the program had already passed. */
function finalizationWalled(situation: ResumeSituation): boolean {
  const set = situation.lastSet;
  return (
    set !== undefined &&
    set.taskKind === "Evaluation" &&
    set.verdict === "Passed" &&
    set.stage !== undefined &&
    set.stage === situation.stageCount - 1
  );
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
      return situation.reworkBudget === 0 ? undefined : "ResumeReworking";
    case "FinalizationBudgetExhausted":
      return "ResumeFinalizing";
    case "GasExhausted":
      return finalizationWalled(situation)
        ? "ResumeFinalizing"
        : "ResumeEvaluating";
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
  if (situation.phase === "HandoffBlocked") return "ResumePublishingHandoff";
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
    case "ResumePublishingHandoff":
      return "PublishingHandoff";
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
    case "ResumePublishingHandoff":
      return "handoff";
  }
}

/**
 * Re-entering work always meters, because that is the account that makes the
 * graph terminate; every other resume is priced by the ticket's own authoring.
 */
export function resumeGasCharge(
  point: ResumePoint,
  pricing: ResumePricing,
): number {
  if (point === "ResumeWorking" || point === "ResumeReworking") return 1;
  return pricing === "RetryCharged" ? 1 : 0;
}

/**
 * What a resume would do, as the facts a page draws it from. An evaluation
 * resume is a fresh fan-out of the lowest stage, never a pick-up mid-sequence.
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
    cost: resumeGasCharge(point, situation.resumePricing),
  };
}
