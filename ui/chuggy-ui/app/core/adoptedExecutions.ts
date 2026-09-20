/**
 * What the ticket machine ran, as this console reads it.
 *
 * ONE EXECUTION IS ONE TASK, AND THE KEY IS WHAT NAMES ITS TICKET. The row
 * carries no ticket number of its own: `taskKey` is the machine's own name for
 * the task, and `ticketTaskKey.ts` is what reads a ticket, a cycle and a stage
 * out of it. The read is filtered in the query, so a page is one ticket's, and
 * the key is still what places each row inside it.
 *
 * THE SHAPE IS THE SERVER'S AND NOT A CONTRACT THIS CONSOLE CO-OWNS. There is
 * no schema for this body under `src/contract/`, so the one here is written
 * against `TicketExecutionSummary` and is open rather than strict: a field the
 * server grows is carried past unread, because refusing the body over it would
 * blank the page a reader came for. What the console needs it asks for, and a
 * field it needs that stops arriving is a parse failure like any other.
 */

import { z } from "zod";

import {
  nativeHttpPageItemsMax,
  nativeHttpRoutes,
  type PartitionIdentity,
} from "../../../../src/contract/http.ts";
import { endpointPath } from "../../../../src/contract/endpoints.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiRead } from "./apiRequest.ts";

const count = z.number().int().nonnegative().safe();

export const adoptedExecutionStateSchema = z.enum([
  "Queued",
  "Running",
  "Terminal",
  "Cancelled",
]);

/** The four token counts every measure of a run is broken down by. */
const adoptedRunTokensShape = {
  tokensInput: count,
  tokensOutput: count,
  tokensCacheCreation: count,
  tokensCacheRead: count,
};

export const adoptedRunModelUsageSchema = z.object({
  model: z.string().min(1),
  costUsdMicros: z.number().nonnegative().safe(),
  ...adoptedRunTokensShape,
});

/**
 * What one attempt's run spent, which is the workload's own account of itself.
 * `costBasis` is a list price rather than a bill, and every figure drawn from
 * it carries that word.
 */
export const adoptedRunTotalsSchema = z.object({
  turns: count,
  durationMs: count,
  durationApiMs: count,
  costUsdMicros: z.number().nonnegative().safe(),
  costBasis: z.literal("List"),
  permissionDenials: count,
  models: z.array(adoptedRunModelUsageSchema),
  resultSubtype: z.string().optional(),
  stopReason: z.string().optional(),
  ...adoptedRunTokensShape,
});

export const adoptedExecutionSchema = z.object({
  taskKey: z.string().min(1),
  state: adoptedExecutionStateSchema,
  attempt: count,
  attemptsUnreported: count,
  queuedAt: z.string().min(1),
  lastReportedAt: z.string().min(1).optional(),
  pool: z.string().min(1).optional(),
  totals: adoptedRunTotalsSchema.optional(),
});

export const adoptedExecutionsSchema = z.object({
  executions: z.array(adoptedExecutionSchema),
});

export type AdoptedExecutionState = z.infer<typeof adoptedExecutionStateSchema>;
export type AdoptedRunModelUsage = z.infer<typeof adoptedRunModelUsageSchema>;
export type AdoptedRunTotals = z.infer<typeof adoptedRunTotalsSchema>;
export type AdoptedExecution = z.infer<typeof adoptedExecutionSchema>;
export type AdoptedExecutions = z.infer<typeof adoptedExecutionsSchema>;

/**
 * Whether the machine can still move this execution, which is what separates a
 * row whose figures are final from one whose figures are a reading taken while
 * it runs.
 */
export function adoptedExecutionSettled(execution: AdoptedExecution): boolean {
  switch (execution.state) {
    case "Terminal":
    case "Cancelled":
      return true;
    case "Queued":
    case "Running":
      return false;
  }
}

/**
 * Whether the read may have been cut short. The route bounds its answer and
 * carries no cursor, so a page that came back full is the only sign this
 * console gets that the ticket has more runs than it is drawing — and a figure
 * summed over such a page is a floor rather than the ticket's own number.
 */
export function adoptedExecutionsShort(page: AdoptedExecutions): boolean {
  return page.executions.length >= nativeHttpPageItemsMax;
}

/**
 * One ticket's executions, filtered in the query so the page is one ticket's.
 * It asks for the most the route will answer, because the route pages without a
 * cursor: a smaller ask would be short more often with no way to say so.
 */
export function adoptedExecutions(
  ports: ApiPorts,
  partition: PartitionIdentity,
  ticket: number,
  signal?: AbortSignal,
): Promise<ApiResult<AdoptedExecutions>> {
  const query = new URLSearchParams({
    ticket: String(ticket),
    limit: String(nativeHttpPageItemsMax),
  });
  return apiRead(
    ports,
    {
      method: "GET",
      path: `${endpointPath(nativeHttpRoutes.ticketExecutions, partition)}?${query.toString()}`,
      ...(signal === undefined ? {} : { signal }),
    },
    (value) => adoptedExecutionsSchema.parse(value),
  );
}
