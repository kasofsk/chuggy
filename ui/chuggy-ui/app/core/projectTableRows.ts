/**
 * One row of the project table: a ticket, joined to whatever it is running.
 *
 * The join is derived on the way to the screen rather than stored, so the two
 * reads behind it — the ticket page and the executions running now — stay
 * separate cache entries that separate frames fold into.
 *
 * THE FIRST COLUMN IS A SLOT. A ticket resource carries no intent, so what the
 * slot shows is the configuration revision the ticket's execution ran from,
 * which is the only thing on the wire that says what a ticket is made of. When
 * a ticket states its own intent, this is where it goes and the row's other
 * columns do not move.
 */

import type {
  ExecutionSummary,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type {
  ExecutionOutcome,
  ExecutionStatus,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";

import { projectExecutionIndexAt } from "./projectExecutionIndex.ts";
import type { ProjectExecutionIndex } from "./projectExecutionIndex.ts";
import { ticketBadgeLabel, ticketSectionOf } from "./ticketSections.ts";
import type { TicketSection } from "./ticketSections.ts";

export interface ProjectTableRow {
  readonly ticket: number;
  readonly phase: TicketPhase;
  readonly section: TicketSection;
  readonly badge: string | undefined;
  readonly configurationRevision: string | undefined;
  readonly executionStatus: ExecutionStatus | undefined;
  readonly executionOutcome: ExecutionOutcome | undefined;
  readonly runsOn: string | undefined;
  readonly sequence: number;
  readonly activityAt: string | undefined;
}

/** What the task was placed on, in the one phrase the requirement's mode makes
 * available: a container is its image and a native task is its driver. */
export function projectTableRunsOn(
  requirement: ExecutionSummary["requirement"],
): string {
  switch (requirement.mode) {
    case "Container":
      return requirement.image;
    case "Native":
      return requirement.driver;
  }
}

/** The ticket's own last activity is its sequence; an instant is the execution's,
 * because that is where the wire states one. */
export function projectTableRow(
  ticket: TicketResponse,
  execution: ExecutionSummary | undefined,
): ProjectTableRow {
  return {
    ticket: ticket.ticket,
    phase: ticket.phase,
    section: ticketSectionOf(ticket.phase),
    badge: ticketBadgeLabel(ticket.phase, ticket.reason),
    configurationRevision: execution?.configurationRevision,
    executionStatus: execution?.status,
    executionOutcome: execution?.outcome,
    runsOn:
      execution === undefined
        ? undefined
        : projectTableRunsOn(execution.requirement),
    sequence: ticket.sequence,
    activityAt: execution?.terminalAt ?? execution?.registeredAt,
  };
}

export function projectTableRows(
  tickets: readonly TicketResponse[],
  index: ProjectExecutionIndex,
): readonly ProjectTableRow[] {
  return tickets.map((ticket) =>
    projectTableRow(ticket, projectExecutionIndexAt(index, ticket.ticket)),
  );
}

export function projectTableRowsIn(
  rows: readonly ProjectTableRow[],
  section: TicketSection,
): readonly ProjectTableRow[] {
  return rows.filter((row) => row.section === section);
}
