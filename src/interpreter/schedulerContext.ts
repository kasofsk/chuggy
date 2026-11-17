/**
 * What the ticket service is allowed to learn from the execution scheduler:
 * the authoritative hard execution-backlog guard over dispatch. It is
 * retryable infrastructure backpressure applied at ingress, before an
 * operation becomes durable, and it is neither `TicketGraph` state, ticket
 * eligibility nor a commercial entitlement.
 *
 * THE GUARD PRESERVES HEADROOM BY BEING NARROW RATHER THAN BY RESERVING IT.
 * `dispatchNeedsExecutionHeadroom` returns true for the two dispatch commands
 * alone, so completion, cancellation, revocation and every other
 * correctness-reducing path is admissible while dispatch is paused. It reads
 * the command tag and nothing inside the command, so the switch is exhaustive
 * in the sense the compiler decides and a tag added later cannot slip past it
 * unclassified.
 *
 * THE CRITERION IS THE COMMAND AND NOT THE WORK IT MAY CAUSE. Resuming a ticket
 * spawns work tasks too and 006 still pauses dispatch alone, so a criterion
 * reading "asks for new execution work" would have to classify resume and
 * native-action resumption the other way from the way this file does. A
 * `Decide` is never one of them: the dispatch is not a command a principal may
 * offer, so the two spellings above are the whole of what arrives.
 *
 * EVERY REFUSAL IS A VALUE, as elsewhere in this layer. A backlogged project is
 * an outcome a submitter must handle, not an exception it may ignore.
 */

import {
  recordScheduler,
  type BacklogScope,
  type SchedulerTelemetry,
} from "./executionScheduler.ts";
export { allBacklogScopes, type BacklogScope } from "./executionScheduler.ts";
import type { Partition } from "./projectStore.ts";
import type { ProjectCommand } from "./projectCommand.ts";

/**
 * What the backlog guard found. `Backlogged` carries a retry hint and no
 * durable count, because the caller is a submitter rather than an operator.
 */
export type BacklogVerdict =
  | { readonly admits: "Admits" }
  | {
      readonly admits: "Backlogged";
      readonly scope: BacklogScope;
      readonly retryAfterSeconds: number;
    };

/**
 * The authoritative hard execution-backlog guard. It is the scheduler's, and
 * both manual and agentic dispatch are checked against the same call.
 */
export interface ExecutionBacklogGuard {
  admitsDispatch(partition: Partition): Promise<BacklogVerdict>;
}

/**
 * Whether this command is a dispatch, which is the one thing the backlog
 * ceiling pauses. Manual dispatch and an agentic proposal are the two spellings
 * dispatch arrives as at this boundary.
 */
export function dispatchNeedsExecutionHeadroom(
  command: ProjectCommand,
): boolean {
  switch (command.command) {
    case "ManualDispatch":
    case "ProposeDispatch":
      return true;
    case "Decide":
    case "ReleaseDraft":
    case "UpdateTicket":
    case "ChangeTicketOverrides":
    case "ResolveNativeAction":
      return false;
  }
}

/** A guard that admits everything, which is what a deployment without a scheduler gets. */
export const openExecutionBacklogGuard: ExecutionBacklogGuard = {
  admitsDispatch: () => Promise.resolve({ admits: "Admits" }),
};

/** The verdict, and the observation of it that no submitter's answer depends on. */
async function observedVerdict(
  guard: ExecutionBacklogGuard,
  telemetry: SchedulerTelemetry,
  partition: Partition,
): Promise<BacklogVerdict> {
  const verdict = await guard.admitsDispatch(partition);
  const scope: BacklogScope | undefined =
    verdict.admits === "Backlogged" ? verdict.scope : undefined;
  recordScheduler(telemetry, (metrics) => {
    metrics.backlog(verdict.admits, scope);
  });
  return verdict;
}

/**
 * The same guard, observed where the verdict crosses the port. It is a wrapper
 * rather than a field on each implementation so an unobserved guard and an
 * observed one answer identically.
 */
export function observedExecutionBacklogGuard(
  guard: ExecutionBacklogGuard,
  telemetry: SchedulerTelemetry,
): ExecutionBacklogGuard {
  return {
    admitsDispatch: (partition) => observedVerdict(guard, telemetry, partition),
  };
}
