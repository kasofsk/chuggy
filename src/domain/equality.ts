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
  TicketGraph,
  EvaluationInstance,
  ReleasedTicket,
  StageDefinition,
  Ticket,
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

function ticketEqualsInstance(
  left: EvaluationInstance,
  right: EvaluationInstance,
): boolean {
  return instanceEquals(left, right);
}

/** Whether two tickets carry the same record, every declared field compared. */
export function ticketEquals(left: Ticket, right: Ticket): boolean {
  return (
    left.phase === right.phase &&
    releasedTicketEquals(left.definition, right.definition) &&
    left.revision === right.revision &&
    left.source === right.source &&
    listEquals(left.evaluations, right.evaluations, ticketEqualsInstance) &&
    left.workCyclesStarted === right.workCyclesStarted &&
    left.spawned === right.spawned &&
    left.finalizationGeneration === right.finalizationGeneration &&
    left.escalation === right.escalation &&
    left.completions === right.completions
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
