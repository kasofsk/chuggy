/**
 * What a live `Execution` frame does to the executions a ticket page is
 * holding.
 *
 * The list is the page the route answered with, ordered by execution identity
 * as that route orders it, so a frame replaces the entry it names in place and
 * a new execution is inserted at its own position rather than at an end. A
 * frame for an execution that would sort past a truncated page is left alone:
 * it belongs to a page this screen has not read, and inserting it would claim
 * the page reaches further than it does.
 */

import { executionResponseSchema } from "../../../../src/contract/responses.ts";
import type {
  ExecutionResponse,
  ExecutionSummary,
  ExecutionsResponse,
} from "../../../../src/contract/responses.ts";

export interface ProjectExecutionChange {
  readonly resource: string;
  readonly representation: unknown;
}

function executionOf(representation: unknown): ExecutionResponse | undefined {
  const parsed = executionResponseSchema.safeParse(representation);
  return parsed.success ? parsed.data : undefined;
}

function executionsWithout(
  previous: ExecutionsResponse,
  execution: string,
): ExecutionsResponse {
  return {
    ...previous,
    executions: previous.executions.filter(
      (held) => held.execution !== execution,
    ),
  };
}

/** In place where it is already listed, at its own position where it is not. */
function executionsWith(
  previous: ExecutionsResponse,
  arrived: ExecutionResponse,
): ExecutionsResponse {
  const held = previous.executions;
  const at = held.findIndex((row) => row.execution === arrived.execution);
  if (at >= 0)
    return {
      ...previous,
      executions: held.map((row, index) => (index === at ? arrived : row)),
    };
  const last = held.at(-1);
  if (
    previous.nextAfter !== undefined &&
    last !== undefined &&
    arrived.execution > last.execution
  )
    return previous;
  const before = held.findIndex((row) => row.execution > arrived.execution);
  const listed: ExecutionSummary[] = [...held];
  listed.splice(before < 0 ? listed.length : before, 0, arrived);
  return { ...previous, executions: listed };
}

/**
 * A page nothing has read is left unread, because a fold that invented one
 * would draw a list of exactly the frames that happened to arrive.
 */
export function ticketExecutionsFolded(
  ticket: number,
  previous: ExecutionsResponse | undefined,
  change: ProjectExecutionChange,
): ExecutionsResponse | undefined {
  if (previous === undefined) return undefined;
  if (change.representation === null)
    return executionsWithout(previous, change.resource);
  const arrived = executionOf(change.representation);
  if (arrived === undefined || arrived.ticket !== ticket) return previous;
  return executionsWith(previous, arrived);
}
