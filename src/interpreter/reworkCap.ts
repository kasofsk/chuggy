/**
 * How many times this deployment reworks a ticket before parking it.
 *
 * THE CAP IS THIS SERVICE'S POLICY, NOT THE MACHINE'S. `model/` leaves the
 * disposition of a failing evaluation open and journals whichever one the
 * writer picked, so nothing here is a decision a decider could have taken: the
 * pick is an input to the completion that concludes a failed stage, made once
 * at the writer and recorded on the event, and replay re-performs it rather
 * than re-taking it.
 *
 * THE COUNT IS DERIVED FROM THE JUDGEMENTS THE TICKET'S LEDGER KEEPS. Nothing
 * stores how much rework a ticket has had, so a cap changed between one
 * release and the next applies to the ticket in flight instead of to whatever
 * a release froze onto it.
 *
 * A FAILED VERDICT ON A STACK KNOWN TO BE DEAD IS NO REWORK. The finalizer marks
 * the work cycle of an evaluation whose stack stopped standing in the
 * transaction that offers its invalidation, and a failure of a marked cycle is
 * taken as `InvalidateEvaluationFailure`, which counts nothing and is no
 * attempt of the ticket's own. The marker is all this reads of a stack: a
 * cycle's stack record exists only where the choice found the ticket under its
 * stacked-failure cap, and that count cannot change before the cycle ends. A
 * verdict that reached the journal before the marker was written is an
 * ordinary rework, which is accepted.
 *
 * THE CAP IS OVER EVALUATION FAILURES, AND THE INSTANCES SAY WHICH THOSE ARE.
 * A `FinalizationNeedsWork` re-enters Work too, and the finalizer is what
 * handles that loop; a cap consulted only on a failing evaluation could never
 * park such a ticket anyway, so counting its reworks here would only shorten
 * the evaluation allowance. An instance that ended `EvaluationFailed` is the
 * one thing that bought a cycle for the reason this cap is about, which is why
 * the count is read off the judgement and not off a task history a blocked
 * evaluator's re-ask also shows in.
 */

import {
  alwaysPolicy,
  type EvaluationFailurePolicy,
} from "../domain/deciders.ts";
import type {
  EvaluationFailureDisposition,
  Ticket,
  TicketLedger,
} from "../domain/generated/modelTypes.ts";
import { evaluationFailureReworksStarted } from "../domain/ticket.ts";

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
  ledger: TicketLedger,
  cyclesMax: number,
): EvaluationFailureDisposition {
  return evaluationFailureReworksStarted(ticket, ledger) >= cyclesMax
    ? "EscalateEvaluationFailure"
    : "ReworkEvaluationFailure";
}

/**
 * The policy `decide` is handed for this ticket: the disposition its count
 * earns, whatever instance failed, except for an instance of a work cycle in
 * `dead`, which is invalidated at the journal position it was found dead at.
 */
export function reworkPolicy(
  ticket: Ticket,
  ledger: TicketLedger,
  cyclesMax: number,
  dead: ReadonlyMap<number, number> = new Map(),
): EvaluationFailurePolicy {
  const counted = alwaysPolicy(reworkDisposition(ticket, ledger, cyclesMax));
  return (instance) => {
    const found = dead.get(instance.workCycle);
    return found === undefined
      ? counted(instance)
      : { type: "InvalidateEvaluationFailure", value: found };
  };
}
