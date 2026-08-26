/**
 * What each ticket ran, kept by ticket so that one execution's frame moves one
 * row, and marked with whether that answer is provably the ticket's latest.
 *
 * A ticket may have had several executions and the table has one column for
 * them, so the index holds the latest one it saw registered — what is running
 * while it runs, and its terminal outcome afterwards, which is also where a
 * settled ticket's configuration revision comes from.
 *
 * THE READ IS TWO WALKS, AND NEITHER ARGUMENT DEPENDS ON AN ORDERING. The
 * executions route pages an identity that `src/interpreter/schedulerIdentity.ts`
 * declares opaque, so what a walk stopped at its page budget holds is an
 * arbitrary subset and not an era: the newest may be inside it and the oldest
 * outside. That is why a truncated walk over every status is followed by one
 * over the non-terminal executions, whose size is bounded by what a cluster can
 * run at once — a complete enumeration of that set answers what is running for
 * every ticket in it, whatever the first walk happened to reach.
 *
 * SO AN ENTRY CARRIES WHETHER THE WALK THAT PUT IT THERE FINISHED. An entry
 * from a walk that stopped early is a ticket's latest only by accident — the
 * execution that superseded it may be one of the ones not reached — and a row
 * drawing it as current would report a failed ticket as passed. Presence is not
 * completeness, and `complete` is the difference; a live frame is complete,
 * because the stream reports every change and the frame is the newest thing
 * that has happened to that execution. That is less than the frame being the
 * ticket's latest — a truncated index given a frame about a superseded
 * execution promotes that one — and it is the trade taken deliberately, because
 * the alternative leaves a truncated index saying "not read" for as long as the
 * tab is open.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import { executionSummarySchema } from "../../../../src/contract/responses.ts";
import type {
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import type { ExecutionsPage } from "./apiRoutes.ts";

/** Pages per walk. A project whose history outruns this is one whose unreached
 * rows say so, and the walk after it is what keeps the running rows exact. */
export const projectExecutionPagesMax = 8;

export type ProjectExecutionSelection = "All" | "NonTerminal";

export interface ProjectExecutionKnown {
  readonly execution: ExecutionSummary;
  readonly complete: boolean;
}

export interface ProjectExecutionIndex {
  readonly latest: Readonly<Record<string, ProjectExecutionKnown>>;
  readonly truncated: boolean;
}

export const projectExecutionIndexEmpty: ProjectExecutionIndex = {
  latest: {},
  truncated: false,
};

/** What a screen joins against before the read answers, and after one that
 * failed: empty, but not claiming that no ticket has ever run. */
export const projectExecutionIndexUnread: ProjectExecutionIndex = {
  latest: {},
  truncated: true,
};

/** Later registration wins, and the execution's own identity breaks a tie so
 * that the answer does not depend on the order the wire gave. */
function projectExecutionLater(
  held: ProjectExecutionKnown | undefined,
  arriving: ExecutionSummary,
): boolean {
  if (held === undefined) return true;
  const mine = held.execution;
  if (mine.execution === arriving.execution) return true;
  if (mine.registeredAt === arriving.registeredAt)
    return mine.execution < arriving.execution;
  return mine.registeredAt < arriving.registeredAt;
}

function projectExecutionIndexWith(
  latest: Readonly<Record<string, ProjectExecutionKnown>>,
  executions: readonly ExecutionSummary[],
  complete: boolean,
): Record<string, ProjectExecutionKnown> {
  const gathered: Record<string, ProjectExecutionKnown> = { ...latest };
  for (const execution of executions) {
    const at = String(execution.ticket);
    if (projectExecutionLater(gathered[at], execution))
      gathered[at] = { execution, complete };
  }
  return gathered;
}

/** Every entry a finished walk left, promoted at once: which of them is the
 * ticket's latest is only knowable when the walk that gathered them ends. */
function projectExecutionIndexCompleted(
  latest: Readonly<Record<string, ProjectExecutionKnown>>,
): Record<string, ProjectExecutionKnown> {
  const promoted: Record<string, ProjectExecutionKnown> = {};
  for (const [at, known] of Object.entries(latest))
    promoted[at] = { ...known, complete: true };
  return promoted;
}

function projectExecutionIndexMerged(
  held: Readonly<Record<string, ProjectExecutionKnown>>,
  arriving: Readonly<Record<string, ProjectExecutionKnown>>,
): Record<string, ProjectExecutionKnown> {
  const merged: Record<string, ProjectExecutionKnown> = { ...held };
  for (const [at, known] of Object.entries(arriving))
    if (projectExecutionLater(merged[at], known.execution)) merged[at] = known;
  return merged;
}

/** The index a complete set of executions makes, which is what a caller holding
 * one already has. */
export function projectExecutionIndexOf(
  executions: readonly ExecutionSummary[],
): ProjectExecutionIndex {
  return {
    latest: projectExecutionIndexWith({}, executions, true),
    truncated: false,
  };
}

export function projectExecutionIndexAt(
  index: ProjectExecutionIndex,
  ticket: number,
): ProjectExecutionKnown | undefined {
  return index.latest[String(ticket)];
}

interface ProjectExecutionWalk {
  readonly latest: Readonly<Record<string, ProjectExecutionKnown>>;
  readonly pagesRead: number;
  readonly finished: boolean;
  readonly failure: ApiFailure | undefined;
}

export type ProjectExecutionReadPage = (
  selection: ProjectExecutionSelection,
  after: string | undefined,
) => Promise<ApiResult<ExecutionsResponse>>;

/** The page one step of a walk asks for: the size it wants, the selection it is
 * walking, and the cursor the page before it answered with. */
export function projectExecutionPage(
  selection: ProjectExecutionSelection,
  after: string | undefined,
): ExecutionsPage {
  return {
    limit: nativeHttpPageItemsMax,
    ...(selection === "NonTerminal" ? { state: selection } : {}),
    ...(after === undefined ? {} : { after }),
  };
}

/**
 * One walk under the page budget, gathering entries no page can yet call
 * complete. A refusal ends it with what it had, and only a walk the wire ended
 * is finished.
 */
async function projectExecutionWalk(
  selection: ProjectExecutionSelection,
  readPage: ProjectExecutionReadPage,
): Promise<ProjectExecutionWalk> {
  let latest: Readonly<Record<string, ProjectExecutionKnown>> = {};
  let after: string | undefined;
  for (let page = 0; page < projectExecutionPagesMax; page += 1) {
    const answered = await readPage(selection, after);
    if (answered.outcome !== "Ok")
      return { latest, pagesRead: page, finished: false, failure: answered };
    latest = projectExecutionIndexWith(
      latest,
      answered.value.executions,
      false,
    );
    after = answered.value.nextAfter;
    if (after === undefined)
      return {
        latest: projectExecutionIndexCompleted(latest),
        pagesRead: page + 1,
        finished: true,
        failure: undefined,
      };
  }
  return {
    latest,
    pagesRead: projectExecutionPagesMax,
    finished: false,
    failure: undefined,
  };
}

/**
 * The index a screen reads, walked under its budget and marked where the wire
 * had more to give than the budget allowed. A read that gathered nothing
 * answers with its refusal, so the panel draws the failure rather than an index
 * that looks empty.
 */
export async function projectExecutionIndexRead(
  readPage: ProjectExecutionReadPage,
): Promise<ApiResult<ProjectExecutionIndex>> {
  const all = await projectExecutionWalk("All", readPage);
  if (all.failure !== undefined && all.pagesRead === 0) return all.failure;
  if (all.finished)
    return { outcome: "Ok", value: { latest: all.latest, truncated: false } };
  const running = await projectExecutionWalk("NonTerminal", readPage);
  return {
    outcome: "Ok",
    value: {
      latest: projectExecutionIndexMerged(all.latest, running.latest),
      truncated: true,
    },
  };
}

/**
 * An `Execution` frame folded in: the representation is the execution read's own
 * body, and a frame that will not read — a tombstone among them — or that is
 * older than the one held leaves every row where it was.
 */
export function projectExecutionIndexFold(
  previous: ProjectExecutionIndex | undefined,
  representation: unknown,
): ProjectExecutionIndex | undefined {
  if (previous === undefined) return previous;
  const read = executionSummarySchema.safeParse(representation);
  if (!read.success) return previous;
  const arriving = read.data;
  const at = String(arriving.ticket);
  if (!projectExecutionLater(previous.latest[at], arriving)) return previous;
  return {
    ...previous,
    latest: {
      ...previous.latest,
      [at]: { execution: arriving, complete: true },
    },
  };
}
