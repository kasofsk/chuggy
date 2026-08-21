/**
 * The execution scheduler service: what one bounded pass does between holding
 * a claim on durable work and holding a durable result.
 *
 * EVERY PASS IS BOUNDED AND EVERY STEP IS A DURABLE MOVE. House rule 9 asks
 * for an explicit limit on anything that can grow, so a pass registers,
 * cancels, admits and launches at most its configured count and returns; the
 * loop that calls it again is a deployment's. Nothing here retries in place,
 * because a retry that outlives a process is a row rather than a loop.
 *
 * THE TWO INABILITIES ARE KEPT APART, which is the whole reason the policy and
 * placement ports answer with three arms rather than a boolean.
 * `docs/design/006-durable-project-dispatch.md` makes a definitive inability to
 * run the immutable contract an `ExecutionBlocked` and a temporary one a
 * visible hold, and conflating them would either fabricate a domain outcome out
 * of a cluster outage or leave a permanently unrunnable ticket queued forever.
 * A denial therefore blocks; an unavailability withdraws the attempt without
 * spending the safe retry budget and leaves the execution exactly as it was.
 *
 * A PASS FENCES BEFORE IT MOVES ANYTHING ELSE. After a takeover the previous
 * epoch's workers are still running, and one of them still names a live
 * attempt it could report a manifest and a completion under. Fencing first is
 * what makes the rest of the pass safe to run at all: an old-generation worker
 * may finish its local work afterwards and can do nothing with it. It is
 * idempotent, so every pass after the first fences nothing.
 *
 * CANCELLATION IS DURABLE BEFORE THE FABRIC HEARS OF IT, and the port's shape
 * is what enforces that rather than the order of two statements: the
 * registration outcome is what names the attempts it fenced, so deleting first
 * is not an order this code can express. 006 fulfills a cancellation request
 * when the retirement is registered and the logical slot released, not when the
 * workload is gone, because the opposite would hold a slot for work nobody is
 * going to run for as long as the cluster was unreachable. A deletion lost to a
 * crash leaves a workload whose attempt is already fenced, which can report
 * nothing either way and which inventory reconciles.
 *
 * A LOST ATTEMPT SPENDS THE BUDGET AND A WITHDRAWN ONE DOES NOT. An attempt
 * that ran and vanished is the bounded retry 006 permits; one the fabric never
 * took is not an attempt at the work at all. When the budget is spent the
 * execution terminalizes as one `TaskDone(Failed)` carrying the explicit empty
 * manifest, which is 006's exhausted-safe-retry outcome and not a fabricated
 * verdict.
 *
 * NOTHING HERE READS A CLOCK. Claim leases, placement backoff and attempt
 * leases are durations handed to the store, which asks the database what time
 * it is; `eslint.config.js` says so for this directory.
 */

import { observe } from "./ticketService.ts";
import {
  checkedExecutionSchedulerConfig,
  type AttemptOpening,
  type ExecutionPolicy,
  type ExecutionProfile,
  type ExecutionSchedulerConfig,
  type ExecutionSchedulerMetrics,
  type ExecutionSchedulerStore,
  type LogicalExecution,
  type PhysicalAttempt,
  type SchedulerOwnerId,
  type WorkerLaunchPort,
  type ClusterId,
} from "./executionScheduler.ts";
import type { RecoveryEpoch } from "./projectStore.ts";

/** Everything a scheduler pass calls out through, and the bounds it works within. */
export interface ExecutionSchedulerService {
  readonly store: ExecutionSchedulerStore;
  readonly workers: WorkerLaunchPort;
  readonly policy: ExecutionPolicy;
  readonly config: ExecutionSchedulerConfig;
  readonly metrics: ExecutionSchedulerMetrics;
}

/** What one bounded pass moved, which is what a deployment's loop paces itself by. */
export interface SchedulerPassReport {
  readonly fenced: number;
  readonly registered: number;
  readonly cancelled: number;
  readonly admitted: number;
  readonly placed: number;
}

/** Fences every attempt an older recovery epoch issued, which is what a takeover owes. */
export async function executionSchedulerFence(
  service: ExecutionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  return service.store.fenceOldEpochAttempts(epoch);
}

/** Registers every spawn request this pass could claim, fencing superseded ones. */
export async function executionSchedulerRegister(
  service: ExecutionSchedulerService,
  owner: SchedulerOwnerId,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(service.config);
  const claims = await service.store.claimRequests(
    owner,
    ["SpawnWork", "SpawnEvaluation"],
    config.requestsPerPassMax,
    config.requestClaimLeaseSecs,
  );
  let registered = 0;
  for (const claim of claims) {
    const outcome = await service.store.registerSpawn(claim);
    observe(() => {
      service.metrics.registration(outcome.registered);
    });
    if (outcome.registered === "Conflicting") {
      observe(() => {
        service.metrics.incident("ConflictingRegistration");
      });
    }
    if (outcome.registered === "Registered") registered += 1;
  }
  return registered;
}

/** Fences every task the claimed cancellation requests name, then fulfills them. */
export async function executionSchedulerCancel(
  service: ExecutionSchedulerService,
  owner: SchedulerOwnerId,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(service.config);
  const claims = await service.store.claimRequests(
    owner,
    ["CancelTicketWork"],
    config.requestsPerPassMax,
    config.requestClaimLeaseSecs,
  );
  let cancelled = 0;
  for (const claim of claims) {
    const outcome = await service.store.registerCancellation(claim);
    observe(() => {
      service.metrics.cancellation(outcome.cancelled);
    });
    if (outcome.cancelled !== "Registered") continue;
    cancelled += outcome.fenced;
    for (const workload of outcome.workloads) {
      await service.workers.delete(claim.partition, workload);
    }
  }
  return cancelled;
}

/** Takes slots for queued work until the cluster or an account says no more. */
export async function executionSchedulerAdmit(
  service: ExecutionSchedulerService,
  cluster: ClusterId,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(service.config);
  let admitted = 0;
  for (let taken = 0; taken < config.admissionsPerPassMax; taken += 1) {
    const outcome = await service.store.admit(cluster);
    observe(() => {
      service.metrics.admission(outcome.admitted);
    });
    if (outcome.admitted !== "Admitted") return admitted;
    admitted += 1;
  }
  return admitted;
}

/** The profile this execution may run under, or the durable move its refusal earns. */
async function schedulerProfileFor(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<ExecutionProfile | undefined> {
  const resolved = await service.policy.profileFor(execution);
  switch (resolved.resolved) {
    case "Profile":
      return resolved.profile;
    case "Denied":
      await service.store.attemptEnded(attempt, "Withdrawn", "PolicyDenied");
      await service.store.blockExecution(
        execution.partition,
        execution.execution,
        resolved.reason,
      );
      return undefined;
    case "Unavailable":
      await service.store.attemptEnded(
        attempt,
        "Withdrawn",
        "PolicyUnavailable",
      );
      return undefined;
  }
}

/** Places one opened attempt, or records the durable evidence of why it was not placed. */
async function schedulerPlace(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<boolean> {
  const profile = await schedulerProfileFor(service, execution, attempt);
  if (profile === undefined) return false;
  const placed = await service.workers.place({
    partition: execution.partition,
    execution: execution.execution,
    attempt: attempt.attempt,
    generation: attempt.generation,
    ticket: execution.ticket,
    task: execution.task,
    taskKind: execution.taskKind,
    ...(execution.stage === undefined ? {} : { stage: execution.stage }),
    sourceRequest: execution.sourceRequest,
    configurationRevision: execution.configurationRevision,
    configurationDigest: execution.configurationDigest,
    profile,
  });
  observe(() => {
    service.metrics.placement(placed.placed);
  });
  switch (placed.placed) {
    case "Placed":
      return service.store.attemptPlaced(attempt, placed.workload);
    case "Denied":
      await service.store.attemptEnded(attempt, "Withdrawn", "PlacementDenied");
      await service.store.blockExecution(
        execution.partition,
        execution.execution,
        placed.reason,
      );
      return false;
    case "Unavailable":
      await service.store.attemptEnded(
        attempt,
        "Withdrawn",
        "PlacementUnavailable",
      );
      return false;
  }
}

/** Opens and places the next attempt for one execution that owns a slot. */
async function schedulerLaunchOne(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  epoch: RecoveryEpoch,
): Promise<boolean> {
  const config = checkedExecutionSchedulerConfig(service.config);
  const opening: AttemptOpening = {
    partition: execution.partition,
    execution: execution.execution,
    epoch,
    leaseSecs: config.attemptLeaseSecs,
    retriesMax: config.attemptRetriesMax,
    placementBackoffSecs: config.placementBackoffSecs,
  };
  const opened = await service.store.openAttempt(opening);
  switch (opened.opened) {
    case "Opened":
      return schedulerPlace(service, execution, opened.attempt);
    case "NotLaunchable":
    case "BackingOff":
      return false;
    case "RetriesExhausted": {
      const outcome = await service.store.retriesExhausted(
        execution.partition,
        execution.execution,
      );
      observe(() => {
        service.metrics.terminalization(outcome.terminalized);
      });
      return false;
    }
  }
}

/** Places workers for the executions that hold a slot and have no live attempt. */
export async function executionSchedulerLaunch(
  service: ExecutionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(service.config);
  const waiting = await service.store.unlaunched(
    epoch,
    config.launchesPerPassMax,
  );
  let placed = 0;
  for (const execution of waiting) {
    if (await schedulerLaunchOne(service, execution, epoch)) placed += 1;
  }
  return placed;
}

/** One bounded pass over every durable move the scheduler owns, in dependency order. */
export async function executionSchedulerPass(
  service: ExecutionSchedulerService,
  owner: SchedulerOwnerId,
  epoch: RecoveryEpoch,
  cluster: ClusterId,
): Promise<SchedulerPassReport> {
  const fenced = await executionSchedulerFence(service, epoch);
  const cancelled = await executionSchedulerCancel(service, owner);
  const registered = await executionSchedulerRegister(service, owner);
  const admitted = await executionSchedulerAdmit(service, cluster);
  const placed = await executionSchedulerLaunch(service, epoch);
  return { fenced, registered, cancelled, admitted, placed };
}
