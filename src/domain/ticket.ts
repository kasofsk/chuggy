/**
 * One ticket's record, and the operations that grow and retire its task sets.
 *
 * ONE GHOST IS STORED AND THE OTHER IS NOT, and the model marks both. `spawned`
 * is a stored duplicate of a derivable fact on purpose: the equality against
 * the derivation is what catches a decider that dropped a task set instead of
 * retiring it, and a derived counter catches nothing. `completions` is absent
 * — `completionExclusive` proves it is exactly one when the phase is Done and
 * zero otherwise, so storing it would be a duplicate with nothing to check
 * against, and the golden comparison reconstructs it at the encode boundary.
 *
 * `reworkLeft` stays on the record while its ownership does not: the measure
 * needs its bounded digit, which is the model's concern, and the policy that
 * grants and prices it arrives as configuration at the boundary rather than as
 * a constant baked in here.
 */

import { assertNever } from "./assertNever.ts";
import type { Reason, Resume } from "./desk.ts";
import type { ProjectId, TicketId } from "./ids.ts";
import { isSettled, type Phase } from "./phase.ts";
import type { Stage } from "./program.ts";
import {
  evalStage,
  nextTaskId,
  retiredInIdOrder,
  spawnTasks,
  type Task,
  type TaskKind,
} from "./task.ts";
import type { ArtifactMark, WrapUp } from "./wrapUp.ts";

/** One ticket. The measure is a pure function of this. */
export interface Ticket {
  readonly phase: Phase;
  readonly deps: readonly TicketId[];
  readonly wrapUp: WrapUp;
  readonly artifact: ArtifactMark;
  readonly project: ProjectId;
  readonly program: readonly Stage[];
  readonly tasks: readonly Task[];
  readonly record: readonly Task[];
  readonly spawned: number;
  readonly reworkLeft: number;
  readonly wrapUpLeft: number;
  readonly gasLeft: number;
  readonly resumeAt: Resume;
  readonly reason: Reason;
}

/**
 * A desk task is open exactly while the ticket is parked, and parked is one
 * phase. Deriving it makes the equivalence hold by construction where storing
 * it would need the equivalence proved.
 */
export function hasOpenHumanTask(ticket: Ticket): boolean {
  return ticket.phase === "PEscalated";
}

/**
 * How many stages of the authored program have not yet passed: the digit
 * appears while evaluating and vanishes on every exit.
 */
export function stagesLeft(ticket: Ticket): number {
  return ticket.phase === "PEvaluating"
    ? ticket.program.length - evalStage(ticket.tasks)
    : 0;
}

/**
 * Install a fresh fan-out and bump the spawn ghost by the same count. Callers
 * guarantee the previous set is already retired, which every spawn site does.
 */
export function spawnOn(ticket: Ticket, kind: TaskKind, count: number): Ticket {
  if (ticket.tasks.length !== 0) {
    throw new Error(
      `spawnOn: ticket still holds ${String(ticket.tasks.length)} live task(s); the caller must retire first`,
    );
  }
  return {
    ...ticket,
    tasks: spawnTasks(
      kind,
      nextTaskId(ticket.record.length, ticket.tasks.length),
      count,
    ),
    spawned: ticket.spawned + count,
  };
}

/** Move the live set into the retained record, in id order, and leave it empty. */
export function retireLive(ticket: Ticket): Ticket {
  return {
    ...ticket,
    tasks: [],
    record: [...ticket.record, ...retiredInIdOrder(ticket.tasks)],
  };
}

/** Whether this ticket has reached one of the three settled phases. */
export function ticketIsSettled(ticket: Ticket): boolean {
  return isSettled(ticket.phase);
}

/**
 * The completion count the model stores as a ghost and this record does not.
 * It is reconstructed here so the one place that needs it — the comparison
 * against a golden state — has a single definition to read.
 */
export function completionsOf(ticket: Ticket): number {
  switch (ticket.phase) {
    case "PDone":
      return 1;
    case "PDraft":
    case "PPending":
    case "PWorking":
    case "PEvaluating":
    case "PWrapUp":
    case "PWrapUpHolding":
    case "PEscalated":
    case "PRevoked":
      return 0;
    default:
      return assertNever(ticket.phase);
  }
}
