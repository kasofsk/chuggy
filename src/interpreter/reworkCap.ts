/**
 * How many times this deployment reworks a ticket before parking it.
 *
 * THE CAP IS THIS SERVICE'S POLICY, NOT THE MACHINE'S. `model/` leaves the
 * disposition of a failing evaluation open and journals whichever one the
 * writer picked, so nothing here is a decision a decider could have taken: the
 * pick is an input to `decideEvalStageReduce`, made once at the writer and
 * recorded on the event, and replay re-performs it rather than re-taking it.
 *
 * THE COUNT IS DERIVED FROM THE TASK HISTORY. Nothing on the ticket stores how
 * much rework it has had, so a cap changed between one release and the next
 * applies to the ticket in flight instead of to whatever a release froze onto
 * it.
 *
 * THE CAP IS OVER EVALUATION FAILURES, AS FAR AS THE HISTORY SHOWS THEM. A
 * `FinalizationNeedsWork` re-enters Work too, and the finalizer is what handles
 * that loop; a cap consulted only on a failing evaluation could never park such
 * a ticket anyway, so counting its reworks here would only shorten the
 * evaluation allowance. The history cannot always tell the two apart: an
 * evaluation set abandoned to `ExecutionBlocked` after one task failed retires
 * beside the re-run that passed, and a finalizer rework after it reads as an
 * evaluation rework. That errs toward parking early, which a desk can undo.
 */

import type {
  EvaluationFailureDisposition,
  Ticket,
} from "../domain/generated/modelTypes.ts";
import { evaluationFailureReworksStarted } from "../domain/task.ts";

/** One deployment's cap: how many times a failing evaluation may rework a ticket rather than park it. */
export interface ReworkCap {
  readonly cyclesMax: number;
}

/** Refuses a cap that is not a whole count of cycles, because an unbounded one is no cap. */
export function checkedReworkCap(cap: ReworkCap): ReworkCap {
  if (!Number.isSafeInteger(cap.cyclesMax) || cap.cyclesMax < 0) {
    throw new RangeError(
      `rework cap must be a non-negative whole number of cycles, not ${String(cap.cyclesMax)}`,
    );
  }
  return cap;
}

/**
 * What a failing evaluation of this ticket is to be taken as. A ticket already
 * reworked `cyclesMax` times after a failing evaluation has had every rework
 * the cap allows, so this failure parks it at the rework wall — `cyclesMax: 2`
 * is two reworks and a park on the third failure, and `cyclesMax: 0` parks on
 * the first.
 */
export function reworkDisposition(
  ticket: Ticket,
  cyclesMax: number,
): EvaluationFailureDisposition {
  return evaluationFailureReworksStarted(ticket.record, ticket.tasks) >=
    cyclesMax
    ? "EscalateEvaluationFailure"
    : "ReworkEvaluationFailure";
}
