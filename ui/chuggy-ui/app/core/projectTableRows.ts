/**
 * One row of the project table: a ticket, and how its latest execution
 * stands, which the tickets list carries on the ticket itself.
 *
 * THE FIRST COLUMN IS THE TICKET'S TITLE, which the wire carries on the ticket
 * itself: the title its brief names, or the first line of its intent where the
 * brief names none. Nothing here derives it.
 */

import type { ProjectTicket } from "../../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import type { Copy } from "./copy.ts";
import { setVerdict } from "./ticketLedger.ts";
import type { SetVerdict } from "./ticketLedger.ts";
import { ticketBadgeLabel } from "./ticketSections.ts";
import type { UpNextOpenDependency } from "./upNextOrder.ts";

export interface ProjectTableRow {
  readonly ticket: number;
  readonly title: string | undefined;
  /** The repository the ticket's released brief names, absent where the wire
   * names none; drawn by `repositoryLabel`. */
  readonly repository: string | undefined;
  /** The principal who filed the ticket, absent where the wire names none;
   * drawn by `creatorLabel` against the project's people. */
  readonly creator: string | undefined;
  readonly phase: TicketPhase;
  /** The journal entry that last changed the ticket's own row, which is the
   * version a Dispatch from the row expects. */
  readonly sequence: number;
  readonly badge: Copy | undefined;
  /** The latest execution as the ticket's ledger judges it, a set of one, so
   * the row draws it in the word and hue the ticket page does. */
  readonly executionVerdict: SetVerdict | undefined;
  readonly activityAt: string;
  readonly openDependencies: readonly UpNextOpenDependency[];
  readonly revokedDependencies: readonly number[];
  /** The epics the ticket belongs to, none where it belongs to none. */
  readonly epics?: ProjectTicket["epics"] | undefined;
}

/** The later of two instants a row's activity might carry, compared as
 * instants rather than as strings, because a lexical compare gets a
 * timezone-shifted wire string wrong. */
function laterActivityAt(
  changedAt: string,
  executionAt: string | undefined,
): string {
  if (executionAt === undefined) return changedAt;
  return Date.parse(executionAt) > Date.parse(changedAt)
    ? executionAt
    : changedAt;
}

/** The ticket's own last activity is the later of its own last move and its
 * latest execution's, so a run that outlasted the ticket's own journal entry
 * still reads as the newer of the two. Every ticket carries `changedAt`, so
 * the column has no empty arm. */
export function projectTableRow(ticket: ProjectTicket): ProjectTableRow {
  const execution = ticket.latestExecution;
  return {
    ticket: ticket.ticket,
    title: ticket.title,
    repository: ticket.repository,
    creator: ticket.creator,
    phase: ticket.phase,
    sequence: ticket.sequence,
    badge: ticketBadgeLabel(ticket.phase, ticket.escalation),
    executionVerdict:
      execution === undefined ? undefined : setVerdict([execution]),
    activityAt: laterActivityAt(
      ticket.changedAt,
      execution?.terminalAt ?? execution?.registeredAt,
    ),
    openDependencies: ticket.openDependencies,
    revokedDependencies: ticket.revokedDependencies,
    epics: ticket.epics,
  };
}
