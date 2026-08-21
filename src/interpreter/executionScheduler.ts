/**
 * The execution scheduler's own vocabulary: the capacity arithmetic
 * `model/capacity.qnt` proves, the durable logical execution that arithmetic
 * ranges over, and the ports the scheduler service reaches the world through.
 *
 * THE CAPACITY FUNCTIONS BELOW MIRROR THE MODEL AND ARE NOT A SECOND OPINION.
 * `model/capacity.qnt` defines `ownsSlot`, `activeCount`, `accountActiveCount`,
 * `reservationDeficit`, `legalStatusMove`, `mayAdmit`, `preferredOver` and
 * `capacitySafe` over a set of registrations, and every one of them has a
 * counterpart here with the same name and the same arms. The adapter enforces
 * the same rules again in PostgreSQL, because a check in this layer is a check
 * a direct table write walks past; these exist so the rules can be unit-tested
 * and so the adapter has something to be compared against.
 *
 * A QUEUED EXECUTION OWNS NO SLOT AND AN ATTEMPT NEVER OWNS ONE. Slot
 * ownership is a function of the logical status, so it is derived at every
 * site rather than stored beside the status — standing rule 3 — and
 * terminalization and cancellation release exactly one slot because the status
 * they move to is absorbing.
 *
 * PHYSICAL ATTEMPTS LIVE BELOW THE LOGICAL GRAIN. An execution is one logical
 * task, keyed by `(tenant, project, ticket, task)`; its attempts are
 * sequential, never reuse an identity, and only the current unfenced one may
 * report authoritatively. `Core` never sees an attempt, and no attempt
 * allocates a second slot.
 *
 * EVERY REFUSAL IS A VALUE, as elsewhere in this layer. A superseded spawn, a
 * fenced attempt, a conflicting result and a cluster with no headroom are
 * outcomes a caller must handle, not exceptions it may ignore.
 *
 * NOTHING HERE DECIDES A TICKET. The scheduler submits `TaskDone` and
 * `ExecutionBlocked` through the narrow completion boundary and cannot append
 * a journal entry, settle an operation or move a ticket projection.
 *
 * THE IMMUTABLE INPUT CONTRACT IS THE SPAWN REQUEST ITSELF, at this point in
 * the tree. 006 has every registration pin its input bundle, and a bundle
 * relation today would hold the request's own ticket, task set, provenance and
 * pinned configuration revision and a digest derived from them — a stored
 * duplicate of derivable facts, which standing rule 3 rejects. So an execution
 * pins the request identity and the configuration revision and digest, and the
 * bundle relation arrives with the slice that gives it upstream handoff and
 * artifact references of its own to hold.
 *
 * A BLOCK RETIRES ONE EXECUTION AND NOT ITS SIBLINGS. `ExecutionBlocked`
 * escalates the whole ticket in `Core`, but the decider emits only
 * `OpenHumanTask`, so no cancellation obligation reaches this scheduler for the
 * work that was still outstanding. Those siblings therefore drain: each
 * terminalizes normally, releasing its own slot exactly once, and its
 * completion is refused by the writer as the auditable staleness 006 already
 * describes. Retiring them here instead would make the scheduler decide a
 * ticket-wide fact it is not the authority for.
 */

import type { Reason } from "../domain/generated/modelTypes.ts";
import type { TaskId, TicketId } from "../domain/ids.ts";
import type { TaskPurpose } from "./briefingTemplate.ts";
import type { OperationId } from "./operationInbox.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { ResultManifest, ResultManifestId } from "./resultManifest.ts";
import type { TaskInvocation } from "./taskBriefing.ts";
import type { PolicyAuthorityGrant } from "./taskAuthority.ts";
export {
  asAttemptId,
  asCapacityAccountId,
  asClusterId,
  asExecutionId,
  asSchedulerOwnerId,
  asWorkloadId,
  schedulerIdentityCharsMax,
  type AttemptId,
  type CapacityAccountId,
  type ClusterId,
  type ExecutionId,
  type SchedulerOwnerId,
  type WorkloadId,
} from "./schedulerIdentity.ts";
import type {
  AttemptId,
  CapacityAccountId,
  ClusterId,
  ExecutionId,
  SchedulerOwnerId,
  WorkloadId,
} from "./schedulerIdentity.ts";

/** The logical states of `model/capacity.qnt`, in the order that module declares them. */
export type ExecutionStatus =
  "Queued" | "Admitted" | "Launching" | "Running" | "Terminal" | "Cancelled";

/** Every logical status, so a suite and a database CHECK iterate rather than restate. */
export const allExecutionStatuses: readonly ExecutionStatus[] = [
  "Queued",
  "Admitted",
  "Launching",
  "Running",
  "Terminal",
  "Cancelled",
];

/** What one logical task settled as, which is the only thing `Core` is told. */
export type ExecutionOutcome = "Passed" | "Failed" | "Blocked";

/** Every terminal outcome, so a suite and a database CHECK iterate rather than restate. */
export const allExecutionOutcomes: readonly ExecutionOutcome[] = [
  "Passed",
  "Failed",
  "Blocked",
];

/** The kind of logical task an execution runs, mirroring the spawn request's child rows. */
export type ExecutionTaskKind = "Work" | "Evaluation";

/** Which briefing template a logical task's kind is briefed from, which is total and never a lookup. */
export function taskPurposeForKind(kind: ExecutionTaskKind): TaskPurpose {
  switch (kind) {
    case "Work":
      return "Work";
    case "Evaluation":
      return "Review";
  }
}

/** What an account may reserve and may borrow up to, as `model/capacity.qnt` states it. */
export interface Entitlement {
  readonly reserved: number;
  readonly maximum: number;
}

/**
 * The fields the capacity arithmetic reads of a registration, which is every
 * field `model/capacity.qnt` gives its `Execution` record.
 */
export interface CapacityExecution {
  readonly project: string;
  readonly ticket: number;
  readonly task: number;
  readonly account: string;
  readonly sourceSeq: number;
  readonly sourceEffect: number;
  readonly status: ExecutionStatus;
}

/** Whether this status owns one logical slot, which is the model's `ownsSlot`. */
export function executionOwnsSlot(status: ExecutionStatus): boolean {
  switch (status) {
    case "Admitted":
    case "Launching":
    case "Running":
      return true;
    case "Queued":
    case "Terminal":
    case "Cancelled":
      return false;
  }
}

/** Whether the move is one the model permits, which is the model's `legalStatusMove`. */
export function executionLegalMove(
  before: ExecutionStatus,
  after: ExecutionStatus,
): boolean {
  switch (before) {
    case "Queued":
      return after === "Admitted" || after === "Cancelled";
    case "Admitted":
      return (
        after === "Launching" || after === "Terminal" || after === "Cancelled"
      );
    case "Launching":
      return (
        after === "Running" || after === "Terminal" || after === "Cancelled"
      );
    case "Running":
      return after === "Terminal" || after === "Cancelled";
    case "Terminal":
      return after === "Terminal";
    case "Cancelled":
      return after === "Cancelled";
  }
}

/** How many of these registrations own a slot, which is the model's `activeCount`. */
export function executionActiveCount(
  executions: readonly CapacityExecution[],
): number {
  return executions.filter((each) => executionOwnsSlot(each.status)).length;
}

/** How many of one account's registrations own a slot, which is the model's `accountActiveCount`. */
export function executionAccountActiveCount(
  executions: readonly CapacityExecution[],
  account: string,
): number {
  return executions.filter(
    (each) => each.account === account && executionOwnsSlot(each.status),
  ).length;
}

/** The entitlement an account was granted, refusing an account no policy revision covers. */
export function executionEntitlementOf(
  entitlements: ReadonlyMap<string, Entitlement>,
  account: string,
): Entitlement {
  const found = entitlements.get(account);
  if (found === undefined) {
    throw new Error(
      `execution capacity: account ${account} has no entitlement in the current policy revision`,
    );
  }
  return found;
}

/** How far below its reservation an account currently sits, which is the model's `reservationDeficit`. */
export function executionReservationDeficit(
  entitlements: ReadonlyMap<string, Entitlement>,
  executions: readonly CapacityExecution[],
  account: string,
): number {
  const left =
    executionEntitlementOf(entitlements, account).reserved -
    executionAccountActiveCount(executions, account);
  return left > 0 ? left : 0;
}

/** Whether this queued registration may take a slot now, which is the model's `mayAdmit`. */
export function executionMayAdmit(
  clusterSlotsMax: number,
  entitlements: ReadonlyMap<string, Entitlement>,
  executions: readonly CapacityExecution[],
  candidate: CapacityExecution,
): boolean {
  return (
    candidate.status === "Queued" &&
    executionActiveCount(executions) < clusterSlotsMax &&
    executionAccountActiveCount(executions, candidate.account) <
      executionEntitlementOf(entitlements, candidate.account).maximum
  );
}

/** Whether a deficit-bearing account dominates a borrower, which is the model's `preferredOver`. */
export function executionPreferredOver(
  entitlements: ReadonlyMap<string, Entitlement>,
  executions: readonly CapacityExecution[],
  left: CapacityExecution,
  right: CapacityExecution,
): boolean {
  return (
    executionReservationDeficit(entitlements, executions, left.account) > 0 &&
    executionReservationDeficit(entitlements, executions, right.account) === 0
  );
}

/** Whether one logical task names at most one registration, which is the model's `identityUnique`. */
export function executionIdentityUnique(
  executions: readonly CapacityExecution[],
): boolean {
  const keys = executions.map(
    (each) =>
      `${String(each.project.length)}:${each.project}/${String(each.ticket)}/${String(each.task)}`,
  );
  return new Set(keys).size === executions.length;
}

/** Whether every registration names a journaled effect, which is the model's `provenanceWellFormed`. */
export function executionProvenanceWellFormed(
  executions: readonly CapacityExecution[],
): boolean {
  return executions.every(
    (each) =>
      each.project.length > 0 && each.sourceSeq >= 1 && each.sourceEffect >= 0,
  );
}

/** Whether the whole ledger is safe, which is the model's `capacitySafe`. */
export function executionCapacitySafe(
  clusterSlotsMax: number,
  entitlements: ReadonlyMap<string, Entitlement>,
  executions: readonly CapacityExecution[],
): boolean {
  return (
    executionActiveCount(executions) <= clusterSlotsMax &&
    executionIdentityUnique(executions) &&
    executionProvenanceWellFormed(executions) &&
    executions.every((each) => {
      const entitlement = executionEntitlementOf(entitlements, each.account);
      return (
        entitlement.reserved >= 0 &&
        entitlement.maximum >= entitlement.reserved &&
        executionAccountActiveCount(executions, each.account) <=
          entitlement.maximum
      );
    })
  );
}

/** One durable logical execution as the scheduler holds it, provenance included. */
export interface LogicalExecution {
  readonly partition: Partition;
  readonly execution: ExecutionId;
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly taskKind: ExecutionTaskKind;
  readonly stage?: number;
  readonly sourceRequest: string;
  readonly sourceSeq: number;
  readonly sourceEffect: number;
  readonly ticketVersion: number;
  readonly account: CapacityAccountId;
  readonly cluster: ClusterId;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly status: ExecutionStatus;
  readonly outcome?: ExecutionOutcome;
  readonly resultManifest?: ResultManifestId;
  readonly completionOperation?: OperationId;
  readonly attemptsOpened: number;
  readonly retriesSpent: number;
}

/**
 * The identity every durable move against one attempt is fenced by. The
 * generation travels with the identity rather than being read first and trusted
 * after, so the fence is applied where the row is locked: a process that
 * checked it itself would be checking a value it read before the takeover it is
 * being fenced by.
 */
export interface FencedAttempt {
  readonly partition: Partition;
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  readonly generation: number;
}

/** One physical attempt: its fenced identity, its lease, and what it has reported. */
export interface PhysicalAttempt extends FencedAttempt {
  readonly attemptNumber: number;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly state: AttemptState;
  readonly authoritative: boolean;
  readonly workload?: WorkloadId;
}

/** What an attempt is doing, which is below the logical grain and never reaches `Core`. */
export type AttemptState =
  "Placing" | "Running" | "Reported" | "Lost" | "Withdrawn" | "Superseded";

/** Every attempt state, so a suite and a database CHECK iterate rather than restate. */
export const allAttemptStates: readonly AttemptState[] = [
  "Placing",
  "Running",
  "Reported",
  "Lost",
  "Withdrawn",
  "Superseded",
];

/**
 * Why an attempt ended without a result. `Lost` spends the safe retry budget
 * because the attempt ran, and `Withdrawn` does not, because the fabric never
 * took it and a cluster outage is a hold rather than a work failure.
 */
export type AttemptLoss = "Lost" | "Withdrawn";

/** The closed vocabulary an attempt records instead of free text, so a label is never a payload. */
export type AttemptEvidence =
  | "PolicyDenied"
  | "PolicyUnavailable"
  | "PlacementDenied"
  | "PlacementUnavailable"
  | "Evicted"
  | "Vanished"
  | "LeaseExpired"
  | "ManifestInvalid"
  | "Fenced";

/** Every evidence label, so a suite and a database CHECK iterate rather than restate. */
export const allAttemptEvidence: readonly AttemptEvidence[] = [
  "PolicyDenied",
  "PolicyUnavailable",
  "PlacementDenied",
  "PlacementUnavailable",
  "Evicted",
  "Vanished",
  "LeaseExpired",
  "ManifestInvalid",
  "Fenced",
];

/** What a registration pass found for one focused spawn request. */
export type SpawnRegistered =
  | { readonly registered: "Registered"; readonly created: number }
  | { readonly registered: "AlreadyRegistered"; readonly created: 0 }
  | { readonly registered: "Superseded" }
  | { readonly registered: "Conflicting"; readonly incident: string };

/**
 * What a cancellation pass found for one focused cancellation request. It
 * names the attempts it fenced as well as counting the logical tasks it
 * retired, because the workloads behind those attempts are what the fabric is
 * asked to delete afterwards and a count cannot name them.
 */
export type CancellationRegistered =
  | {
      readonly cancelled: "Registered";
      readonly fenced: number;
      readonly workloads: readonly AttemptId[];
    }
  | { readonly cancelled: "AlreadyFulfilled" };

/** What an admission attempt found, naming the bound that stopped it. */
export type Admitted =
  | { readonly admitted: "Admitted"; readonly execution: ExecutionId }
  | { readonly admitted: "NoCandidate" }
  | { readonly admitted: "ClusterFull" }
  | { readonly admitted: "AccountAtMaximum" };

/** What opening an attempt is asked for, every bound of it an operational choice. */
export interface AttemptOpening {
  readonly partition: Partition;
  readonly execution: ExecutionId;
  readonly epoch: RecoveryEpoch;
  readonly leaseSecs: number;
  readonly retriesMax: number;
  readonly placementBackoffSecs: number;
}

/** What a launch reservation produced: the fenced attempt a worker is placed under. */
export type AttemptOpened =
  | { readonly opened: "Opened"; readonly attempt: PhysicalAttempt }
  | { readonly opened: "NotLaunchable"; readonly status: ExecutionStatus }
  | { readonly opened: "BackingOff" }
  | { readonly opened: "RetriesExhausted" };

/** What the scheduler reports of one attempt, which the terminal transaction reduces. */
export interface AttemptReport extends FencedAttempt {
  readonly manifest: ResultManifest;
}

/** What a terminal report found, distinguishing the first outcome from every later claim. */
export type Terminalized =
  | {
      readonly terminalized: "Terminalized";
      readonly outcome: ExecutionOutcome;
      readonly operation: OperationId;
    }
  | {
      readonly terminalized: "AlreadyTerminal";
      readonly outcome: ExecutionOutcome;
      readonly operation: OperationId;
    }
  | { readonly terminalized: "Fenced" }
  | { readonly terminalized: "Cancelled" }
  | { readonly terminalized: "Conflicting"; readonly incident: string };

/**
 * What blocking one execution found. A second denial under the same ticket
 * submits its own operation, which the writer refuses without a journal entry.
 */
export type Blocked =
  | { readonly blocked: "Blocked"; readonly operation: OperationId }
  | { readonly blocked: "AlreadyBlocked"; readonly operation: OperationId }
  | { readonly blocked: "AlreadyTerminal"; readonly outcome: ExecutionOutcome }
  | { readonly blocked: "Cancelled" };

/** A definitive inability to run the immutable contract, which the model bounds. */
export type BlockedReason = Extract<
  Reason,
  | "ExecutionPolicyDenied"
  | "TicketConfigIncompatible"
  | "ExecutionProfileUnavailable"
  | "RuntimeVersionUnsupported"
  | "RequiredCapabilityUnavailable"
>;

/** Every blocking reason, in the order `src/domain/enablement.ts` declares them. */
export const allBlockedReasons: readonly BlockedReason[] = [
  "ExecutionPolicyDenied",
  "TicketConfigIncompatible",
  "ExecutionProfileUnavailable",
  "RuntimeVersionUnsupported",
  "RequiredCapabilityUnavailable",
];

/** One claim of a focused request, held for a bounded stretch of database time. */
export interface RequestClaim {
  readonly partition: Partition;
  readonly request: string;
  readonly kind: "SpawnWork" | "SpawnEvaluation" | "CancelTicketWork";
  readonly ticket: TicketId;
  readonly authorizingSeq: number;
  readonly generation: number;
  readonly owner: SchedulerOwnerId;
}

/**
 * The durable execution authority for one installation. Every call names its
 * partition except admission, which is a cluster-wide decision over durable
 * logical allocations and reads no project's tickets.
 */
export interface ExecutionSchedulerStore {
  /** Claims at most `requestsMax` unclaimed or lapsed focused requests of the named kinds. */
  claimRequests(
    owner: SchedulerOwnerId,
    kinds: readonly RequestClaim["kind"][],
    requestsMax: number,
    leaseSecs: number,
  ): Promise<readonly RequestClaim[]>;

  /** Creates or finds the exact logical executions one spawn request authorized. */
  registerSpawn(claim: RequestClaim): Promise<SpawnRegistered>;

  /** Fences every task a cancellation request names, then fulfills the request. */
  registerCancellation(claim: RequestClaim): Promise<CancellationRegistered>;

  /** Takes one slot for the preferred queued execution under the locked cluster ledger. */
  admit(cluster: ClusterId): Promise<Admitted>;

  /**
   * Opens the next sequential attempt for an execution that owns a slot, has no
   * live attempt and is not inside its placement backoff.
   */
  openAttempt(opening: AttemptOpening): Promise<AttemptOpened>;

  /** Records that the worker port placed the attempt, moving the execution to `Running`. */
  attemptPlaced(attempt: FencedAttempt, workload: WorkloadId): Promise<boolean>;

  /** Records that an attempt ended without a result, leaving the slot with its execution. */
  attemptEnded(
    attempt: FencedAttempt,
    loss: AttemptLoss,
    evidence: AttemptEvidence,
  ): Promise<boolean>;

  /**
   * Terminalizes an execution whose safe retry budget is spent, pinning the
   * explicit empty manifest that says it produced no handoffs.
   */
  retriesExhausted(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<Terminalized>;

  /**
   * Pins the verified manifest, records the one terminal outcome, releases the
   * slot and creates the completion operation in one indivisible transaction.
   */
  terminalize(report: AttemptReport): Promise<Terminalized>;

  /**
   * Retires one execution that definitively cannot run and submits its
   * `ExecutionBlocked`, releasing the slot in the same transaction.
   */
  blockExecution(
    partition: Partition,
    execution: ExecutionId,
    reason: BlockedReason,
  ): Promise<Blocked>;

  /** What one execution durably says about itself, which resolves an ambiguous commit. */
  execution(
    partition: Partition,
    execution: ExecutionId,
  ): Promise<LogicalExecution | undefined>;

  /** At most `executionsMax` executions that own a slot and have no live attempt. */
  unlaunched(
    epoch: RecoveryEpoch,
    executionsMax: number,
  ): Promise<readonly LogicalExecution[]>;

  /** Marks every attempt issued under an older recovery epoch unable to report. */
  fenceOldEpochAttempts(epoch: RecoveryEpoch): Promise<number>;
}

/** The execution profile a worker runs under, resolved from policy and never weakened by authored content. */
export interface ExecutionProfile {
  readonly profile: string;
  readonly runtimeVersion: string;
}

/**
 * One placement asked of the fabric, carrying only what an untrusted worker may
 * be told. The invocation is what the worker is briefed with and what it may
 * do; a placement that named a briefing and no authority, or the other way
 * round, is not a shape this port has.
 */
export interface WorkerPlacement {
  readonly partition: Partition;
  readonly execution: ExecutionId;
  readonly attempt: AttemptId;
  readonly generation: number;
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly taskKind: ExecutionTaskKind;
  readonly stage?: number;
  readonly sourceRequest: string;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly profile: ExecutionProfile;
  readonly invocation: TaskInvocation;
}

/**
 * What a placement found. `Denied` is a definitive inability to run the
 * immutable contract and becomes `ExecutionBlocked`; `Unavailable` is
 * temporary and leaves the execution visibly held.
 */
export type WorkerPlaced =
  | { readonly placed: "Placed"; readonly workload: WorkloadId }
  | { readonly placed: "Denied"; readonly reason: BlockedReason }
  | { readonly placed: "Unavailable"; readonly retryAfterSeconds: number };

/**
 * The mandatory execution policy, evaluated separately from the pinned release
 * briefing. A denial is definitive and becomes `ExecutionBlocked`; an
 * unavailable policy is a hold that leaves the execution exactly as it was.
 */
export interface ExecutionPolicy {
  profileFor(execution: LogicalExecution): Promise<ProfileResolved>;
}

/**
 * What resolving the execution profile found, which is where 006's two
 * inabilities part. The grant travels with the profile because they are one
 * policy answer, and asking twice is asking a policy that may have moved.
 */
export type ProfileResolved =
  | {
      readonly resolved: "Profile";
      readonly profile: ExecutionProfile;
      readonly grant: PolicyAuthorityGrant;
    }
  | { readonly resolved: "Denied"; readonly reason: BlockedReason }
  | { readonly resolved: "Unavailable" };

/**
 * Kubernetes, behind a typed port so the durable state machine can be driven
 * without a cluster. Nothing here is the capacity ledger: a pod count is an
 * observation and the durable allocations are the authority.
 */
export interface WorkerLaunchPort {
  /** Places one fenced attempt, or says why the immutable contract cannot be run. */
  place(placement: WorkerPlacement): Promise<WorkerPlaced>;

  /** Asks the fabric to delete a workload; correctness never waits on it. */
  delete(partition: Partition, attempt: AttemptId): Promise<void>;
}

/** The authority kind every scheduler-submitted completion is scoped and audited under. */
export const executionSchedulerAuthorityKind = "ExecutionScheduler";

/** The longest bounded evidence label a stored attempt or incident row carries. */
export const schedulerEvidenceCharsMax = 1_024;

/** The capacity a fresh installation starts with, which is configuration and not semantics. */
export const executionCapacityDefaults = {
  cluster: "default",
  clusterSlotsMax: 64,
  accountReserved: 1,
  accountMaximum: 8,
} as const;

/**
 * The scheduler's bounded configuration, every value of it an operational
 * choice. The two backlog ceilings live here because the guard that reads them
 * is the scheduler's authority wherever it is mounted.
 */
export interface ExecutionSchedulerConfig {
  readonly requestClaimLeaseSecs: number;
  readonly requestsPerPassMax: number;
  readonly attemptLeaseSecs: number;
  readonly attemptRetriesMax: number;
  readonly placementBackoffSecs: number;
  readonly admissionsPerPassMax: number;
  readonly launchesPerPassMax: number;
  readonly projectBacklogMax: number;
  readonly installationBacklogMax: number;
  readonly backlogRetryAfterSeconds: number;
}

/** The values a deployment starts from when it names none. */
export const executionSchedulerDefaults: ExecutionSchedulerConfig = {
  requestClaimLeaseSecs: 30,
  requestsPerPassMax: 32,
  attemptLeaseSecs: 300,
  attemptRetriesMax: 3,
  placementBackoffSecs: 15,
  admissionsPerPassMax: 32,
  launchesPerPassMax: 32,
  projectBacklogMax: 5_000,
  installationBacklogMax: 5_000,
  backlogRetryAfterSeconds: 5,
};

/** Refuses a configuration whose bounds are not positive safe integers. */
export function checkedExecutionSchedulerConfig(
  config: ExecutionSchedulerConfig,
): ExecutionSchedulerConfig {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(
        `execution scheduler configuration: ${name} must be a positive safe integer`,
      );
    }
  }
  return config;
}

/** Closed, identifier-free observations emitted by the execution scheduler. */
export interface ExecutionSchedulerMetrics {
  registration(outcome: SpawnRegistered["registered"]): void;
  cancellation(outcome: CancellationRegistered["cancelled"]): void;
  admission(outcome: Admitted["admitted"]): void;
  placement(outcome: WorkerPlaced["placed"]): void;
  terminalization(outcome: Terminalized["terminalized"]): void;
  manifest(outcome: "Accepted" | "Rejected"): void;
  incident(kind: SchedulerIncidentKind): void;
  backlog(verdict: "Admits" | "Backlogged"): void;
}

/** What the scheduler records when durable evidence contradicts itself. */
export type SchedulerIncidentKind =
  | "ConflictingResult"
  | "ConflictingRegistration"
  | "ImpossibleState"
  | "CrossProjectReference";

/** Every incident kind, so a suite and a database CHECK iterate rather than restate. */
export const allSchedulerIncidentKinds: readonly SchedulerIncidentKind[] = [
  "ConflictingResult",
  "ConflictingRegistration",
  "ImpossibleState",
  "CrossProjectReference",
];

/** Emits nothing, which is what a caller that supplies no telemetry gets. */
export const silentExecutionSchedulerMetrics: ExecutionSchedulerMetrics = {
  registration: () => undefined,
  cancellation: () => undefined,
  admission: () => undefined,
  placement: () => undefined,
  terminalization: () => undefined,
  manifest: () => undefined,
  incident: () => undefined,
  backlog: () => undefined,
};
