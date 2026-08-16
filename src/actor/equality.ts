/**
 * Structural equality over the domain's observed vocabulary, one definition
 * per shape, each a conjunction over the shape's declared fields.
 *
 * The model compares records and states with its own `==`; here the replay
 * checker and the recovery obligation ask the same question, so the answer is
 * a pure function rather than a serialization the reader cannot audit. The
 * per-field spelling is deliberate: a field added to a domain type makes the
 * equality here a compile-time gap the moment the conjunction reads it, where
 * a generic deep comparison would silently start comparing it.
 */

import { assertNever } from "../domain/assertNever.ts";
import {
  ticketAt,
  ticketIds,
  type Core,
  type StepRecord,
  type Transition,
} from "../domain/core.ts";
import type { Stage } from "../domain/program.ts";
import { taskEquals } from "../domain/task.ts";
import type { Ticket } from "../domain/ticket.ts";
import {
  wrapUpEquals,
  type ArtifactMark,
  type WrapUpObs,
} from "../domain/wrapUp.ts";

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

function recordEqualsAttempt(left: WrapUpObs, right: WrapUpObs): boolean {
  switch (left.attempt) {
    case "WONone":
      return right.attempt === "WONone";
    case "WOAttempt":
      return (
        right.attempt === "WOAttempt" &&
        right.project === left.project &&
        right.invalidated === left.invalidated
      );
    default:
      return assertNever(left);
  }
}

/** Whether two step records observe the same decision, field by field. */
export function recordEquals(left: StepRecord, right: StepRecord): boolean {
  return (
    left.label === right.label &&
    listEquals(left.transitions, right.transitions, recordEqualsTransition) &&
    listEquals(left.effects, right.effects, sameValue) &&
    recordEqualsAttempt(left.attempt, right.attempt)
  );
}

function ticketEqualsArtifact(
  left: ArtifactMark,
  right: ArtifactMark,
): boolean {
  switch (left.artifact) {
    case "ANone":
      return right.artifact === "ANone";
    case "ASome":
      return right.artifact === "ASome" && right.mark === left.mark;
    default:
      return assertNever(left);
  }
}

function ticketEqualsStage(left: Stage, right: Stage): boolean {
  return left.fanout === right.fanout && left.combinator === right.combinator;
}

/** Whether two tickets carry the same record, every declared field compared. */
export function ticketEquals(left: Ticket, right: Ticket): boolean {
  return (
    left.phase === right.phase &&
    listEquals(left.deps, right.deps, sameValue) &&
    wrapUpEquals(left.wrapUp, right.wrapUp) &&
    ticketEqualsArtifact(left.artifact, right.artifact) &&
    left.project === right.project &&
    listEquals(left.program, right.program, ticketEqualsStage) &&
    listEquals(left.tasks, right.tasks, taskEquals) &&
    listEquals(left.record, right.record, taskEquals) &&
    left.spawned === right.spawned &&
    left.reworkLeft === right.reworkLeft &&
    left.wrapUpLeft === right.wrapUpLeft &&
    left.gasLeft === right.gasLeft &&
    left.resumeAt === right.resumeAt &&
    left.reason === right.reason
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
