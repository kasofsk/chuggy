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
 *   - at 3 and below, a row completing a ticket out of any phase but
 *     Finalization was decided by a machine where a release could author no
 *     finalizer, and is refused the same way;
 *   - at 3 and below, a revoke whose record transitions more than one ticket
 *     cascaded, parking every Pending dependent of the ticket it revoked. Which
 *     of them it parked is read off that record, and only a ticket the replay
 *     holds Pending is parked at all: a dependent leaves Pending only once its
 *     dependencies are Done, and a Done ticket is not revocable, so a record
 *     parking anything else is a record no cascade wrote. Each is parked at
 *     `NoReason` and `NoResume`: the reason the cascade stamped left the machine
 *     with the cascade, and a revoke — which `revocableIn` admits from
 *     Escalated — is all any stored continuation ever took on a parked
 *     dependent. Above 3 the correction does not run, and
 *     `storedJournalLegalOn` refuses such a record the way it refuses any
 *     other the current decider would not produce;
 *   - at 2, a rework wall's resume gets no correction of its own, so replay
 *     hands it to the current decider — which stamps every rework wall
 *     `ResumeRework`, there being no budget left to consult. A row parked
 *     with no rework budget, decided when that wall answered `NoResume`,
 *     replays retryable though the machine that wrote it refused a retry.
 *
 * AT 4 AND BELOW EVERY SPELLING IS THE OLD ONE, which is the one correction
 * that has to run before the codec rather than after it: a stored row names
 * `Working`, `ReleaseTicket` or `FinalizationFailed`, and the schema this
 * image generates describes none of them, so there would be no event to
 * correct. `rowAtCurrentVocabulary` rewrites those fields as one total map,
 * and every correction above therefore compares against the current
 * spellings. A row's BYTES do not change — `event_schema_version` stays 1 —
 * and neither does what it decided; only the words it says it in.
 *
 * TWO OF THOSE REFUSALS ARE READ OFF THE RECORD BECAUSE THE EVENT NO LONGER
 * SPELLS THEM. A pre-4 release row carries a `finalizer` and each of its stages
 * a `combinator`; the model has neither field, so the codec drops both on the
 * way in and `ManagedFinalizer` and `UnanimousPass`, the surviving meaning,
 * replay unchanged. What the dropped keys decided is in the record either way:
 * a finisher-free release completes out of Evaluation, an `AnyPass` stage
 * that passed on a mixed set carries a label this machine's `combine` does
 * not produce, and `storedJournalLegalOn` compares records.
 */

import {
  ticketAt,
  ticketIds,
  withTicket,
  type Decision,
} from "../domain/ticketGraph.ts";
import type {
  TicketGraph,
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
export type DecisionSemanticsVersion = 1 | 2 | 3 | 4 | 5;

/** The semantics every new decision is taken under, and the one `model/` describes. */
export const decisionSemanticsVersionCurrent: DecisionSemanticsVersion = 5;

/** Whether a stored number names decision semantics this image knows how to replay. */
export function isDecisionSemanticsVersion(
  value: number,
): value is DecisionSemanticsVersion {
  return value >= 1 && value <= 5 && Number.isInteger(value);
}

/**
 * Every word semantics 5 renamed, and what it is called now. One flat map
 * rather than one per field: no old spelling is also a new one, so rewriting a
 * row that already speaks the current vocabulary changes nothing, and a reader
 * never has to know which vintage it holds.
 */
const currentVocabulary: ReadonlyMap<string, string> = new Map([
  ["ReleaseTicket", "CreateTicket"],
  ["Working", "Work"],
  ["Evaluating", "Evaluation"],
  ["Finalizing", "Finalization"],
  ["WorkFailed", "WorkFailureEscalated"],
  ["ReworkBudgetExhausted", "EvaluationFailureEscalated"],
  ["ExecutionPolicyDenied", "WorkExecutionUnavailableEscalated"],
  ["TicketConfigIncompatible", "WorkExecutionUnavailableEscalated"],
  ["ExecutionProfileUnavailable", "WorkExecutionUnavailableEscalated"],
  ["RuntimeVersionUnsupported", "WorkExecutionUnavailableEscalated"],
  ["RequiredCapabilityUnavailable", "WorkExecutionUnavailableEscalated"],
  ["FinalizationFailed", "FinalizationNeedsWork"],
  ["ticket-escalated work_failed", "ticket-escalated work_failure_escalated"],
  [
    "ticket-escalated rework_budget_exhausted",
    "ticket-escalated evaluation_failure_escalated",
  ],
  [
    "ticket-escalated execution_blocked",
    "ticket-escalated work_execution_unavailable_escalated",
  ],
  [
    "rework-started finalization_failed",
    "rework-started finalization_needs_work",
  ],
]);

/** The fields of a row this map may rewrite, read before the codec has seen it. */
function objectFields(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

/** A string field rewritten to its current spelling, or left exactly as it is. */
function wordAtCurrentVocabulary(value: unknown): unknown {
  return typeof value === "string"
    ? (currentVocabulary.get(value) ?? value)
    : value;
}

/**
 * One stored row with every superseded spelling rewritten: the event's tag and
 * the two payload fields that name vocabulary, the record's label, and both
 * ends of each transition. Nothing else is walked — a blind walk would rewrite
 * a future field that happens to hold a renamed string — and a row that is not
 * the shape named passes through for the codec to refuse on its own terms.
 */
export function rowAtCurrentVocabulary(raw: unknown): unknown {
  const row = objectFields(raw);
  if (row === undefined) return raw;
  const event = objectFields(row["event"]);
  const rec = objectFields(row["rec"]);
  const value = objectFields(event?.["value"]);
  const transitions = rec?.["transitions"];
  return {
    ...row,
    ...(event === undefined
      ? {}
      : {
          event: {
            ...event,
            type: wordAtCurrentVocabulary(event["type"]),
            ...(value === undefined
              ? {}
              : {
                  value: {
                    ...value,
                    ...("reason" in value
                      ? { reason: wordAtCurrentVocabulary(value["reason"]) }
                      : {}),
                    ...("out" in value
                      ? { out: wordAtCurrentVocabulary(value["out"]) }
                      : {}),
                  },
                }),
          },
        }),
    ...(rec === undefined
      ? {}
      : {
          rec: {
            ...rec,
            label: wordAtCurrentVocabulary(rec["label"]),
            ...(Array.isArray(transitions)
              ? {
                  transitions: transitions.map((t: unknown) => {
                    const move = objectFields(t);
                    if (move === undefined) return t;
                    return {
                      ...move,
                      from: wordAtCurrentVocabulary(move["from"]),
                      to: wordAtCurrentVocabulary(move["to"]),
                    };
                  }),
                }
              : {}),
          },
        }),
  };
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
    rec.transitions.some((t) => t.from !== "Finalization")
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
  if (
    parked.phase !== "Escalated" ||
    parked.reason !== "EvaluationFailureEscalated"
  )
    return decision;
  return {
    rec: decision.rec,
    post: withTicket(decision.post, id, {
      ...parked,
      resumeAt: "ResumeEvaluation",
    }),
  };
}

/**
 * The revoke that parked the revoked ticket's dependents, where this machine's
 * revoke settles the ticket it names alone. Which of them it parked is read off
 * the record and nothing else is — a ticket the replay holds Pending is parked,
 * once, and anything else the record names is re-derived without it, so a row
 * parking a ticket this fleet never held, one already settled or running, or
 * the same dependent twice fails `storedJournalLegalOn`'s comparison.
 */
function decisionAtRevokeCascadedToDependents(
  row: JournaledDecision,
  decision: Decision,
): Decision {
  if (row.rec.label !== "ticket-revoked") return decision;
  const pending = new Set<number>(
    ticketIds(decision.post).filter(
      (held) => ticketAt(decision.post, held).phase === "Pending",
    ),
  );
  const named = row.rec.transitions
    .filter((t) => t.to === "Escalated" && pending.has(t.ticket))
    .map((t) => t.ticket);
  const parked = [...new Set(named)].map(asTicketId);
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
      (graph, id) =>
        withTicket(graph, id, {
          ...ticketAt(graph, id),
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
  graph: TicketGraph,
  row: JournaledDecision,
): Decision {
  switch (semantics) {
    case 1:
      return decisionAtRevokeCascadedToDependents(
        row,
        decisionAtReworkWallParkedEvaluating(
          row.event,
          execDecisionEvent(graph, eventAtRecordedDisposition(row)),
        ),
      );
    case 2:
      return decisionAtRevokeCascadedToDependents(
        row,
        execDecisionEvent(graph, eventAtRecordedDisposition(row)),
      );
    case 3:
      return decisionAtRevokeCascadedToDependents(
        row,
        execDecisionEvent(graph, row.event),
      );
    case 4:
    case 5:
      return execDecisionEvent(graph, row.event);
  }
}
