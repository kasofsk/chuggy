/**
 * What a ticket does with its own fields: what a park implies, and the two
 * sites that move its task set.
 *
 * The record is the model's, so `completions` is a stored ghost here as it is
 * there rather than reconstructed from the phase — a stored duplicate of a
 * derivable fact is a finding, and this one is the model's own accounting,
 * carried so a golden state compares field for field.
 */

import type {
  Escalation,
  Resume,
  StageDefinition,
  Task,
  TaskIdentity,
  Ticket,
} from "./generated/modelTypes.ts";
import { isSettled } from "./phase.ts";
import {
  evaluationTaskOf,
  retiredInEvaluatorKeyOrder,
  spawnTasks,
  workTaskOf,
} from "./task.ts";

/**
 * A desk task is open exactly while the ticket is parked, and parked is one
 * phase. Deriving it makes the equivalence hold by construction where storing
 * it would need the equivalence proved.
 */
export function hasOpenHumanTask(ticket: Ticket): boolean {
  return ticket.phase === "Escalated";
}

/**
 * Where each wall resumes, total on the sum, so every park offers the desk
 * exactly one continuation and the unparked ticket offers none — which is what
 * lets the resume point stay off the ticket rather than sit beside the wall
 * that implies it. The two work walls and the evaluation-failure wall all buy
 * a new artifact; only the walls they answer differ.
 */
export function resumeOf(escalation: Escalation): Resume {
  switch (escalation) {
    case "NoEscalation":
      return "NoResume";
    case "WorkFailureEscalated":
    case "WorkExecutionUnavailableEscalated":
      return "ResumeWork";
    case "EvaluationFailureEscalated":
      return "ResumeRework";
    case "EvaluationBlockedEscalated":
      return "ResumeEvaluation";
    case "FinalizationUnavailableEscalated":
      return "ResumeFinalization";
  }
}

/**
 * Install a fresh fan-out under the identities the caller names and bump the
 * spawn ghost by the same count. Callers guarantee the previous set is already
 * retired, which every spawn site does.
 */
export function spawnOn(
  ticket: Ticket,
  identities: readonly TaskIdentity[],
): Ticket {
  if (ticket.tasks.size !== 0) {
    throw new Error(
      `spawnOn: ticket still holds ${String(ticket.tasks.size)} live task(s); the caller must retire first`,
    );
  }
  return {
    ...ticket,
    tasks: spawnTasks(identities),
    spawned: ticket.spawned + identities.length,
  };
}

/**
 * The work spawn: a work cycle is one task, always. Work is not staged and
 * lists no evaluators, so the only fan-out left is an evaluation stage's
 * roster, and every work spawn site is this call — which is also the only
 * thing that moves the counter the identity is drawn from.
 */
export function spawnWork(ticket: Ticket, id: number): Ticket {
  const cycle = ticket.workCyclesStarted + 1;
  return {
    ...spawnOn(ticket, [workTaskOf(id, cycle)]),
    workCyclesStarted: cycle,
  };
}

/**
 * The stage a ticket's program holds at this index, which every caller here
 * needs and none may improvise. An index outside the program is a caller bug,
 * not a state the machine reaches.
 */
export function stageAt(ticket: Ticket, index: number): StageDefinition {
  const stage = ticket.program[index];
  if (stage === undefined) {
    throw new Error(
      `stageAt: stage ${String(index)} is outside a program of ${String(ticket.program.length)}`,
    );
  }
  return stage;
}

/**
 * Which run of this stage the current cycle is on, counted at the stage's
 * first listed evaluator key because every run spawns exactly one of that key.
 * Every stage runs once per cycle but one: an evaluation park resumes at the
 * lowest stage, re-entering a stage the cycle may already have spawned, and
 * the generation is what keeps the second run's identities distinct from the
 * first's.
 */
export function stageGeneration(ticket: Ticket, index: number): number {
  const stage = stageAt(ticket, index);
  const first = stage.evaluators[0];
  if (first === undefined)
    throw new Error(
      `stageGeneration: stage ${String(index)} lists no evaluator`,
    );
  return (
    1 +
    ticket.record.filter(
      (t) =>
        t.identity.type === "EvaluationTask" &&
        t.identity.value.workCycle === ticket.workCyclesStarted &&
        t.identity.value.stage === stage.key &&
        t.identity.value.evaluator === first.key,
    ).length
  );
}

/**
 * The evaluation spawn: one task per evaluator the stage lists, under the key
 * it was authored with and naming the work cycle it judges. The roster is read
 * off the program here, so no caller can hand this a count.
 */
export function spawnEvalStage(
  ticket: Ticket,
  id: number,
  index: number,
): Ticket {
  const stage = stageAt(ticket, index);
  const generation = stageGeneration(ticket, index);
  return spawnOn(
    ticket,
    stage.evaluators.map((evaluator) =>
      evaluationTaskOf(
        id,
        ticket.workCyclesStarted,
        stage.key,
        generation,
        evaluator.key,
      ),
    ),
  );
}

/** Move the live set into the retained record, by ascending evaluator key, and leave it empty. */
export function retireLive(ticket: Ticket): Ticket {
  return {
    ...ticket,
    tasks: new Set<Task>(),
    record: [...ticket.record, ...retiredInEvaluatorKeyOrder(ticket.tasks)],
  };
}

/** Whether this ticket has reached one of the absorbing terminals. */
export function ticketIsSettled(ticket: Ticket): boolean {
  return isSettled(ticket.phase);
}
