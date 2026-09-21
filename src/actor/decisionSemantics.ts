/**
 * The decision semantics a stored journal row may have been decided under.
 *
 * ONE MACHINE DECIDES AND THE OTHERS ONLY REPLAY. `src/domain/` is the machine
 * the model proves and the only one that takes a new step; a superseded
 * semantics lives here to re-derive rows already written, and is stated as a
 * correction to the current decision rather than as a second copy of the
 * deciders — a copy would be a machine the model does not check, drifting
 * beside the one it does.
 *
 * A SUPERSEDED SEMANTICS IS FROZEN. What it decided is already durable, so
 * revising one would turn a legal history illegal, which is the failure this
 * module exists to prevent.
 *
 * EVERY CORRECTION IS READ OFF THE ROW, which is why one takes the row and not
 * just its event. There are three:
 *   - at 1, a row whose record parks a ticket at the evaluation wall parked it
 *     at the eval resume, because that wall had no resume of its own yet;
 *   - at 1 and 2, a row's EvalReduce carried no disposition, and the one it was
 *     decided under is in its record: a transition into Escalated is the
 *     escalate edge and anything else is the rework edge;
 *   - at 1 and 2, a row whose record names a wall this machine no longer has
 *     cannot be re-derived at all, and `storedJournalLegalOn` refuses it rather
 *     than replaying it into a state the fleet was never in.
 *
 * A REPLAYED STATE IS NOT A STATE THE CURRENT DOMAIN INVARIANTS DESCRIBE. The
 * first semantics grants the rework wall an eval resume, while `deskConsistent`
 * in `src/domain/invariants.ts` holds that a wall's resume is the one its own
 * decider stamps — so a correct replay of such a history reaches a state the
 * current bundle rejects. The bundle describes the machine the model proves;
 * history is not required to satisfy it, and nothing in `src/` evaluates it
 * over a replayed core.
 */

import type { Config } from "../domain/config.ts";
import { ticketAt, withTicket, type Decision } from "../domain/core.ts";
import type {
  Core,
  EvaluationFailureDisposition,
  StepRecord,
} from "../domain/generated/modelTypes.ts";
import {
  decisionEventSubject,
  execDecisionEvent,
  type DecisionEvent,
} from "./decisionEvent.ts";

/** Which deciders produced a row, as the row's own durable envelope declares it. */
export type DecisionSemanticsVersion = 1 | 2 | 3;

/** The semantics every new decision is taken under, and the one `model/` describes. */
export const decisionSemanticsVersionCurrent: DecisionSemanticsVersion = 3;

/** Whether a stored number names decision semantics this image knows how to replay. */
export function isDecisionSemanticsVersion(
  value: number,
): value is DecisionSemanticsVersion {
  return value === 1 || value === 2 || value === 3;
}

/** A journaled decision as a correction reads it: the event, and the record it wrote. */
export interface JournaledDecision {
  readonly event: DecisionEvent;
  readonly rec: StepRecord;
}

/** The walls this machine no longer has, under the labels their rows carry. */
const removedWallLabels: readonly string[] = [
  "ticket-escalated gas_exhausted",
  "ticket-escalated finalization_budget_exhausted",
];

/**
 * Whether this row can be re-derived at all. A row that parked a ticket on an
 * account wall names a decision no current decider makes, so there is nothing
 * to correct it to.
 */
export function replayableDecision(row: JournaledDecision): boolean {
  return !removedWallLabels.includes(row.rec.label);
}

/**
 * The disposition the row was decided under, read off its record: the escalate
 * edge is the one that parks the ticket. A pre-3 row's bytes name no
 * disposition at all, so whatever reads those bytes into an event asks this
 * too.
 */
export function dispositionInRecord(
  rec: StepRecord,
): EvaluationFailureDisposition {
  return rec.transitions.some((t) => t.to === "Escalated")
    ? "EscalateEvaluationFailure"
    : "ReworkEvaluationFailure";
}

/** The row's event with the disposition its record reports, which older rows did not carry. */
function eventAtRecordedDisposition(row: JournaledDecision): DecisionEvent {
  if (row.event.type !== "EvalReduce") return row.event;
  return {
    type: "EvalReduce",
    value: {
      ticket: row.event.value.ticket,
      onFailure: dispositionInRecord(row.rec),
    },
  };
}

/**
 * The rework wall parked at the eval resume before the wall had a resume of its
 * own, which is the whole of what the first semantics decided differently.
 */
function decisionAtReworkWallParkedEvaluating(
  event: DecisionEvent,
  decision: Decision,
): Decision {
  if (event.type !== "EvalReduce") return decision;
  const id = decisionEventSubject(event);
  const parked = ticketAt(decision.post, id);
  if (parked.phase !== "Escalated" || parked.reason !== "ReworkBudgetExhausted")
    return decision;
  return {
    rec: decision.rec,
    post: withTicket(decision.post, id, {
      ...parked,
      resumeAt: "ResumeEvaluating",
    }),
  };
}

/**
 * One journaled decision re-derived under the semantics its row declares. The
 * record is the current decider's either way; only the disposition it is asked
 * for and the parked resume differ.
 */
export function execDecisionEventAt(
  semantics: DecisionSemanticsVersion,
  config: Config,
  core: Core,
  row: JournaledDecision,
): Decision {
  switch (semantics) {
    case 1:
      return decisionAtReworkWallParkedEvaluating(
        row.event,
        execDecisionEvent(config, core, eventAtRecordedDisposition(row)),
      );
    case 2:
      return execDecisionEvent(config, core, eventAtRecordedDisposition(row));
    case 3:
      return execDecisionEvent(config, core, row.event);
  }
}
