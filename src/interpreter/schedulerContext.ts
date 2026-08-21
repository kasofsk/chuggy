/**
 * The two narrow things the ticket service and the selector are allowed to
 * learn from the execution scheduler: bounded project-safe active-work and
 * advisory capacity context, and the authoritative hard execution-backlog
 * guard over dispatch.
 *
 * THE CONTEXT IS ADVISORY AND THE GUARD IS AUTHORITATIVE, and they are
 * separate ports for that reason. `docs/design/006-durable-project-dispatch.md`
 * lets capacity and active-work observations guide the selector while forbidding
 * them to reserve capacity, alter ticket eligibility or become a hidden ticket
 * service dispatch policy — and it excludes them from the strict dispatch-view
 * digest, so a proposal must survive their changing underneath it. The guard is
 * the opposite: it is retryable infrastructure backpressure applied at ingress,
 * before an operation becomes durable, and it is neither `Core` state, ticket
 * eligibility, a commercial entitlement nor a selector reservation.
 *
 * NOTHING CROSSES THE PROJECT BOUNDARY EXCEPT A SAFE AGGREGATE. The active-work
 * numbers are the named project's own; the capacity numbers are the cluster
 * total and the project's own account, which 006 permits as safe aggregate
 * advisory context. No other project's identity, tickets, tasks or counts are
 * representable in these types, so an adapter cannot leak one by accident.
 *
 * THE GUARD PRESERVES HEADROOM BY BEING NARROW RATHER THAN BY RESERVING IT.
 * `dispatchNeedsExecutionHeadroom` returns true for dispatch alone, so
 * completion, cancellation, revocation and every other correctness-reducing
 * path is admissible while dispatch is paused. It is an exhaustive switch, so
 * a command tag added later cannot slip past it unclassified.
 *
 * EVERY REFUSAL IS A VALUE, as elsewhere in this layer. A backlogged project is
 * an outcome a submitter must handle, not an exception it may ignore.
 */

import type { Partition } from "./projectStore.ts";
import type { TicketCommand } from "./ticketCommand.ts";

/** The named project's own unfinished logical work, by the status that owns a slot or waits for one. */
export interface ProjectActiveWork {
  readonly partition: Partition;
  readonly queued: number;
  readonly admitted: number;
  readonly launching: number;
  readonly running: number;
}

/** The safe aggregate capacity facts a selector may weigh, and no cross-project detail. */
export interface AdvisoryCapacity {
  readonly clusterSlotsMax: number;
  readonly clusterActive: number;
  readonly accountMaximum: number;
  readonly accountActive: number;
  readonly accountReservationDeficit: number;
}

/** One observation the selector may record as provenance for a choice or a wait. */
export interface SelectorExecutionContext {
  readonly activeWork: ProjectActiveWork;
  readonly capacity: AdvisoryCapacity;
}

/**
 * The advisory read the selector observes through the authenticated ticket
 * service. It answers for one project and reads no other.
 */
export interface ExecutionContextRead {
  context(partition: Partition): Promise<SelectorExecutionContext>;
}

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

/** Which ceiling stopped a dispatch, which is the whole of what a submitter learns. */
export type BacklogScope = "Project" | "Installation";

/** Every backlog scope, so a suite iterates rather than restates. */
export const allBacklogScopes: readonly BacklogScope[] = [
  "Project",
  "Installation",
];

/**
 * The authoritative hard execution-backlog guard. It is the scheduler's, and
 * both manual and agentic dispatch are checked against the same call.
 */
export interface ExecutionBacklogGuard {
  admitsDispatch(partition: Partition): Promise<BacklogVerdict>;
}

/**
 * Whether this command asks for new execution work and therefore needs
 * scheduler headroom. Completion, cancellation, revocation, resume, release and
 * native-action resolution do not.
 */
export function dispatchNeedsExecutionHeadroom(
  command: TicketCommand,
): boolean {
  switch (command.command) {
    case "Decide":
      return command.event.type === "Dispatch";
    case "ReleaseDraft":
    case "ResolveNativeAction":
      return false;
  }
}

/** A guard that admits everything, which is what a deployment without a scheduler gets. */
export const openExecutionBacklogGuard: ExecutionBacklogGuard = {
  admitsDispatch: () => Promise.resolve({ admits: "Admits" }),
};
