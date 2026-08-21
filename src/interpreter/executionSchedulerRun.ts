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
 * A WORKER IS BRIEFED BEFORE IT IS PLACED, AND THE PORT HAS NO SHAPE FOR AN
 * UNBRIEFED ONE. `WorkerPlacement` carries the composed invocation, so placing
 * without a briefing is not an order this code can express — the same device
 * cancellation uses. Composing it needs the pinned revision read back and the
 * runtime facts gathered, and both are read before `./taskBriefing.ts` decides
 * anything, which is what keeps the decision itself pure and synchronous.
 *
 * A CONFIGURATION THAT CANNOT BE BRIEFED IS THE SAME TWO INABILITIES AGAIN. A
 * revision that is gone, one whose digest is not the pinned one, and a practice
 * no catalog blesses are each a definitive inability to run the immutable
 * contract, so they take the `TicketConfigIncompatible` arm of the reason
 * vocabulary the model already bounds. An authoring store or a workspace that
 * cannot be read right now is a hold, and withdraws the attempt without
 * spending the safe retry budget. Both record the evidence the mandatory policy
 * phase already has, because briefing composition happens inside it and a
 * second label for the same phase would be a vocabulary this tree's stored
 * rows do not carry.
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
  taskPurposeForKind,
  type AttemptEvidence,
  type AttemptOpening,
  type BlockedReason,
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
import {
  composeTaskInvocation,
  type PinnedConfigurationPort,
  type PinnedTaskConfiguration,
  type PracticeCatalog,
  type RuntimeFacts,
  type RuntimeFactsPort,
  type TaskInvocation,
} from "./taskBriefing.ts";
import type { PolicyAuthorityGrant } from "./taskAuthority.ts";

/** Everything a scheduler pass calls out through, and the bounds it works within. */
export interface ExecutionSchedulerService {
  readonly store: ExecutionSchedulerStore;
  readonly workers: WorkerLaunchPort;
  readonly policy: ExecutionPolicy;
  readonly configurations: PinnedConfigurationPort;
  readonly runtimeFacts: RuntimeFactsPort;
  readonly practices: PracticeCatalog;
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

/** Withdraws the attempt and retires the execution, which is what a definitive inability earns. */
async function schedulerBlock(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
  evidence: AttemptEvidence,
  reason: BlockedReason,
): Promise<void> {
  await service.store.attemptEnded(attempt, "Withdrawn", evidence);
  await service.store.blockExecution(
    execution.partition,
    execution.execution,
    reason,
  );
}

/** What policy granted this execution, or the durable move its refusal earns. */
async function schedulerPolicyFor(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<
  | { readonly profile: ExecutionProfile; readonly grant: PolicyAuthorityGrant }
  | undefined
> {
  const resolved = await service.policy.profileFor(execution);
  switch (resolved.resolved) {
    case "Profile":
      return { profile: resolved.profile, grant: resolved.grant };
    case "Denied":
      await schedulerBlock(
        service,
        execution,
        attempt,
        "PolicyDenied",
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

/** Why a briefing could not be gathered, which is the two inabilities once more. */
type BriefingUnready =
  { readonly gathered: "Missing" } | { readonly gathered: "Unavailable" };

/** Reads back exactly the revision this execution pinned, never a moving ticket row. */
async function schedulerConfiguration(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<PinnedTaskConfiguration | BriefingUnready> {
  const read = await service.configurations.configuration(
    execution.partition,
    execution,
  );
  switch (read.read) {
    case "Configuration":
      return read.configuration;
    case "Missing":
      return { gathered: "Missing" };
    case "Unavailable":
      return { gathered: "Unavailable" };
  }
}

/** Gathers what the fabric can observe of this execution's workspace. */
async function schedulerRuntimeFacts(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<RuntimeFacts | BriefingUnready> {
  const read = await service.runtimeFacts.facts(
    execution.partition,
    execution.execution,
  );
  switch (read.read) {
    case "Facts":
      return read.facts;
    case "Unavailable":
      return { gathered: "Unavailable" };
  }
}

/** The durable move an ungatherable briefing input earns, one arm each. */
async function schedulerUnready(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
  unready: BriefingUnready,
): Promise<void> {
  switch (unready.gathered) {
    case "Missing":
      await schedulerBlock(
        service,
        execution,
        attempt,
        "PolicyDenied",
        "TicketConfigIncompatible",
      );
      return;
    case "Unavailable":
      await service.store.attemptEnded(
        attempt,
        "Withdrawn",
        "PolicyUnavailable",
      );
      return;
  }
}

/** What a placement needs before it may be asked for: the profile, and the composed invocation. */
interface TaskLaunch {
  readonly profile: ExecutionProfile;
  readonly invocation: TaskInvocation;
}

/** Resolves policy, gathers the pinned briefing inputs and composes one invocation. */
async function schedulerPrepare(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<TaskLaunch | undefined> {
  const policy = await schedulerPolicyFor(service, execution, attempt);
  if (policy === undefined) return undefined;
  const configuration = await schedulerConfiguration(service, execution);
  if ("gathered" in configuration) {
    await schedulerUnready(service, execution, attempt, configuration);
    return undefined;
  }
  const runtime = await schedulerRuntimeFacts(service, execution);
  if ("gathered" in runtime) {
    await schedulerUnready(service, execution, attempt, runtime);
    return undefined;
  }
  const composed = composeTaskInvocation(service.practices, {
    purpose: taskPurposeForKind(execution.taskKind),
    pin: execution,
    configuration,
    runtime,
    grant: policy.grant,
  });
  switch (composed.composed) {
    case "Composed":
      return { profile: policy.profile, invocation: composed.invocation };
    case "Blocked":
      await schedulerBlock(
        service,
        execution,
        attempt,
        "PolicyDenied",
        "TicketConfigIncompatible",
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
  const launch = await schedulerPrepare(service, execution, attempt);
  if (launch === undefined) return false;
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
    profile: launch.profile,
    invocation: launch.invocation,
  });
  observe(() => {
    service.metrics.placement(placed.placed);
  });
  switch (placed.placed) {
    case "Placed":
      return service.store.attemptPlaced(attempt, placed.workload);
    case "Denied":
      await schedulerBlock(
        service,
        execution,
        attempt,
        "PlacementDenied",
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
