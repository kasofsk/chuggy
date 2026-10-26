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
 *
 * A row says which of three things is true of its execution columns:
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

import type {
  ExecutionSummary,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type {
  ExecutionOutcome,
  ExecutionStatus,
  TicketPhase,
} from "../../../../src/contract/rosters.ts";

import { capabilitiesShortened, workerLabel } from "./labels.ts";
import type { Label } from "./labels.ts";
import { projectExecutionIndexAt } from "./projectExecutionIndex.ts";
import type {
  ProjectExecutionIndex,
  ProjectExecutionKnown,
} from "./projectExecutionIndex.ts";
import { executionStopped } from "./ticketLedger.ts";
import { ticketBadgeLabel } from "./ticketSections.ts";
import type { UpNextOpenDependency } from "./upNextOrder.ts";

export const projectTableExecutionReads = [
  "Joined",
  "NoneRegistered",
  "IndexTruncated",
] as const;
export type ProjectTableExecutionRead =
  (typeof projectTableExecutionReads)[number];

export interface ProjectTableRow {
  readonly ticket: number;
  readonly title: string | undefined;
  /** The principal who filed the ticket, absent where the wire names none;
   * drawn by `creatorLabel` against the project's people. */
  readonly creator: string | undefined;
  readonly phase: TicketPhase;
  readonly badge: string | undefined;
  readonly executionRead: ProjectTableExecutionRead;
  readonly executionStatus: ExecutionStatus | undefined;
  readonly executionOutcome: ExecutionOutcome | undefined;
  /** Whether the ticket's ledger draws the joined execution as a stop rather
   * than a judgement, as it does an evaluator whose process failed. */
  readonly executionStopped: boolean;
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

/** An entry no walk finished is not this ticket's latest, so the row is one the
 * index did not answer rather than one it did. */
export function projectTableExecutionRead(
  known: ProjectExecutionKnown | undefined,
  indexTruncated: boolean,
): ProjectTableExecutionRead {
  if (known !== undefined) return known.complete ? "Joined" : "IndexTruncated";
  return indexTruncated ? "IndexTruncated" : "NoneRegistered";
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
  known: ProjectExecutionKnown | undefined,
  indexTruncated: boolean,
): ProjectTableRow {
  const read = projectTableExecutionRead(known, indexTruncated);
  const execution = read === "Joined" ? known?.execution : undefined;
  return {
    ticket: ticket.ticket,
    title: ticket.title,
    creator: ticket.creator,
    phase: ticket.phase,
    badge: ticketBadgeLabel(ticket.phase, ticket.escalation),
    executionRead: read,
    executionStatus: execution?.status,
    executionOutcome: execution?.outcome,
    executionStopped: execution !== undefined && executionStopped(execution),
    runsOn: execution === undefined ? undefined : projectTableRunsOn(execution),
    activityAt: laterActivityAt(
      ticket.changedAt,
      execution?.terminalAt ?? execution?.registeredAt,
    ),
    openDependencies: ticket.openDependencies,
    revokedDependencies: ticket.revokedDependencies,
  };
}

/** The one word an outcome is drawn as, the ledger's: a stop is Blocked, a
 * failed process otherwise Failed, and any other outcome its own spelling. */
function executionOutcomeWord(
  outcome: ExecutionOutcome,
  stopped: boolean,
): string {
  if (stopped) return "Blocked";
  return outcome === "ProcessFailed" ? "Failed" : outcome;
}

/** The one word a status is drawn as where no outcome refines it. A terminal
 * execution reaches an outcome, so `Finished` is drawn only for one whose
 * outcome did not arrive. */
function executionStatusWord(status: ExecutionStatus): string {
  return status === "Terminal" ? "Finished" : status;
}

/** The outcome where the execution has reached one, the status where it has
 * not, and nothing at all where no execution is joined to the row. */
export function projectTableExecutionPhrase(
  row: ProjectTableRow,
): string | undefined {
  if (row.executionStatus === undefined) return undefined;
  return row.executionOutcome === undefined
    ? executionStatusWord(row.executionStatus)
    : executionOutcomeWord(row.executionOutcome, row.executionStopped);
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
