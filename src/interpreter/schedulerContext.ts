/**
 * The two narrow things the ticket service is allowed to learn from the
 * execution scheduler: bounded project-safe active-work and advisory capacity
 * context, and the authoritative hard execution-backlog guard over dispatch.
 *
 * THE SELECTOR IS THE CONTEXT'S INTENDED READER AND HAS NO ROUTE TO IT HERE,
 * which is why the names below say selector and why this says the rest. 006
 * makes the context selector-facing; in this tree the functions that answer it
 * are granted to the API and ticket-service roles alone, `NativeWeb` publishes
 * no method returning one, and nothing composes the read. What the selector
 * does learn is the guard's verdict, as the answer to its own `ProposeDispatch`.
 *
 * THE CONTEXT IS ADVISORY AND THE GUARD IS AUTHORITATIVE, and they are
 * separate ports for that reason. issue #180
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
 * A PROJECT IS THE WHOLE COMPOSITE KEY HERE, WHICH IS WHY THE FOLD READS A TYPE
 * THE ARITHMETIC DOES NOT. `model/capacity.qnt` gives a registration one atomic
 * project identity and this tree's is `(tenant, project)`, so a fold that
 * compared the project half alone would answer one tenant with another tenant's
 * work whenever both named a project the same thing. The arithmetic below still
 * takes the model's own record, and the project-scoped fold takes a
 * `PartitionedExecution` — the tenant half is in the type it reads, so a caller
 * that has not got one cannot ask.
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
 * `Decide` is never one of them either, including one carrying a `Dispatch`
 * event: the inbox refuses that command as `InvalidCommand` whatever the
 * backlog, so gating it here would answer a command that can never be accepted
 * with a retryable `Backlogged` for as long as the project stayed backlogged —
 * two answers to one invalid command, and the retryable one first.
 *
 * EVERY REFUSAL IS A VALUE, as elsewhere in this layer. A backlogged project is
 * an outcome a submitter must handle, not an exception it may ignore.
 */

import {
  executionAccountActiveCount,
  executionActiveCount,
  executionEntitlementOf,
  executionReservationDeficit,
  recordScheduler,
  type BacklogScope,
  type CapacityExecution,
  type Entitlement,
  type ExecutionStatus,
  type SchedulerTelemetry,
} from "./executionScheduler.ts";
export { allBacklogScopes, type BacklogScope } from "./executionScheduler.ts";
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

export interface SelectorRuntimeExecutionContext extends SelectorExecutionContext {
  readonly account: string;
  readonly backlog: {
    readonly project: number;
    readonly installation: number;
  };
}

/**
 * The advisory read the selector observes through the authenticated ticket
 * service. It answers for one project and reads no other.
 */
export interface ExecutionContextRead {
  context(partition: Partition): Promise<SelectorRuntimeExecutionContext>;
}

/** One registration with the tenant half of its key, which the arithmetic never reads. */
export interface PartitionedExecution extends CapacityExecution {
  readonly tenant: string;
}

/** How many of these registrations sit in one logical status. */
function statusCount(
  executions: readonly CapacityExecution[],
  status: ExecutionStatus,
): number {
  return executions.filter((each) => each.status === status).length;
}

/** Whether this registration is the named partition's own, on both halves of the key. */
function partitionOwns(
  partition: Partition,
  execution: PartitionedExecution,
): boolean {
  return (
    execution.tenant === partition.tenant &&
    execution.project === partition.project
  );
}

/**
 * The advisory context one cluster ledger already determines, folded with the
 * same mirrored arithmetic admission uses so an adapter answering the read has
 * something to be compared against rather than a second opinion to form. Every
 * count it returns is either the named partition's own or a cluster-wide total,
 * which is where the project boundary is actually kept.
 */
export function selectorExecutionContext(
  clusterSlotsMax: number,
  entitlements: ReadonlyMap<string, Entitlement>,
  executions: readonly PartitionedExecution[],
  partition: Partition,
  account: string,
): SelectorExecutionContext {
  const own = executions.filter((each) => partitionOwns(partition, each));
  return {
    activeWork: {
      partition,
      queued: statusCount(own, "Queued"),
      admitted: statusCount(own, "Admitted"),
      launching: statusCount(own, "Launching"),
      running: statusCount(own, "Running"),
    },
    capacity: {
      clusterSlotsMax,
      clusterActive: executionActiveCount(executions),
      accountMaximum: executionEntitlementOf(entitlements, account).maximum,
      accountActive: executionAccountActiveCount(executions, account),
      accountReservationDeficit: executionReservationDeficit(
        entitlements,
        executions,
        account,
      ),
    },
  };
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
  command: TicketCommand,
): boolean {
  switch (command.command) {
    case "ManualDispatch":
    case "ProposeDispatch":
      return true;
    case "Decide":
    case "ReleaseDraft":
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
