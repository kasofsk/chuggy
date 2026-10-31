/**
 * One row of the project table: a ticket, and what its latest execution says
 * it is running, which the tickets list carries on the ticket itself.
 *
 * THE FIRST COLUMN IS THE TICKET'S TITLE, which the wire carries on the ticket
 * itself: the title its brief names, or the first line of its intent where the
 * brief names none. Nothing here derives it.
 */

import type {
  ProjectTicket,
  TicketLatestExecution,
} from "../../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import { capabilitiesShortened, workerLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
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
  readonly badge: string | undefined;
  /** The latest execution as the ticket's ledger judges it, a set of one, so
   * the row draws it in the word and hue the ticket page does. */
  readonly executionVerdict: SetVerdict | undefined;
  readonly runsOn: Label | undefined;
  readonly activityAt: string;
  readonly openDependencies: readonly UpNextOpenDependency[];
  readonly revokedDependencies: readonly number[];
}

/** What the task was placed on, named where the catalog names it: a container
 * is its worker or the image the catalog holds no worker for, a capability task
 * is what it asked its runner for. */
export function projectTableRunsOn(execution: TicketLatestExecution): Label {
  const requirement = execution.requirement;
  switch (requirement.mode) {
    case "Container":
      return workerLabel(execution.worker, requirement.image);
    case "Capability":
      return {
        text: capabilitiesShortened(requirement.capabilities),
        title: requirement.capabilities.join(", "),
      };
  }
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
    runsOn: execution === undefined ? undefined : projectTableRunsOn(execution),
    activityAt: laterActivityAt(
      ticket.changedAt,
      execution?.terminalAt ?? execution?.registeredAt,
    ),
    openDependencies: ticket.openDependencies,
    revokedDependencies: ticket.revokedDependencies,
  };
}
