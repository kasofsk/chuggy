/**
 * The names this fabric writes onto the cluster, formed in one place so the
 * spawn that stamps them and the watch that selects on them cannot drift: a
 * Job is named from the ticket and task ids alone, so a re-delivered emission
 * collides into already-exists instead of a second fan-out, and the two labels
 * carry the same pair back off any object the watch is handed.
 */

import type { TaskId, TicketId } from "../../domain/ids.ts";

/** The label naming the ticket a Job belongs to; its bare presence is the watch's selector. */
export const fabricTicketLabel = "chug-ticket";

/** The label naming the task a Job runs. */
export const fabricTaskLabel = "chug-task";

/** The one name a ticket's task may run under, and the whole of name-keyed absorption. */
export function fabricJobName(ticket: TicketId, taskId: TaskId): string {
  return `chug-t${String(ticket)}-k${String(taskId)}`;
}

/** The selector a cancellation deletes by: every Job of the one ticket. */
export function fabricTicketSelector(ticket: TicketId): string {
  return `${fabricTicketLabel}=${String(ticket)}`;
}

/** The labels a spawned Job and its pods carry, which are what the watch and the cancellation address. */
export function fabricLabels(
  ticket: TicketId,
  taskId: TaskId,
): Readonly<Record<string, string>> {
  return {
    [fabricTicketLabel]: String(ticket),
    [fabricTaskLabel]: String(taskId),
  };
}
