/**
 * What each ticket ran, kept by ticket so that one execution's frame moves one
 * row.
 *
 * A ticket may have had several executions and the table has one column for
 * them, so the index holds the latest one registered — what is running while it
 * runs, and its terminal outcome afterwards, which is also where a settled
 * ticket's configuration revision comes from. The value is a record keyed by
 * the ticket number as text, because that is what a cache entry can hold and
 * diff.
 *
 * THE READ IS TWO WALKS AND THE SECOND IS THE TRUNCATION'S REMEDY. The
 * executions route orders by execution identity ascending and offers no cursor
 * from the other end, so a walk that stops at its page budget has the earliest
 * executions and is missing the newest — exactly the running ones the table
 * exists to show. So a truncated walk over every status is followed by a walk
 * over the non-terminal ones, whose size is bounded by what a cluster can run
 * at once. What is then still missing is the middle of a long project's
 * history, and `truncated` is what says so rather than a row quietly drawing a
 * dash.
 */

import { executionSummarySchema } from "../../../../src/contract/responses.ts";
import type {
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";

/** Pages per walk. A project whose history outruns this is one whose settled
 * rows say so, and the walk after it is what keeps the running rows exact. */
export const projectExecutionPagesMax = 8;

export type ProjectExecutionSelection = "All" | "NonTerminal";

export interface ProjectExecutionIndex {
  readonly latest: Readonly<Record<string, ExecutionSummary>>;
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
  held: ExecutionSummary | undefined,
  arriving: ExecutionSummary,
): boolean {
  if (held === undefined) return true;
  if (held.execution === arriving.execution) return true;
  if (held.registeredAt === arriving.registeredAt)
    return held.execution < arriving.execution;
  return held.registeredAt < arriving.registeredAt;
}

function projectExecutionIndexWith(
  index: ProjectExecutionIndex,
  executions: readonly ExecutionSummary[],
): ProjectExecutionIndex {
  const latest: Record<string, ExecutionSummary> = { ...index.latest };
  for (const execution of executions) {
    const at = String(execution.ticket);
    if (projectExecutionLater(latest[at], execution)) latest[at] = execution;
  }
  return { ...index, latest };
}

export function projectExecutionIndexOf(
  executions: readonly ExecutionSummary[],
): ProjectExecutionIndex {
  return projectExecutionIndexWith(projectExecutionIndexEmpty, executions);
}

export function projectExecutionIndexAt(
  index: ProjectExecutionIndex,
  ticket: number,
): ExecutionSummary | undefined {
  return index.latest[String(ticket)];
}

interface ProjectExecutionWalk {
  readonly index: ProjectExecutionIndex;
  readonly pagesRead: number;
  readonly failure: ApiFailure | undefined;
}

export type ProjectExecutionReadPage = (
  selection: ProjectExecutionSelection,
  after: string | undefined,
) => Promise<ApiResult<ExecutionsResponse>>;

/** One walk under the page budget; a refusal ends it with whatever it had. */
async function projectExecutionWalk(
  index: ProjectExecutionIndex,
  selection: ProjectExecutionSelection,
  readPage: ProjectExecutionReadPage,
): Promise<ProjectExecutionWalk> {
  let gathered = index;
  let after: string | undefined;
  for (let page = 0; page < projectExecutionPagesMax; page += 1) {
    const answered = await readPage(selection, after);
    if (answered.outcome !== "Ok")
      return { index: gathered, pagesRead: page, failure: answered };
    gathered = projectExecutionIndexWith(gathered, answered.value.executions);
    after = answered.value.nextAfter;
    if (after === undefined)
      return { index: gathered, pagesRead: page + 1, failure: undefined };
  }
  return {
    index: { ...gathered, truncated: true },
    pagesRead: projectExecutionPagesMax,
    failure: undefined,
  };
}

/**
 * The index a screen reads, walked under its budget and marked when the wire
 * had more to give than the budget allowed.
 *
 * A read that gathered nothing answers with its refusal, so the panel draws the
 * failure rather than an index that looks empty.
 */
export async function projectExecutionIndexRead(
  readPage: ProjectExecutionReadPage,
): Promise<ApiResult<ProjectExecutionIndex>> {
  const all = await projectExecutionWalk(
    projectExecutionIndexEmpty,
    "All",
    readPage,
  );
  if (all.failure !== undefined)
    return all.pagesRead === 0
      ? all.failure
      : { outcome: "Ok", value: { ...all.index, truncated: true } };
  if (!all.index.truncated) return { outcome: "Ok", value: all.index };
  const running = await projectExecutionWalk(
    all.index,
    "NonTerminal",
    readPage,
  );
  return { outcome: "Ok", value: { ...running.index, truncated: true } };
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
  return { ...previous, latest: { ...previous.latest, [at]: arriving } };
}
