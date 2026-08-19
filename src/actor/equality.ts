/**
 * Structural equality over the domain's observed vocabulary, one definition
 * per shape, each a conjunction over the shape's declared fields.
 *
 * The model compares records and states with its own `==`; here the replay
 * checker and the recovery obligation ask the same question, and the answer is
 * written out because `actor-sees-domain-only` in `.dependency-cruiser.cjs`
 * puts `node:util`'s deep compare outside this layer's graph. What is left is
 * a pure function of the domain's own types, which a reader can audit where a
 * serialization would not be.
 *
 * WHAT A CONJUNCTION CANNOT SAY IS THAT IT IS COMPLETE. A variant arm is total
 * by `assertNever` on its tag, but a product's conjunction compiles and
 * answers `true` on two values differing only in a field nobody conjoined —
 * which is `recoveryComplete` green on a state the journal cannot rebuild, and
 * `journalLegalOn` accepting a forged record. `test/actor/equality.test.ts`
 * holds each product shape to a `Record<keyof Shape, ...>` roster, so a field
 * added to a domain type is a compile error there and an unread field in the
 * roster is a failing case.
 */

import { ticketAt, ticketIds } from "../domain/core.ts";
import type {
  ArtifactMark,
  Core,
  Stage,
  StepRecord,
  Ticket,
  Transition,
} from "../domain/generated/modelTypes.ts";
import { tasksInIdOrder, taskEquals } from "../domain/task.ts";

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

/** Identity on the primitives: the ids, the effects, the ranks. */
function sameValue<Value extends number | string>(
  left: Value,
  right: Value,
): boolean {
  return left === right;
}

function recordEqualsTransition(left: Transition, right: Transition): boolean {
  return (
    left.ticket === right.ticket &&
    left.from === right.from &&
    left.to === right.to
  );
}

/** Whether two step records observe the same decision, field by field. */
export function recordEquals(left: StepRecord, right: StepRecord): boolean {
  return (
    left.label === right.label &&
    listEquals(left.transitions, right.transitions, recordEqualsTransition) &&
    listEquals(left.effects, right.effects, sameValue)
  );
}

function ticketEqualsArtifact(
  left: ArtifactMark,
  right: ArtifactMark,
): boolean {
  if (left === "NoArtifact") return right === "NoArtifact";
  return right !== "NoArtifact" && right.value === left.value;
}

/** The dependency set as a list, ascending, so two sets compare member by member. */
function depsInOrder(deps: ReadonlySet<number>): readonly number[] {
  return [...deps].sort((a, b) => a - b);
}

/** One pricing branch carries a budget and the other does not, so the tags compare first. */
function ticketEqualsPricing(
  left: Ticket["finalizationPricing"],
  right: Ticket["finalizationPricing"],
): boolean {
  if (left === "DeadlineOnly") return right === "DeadlineOnly";
  return right !== "DeadlineOnly" && right.value === left.value;
}

function ticketEqualsStage(left: Stage, right: Stage): boolean {
  return left.fanout === right.fanout && left.combinator === right.combinator;
}

/** Whether two tickets carry the same record, every declared field compared. */
export function ticketEquals(left: Ticket, right: Ticket): boolean {
  return (
    left.phase === right.phase &&
    listEquals(depsInOrder(left.deps), depsInOrder(right.deps), sameValue) &&
    left.finalizer === right.finalizer &&
    ticketEqualsArtifact(left.artifact, right.artifact) &&
    left.workFanout === right.workFanout &&
    left.reworkPolicy.value === right.reworkPolicy.value &&
    ticketEqualsPricing(left.finalizationPricing, right.finalizationPricing) &&
    left.resumePricing === right.resumePricing &&
    listEquals(left.program, right.program, ticketEqualsStage) &&
    listEquals(
      tasksInIdOrder(left.tasks),
      tasksInIdOrder(right.tasks),
      taskEquals,
    ) &&
    listEquals(left.record, right.record, taskEquals) &&
    left.spawned === right.spawned &&
    left.reworkLeft === right.reworkLeft &&
    left.finalizationLeft === right.finalizationLeft &&
    left.gasLeft === right.gasLeft &&
    left.resumeAt === right.resumeAt &&
    left.reason === right.reason &&
    left.completions === right.completions
  );
}

/** Whether two cores hold the same fleet: the same ids, and equal tickets under each. */
export function coreEquals(left: Core, right: Core): boolean {
  const leftIds = ticketIds(left);
  return (
    listEquals(leftIds, ticketIds(right), sameValue) &&
    leftIds.every((id) => ticketEquals(ticketAt(left, id), ticketAt(right, id)))
  );
}
