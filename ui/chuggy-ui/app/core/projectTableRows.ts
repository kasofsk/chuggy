/**
 * One row of the project table: a ticket, joined to whatever it is running.
 *
 * The join is derived on the way to the screen rather than stored, so the two
 * reads behind it — the ticket page and the index of what each ticket ran —
 * stay separate cache entries that separate frames fold into.
 *
 * THE FIRST COLUMN IS A SLOT. A ticket resource carries no intent, so what the
 * slot shows is the configuration revision the ticket's execution ran from,
 * which is the only thing on the wire that says what a ticket is made of. When
 * a ticket states its own intent, this is where it goes and the row's other
 * columns do not move.
 *
 * A row therefore says which of three things is true of its execution columns:
 * they are joined, this ticket has never run, or what the index holds for it is
 * not answerable. The third is drawn as itself, because a dash meaning "not
 * read" and a dash meaning "never ran" are the same dash.
 *
 * AND JOINED IS DECIDED ON COMPLETENESS, NOT ON PRESENCE. An entry a truncated
 * walk left behind may have been superseded by an execution that walk never
 * reached, so drawing it as current would report a failed ticket as passed —
 * the same conflation, one level down. Such a row is unreachable rather than
 * joined, and its execution columns are not filled from an answer that may be
 * stale.
 */

import type { TicketResponse } from "../../../../src/contract/responses.ts";
import type {
  ExecutionOutcome,
  ExecutionStatus,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";

import { projectExecutionIndexAt } from "./projectExecutionIndex.ts";
import type {
  ProjectExecutionIndex,
  ProjectExecutionKnown,
} from "./projectExecutionIndex.ts";
import { ticketBadgeLabel, ticketSectionOf } from "./ticketSections.ts";
import type { TicketSection } from "./ticketSections.ts";

export const projectTableExecutionReads = [
  "Joined",
  "NoneRegistered",
  "IndexTruncated",
] as const;
export type ProjectTableExecutionRead =
  (typeof projectTableExecutionReads)[number];

export interface ProjectTableRow {
  readonly ticket: number;
  readonly phase: TicketPhase;
  readonly section: TicketSection;
  readonly badge: string | undefined;
  readonly executionRead: ProjectTableExecutionRead;
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
  requirement: ProjectExecutionKnown["execution"]["requirement"],
): string {
  switch (requirement.mode) {
    case "Container":
      return requirement.image;
    case "Native":
      return requirement.driver;
  }
}

/** An entry no walk finished is not this ticket's latest, so the row is one the
 * index did not answer rather than one it did. */
export function projectTableExecutionRead(
  known: ProjectExecutionKnown | undefined,
  indexTruncated: boolean,
): ProjectTableExecutionRead {
  if (known !== undefined) return known.complete ? "Joined" : "IndexTruncated";
  return indexTruncated ? "IndexTruncated" : "NoneRegistered";
}

/** The ticket's own last activity is its sequence; an instant is the execution's,
 * because that is where the wire states one. */
export function projectTableRow(
  ticket: TicketResponse,
  known: ProjectExecutionKnown | undefined,
  indexTruncated: boolean,
): ProjectTableRow {
  const read = projectTableExecutionRead(known, indexTruncated);
  const execution = read === "Joined" ? known?.execution : undefined;
  return {
    ticket: ticket.ticket,
    phase: ticket.phase,
    section: ticketSectionOf(ticket.phase),
    badge: ticketBadgeLabel(ticket.phase, ticket.reason),
    executionRead: read,
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
    projectTableRow(
      ticket,
      projectExecutionIndexAt(index, ticket.ticket),
      index.truncated,
    ),
  );
}

export function projectTableRowsIn(
  rows: readonly ProjectTableRow[],
  section: TicketSection,
): readonly ProjectTableRow[] {
  return rows.filter((row) => row.section === section);
}
