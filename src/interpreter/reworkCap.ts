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
 * THE CAP IS OVER EVALUATION FAILURES ALONE. A `FinalizationFailed` re-enters
 * Working too, and the finalizer is what handles that loop; a cap consulted
 * only on a failing evaluation could never park such a ticket anyway, so
 * counting its reworks here would only shorten the evaluation allowance by an
 * amount no reader of the configuration can predict.
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
