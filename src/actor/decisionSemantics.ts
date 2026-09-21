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
 * just its event. The last entry below is a divergence left standing rather
 * than corrected:
 *   - at 1, a row whose record parks a ticket at the evaluation wall parked it
 *     at the eval resume, because that wall had no resume of its own yet;
 *   - at 1 and 2, a row's EvalReduce carried no disposition, and the one it was
 *     decided under is in its record: a transition into Escalated is the
 *     escalate edge and anything else is the rework edge;
 *   - at 1 and 2, a row whose record names a wall this machine no longer has
 *     cannot be re-derived at all, and `storedJournalLegalOn` refuses it rather
 *     than replaying it into a state the fleet was never in;
 *   - at 3 and below, a row completing a ticket out of any phase but Finalizing
 *     was decided by a machine where a release could author no finalizer, and
 *     is refused the same way;
 *   - at 3 and below, a revoke whose record transitions more than one ticket
 *     cascaded, parking every Pending dependent of the ticket it revoked. Which
 *     tickets it parked is read off that record, and each is parked at
 *     `NoReason` and `NoResume`: the reason the cascade stamped left the machine
 *     with the cascade, and a revoke — which `revocableIn` admits from
 *     Escalated — is all any stored continuation ever took on a parked
 *     dependent. At 4 the correction does not run, and `storedJournalLegalOn`
 *     refuses such a record the way it refuses any other the current decider
 *     would not produce;
 *   - at 2, a rework wall's resume gets no correction of its own, so replay
 *     hands it to the current decider — which stamps every rework wall
 *     `ResumeReworking`, there being no budget left to consult. A row parked
 *     with no rework budget, decided when that wall answered `NoResume`,
 *     replays retryable though the machine that wrote it refused a retry.
 *
 * TWO OF THOSE REFUSALS ARE READ OFF THE RECORD BECAUSE THE EVENT NO LONGER
 * SPELLS THEM. A pre-4 release row carries a `finalizer` and each of its stages
 * a `combinator`; the model has neither field, so the codec drops both on the
 * way in and `ManagedFinalizer` and `UnanimousPass`, the surviving meaning,
 * replay unchanged. What the dropped keys decided is in the record either way:
 * a finisher-free release completes out of Evaluating, an `AnyPass` stage that
 * passed on a mixed set carries a label this machine's `combine` does not
 * produce, and `storedJournalLegalOn` compares records.
 */

import {
  ticketAt,
  ticketIds,
  withTicket,
  type Decision,
} from "../domain/core.ts";
import type {
  Core,
  EvaluationFailureDisposition,
  StepRecord,
} from "../domain/generated/modelTypes.ts";
import { asTicketId } from "../domain/ids.ts";
import {
  decisionEventSubject,
  execDecisionEvent,
  type DecisionEvent,
} from "./decisionEvent.ts";

/** Which deciders produced a row, as the row's own durable envelope declares it. */
export type DecisionSemanticsVersion = 1 | 2 | 3 | 4;

/** The semantics every new decision is taken under, and the one `model/` describes. */
export const decisionSemanticsVersionCurrent: DecisionSemanticsVersion = 4;

/** Whether a stored number names decision semantics this image knows how to replay. */
export function isDecisionSemanticsVersion(
  value: number,
): value is DecisionSemanticsVersion {
  return value === 1 || value === 2 || value === 3 || value === 4;
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

/** Whether this record completes a ticket from somewhere the finalizer does not run. */
function completedWithoutFinalizing(rec: StepRecord): boolean {
  return (
    rec.label === "ticket-done" &&
    rec.transitions.some((t) => t.from !== "Finalizing")
  );
}

/**
 * Whether this row can be re-derived at all. A row that parked a ticket on an
 * account wall or completed one without running a finalizer names a decision no
 * current decider makes, so there is nothing to correct it to.
 */
export function replayableDecision(row: JournaledDecision): boolean {
  return (
    !removedWallLabels.includes(row.rec.label) &&
    !completedWithoutFinalizing(row.rec)
  );
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
 * The revoke that parked the revoked ticket's dependents, where this machine's
 * revoke settles the ticket it names alone. Which dependents it parked is the
 * one thing read off the record — the cascade drew them from a graph no
 * current decider walks — and every other field is re-derived from the state
 * the row replays at, so a record naming a ticket this fleet does not hold or a
 * phase it is not in still fails `storedJournalLegalOn`'s comparison.
 */
function decisionAtRevokeCascadedToDependents(
  row: JournaledDecision,
  decision: Decision,
): Decision {
  if (row.rec.label !== "ticket-revoked") return decision;
  const held = new Set<number>(ticketIds(decision.post));
  const parked = row.rec.transitions
    .filter((t) => t.to === "Escalated" && held.has(t.ticket))
    .map((t) => asTicketId(t.ticket));
  if (parked.length === 0) return decision;
  return {
    rec: {
      label: decision.rec.label,
      transitions: [
        ...decision.rec.transitions,
        ...parked.map((id) => ({
          ticket: id,
          from: ticketAt(decision.post, id).phase,
          to: "Escalated" as const,
        })),
      ],
      effects: [...decision.rec.effects, ...parked.map(() => "OpenHumanTask")],
    },
    post: parked.reduce(
      (core, id) =>
        withTicket(core, id, {
          ...ticketAt(core, id),
          phase: "Escalated",
          resumeAt: "NoResume",
          reason: "NoReason",
        }),
      decision.post,
    ),
  };
}

/**
 * One journaled decision re-derived under the semantics its row declares. The
 * record is the current decider's either way; only the disposition it is asked
 * for, the parked resume, and the dependents a revoke parked differ.
 */
export function execDecisionEventAt(
  semantics: DecisionSemanticsVersion,
  core: Core,
  row: JournaledDecision,
): Decision {
  switch (semantics) {
    case 1:
      return decisionAtRevokeCascadedToDependents(
        row,
        decisionAtReworkWallParkedEvaluating(
          row.event,
          execDecisionEvent(core, eventAtRecordedDisposition(row)),
        ),
      );
    case 2:
      return decisionAtRevokeCascadedToDependents(
        row,
        execDecisionEvent(core, eventAtRecordedDisposition(row)),
      );
    case 3:
      return decisionAtRevokeCascadedToDependents(
        row,
        execDecisionEvent(core, row.event),
      );
    case 4:
      return execDecisionEvent(core, row.event);
  }
}
