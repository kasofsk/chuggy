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
 */

import type {
  EvaluationFailureDisposition,
  Ticket,
} from "../domain/generated/modelTypes.ts";
import { workCyclesStarted } from "../domain/task.ts";

/** One deployment's cap: how many rework cycles a ticket may be given. */
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
 * What a failing evaluation of this ticket is to be taken as. A ticket that has
 * already started `cyclesMax` work cycles beyond its first has been given every
 * rework the cap allows, so its next failure parks it at the rework wall —
 * `cyclesMax: 2` is two reworks and a park on the third failure.
 */
export function reworkDisposition(
  ticket: Ticket,
  cyclesMax: number,
): EvaluationFailureDisposition {
  return workCyclesStarted(ticket.record, ticket.tasks) > cyclesMax
    ? "EscalateEvaluationFailure"
    : "ReworkEvaluationFailure";
}
