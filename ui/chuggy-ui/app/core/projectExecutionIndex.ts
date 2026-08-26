/**
 * What each ticket is running right now, kept by ticket so that one execution's
 * frame moves one row.
 *
 * A ticket may have had several executions and the table has one column for
 * them, so the index holds the latest one registered — the same execution the
 * running-now read answers with while it is running, and the one whose terminal
 * outcome is the last thing that happened to that ticket afterwards. The value
 * is a record keyed by the ticket number as text, because that is what a cache
 * entry can hold and diff.
 */

import { executionSummarySchema } from "../../../../src/contract/responses.ts";
import type { ExecutionSummary } from "../../../../src/contract/responses.ts";

export type ProjectExecutionIndex = Readonly<Record<string, ExecutionSummary>>;

export const projectExecutionIndexEmpty: ProjectExecutionIndex = {};

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

export function projectExecutionIndexOf(
  executions: readonly ExecutionSummary[],
): ProjectExecutionIndex {
  const index: Record<string, ExecutionSummary> = {};
  for (const execution of executions) {
    const at = String(execution.ticket);
    if (projectExecutionLater(index[at], execution)) index[at] = execution;
  }
  return index;
}

export function projectExecutionIndexAt(
  index: ProjectExecutionIndex,
  ticket: number,
): ExecutionSummary | undefined {
  return index[String(ticket)];
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
  if (!projectExecutionLater(previous[at], arriving)) return previous;
  return { ...previous, [at]: arriving };
}
