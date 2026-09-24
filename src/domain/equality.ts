/**
 * Structural equality over the domain's observed vocabulary, one definition
 * per shape, each a conjunction over the shape's declared fields.
 *
 * The model compares states with its own `==`; here `eventsNeverIdentity`,
 * the journal's legality check and the recovery obligation ask the same
 * question, and the answer is written out because `domain-is-pure` in
 * `.dependency-cruiser.cjs` puts `node:util`'s deep compare outside this
 * layer's graph. What is left is a pure function of the domain's own types,
 * which a reader can audit where a serialization would not be.
 *
 * WHAT A CONJUNCTION CANNOT SAY IS THAT IT IS COMPLETE. A variant arm is total
 * by `assertNever` on its tag, but a product's conjunction compiles and
 * answers `true` on two values differing only in a field nobody conjoined —
 * which is `recoveryComplete` green on a state the journal cannot rebuild, and
 * `journalLegalOn` accepting a row that moved nothing. `test/domain/equality.test.ts`
 * holds each product shape to a `Record<keyof Shape, ...>` roster, so a field
 * added to a domain type is a compile error there and an unread field in the
 * roster is a failing case.
 */

import { ticketAt, ticketIds } from "./ticketGraph.ts";
import type {
  Escalation,
  EvaluationInstance,
  EvaluationReworkEntry,
  FinalizationOperation,
  ReleasedTicket,
  StageDefinition,
  Ticket,
  TicketGraph,
  TicketLedger,
  TicketState,
  WorkCause,
  WorkEscalation,
  WorkInput,
} from "./generated/modelTypes.ts";
import { taskDefinitionEquals } from "./task.ts";
import { instanceEquals, stageDefinitionEquals } from "./evaluation.ts";

/** Same length, and equal member by member in order. */
function listEquals<Value>(
  left: readonly Value[],
  right: readonly Value[],
  equals: (leftValue: Value, rightValue: Value) => boolean,
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => {
      const other = right[index];
      return other !== undefined && equals(value, other);
    })
  );
}

/** Identity on the primitives: the ids and the ranks. */
function sameValue<Value extends number | string>(
  left: Value,
  right: Value,
): boolean {
  return left === right;
}

/** The dependency set as a list, ascending, so two sets compare member by member. */
function dependenciesInOrder(
  dependencies: ReadonlySet<number>,
): readonly number[] {
  return [...dependencies].sort((a, b) => a - b);
}

/** Whether two dependency sets name the same tickets. */
export function dependenciesEqual(
  left: ReadonlySet<number>,
  right: ReadonlySet<number>,
): boolean {
  return listEquals(
    dependenciesInOrder(left),
    dependenciesInOrder(right),
    sameValue,
  );
}

/** Whether two releases froze the same record, every declared field compared. */
export function releasedTicketEquals(
  left: ReleasedTicket,
  right: ReleasedTicket,
): boolean {
  return (
    left.id === right.id &&
    left.content === right.content &&
    dependenciesEqual(left.dependencies, right.dependencies) &&
    taskDefinitionEquals(left.workConfiguration, right.workConfiguration) &&
    listEquals(
      left.evaluationPlan.stages,
      right.evaluationPlan.stages,
      ticketEqualsStage,
    ) &&
    left.finalizationConfiguration === right.finalizationConfiguration
  );
}

/**
 * The plan's stages and the instances' own shapes are the protocol's, so
 * their equality is stated once beside the protocol (`src/domain/evaluation.ts`)
 * and read here. Two homes for one conjunction is two answers within a year.
 */
function ticketEqualsStage(
  left: StageDefinition,
  right: StageDefinition,
): boolean {
  return stageDefinitionEquals(left, right);
}

/** Structural equality on a finalization attempt, field for field. */
export function finalizationOperationEquals(
  left: FinalizationOperation,
  right: FinalizationOperation,
): boolean {
  return (
    left.workCycle === right.workCycle &&
    left.generation === right.generation &&
    left.input === right.input &&
    left.source === right.source
  );
}

function ticketEqualsInstance(
  left: EvaluationInstance,
  right: EvaluationInstance,
): boolean {
  return instanceEquals(left, right);
}

/** Whether two rework accounts name the same evaluators and results, in order. */
function reworkEntriesEqual(
  left: readonly EvaluationReworkEntry[],
  right: readonly EvaluationReworkEntry[],
): boolean {
  return listEquals(
    left,
    right,
    (l, r) => l.evaluator === r.evaluator && l.resultRef === r.resultRef,
  );
}

/** Whether two work causes are the same arm with the same payload. */
export function workCauseEquals(left: WorkCause, right: WorkCause): boolean {
  if (left === "InitialWork" || right === "InitialWork") return left === right;
  switch (left.type) {
    case "EvaluationRework":
      return (
        right.type === "EvaluationRework" &&
        reworkEntriesEqual(left.value, right.value)
      );
    case "FinalizationRework":
      return right.type === "FinalizationRework" && left.value === right.value;
  }
}

/** Whether two work inputs carry the same content, cause and retry evidence. */
export function workInputEquals(left: WorkInput, right: WorkInput): boolean {
  return (
    left.released === right.released &&
    workCauseEquals(left.cause, right.cause) &&
    listEquals(left.retryEvidence, right.retryEvidence, sameValue)
  );
}

/** Whether two work walls carry the same resume input, source and evidence. */
function workEscalationEquals(
  left: WorkEscalation,
  right: WorkEscalation,
): boolean {
  return (
    workInputEquals(left.resumeInput, right.resumeInput) &&
    left.source === right.source &&
    left.evidence === right.evidence
  );
}

/** Whether two walls are the same arm with the same payload. */
export function escalationEquals(left: Escalation, right: Escalation): boolean {
  switch (left.type) {
    case "WorkFailureEscalated":
      return (
        right.type === "WorkFailureEscalated" &&
        workEscalationEquals(left.value, right.value)
      );
    case "WorkExecutionUnavailableEscalated":
      return (
        right.type === "WorkExecutionUnavailableEscalated" &&
        workEscalationEquals(left.value, right.value)
      );
    case "EvaluationFailureEscalated":
      return (
        right.type === "EvaluationFailureEscalated" &&
        reworkEntriesEqual(left.value.evidence, right.value.evidence) &&
        left.value.source === right.value.source
      );
    case "EvaluationBlockedEscalated":
      return (
        right.type === "EvaluationBlockedEscalated" &&
        ticketEqualsInstance(left.value, right.value)
      );
    case "FinalizationUnavailableEscalated":
      return (
        right.type === "FinalizationUnavailableEscalated" &&
        finalizationOperationEquals(
          left.value.finalization,
          right.value.finalization,
        ) &&
        left.value.evidence === right.value.evidence
      );
  }
}

/** Whether two states are the same arm with the same payload. */
export function ticketStateEquals(
  left: TicketState,
  right: TicketState,
): boolean {
  if (typeof left === "string" || typeof right === "string")
    return left === right;
  switch (left.type) {
    case "Work":
      return (
        right.type === "Work" &&
        workInputEquals(left.value.input, right.value.input) &&
        left.value.source === right.value.source
      );
    case "Evaluation":
      return (
        right.type === "Evaluation" &&
        ticketEqualsInstance(left.value, right.value)
      );
    case "Finalization":
      return (
        right.type === "Finalization" &&
        finalizationOperationEquals(left.value, right.value)
      );
    case "Escalated":
      return (
        right.type === "Escalated" && escalationEquals(left.value, right.value)
      );
  }
}

/** Whether two tickets carry the same record, every declared field compared. */
export function ticketEquals(left: Ticket, right: Ticket): boolean {
  return (
    releasedTicketEquals(left.definition, right.definition) &&
    left.revision === right.revision &&
    left.workCyclesStarted === right.workCyclesStarted &&
    ticketStateEquals(left.state, right.state)
  );
}

/** Whether two ledgers hold the same closed instances and counters. */
export function ledgerEquals(left: TicketLedger, right: TicketLedger): boolean {
  return (
    listEquals(
      left.closedEvaluations,
      right.closedEvaluations,
      ticketEqualsInstance,
    ) &&
    left.spawned === right.spawned &&
    left.completions === right.completions
  );
}

/** Whether two ledger maps hold the same ids and equal ledgers under each. */
export function ledgersEqual(
  left: ReadonlyMap<number, TicketLedger>,
  right: ReadonlyMap<number, TicketLedger>,
): boolean {
  const leftIds = [...left.keys()].sort((a, b) => a - b);
  const rightIds = [...right.keys()].sort((a, b) => a - b);
  return (
    listEquals(leftIds, rightIds, sameValue) &&
    leftIds.every((id) => {
      const l = left.get(id);
      const r = right.get(id);
      return l !== undefined && r !== undefined && ledgerEquals(l, r);
    })
  );
}

/** Whether two cores hold the same fleet: the same ids, and equal tickets under each. */
export function graphEquals(left: TicketGraph, right: TicketGraph): boolean {
  const leftIds = ticketIds(left);
  return (
    listEquals(leftIds, ticketIds(right), sameValue) &&
    leftIds.every((id) => ticketEquals(ticketAt(left, id), ticketAt(right, id)))
  );
}
