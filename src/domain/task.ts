/**
 * What the machine does with a task's identity and obligation: name one,
 * compare two, and hold each to the contract's own validity claim.
 *
 * The ticket keeps no task set. What it is running is derived from its phase
 * and its current run (`liveObligations` in `src/domain/ticket.ts`), so
 * nothing here resolves or retires a task.
 */

import type {
  TaskDefinition,
  TaskIdentity,
  TaskObligation,
} from "./generated/modelTypes.ts";

/** The work task of one cycle — the only task a work cycle runs. */
export function workTaskOf(ticket: number, cycle: number): TaskIdentity {
  return { type: "WorkTask", value: { ticket, cycle } };
}

/**
 * One evaluator of one run of one stage, under the two keys the plan
 * authored. No offset is applied: a caller holding a stage index passes that
 * stage's key, which the positional rule makes the same number.
 */
export function evaluationTaskOf(
  ticket: number,
  workCycle: number,
  stage: number,
  generation: number,
  evaluator: number,
): TaskIdentity {
  return {
    type: "EvaluationTask",
    value: { ticket, workCycle, stage, generation, evaluator },
  };
}

/** Structural equality on an identity: same arm, same fields. */
export function taskIdentityEquals(
  left: TaskIdentity,
  right: TaskIdentity,
): boolean {
  if (left.type === "WorkTask") {
    return (
      right.type === "WorkTask" &&
      left.value.ticket === right.value.ticket &&
      left.value.cycle === right.value.cycle
    );
  }
  return (
    right.type === "EvaluationTask" &&
    left.value.ticket === right.value.ticket &&
    left.value.workCycle === right.value.workCycle &&
    left.value.stage === right.value.stage &&
    left.value.generation === right.value.generation &&
    left.value.evaluator === right.value.evaluator
  );
}

/** The ticket an identity belongs to, whichever arm it is. */
export function taskOwner(identity: TaskIdentity): number {
  return identity.value.ticket;
}

/**
 * The contract's own claim about an identity (`taskIdentityValid` in
 * `model/task-contract/task.qnt`): every counter it carries is positive.
 */
export function taskIdentityValid(identity: TaskIdentity): boolean {
  if (identity.type === "WorkTask")
    return identity.value.ticket > 0 && identity.value.cycle > 0;
  return (
    identity.value.ticket > 0 &&
    identity.value.workCycle > 0 &&
    identity.value.stage > 0 &&
    identity.value.generation > 0 &&
    identity.value.evaluator > 0
  );
}

/**
 * The contract's claim about a definition (`taskDefinitionValid`): every
 * reference it names is a real one.
 */
export function taskDefinitionValid(definition: TaskDefinition): boolean {
  return (
    definition.workload > 0 &&
    definition.inputs > 0 &&
    definition.executionRequirements > 0 &&
    definition.resultContract > 0
  );
}

/** The contract's claim about an obligation (`taskObligationValid`). */
export function taskObligationValid(obligation: TaskObligation): boolean {
  return (
    taskIdentityValid(obligation.task) &&
    taskDefinitionValid(obligation.definition) &&
    obligation.contextRef > 0
  );
}

/** Structural equality on a definition: the four references, field for field. */
export function taskDefinitionEquals(
  left: TaskDefinition,
  right: TaskDefinition,
): boolean {
  return (
    left.workload === right.workload &&
    left.inputs === right.inputs &&
    left.executionRequirements === right.executionRequirements &&
    left.resultContract === right.resultContract
  );
}

/**
 * Structural equality on an obligation, which is what admits a produced
 * report: the task, the definition it runs under and the context it was
 * spawned for, all three.
 */
export function taskObligationEquals(
  left: TaskObligation,
  right: TaskObligation,
): boolean {
  return (
    taskIdentityEquals(left.task, right.task) &&
    taskDefinitionEquals(left.definition, right.definition) &&
    left.contextRef === right.contextRef
  );
}
