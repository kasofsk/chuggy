/**
 * The execution scheduler service: what one bounded pass does between holding
 * a claim on durable work and holding a durable result.
 *
 * EVERY PASS IS BOUNDED AND EVERY STEP IS A DURABLE MOVE. House rule 9 asks for
 * an explicit limit on anything that can grow, so a pass fences, reaps,
 * registers, cancels, admits, observes and launches at most its configured
 * count and returns; the loop that calls it again is a deployment's. Nothing
 * here retries in place, because a retry that outlives a process is a row
 * rather than a loop. The two sweeps are bounded like every other step, which
 * is what keeps a cluster-wide outage from locking every affected row in one
 * transaction: each is idempotent, so a takeover with more attempts to fence
 * than one pass may take finishes across the passes that follow.
 *
 * THE TWO INABILITIES ARE KEPT APART, which is the whole reason the policy and
 * placement ports answer with three arms rather than a boolean.
 * issue #180 makes a definitive inability to
 * run the immutable contract a wall the task reports and a temporary one a
 * visible hold, and conflating them would either fabricate a domain outcome out
 * of a cluster outage or leave a permanently unrunnable ticket queued forever.
 * A denial therefore blocks; an unavailability withdraws the attempt without
 * spending the safe retry budget and leaves the execution exactly as it was.
 *
 * A PASS FENCES BEFORE IT MOVES ANYTHING ELSE. After a takeover the previous
 * epoch's attempts may still be running, and one still names a live
 * attempt it could report a manifest and a completion under. Fencing first is
 * what makes the rest of the pass safe to run at all: an old-generation executor
 * may finish its local work afterwards and can do nothing with it. It is
 * idempotent, so a pass that finds nothing left to fence fences nothing.
 *
 * REAPING A LAPSED LEASE IS A MOVE AND IS ASKED FOR AS ONE. An attempt whose
 * lease has run out is no longer live but its row still says it is, so nothing
 * launchable can be found until those attempts are ended. That is a durable
 * write, and hiding it inside the read that needs it would give this layer a
 * port method whose name promises a question and whose body spends a retry
 * budget. So the launch step reaps first and then reads, and a caller can see
 * both.
 *
 * A WORKLOAD THE DURABLE ROW WOULD NOT TAKE IS DELETED WHERE IT WAS PLACED. An
 * attempt fenced between the placement and the record leaves an executor running
 * for a generation that may no longer report, so the same pass asks the backend
 * to cancel it; leaving it would let the next pass place a second attempt for one
 * logical task, which is the thing the attempt fence exists to prevent. The
 * durable answer still comes first, so a deletion lost to a crash leaves a
 * placement whose attempt is already fenced.
 *
 * CANCELLATION IS DURABLE BEFORE THE FABRIC HEARS OF IT, and the port's shape
 * is what enforces that rather than the order of two statements: the
 * registration outcome is what names the attempts it fenced, so deleting first
 * is not an order this code can express. 006 fulfills a cancellation request
 * when the retirement is registered and the logical slot released, not when the
 * placement is gone, because the opposite would hold a slot for work nobody is
 * going to run for as long as the cluster was unreachable. A deletion lost to a
 * crash leaves a placement whose attempt is already fenced, which can report
 * nothing either way and which inventory reconciles.
 *
 * A WORKER IS BRIEFED BEFORE IT IS PLACED, AND THE PORT HAS NO SHAPE FOR AN
 * UNBRIEFED ONE. `AttemptPlacement` carries the composed invocation, so placing
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
 * rows do not carry. Which of them it was is observed as the composition's own
 * bounded fault, so a rewritten pinned revision and an over-long line are not
 * one undifferentiated refusal to whoever has to explain the blocked ticket.
 *
 * A LOST ATTEMPT SPENDS THE BUDGET AND A WITHDRAWN ONE DOES NOT. An attempt
 * that ran and vanished is the bounded retry 006 permits; one the fabric never
 * took is not an attempt at the work at all. When the budget is spent the
 * execution terminalizes as one completion reporting the process died, under
 * the explicit empty manifest that says it produced nothing — 006's
 * exhausted-safe-retry outcome, and not a verdict fabricated for an evaluator
 * that never reached one.
 *
 * AN EXECUTION ROUTED TO POOLS IS NEVER PLACED HERE. Its attempt is opened and
 * `runner.qnt`'s `placementOutcome` asked of the pools its project registered,
 * each revoked where the project authority withholds its `Execute`. That is
 * the two inabilities again: no pool configured to run it blocks, and one that
 * could is a hold, as is an authority that could not answer. A held attempt,
 * prepared and invoked as a placed one is where a pool could run it, waits on
 * its own lease, and one no pool holds when that lapses is withdrawn without
 * spending the budget.
 *
 * A POOL'S REFUSAL IS THE DEFINITIVE INABILITY. A pool that says it cannot run
 * what it claimed blocks the execution rather than holding it for another pool,
 * which is the task contract's `TaskExecutionUnavailable`. One naming a fault
 * of the image blocks it as `TicketConfigIncompatible` under the fault's own
 * label, as a fault the cluster's pod shows does below. The reaper passes over
 * a refused attempt whatever its lease, so a refusal is never ended as a lapse.
 *
 * ONCE A POOL HAS CLAIMED AN ATTEMPT, ITS EXECUTION OPENS NO OTHER. Any other
 * end of that attempt without a verified report concludes the execution as the
 * process that died, and recovery is the ticket's. A block, a refusal and that
 * conclusion are `runner.qnt`'s `cancel` of the assignment where one was made,
 * and the ledger's own move to `Cancelled` where none was. Which it was is
 * evidence rather than a model term, and `test/interpreter/runner.test.ts`
 * states the mapping and holds it to the model.
 *
 * A WORKLOAD THAT MET A FAULT ITS WORKER CANNOT REPORT IS ENDED ON IT. A job
 * whose image could not be pulled, started or passed through the runtime's
 * check never claims anything, so waiting out its lease spends the ticket's
 * whole retry budget a lease at a time on a fault no retry changes, and records
 * `LeaseExpired` over what happened. The pass asks the placement port instead,
 * before the reaper. A fault of the image blocks the execution as
 * `TicketConfigIncompatible` under the fault's own label, and the backend
 * stores the text its person reads first, while the attempt is still live
 * enough to take it. A fault of the site's own runtime withdraws the attempt as
 * `PlacementUnavailable` without spending the budget, because no change to the
 * ticket mends it, and the pass reports it for an operator. The pod is
 * cancelled after the durable move, so a pass that stops between them leaves an
 * ended attempt the cleanup removes. Each placed attempt costs one observation,
 * and one that faulted the further requests its error text and its cancel take,
 * which for a cluster are its bearer Secret's read, the worker plane's write and
 * the pod's delete; all are bounded by `attemptsPerPassMax` and taken one at a
 * time, as the session pass observes its pods.
 *
 * NOTHING HERE READS A CLOCK. Claim leases, placement backoff and attempt
 * leases are durations handed to the store, which asks the database what time
 * it is; `eslint.config.js` says so for this directory.
 */

import {
  attemptRefusalBlock,
  checkedExecutionSchedulerConfig,
  executionRoutes,
  recordScheduler,
  type AttemptEvidenceRecord,
  type AttemptLoss,
  type AttemptOpening,
  type BlockedReason,
  type ExecutionPolicy,
  type ExecutionProfile,
  type ExecutionSchedulerConfig,
  type ExecutionSchedulerStore,
  type FencedAttempt,
  type LogicalExecution,
  type PhysicalAttempt,
  type SchedulerOwnerId,
  type SchedulerTelemetry,
  type AttemptPlacementPort,
  type ClusterId,
} from "./executionScheduler.ts";
import type { WorkerImageFault } from "../contract/workerEnvironment.ts";
import type { FinalizerConfig, RepositoryId } from "./finalizer.ts";
import type { RecoveryEpoch } from "./projectStore.ts";
import type { TicketServiceConfig } from "./ticketService.ts";
import {
  composeTaskInvocation,
  type FailedLanding,
  type FailedLandingPort,
  type PinnedConfigurationPort,
  type PinnedTaskConfiguration,
  type PracticeCatalog,
  type PriorEvaluationReports,
  type PriorEvaluationReportsPort,
  type PriorWorkReports,
  type PriorWorkReportsPort,
  type ReadOnlyRepositoriesPort,
  type RuntimeFacts,
  type RuntimeFactsPort,
  type TaskInvocation,
  type TaskConfigurationReadFault,
  type TaskPurpose,
} from "./taskBriefing.ts";
import type { PolicyAuthorityGrant } from "./taskAuthority.ts";
import type { TicketBriefPort } from "./ticketBrief.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Principal } from "./principal.ts";
import {
  workerPoolExecutes,
  workerPoolOwnerStands,
  type PersonalRunnerRegistered,
  type WorkerPoolRegistered,
  type WorkerPoolRoster,
} from "./workerPool.ts";
import {
  workerPoolOutcomeRegistered,
  type WorkerPoolAnswered,
} from "./workerPoolAssignment.ts";
import { workTaskInvocation } from "./workerTask.ts";

/** Everything a scheduler pass calls out through, and the bounds it works within. */
export interface ExecutionSchedulerService {
  readonly store: ExecutionSchedulerStore;
  readonly placement: AttemptPlacementPort;
  readonly workerPools: WorkerPoolRoster;
  readonly access: ProjectAccess;
  readonly policy: ExecutionPolicy;
  readonly configurations: PinnedConfigurationPort;
  readonly runtimeFacts: RuntimeFactsPort;
  readonly readOnlyRepositories: ReadOnlyRepositoriesPort;
  readonly priorWorkReports: PriorWorkReportsPort;
  readonly priorEvaluationReports: PriorEvaluationReportsPort;
  readonly failedLanding: FailedLandingPort;
  readonly ticketBriefs: TicketBriefPort;
  readonly practices: PracticeCatalog;
  /** The image chuggy's runtime is copied from, which every attempt a pass opens keeps. */
  readonly workerRuntime: string;
  readonly config: ExecutionSchedulerConfig;
  readonly ticketService: TicketServiceConfig;
  readonly finalizer: FinalizerConfig;
  readonly metrics: SchedulerTelemetry;
}

/** What a pass met that it cannot mend itself, which a deployment tells its operator. */
export type SchedulerPassNotice =
  | {
      readonly notice: "SiteFault";
      readonly attempt: FencedAttempt;
      readonly why: string;
    }
  | {
      readonly notice: "ErrorUnwritten";
      readonly attempt: FencedAttempt;
      readonly fault: WorkerImageFault;
      readonly text: string;
      readonly why: string;
    };

/** How many attempts one observation ended, and what it has to tell. */
export interface SchedulerObserved {
  readonly observed: number;
  readonly notices: readonly SchedulerPassNotice[];
}

/** What one bounded pass moved, which is what a deployment's loop paces itself by, and what it has to tell. */
export interface SchedulerPassReport {
  readonly fenced: number;
  readonly cleaned: number;
  readonly registered: number;
  readonly cancelled: number;
  readonly admitted: number;
  readonly observed: number;
  readonly placed: number;
  readonly notices: readonly SchedulerPassNotice[];
}

/** Removes a bounded batch of ended physical workloads, acknowledging only accepted cleanup. */
export async function executionSchedulerCleanup(
  service: ExecutionSchedulerService,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  const attempts = await service.store.attemptsAwaitingCleanup(
    config.attemptsPerPassMax,
  );
  let cleaned = 0;
  for (const attempt of attempts) {
    const cancelled = await service.placement.cancel(attempt);
    if (cancelled.cancelled === "Unavailable")
      throw new Error("execution scheduler: attempt cleanup is unavailable");
    if (await service.store.attemptCleanupCompleted(attempt)) cleaned += 1;
  }
  return cleaned;
}

/**
 * Ends one attempt without a result, which is the one place this module records
 * that, and records it only where the fenced move ended it rather than finding
 * it already ended.
 */
async function schedulerEndAttempt(
  service: ExecutionSchedulerService,
  attempt: FencedAttempt,
  loss: AttemptLoss,
  evidence: AttemptEvidenceRecord,
): Promise<boolean> {
  const ended = await service.store.attemptEnded(attempt, loss, evidence);
  if (ended) {
    recordScheduler(service.metrics, (metrics) => {
      metrics.attemptEnded(loss, evidence);
    });
  }
  return ended;
}

/** Fences every attempt an older recovery epoch issued, which is what a takeover owes. */
export async function executionSchedulerFence(
  service: ExecutionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  const fenced = await service.store.fenceOldEpochAttempts(
    epoch,
    config.attemptsPerPassMax,
  );
  recordScheduler(service.metrics, (metrics) => {
    metrics.fencing("Epoch", fenced);
  });
  return fenced;
}

/** Registers every spawn request this pass could claim, fencing superseded ones. */
export async function executionSchedulerRegister(
  service: ExecutionSchedulerService,
  owner: SchedulerOwnerId,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  const claims = await service.store.claimRequests(
    owner,
    ["SpawnWork", "SpawnEvaluation"],
    config.requestsPerPassMax,
    config.requestClaimLeaseSecs,
  );
  let registered = 0;
  for (const claim of claims) {
    const outcome = await service.store.registerSpawn(
      claim,
      config.nTasks,
      executionRoutes(
        service.policy.routing,
        claim.partition,
        await service.store.projectPlacement(claim.partition),
      ),
    );
    recordScheduler(service.metrics, (metrics) => {
      metrics.registration(outcome.registered);
      if (outcome.registered === "Conflicting") {
        metrics.incident("ConflictingRegistration");
      }
    });
    if (outcome.registered === "Registered") registered += 1;
  }
  return registered;
}

/** Fences every task the claimed cancellation requests name, then fulfills them. */
export async function executionSchedulerCancel(
  service: ExecutionSchedulerService,
  owner: SchedulerOwnerId,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  const claims = await service.store.claimRequests(
    owner,
    ["CancelTicketWork"],
    config.requestsPerPassMax,
    config.requestClaimLeaseSecs,
  );
  let cancelled = 0;
  for (const claim of claims) {
    const outcome = await service.store.registerCancellation(claim);
    recordScheduler(service.metrics, (metrics) => {
      metrics.cancellation(outcome.cancelled);
      if (outcome.cancelled === "Registered") {
        metrics.fencing("Cancellation", outcome.placements.length);
      }
    });
    if (outcome.cancelled !== "Registered") continue;
    cancelled += outcome.fenced;
    for (const placement of outcome.placements) {
      await service.placement.cancel(placement);
    }
  }
  return cancelled;
}

/** Takes slots for queued work until the cluster or an account says no more. */
export async function executionSchedulerAdmit(
  service: ExecutionSchedulerService,
  cluster: ClusterId,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  let admitted = 0;
  for (let taken = 0; taken < config.admissionsPerPassMax; taken += 1) {
    const outcome = await service.store.admit(cluster);
    recordScheduler(service.metrics, (metrics) => {
      metrics.admission(outcome.admitted);
    });
    if (outcome.admitted !== "Admitted") return admitted;
    admitted += 1;
  }
  return admitted;
}

/**
 * Withdraws the attempt and retires the execution it names, which is what a
 * definitive inability earns, answering whether this move ended the attempt.
 */
async function schedulerBlock(
  service: ExecutionSchedulerService,
  attempt: FencedAttempt,
  evidence: AttemptEvidenceRecord,
  reason: BlockedReason,
): Promise<boolean> {
  const ended = await schedulerEndAttempt(
    service,
    attempt,
    "Withdrawn",
    evidence,
  );
  const blocked = await service.store.blockExecution(
    attempt.partition,
    attempt.execution,
    reason,
  );
  recordScheduler(service.metrics, (metrics) => {
    metrics.blocking(blocked.blocked, reason);
    if (blocked.blocked === "Conflicting") {
      metrics.incident("ImpossibleState");
    }
  });
  return ended;
}

/** What policy granted this execution, or the durable move its refusal earns. */
async function schedulerPolicyFor(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<
  | {
      readonly profile: ExecutionProfile;
      readonly grant: PolicyAuthorityGrant;
      readonly image?: string;
    }
  | undefined
> {
  const resolved = await service.policy.profileFor(execution);
  switch (resolved.resolved) {
    case "Profile":
      return {
        profile: resolved.profile,
        grant: resolved.grant,
        ...(resolved.image === undefined ? {} : { image: resolved.image }),
      };
    case "Denied":
      await schedulerBlock(service, attempt, "PolicyDenied", resolved.reason);
      return undefined;
    case "Unavailable":
      await schedulerEndAttempt(
        service,
        attempt,
        "Withdrawn",
        "PolicyUnavailable",
      );
      return undefined;
  }
}

/** Why a briefing could not be gathered, which is the two inabilities once more. */
type BriefingUnready =
  | { readonly gathered: "Missing" }
  | {
      readonly gathered: "Incompatible";
      readonly fault: TaskConfigurationReadFault;
    }
  | { readonly gathered: "Unavailable" };

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
    case "Incompatible":
      return { gathered: "Incompatible", fault: read.fault };
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

/** Reads the repositories this execution's project binds beside its own, which its pod reads and never delivers to. */
async function schedulerReadOnlyRepositories(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<
  { readonly readOnlyRepositories: readonly RepositoryId[] } | BriefingUnready
> {
  const read = await service.readOnlyRepositories.repositories(
    execution.partition,
    execution.execution,
  );
  switch (read.read) {
    case "Repositories":
      return { readOnlyRepositories: read.repositories };
    case "Unavailable":
      return { gathered: "Unavailable" };
  }
}

/** The durable move an ungatherable briefing input earns, one arm each. */
async function schedulerUnready(
  service: ExecutionSchedulerService,
  attempt: FencedAttempt,
  unready: BriefingUnready,
): Promise<void> {
  switch (unready.gathered) {
    case "Missing":
      await schedulerBlock(
        service,
        attempt,
        "PolicyDenied",
        "TicketConfigIncompatible",
      );
      return;
    case "Incompatible":
      recordScheduler(service.metrics, (metrics) => {
        metrics.briefing(unready.fault);
      });
      await schedulerBlock(
        service,
        attempt,
        `PolicyDenied: ${unready.fault}`,
        "TicketConfigIncompatible",
      );
      return;
    case "Unavailable":
      await schedulerEndAttempt(
        service,
        attempt,
        "Withdrawn",
        "PolicyUnavailable",
      );
      return;
  }
}

/** Reads the bounded work summaries this execution's own input bundle pinned. */
async function schedulerPriorWorkReports(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<PriorWorkReports | BriefingUnready> {
  const read = await service.priorWorkReports.reports(
    execution.partition,
    execution.execution,
  );
  switch (read.read) {
    case "Reports":
      return read.reports;
    case "Unavailable":
      return { gathered: "Unavailable" };
  }
}

/**
 * Reads the reports of the failed evaluation a work task follows. Only a work
 * task renders them, so no other kind is asked; an evaluation or a first
 * attempt is briefed with none.
 */
async function schedulerPriorEvaluationReports(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<PriorEvaluationReports | BriefingUnready> {
  if (execution.taskKind !== "Work") return { reports: [] };
  const read = await service.priorEvaluationReports.reports(
    execution.partition,
    execution.execution,
  );
  switch (read.read) {
    case "Reports":
      return read.reports;
    case "Unavailable":
      return { gathered: "Unavailable" };
  }
}

/**
 * Reads the failed landing a work task follows. Only a work task renders it,
 * so no other kind is asked, and a task that follows none is briefed with none.
 */
async function schedulerFailedLanding(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<{ readonly landing?: FailedLanding } | BriefingUnready> {
  if (execution.taskKind !== "Work") return {};
  const read = await service.failedLanding.landing(
    execution.partition,
    execution.execution,
  );
  switch (read.read) {
    case "Landing":
      return read.landing === undefined ? {} : { landing: read.landing };
    case "Unavailable":
      return { gathered: "Unavailable" };
  }
}

/** What a rework is told of the cycle before it, gathered as one value so either read can hold the attempt. */
async function schedulerRework(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<
  | {
      readonly priorEvaluationReports: PriorEvaluationReports;
      readonly failedLanding?: FailedLanding;
    }
  | BriefingUnready
> {
  const priorEvaluationReports = await schedulerPriorEvaluationReports(
    service,
    execution,
  );
  if ("gathered" in priorEvaluationReports) return priorEvaluationReports;
  const failed = await schedulerFailedLanding(service, execution);
  if ("gathered" in failed) return failed;
  return {
    priorEvaluationReports,
    ...(failed.landing === undefined ? {} : { failedLanding: failed.landing }),
  };
}

/** What a placement needs before it may be asked for: the profile, and the composed invocation. */
interface TaskLaunch {
  readonly profile: ExecutionProfile;
  readonly image?: string;
  readonly invocation: TaskInvocation;
}

/** Selects the authored evaluation role after its pinned configuration has been read. */
function schedulerTaskPurpose(
  execution: LogicalExecution,
  configuration: PinnedTaskConfiguration,
): TaskPurpose {
  if (execution.taskKind === "Work") return "Work";
  return execution.stage === undefined
    ? "Review"
    : (configuration.evaluations?.[execution.stage]?.purpose ?? "Review");
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
    await schedulerUnready(service, attempt, configuration);
    return undefined;
  }
  const runtime = await schedulerRuntimeFacts(service, execution);
  if ("gathered" in runtime) {
    await schedulerUnready(service, attempt, runtime);
    return undefined;
  }
  const readOnly = await schedulerReadOnlyRepositories(service, execution);
  if ("gathered" in readOnly) {
    await schedulerUnready(service, attempt, readOnly);
    return undefined;
  }
  const priorWorkReports = await schedulerPriorWorkReports(service, execution);
  if ("gathered" in priorWorkReports) {
    await schedulerUnready(service, attempt, priorWorkReports);
    return undefined;
  }
  const rework = await schedulerRework(service, execution);
  if ("gathered" in rework) {
    await schedulerUnready(service, attempt, rework);
    return undefined;
  }
  const brief = await service.ticketBriefs.brief(
    execution.partition,
    execution.ticket,
  );
  const composed = composeTaskInvocation(service.practices, {
    purpose: schedulerTaskPurpose(execution, configuration),
    ...(execution.stage === undefined ? {} : { stage: execution.stage }),
    pin: execution,
    configuration,
    runtime,
    ...readOnly,
    priorWorkReports,
    ...rework,
    ...(brief === undefined ? {} : { brief }),
    grant: policy.grant,
  });
  switch (composed.composed) {
    case "Composed":
      return {
        profile: policy.profile,
        ...(policy.image === undefined ? {} : { image: policy.image }),
        invocation: composed.invocation,
      };
    case "Blocked":
      recordScheduler(service.metrics, (metrics) => {
        metrics.briefing(composed.fault);
      });
      await schedulerBlock(
        service,
        attempt,
        `PolicyDenied: ${composed.fault}`,
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
  if (
    !(await service.store.attemptInvoked(attempt, workTaskInvocation(launch)))
  )
    return false;
  const placed = await service.placement.place({
    partition: execution.partition,
    execution: execution.execution,
    attempt: attempt.attempt,
    generation: attempt.generation,
    ticket: execution.ticket,
    task: execution.task,
    taskKind: execution.taskKind,
    ...(execution.stage === undefined ? {} : { stage: execution.stage }),
    sourceRequest: execution.sourceRequest,
    inputBundle: execution.inputBundle,
    inputBundleDigest: execution.inputBundleDigest,
    configurationRevision: execution.configurationRevision,
    configurationDigest: execution.configurationDigest,
    requirementIdentity: execution.requirementIdentity,
    requirement: execution.requirement,
    requirementDigest: execution.requirementDigest,
    ...(execution.resources === undefined
      ? {}
      : { resources: execution.resources }),
    profile: launch.profile,
    ...(launch.image === undefined ? {} : { image: launch.image }),
    invocation: launch.invocation,
    capability: attempt.capability,
  });
  recordScheduler(service.metrics, (metrics) => {
    metrics.placement(placed.placed);
  });
  switch (placed.placed) {
    case "Placed": {
      const recorded = await service.store.attemptPlaced(
        attempt,
        placed.placement,
      );
      if (!recorded) {
        await service.placement.cancel(attempt);
      }
      return recorded;
    }
    case "Denied":
      await schedulerBlock(service, attempt, "PlacementDenied", placed.reason);
      return false;
    case "Unavailable":
      await schedulerEndAttempt(
        service,
        attempt,
        "Withdrawn",
        "PlacementUnavailable",
      );
      return false;
  }
}

/** An execution's owner and the personal runner registered for them. */
interface SchedulerOwnerRunner {
  readonly owner: Principal;
  readonly runner: PersonalRunnerRegistered;
}

/** The owner's runner where the execution's project allows one, and nothing where it allows none, it has no owner, or the owner has no runner. */
async function schedulerOwnerRunner(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
): Promise<SchedulerOwnerRunner | undefined> {
  const owner = execution.owner;
  if (execution.ownerFallback === undefined || owner === undefined)
    return undefined;
  const runner = await service.workerPools.personal(execution.partition, owner);
  return runner === undefined ? undefined : { owner, runner };
}

/** The owner's runner, revoked where the owner no longer holds what admits it or `Read` of the project. */
async function schedulerOwnerRunnerAnswered(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  { owner, runner }: SchedulerOwnerRunner,
): Promise<WorkerPoolAnswered> {
  return {
    partition: execution.partition,
    pool: owner,
    principal: runner.principal,
    capabilities: runner.capabilities,
    class: "Personal",
    dedicatedOwner: owner,
    allowlist: runner.allowlist,
    revoked: !(await workerPoolOwnerStands(
      service.access,
      owner,
      execution.partition,
    )),
  };
}

/**
 * Each pool beside whether the authority withholds its `Execute`, and the
 * owner's personal runner beside whether it is revoked, or nothing where the
 * authority could not answer, which decides nothing this pass.
 */
async function schedulerPoolsAnswered(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  pools: readonly WorkerPoolRegistered[],
  owned: SchedulerOwnerRunner | undefined,
): Promise<readonly WorkerPoolAnswered[] | undefined> {
  try {
    const answered = await Promise.all(
      pools.map(async (pool) => ({
        ...pool,
        dedicatedOwner: undefined,
        allowlist: [],
        revoked: !(await workerPoolExecutes(
          service.access,
          pool.partition,
          pool.principal,
        )),
      })),
    );
    return owned === undefined
      ? answered
      : [
          ...answered,
          await schedulerOwnerRunnerAnswered(service, execution, owned),
        ];
  } catch {
    return undefined;
  }
}

/**
 * Asks what can be said of an execution routed to pools against the pools its
 * project registered and its owner's personal runner, blocks the one no runner
 * is configured to run, and answers whether its attempt may be offered. A page
 * the registry cut short never blocks, since a pool past it may be, and an
 * undecided authority holds.
 */
async function schedulerOfferable(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<boolean> {
  const registered = await service.workerPools.registered(execution.partition);
  const answered = await schedulerPoolsAnswered(
    service,
    execution,
    registered.pools,
    await schedulerOwnerRunner(service, execution),
  );
  if (answered === undefined) return false;
  const outcome = workerPoolOutcomeRegistered(execution, answered);
  switch (outcome) {
    case "DefinitiveIncompatibility":
      if (registered.truncated) return true;
      await schedulerBlock(
        service,
        attempt,
        "PlacementIncompatible",
        "RequiredCapabilityUnavailable",
      );
      return false;
    case "Placeable":
    case "Unavailable":
      return true;
    case "NotApplicable":
      throw new Error(
        `execution scheduler: ${execution.execution} is routed to pools and no pool outcome applies to it`,
      );
  }
}

/**
 * Offers an opened attempt to the pools its execution is routed to: prepared
 * and invoked as a placed one is, so a pool claims what policy admitted, and
 * never placed, because a pool takes it rather than being handed it.
 */
async function schedulerOffer(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<void> {
  if (!(await schedulerOfferable(service, execution, attempt))) return;
  const launch = await schedulerPrepare(service, execution, attempt);
  if (launch === undefined) return;
  if (
    !(await service.store.attemptInvoked(attempt, workTaskInvocation(launch)))
  )
    return;
  recordScheduler(service.metrics, (metrics) => {
    metrics.attemptOffered();
  });
}

/** Places an opened attempt, or offers it to the pools its execution is routed to. */
async function schedulerLaunchOpened(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  attempt: PhysicalAttempt,
): Promise<boolean> {
  switch (execution.route) {
    case "InCluster":
      return schedulerPlace(service, execution, attempt);
    case "Pool":
      await schedulerOffer(service, execution, attempt);
      return false;
  }
}

/** Opens and places the next attempt for one execution that owns a slot. */
async function schedulerLaunchOne(
  service: ExecutionSchedulerService,
  execution: LogicalExecution,
  epoch: RecoveryEpoch,
): Promise<boolean> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  const opening: AttemptOpening = {
    partition: execution.partition,
    execution: execution.execution,
    epoch,
    leaseSecs: config.attemptLeaseSecs,
    retriesMax: config.attemptRetriesMax,
    placementBackoffSecs: config.placementBackoffSecs,
    runtime: service.workerRuntime,
  };
  const opened = await service.store.openAttempt(opening);
  recordScheduler(service.metrics, (metrics) => {
    metrics.attemptOpened(opened.opened);
  });
  switch (opened.opened) {
    case "Opened":
      return schedulerLaunchOpened(service, execution, opened.attempt);
    case "NotLaunchable":
    case "BackingOff":
      return false;
    case "RetriesExhausted": {
      const outcome = await service.store.retriesExhausted(
        execution.partition,
        execution.execution,
      );
      recordScheduler(service.metrics, (metrics) => {
        metrics.terminalization(outcome.terminalized);
      });
      return false;
    }
    case "AssignmentEnded": {
      const outcome = await service.store.assignmentEnded(
        execution.partition,
        execution.execution,
      );
      recordScheduler(service.metrics, (metrics) => {
        metrics.terminalization(outcome.terminalized);
      });
      return false;
    }
  }
}

/** Ends an attempt whose workload could not be run and blocks its execution as `attemptRefusalBlock` says, answering whether this step ended it. */
function schedulerBlockUnrun(
  service: ExecutionSchedulerService,
  attempt: FencedAttempt,
  fault: WorkerImageFault | undefined,
): Promise<boolean> {
  const block = attemptRefusalBlock(fault);
  return schedulerBlock(service, attempt, block.evidence, block.reason);
}

/** Blocks the execution of each attempt a pool refused, before any lapsed lease is reaped. */
async function schedulerBlockRefused(
  service: ExecutionSchedulerService,
  epoch: RecoveryEpoch,
  attemptsMax: number,
): Promise<void> {
  const refused = await service.store.refusedAttempts(epoch, attemptsMax);
  for (const attempt of refused)
    await schedulerBlockUnrun(service, attempt, attempt.fault);
}

/**
 * Ends one observed attempt on what its workload met, answering whether this
 * step was what ended it and noting what an operator has to be told.
 */
async function schedulerObserveOne(
  service: ExecutionSchedulerService,
  attempt: FencedAttempt,
  notices: SchedulerPassNotice[],
): Promise<boolean> {
  const workload = await service.placement.observe(attempt);
  switch (workload.observed) {
    case "Unfaulted":
      return false;
    case "ImageFault": {
      const written = await service.placement.writeError(
        attempt,
        workload.text,
      );
      const ended = await schedulerBlockUnrun(service, attempt, workload.fault);
      if (ended && written.written === "Unwritten")
        notices.push({
          notice: "ErrorUnwritten",
          attempt,
          fault: workload.fault,
          text: workload.text,
          why: written.why,
        });
      await service.placement.cancel(attempt);
      return ended;
    }
    case "SiteFault": {
      const ended = await schedulerEndAttempt(
        service,
        attempt,
        "Withdrawn",
        "PlacementUnavailable",
      );
      if (ended)
        notices.push({ notice: "SiteFault", attempt, why: workload.why });
      await service.placement.cancel(attempt);
      return ended;
    }
  }
}

/**
 * Ends a bounded batch of placed attempts whose workload met a fault its own
 * worker cannot report. It runs before the reaper because it is the sharper
 * answer for the same attempts, and one it leaves standing is what the lease
 * is still for.
 */
export async function executionSchedulerObserve(
  service: ExecutionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<SchedulerObserved> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  const attempts = await service.store.attemptsAwaitingObservation(
    epoch,
    config.attemptsPerPassMax,
  );
  const notices: SchedulerPassNotice[] = [];
  let observed = 0;
  for (const attempt of attempts) {
    if (await schedulerObserveOne(service, attempt, notices)) observed += 1;
  }
  return { observed, notices };
}

/** Places attempts for the executions that hold a slot and have no live attempt. */
export async function executionSchedulerLaunch(
  service: ExecutionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedExecutionSchedulerConfig(
    service.config,
    service.ticketService,
    service.finalizer,
  );
  await schedulerBlockRefused(service, epoch, config.attemptsPerPassMax);
  const reaped = await service.store.reapLapsedAttempts(
    epoch,
    config.attemptsPerPassMax,
  );
  recordScheduler(service.metrics, (metrics) => {
    metrics.reaping(reaped);
  });
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
  const cleaned = await executionSchedulerCleanup(service);
  const cancelled = await executionSchedulerCancel(service, owner);
  const registered = await executionSchedulerRegister(service, owner);
  const admitted = await executionSchedulerAdmit(service, cluster);
  const { observed, notices } = await executionSchedulerObserve(service, epoch);
  const placed = await executionSchedulerLaunch(service, epoch);
  return {
    fenced,
    cleaned,
    registered,
    cancelled,
    admitted,
    observed,
    placed,
    notices,
  };
}
