/**
 * The board, derived: the live core joined with the annex, and nothing stored.
 *
 * WHAT A ROW SAYS IS READ, NOT REMEMBERED. Phase, budgets, deps, program and
 * tasks come off the core the drive holds at the moment of the render, so there
 * is no projection to keep current and no window in which the board and the
 * machine disagree. What is joined onto it is the annex, which is the only part
 * no decider has an opinion about.
 *
 * THE ENABLED ACTIONS ARE THE ENABLEMENT PREDICATES, referenced rather than
 * re-derived. A form the board offers is one the machine would take, and a
 * submission it would refuse comes back refused with the reason — so the two
 * cannot drift, because there is only one definition of each and the desk is
 * not it.
 *
 * A TICKET WITH NO ANNEX IS A TICKET, NOT AN ERROR. The arrival and its annex
 * row are two writes; a crash between them leaves the draft standing with
 * nothing written on it, and every row here carries the annex as something that
 * may be absent so the board renders that state rather than failing on it.
 */

import type { Config } from "../../domain/config.ts";
import { ticketAt, ticketIds, type Core } from "../../domain/core.ts";
import type { Reason, Resume } from "../../domain/desk.ts";
import {
  draftsIn,
  holdingIn,
  retryablesIn,
  revocablesIn,
} from "../../domain/enablement.ts";
import type { ProjectId, TicketId } from "../../domain/ids.ts";
import type { Phase } from "../../domain/phase.ts";
import type { Stage } from "../../domain/program.ts";
import type { Task } from "../../domain/task.ts";
import type { ArtifactMark, WrapUp } from "../../domain/wrapUp.ts";
import type { DeskEvent, TicketAnnex } from "../../interpreter/registry.ts";
import type { HttpApiArtifact } from "./artifacts.ts";

/** What the machine would take for a ticket now, each name the path segment its route answers on. */
export type DeskAction = "release" | "revoke" | "retry" | "gate";

/** Every action, in the order this file declares them, so a route can read the vocabulary rather than restate it. */
export const deskActions: readonly DeskAction[] = [
  "release",
  "revoke",
  "retry",
  "gate",
];

/** One line of the board: the machine's reading of a ticket, joined with what its author wrote. */
export interface BoardRow {
  readonly ticket: TicketId;
  readonly phase: Phase;
  readonly project: ProjectId;
  readonly annex: TicketAnnex | undefined;
  readonly gasLeft: number;
  readonly reworkLeft: number;
  readonly wrapUpLeft: number;
  readonly actions: readonly DeskAction[];
}

/** One ticket in full: its board line, the rest of the machine's record, and what the desk was told and handed. */
export interface TicketView {
  readonly row: BoardRow;
  readonly deps: readonly TicketId[];
  readonly program: readonly Stage[];
  readonly wrapUp: WrapUp;
  readonly artifact: ArtifactMark;
  readonly resumeAt: Resume;
  readonly reason: Reason;
  readonly spawned: number;
  readonly tasks: readonly Task[];
  readonly record: readonly Task[];
  readonly events: readonly DeskEvent[];
  readonly declared: readonly HttpApiArtifact[];
}

/** The actions enablement allows on this ticket, each conjunct a reference to the predicate the machine reads. */
function viewActions(
  config: Config,
  core: Core,
  ticket: TicketId,
): readonly DeskAction[] {
  const actions: DeskAction[] = [];
  if (draftsIn(core).includes(ticket)) actions.push("release");
  if (revocablesIn(core).includes(ticket)) actions.push("revoke");
  if (retryablesIn(config, core).includes(ticket)) actions.push("retry");
  if (holdingIn(core).includes(ticket)) actions.push("gate");
  return actions;
}

/** One row, derived at the moment it is asked for. */
export function viewRow(
  config: Config,
  core: Core,
  annexes: ReadonlyMap<TicketId, TicketAnnex>,
  ticket: TicketId,
): BoardRow {
  const held = ticketAt(core, ticket);
  return {
    ticket,
    phase: held.phase,
    project: held.project,
    annex: annexes.get(ticket),
    gasLeft: held.gasLeft,
    reworkLeft: held.reworkLeft,
    wrapUpLeft: held.wrapUpLeft,
    actions: viewActions(config, core, ticket),
  };
}

/** The whole board, in the ascending id order every fold over the fleet reads. */
export function viewBoard(
  config: Config,
  core: Core,
  annexes: ReadonlyMap<TicketId, TicketAnnex>,
): readonly BoardRow[] {
  return ticketIds(core).map((ticket) =>
    viewRow(config, core, annexes, ticket),
  );
}

/** One ticket in full, or nothing when the core holds no such ticket. */
export function viewTicket(
  config: Config,
  core: Core,
  annexes: ReadonlyMap<TicketId, TicketAnnex>,
  ticket: TicketId,
  events: readonly DeskEvent[],
  declared: readonly HttpApiArtifact[],
): TicketView | undefined {
  if (!core.tickets.has(ticket)) return undefined;
  const held = ticketAt(core, ticket);
  return {
    row: viewRow(config, core, annexes, ticket),
    deps: held.deps,
    program: held.program,
    wrapUp: held.wrapUp,
    artifact: held.artifact,
    resumeAt: held.resumeAt,
    reason: held.reason,
    spawned: held.spawned,
    tasks: held.tasks,
    record: held.record,
    events,
    declared,
  };
}
