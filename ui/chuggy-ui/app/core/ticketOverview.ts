/**
 * What the Overview's sidebar and its banner say of a ticket beside its runs:
 * the branch and where it lands, what it waits on, how long its runs have
 * taken, and the draft's edits not yet released.
 *
 * A RUN'S TIME IS ITS SPAN, as the Runs tab reads it, and the ticket's is the
 * sum of its runs' rather than one span across them, so a wait between two
 * runs is not counted as either.
 */

import type {
  DraftResponse,
  ExecutionSummary,
  TicketResponse,
} from "../../../../src/contract/responses.ts";
import type { TicketPhase } from "../../../../src/contract/rosters.ts";
import { durationFigure } from "./figures.ts";
import type { Figure } from "./figures.ts";
import { branchName } from "./labels.ts";
import { runSpanRanOf } from "./runTotals.ts";
import { draftReleaseOf } from "./ticketEdit.ts";
import type { TicketLanding } from "./ticketLandings.ts";

/** The branch the work happens on and the one it lands on, each by its name. */
export interface TicketOverviewBranch {
  readonly branch: string;
  readonly target: string | undefined;
}

/**
 * The brief's branch, and the branch it lands on: the brief's own target, or
 * the one its newest landing named where the brief left it to its repository.
 * A ticket that lands nothing lands on no branch.
 */
export function ticketOverviewBranchOf(
  ticket: TicketResponse,
  landings: readonly TicketLanding[],
): TicketOverviewBranch | undefined {
  const brief = ticket.brief;
  if (brief?.branch === undefined) return undefined;
  const finalization = brief.finalization;
  const newest = landings.at(-1)?.detail;
  const target =
    finalization?.mode === "None"
      ? undefined
      : (finalization?.target ?? newest?.proposal?.base ?? newest?.targetRef);
  return {
    branch: branchName(brief.branch),
    target: target === undefined ? undefined : branchName(target),
  };
}

function ticketOverviewLive(row: ExecutionSummary): boolean {
  return row.status !== "Terminal" && row.status !== "Cancelled";
}

/** Whether any of the ticket's runs is still going, which makes every sum
 * over them one that is still growing. */
export function ticketOverviewRunning(
  executions: readonly ExecutionSummary[],
): boolean {
  return executions.some(ticketOverviewLive);
}

/** The runs' spans added, a run still going counted to now; none before the
 * first run. */
export function ticketOverviewRunTime(
  executions: readonly ExecutionSummary[],
  nowMs: number,
): Figure | undefined {
  if (executions.length === 0) return undefined;
  let ranMs = 0;
  for (const execution of executions) {
    const span = runSpanRanOf([execution]);
    const fromMs = span.from === undefined ? NaN : Date.parse(span.from);
    const toMs = span.to === undefined ? nowMs : Date.parse(span.to);
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs)
      ranMs += toMs - fromMs;
  }
  return durationFigure(ranMs);
}

/** A dependency and the phase it is at. */
export interface TicketOverviewDependency {
  readonly ticket: number;
  readonly phase: TicketPhase;
}

/** Each dependency the ticket's release named, at the phase it is at: a
 * revoked one as revoked, an open one at its own phase, and any other done. */
export function ticketOverviewDependenciesOf(
  ticket: TicketResponse,
): readonly TicketOverviewDependency[] {
  return (ticket.dependencies ?? []).map((number) => ({
    ticket: number,
    phase: ticket.revokedDependencies.includes(number)
      ? "Revoked"
      : (ticket.openDependencies.find((open) => open.ticket === number)
          ?.phase ?? "Done"),
  }));
}

/** How many edits the draft holds that no update has released, as the
 * banner's line, and none where it holds none. */
export function ticketOverviewUnreleased(
  draft: DraftResponse,
): string | undefined {
  const release = draftReleaseOf(draft);
  if (release.release !== "Ahead") return undefined;
  const count = release.current - release.released;
  return `${String(count)} unreleased ${count === 1 ? "change" : "changes"}`;
}
