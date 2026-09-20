/**
 * One row of the project table: a ticket, and what the rest of the project
 * says about it.
 *
 * Every field is the adopted read's own. The read answers the whole project in
 * one body, so a ticket's dependencies and the state of each of those tickets
 * arrive together and `waitingOn` is derived here rather than asked for.
 *
 * `UpNext` IS STILL EVERY PENDING TICKET, FOR A NEW REASON. Main's heading was
 * every pending ticket because the project read carried neither a ticket's
 * dependencies nor the state of what it waited on; both are on this wire, so
 * that reason has expired. What keeps the heading is the roster: the five
 * sections are the whole of where a ticket can be drawn, and moving the
 * blocked pending tickets out of "up next" would leave them in no section at
 * all — a row nobody removed and nobody can see. So the frontier is a fact of
 * the row instead of a boundary between sections: a pending ticket waiting on
 * nothing is the frontier, it says so by having an empty `waitingOn`, and
 * `projectTableRowsIn` draws those rows first.
 *
 * A DEPENDENCY IS WAITED ON UNTIL IT IS DONE, AND A REVOKED ONE IS NOT SPECIAL
 * HERE. A ticket whose dependency can never finish is one the machine
 * escalates, and it is drawn under "needs you" when it does; saying so first
 * from this side would be the console deciding something the machine decides.
 */

import type { AdoptedTicket } from "../../../../src/contract/adoptedTickets.ts";

import { ticketSectionOf } from "./ticketSections.ts";
import type { TicketSection } from "./ticketSections.ts";

export interface ProjectTableRow {
  readonly ticket: number;
  readonly state: AdoptedTicket["state"];
  readonly section: TicketSection;
  readonly revision: number;
  readonly workCyclesStarted: number;
  /** The tickets this one depends on that have not finished, in the order the
   * dependencies are stated. Empty means nothing is holding it. */
  readonly waitingOn: readonly number[];
}

/** A dependency the answer does not hold has not been seen to finish, so it is
 * waited on like any other: the alternative is drawing a ticket as ready
 * because something about it could not be read. */
function projectTableRowWaitingOn(
  ticket: AdoptedTicket,
  states: ReadonlyMap<number, AdoptedTicket["state"]>,
): readonly number[] {
  return ticket.dependencies.filter((on) => states.get(on) !== "Done");
}

export function projectTableRow(
  ticket: AdoptedTicket,
  states: ReadonlyMap<number, AdoptedTicket["state"]>,
): ProjectTableRow {
  return {
    ticket: ticket.ticket,
    state: ticket.state,
    section: ticketSectionOf(ticket.state),
    revision: ticket.revision,
    workCyclesStarted: ticket.workCyclesStarted,
    waitingOn: projectTableRowWaitingOn(ticket, states),
  };
}

export function projectTableRows(
  tickets: readonly AdoptedTicket[],
): readonly ProjectTableRow[] {
  const states = new Map(
    tickets.map((ticket) => [ticket.ticket, ticket.state] as const),
  );
  return tickets.map((ticket) => projectTableRow(ticket, states));
}

/** Whether nothing this ticket depends on is still to finish. */
export function projectTableRowUnblocked(row: ProjectTableRow): boolean {
  return row.waitingOn.length === 0;
}

/**
 * The rows of one section, in the read's own order — except under "up next",
 * where the tickets that could start now come first. That heading is the one
 * the reader is asking a question of rather than scanning, and a frontier
 * three rows down a list of forty answers it no better than no order at all.
 */
export function projectTableRowsIn(
  rows: readonly ProjectTableRow[],
  section: TicketSection,
): readonly ProjectTableRow[] {
  const held = rows.filter((row) => row.section === section);
  if (section !== "UpNext") return held;
  return [
    ...held.filter((row) => projectTableRowUnblocked(row)),
    ...held.filter((row) => !projectTableRowUnblocked(row)),
  ];
}
