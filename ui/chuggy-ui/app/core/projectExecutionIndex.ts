/**
 * Each ticket's latest execution, kept by ticket so that one execution's frame
 * moves one row: what is running while it runs, and its terminal outcome
 * afterwards, which is also where a settled ticket's configuration revision
 * comes from.
 *
 * The read walks the executions route's latest read, one row per ticket,
 * highest ticket first, so a walk stopped at its page budget holds the newest
 * tickets. A walk that did not finish is followed by one over the non-terminal
 * executions, so a running ticket older than the budget is still exact.
 */

import { nativeHttpPageItemsMax } from "../../../../src/contract/http.ts";
import { executionSummarySchema } from "../../../../src/contract/responses.ts";
import type {
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../src/contract/responses.ts";

import type { ApiFailure, ApiResult } from "./apiRequest.ts";
import type { ExecutionsPage } from "./apiRoutes.ts";

/** Pages per walk: the newest this many pages of tickets are joined. */
export const projectExecutionPagesMax = 8;

export type ProjectExecutionSelection = "Latest" | "NonTerminal";

export interface ProjectExecutionIndex {
  readonly latest: Readonly<Record<string, ExecutionSummary>>;
}

export const projectExecutionIndexEmpty: ProjectExecutionIndex = {
  latest: {},
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
  latest: Readonly<Record<string, ExecutionSummary>>,
  executions: readonly ExecutionSummary[],
): Record<string, ExecutionSummary> {
  const gathered: Record<string, ExecutionSummary> = { ...latest };
  for (const execution of executions) {
    const at = String(execution.ticket);
    if (projectExecutionLater(gathered[at], execution))
      gathered[at] = execution;
  }
  return gathered;
}

/** The index a set of executions makes, which is what a caller holding one
 * already has. */
export function projectExecutionIndexOf(
  executions: readonly ExecutionSummary[],
): ProjectExecutionIndex {
  return { latest: projectExecutionIndexWith({}, executions) };
}

export function projectExecutionIndexAt(
  index: ProjectExecutionIndex,
  ticket: number,
): ExecutionSummary | undefined {
  return index.latest[String(ticket)];
}

interface ProjectExecutionWalk {
  readonly executions: readonly ExecutionSummary[];
  readonly finished: boolean;
  readonly failure: ApiFailure | undefined;
}

export type ProjectExecutionReadPage = (
  selection: ProjectExecutionSelection,
  cursor: string | undefined,
) => Promise<ApiResult<ExecutionsResponse>>;

/** The page one step of a walk asks for: the size it wants, the selection it is
 * walking, and the cursor the page before it answered with. */
export function projectExecutionPage(
  selection: ProjectExecutionSelection,
  cursor: string | undefined,
): ExecutionsPage {
  return {
    limit: nativeHttpPageItemsMax,
    ...(selection === "Latest" ? { latest: true } : { state: selection }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

/** One walk under the page budget. A refusal ends it with what it had, and only
 * a walk the wire ended is finished. */
async function projectExecutionWalk(
  selection: ProjectExecutionSelection,
  readPage: ProjectExecutionReadPage,
): Promise<ProjectExecutionWalk> {
  const executions: ExecutionSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < projectExecutionPagesMax; page += 1) {
    const answered = await readPage(selection, cursor);
    if (answered.outcome !== "Ok")
      return { executions, finished: false, failure: answered };
    executions.push(...answered.value.executions);
    cursor = answered.value.nextCursor;
    if (cursor === undefined)
      return { executions, finished: true, failure: undefined };
  }
  return { executions, finished: false, failure: undefined };
}

/**
 * The index a screen reads. A read whose first page is refused answers with
 * the refusal, so the panel draws the failure rather than an index that looks
 * empty.
 */
export async function projectExecutionIndexRead(
  readPage: ProjectExecutionReadPage,
): Promise<ApiResult<ProjectExecutionIndex>> {
  const latest = await projectExecutionWalk("Latest", readPage);
  if (latest.failure !== undefined && latest.executions.length === 0)
    return latest.failure;
  if (latest.finished)
    return { outcome: "Ok", value: projectExecutionIndexOf(latest.executions) };
  const running = await projectExecutionWalk("NonTerminal", readPage);
  return {
    outcome: "Ok",
    value: projectExecutionIndexOf([
      ...latest.executions,
      ...running.executions,
    ]),
  };
}

/**
 * An `Execution` frame folded in: the representation is the executions list's
 * row, and a frame that will not read — a tombstone among them — or that is
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
  return { latest: { ...previous.latest, [at]: arriving } };
}
