/**
 * One row of the project table: a ticket, joined to whatever it is running.
 *
 * The join is derived on the way to the screen rather than stored, so the two
 * reads behind it — the ticket page and the index of what each ticket ran —
 * stay separate cache entries that separate frames fold into.
 *
 * THE FIRST COLUMN IS THE TICKET'S TITLE, which the wire carries on the ticket
 * itself: the title its brief names, or the first line of its intent where the
 * brief names none. Nothing here derives it.
 */

import type {
  ExecutionSummary,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";

import { capabilitiesShortened, workerLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import { projectExecutionIndexAt } from "./projectExecutionIndex.ts";
import type { ProjectExecutionIndex } from "./projectExecutionIndex.ts";
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
  readonly badge: string | undefined;
  /** The joined execution as the ticket's ledger judges it, a set of one, so
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
export function projectTableRunsOn(execution: ExecutionSummary): Label {
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
 * joined execution's, so a run that outlasted the ticket's own journal entry
 * still reads as the newer of the two. Every ticket carries `changedAt`, so
 * the column has no empty arm. */
export function projectTableRow(
  ticket: TicketResponse,
  execution: ExecutionSummary | undefined,
): ProjectTableRow {
  return {
    ticket: ticket.ticket,
    title: ticket.title,
    repository: ticket.repository,
    creator: ticket.creator,
    phase: ticket.phase,
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

export function projectTableRows(
  tickets: readonly TicketResponse[],
  index: ProjectExecutionIndex,
): readonly ProjectTableRow[] {
  return tickets.map((ticket) =>
    projectTableRow(ticket, projectExecutionIndexAt(index, ticket.ticket)),
  );
}
