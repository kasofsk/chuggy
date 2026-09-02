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
 * TELEMETRY IS NOT AN AUTHORITY, AND THE SHAPE IS WHAT SAYS SO. A deployment's
 * sink is sealed into a `SchedulerTelemetry` this module holds under a symbol it
 * does not export, so the only way to reach the sink is `recordScheduler` — which
 * answers nothing and raises nothing. There is therefore no expression in which a
 * metric returns a value a branch could read, and no observation whose failure
 * can abort or redirect the move that produced it. Every method of the sink
 * itself returns nothing for the same reason, so even a caller holding one
 * directly can learn from it only that it was called.
 *
 * AN ABSORPTION IS AN ARM AND NOT A COUNTER OF ITS OWN. `AlreadyRegistered`,
 * `AlreadyFulfilled`, `AlreadyTerminal` and `AlreadyBlocked` are what this
 * scheduler's idempotence looks like from outside, so they are observed by the
 * same metric as the move they absorbed rather than by a separate one that could
 * disagree with it about how many there were.
 *
 * A BACKLOG CEILING IS A PROMISE ABOUT A MAILBOX, so the configuration that
 * states one is checked against the configuration that bounds the other. Every
 * execution a project's backlog holds may later submit exactly one completion,
 * and a completion is admitted above the ordinary ceiling rather than refused —
 * so a backlog ceiling wider than the room the mailbox keeps above that ceiling
 * lets one project's finished work fill its own mailbox and stop every ordinary
 * ingress behind it, a cancellation included. 006 puts the obligation on
 * admission rather than on the completion boundary, because refusing a
 * completion would hold the slot the completion was going to release; so the
 * reservation is made where the work is admitted, and
 * `checkedExecutionSchedulerConfig` is where a deployment that has not made it
 * is refused before it runs a pass.
 *
 * THAT ROOM HAS TWO CLAIMANTS AND NEITHER IS SIZED ALONE. A finalization result
 * is a `Completion` too and the request that submits one sits in no backlog, so
 * a backlog sized against the whole room leaves the finalizer none of it. The
 * reservation is the sum of the two ceilings, and what the finalizer's ceiling
 * contributes is one pass's draw: `requestsPerPassMax` bounds what a pass claims
 * and not what stands claimed, since a claimed request is `Registered` until it
 * settles or a sweep reopens its lapsed lease, and that draw is
 * installation-wide where both ceilings are per project. The sum is therefore
 * the room a deployment must keep clear and not a proof that no more is ever
 * wanted, and a configuration failing it promises room it does not have. It is a
 * sum here rather than a wider `execution_backlog`: that function is the hard
 * dispatch guard, and a count grown by finalizations would refuse a project's
 * dispatch for work no dispatch relieves.
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
import type { Config as DomainConfig } from "../domain/config.ts";
import type { TaskId, TicketId } from "../domain/ids.ts";
import type { TaskPurpose } from "./briefingTemplate.ts";
import { checkedFinalizerConfig } from "./finalizer.ts";
import type { FinalizerConfig } from "./finalizer.ts";
import type { OperationId } from "./operationInbox.ts";
import { mailboxCompletionRoom, observe } from "./ticketService.ts";
import type { TicketServiceConfig } from "./ticketService.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { ResultManifest, ResultManifestId } from "./resultManifest.ts";
import type {
  BriefingFault,
  TaskConfigurationReadFault,
  TaskInvocation,
} from "./taskBriefing.ts";
import type { PolicyAuthorityGrant } from "./taskAuthority.ts";
import type {
  ExecutionCapability,
  ExecutionRequirement,
  ExecutionTaskKind,
  RequirementSource,
} from "./executionRequirement.ts";
export type { ExecutionTaskKind } from "./executionRequirement.ts";
export {
  asAttemptId,
  asCapacityAccountId,
  asClusterId,
  asExecutionId,
  asSchedulerOwnerId,
  asPlacementId,
  schedulerIdentityCharsMax,
  type AttemptId,
  type CapacityAccountId,
  type ClusterId,
  type ExecutionId,
  type SchedulerOwnerId,
  type PlacementId,
} from "./schedulerIdentity.ts";
import type {
  AttemptId,
  CapacityAccountId,
  ClusterId,
  ExecutionId,
  SchedulerOwnerId,
  PlacementId,
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
  readonly inputBundle: string;
  readonly inputBundleDigest: string;
  readonly sourceSeq: number;
  readonly sourceEffect: number;
  readonly ticketVersion: number;
  readonly account: CapacityAccountId;
  readonly cluster: ClusterId;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly requirementIdentity: string;
  readonly requirement: ExecutionRequirement;
  readonly requirementDigest: string;
  readonly requirementSource: RequirementSource;
  /**
   * The agent the configuration this registration pins names, absent where it
   * names none. It is a constraint on the requirement and never a substitute
   * for one: a pinned image runs, and this is what that image has to provide.
   */
  readonly agentCapability?: ExecutionCapability;
  readonly platformDefaultVersion: number;
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

declare const attemptCapabilityIdBrand: unique symbol;
declare const attemptCapabilitySecretBrand: unique symbol;

/** The public identity of one attempt-scoped worker-plane capability. */
export type AttemptCapabilityId = string & {
  readonly [attemptCapabilityIdBrand]: true;
};

/** The bearer secret returned exactly once when its durable capability is minted. */
export type AttemptCapabilitySecret = string & {
  readonly [attemptCapabilitySecretBrand]: true;
};

/** The authority minted atomically with an attempt and handed only to its launcher. */
export interface AttemptCapability {
  readonly id: AttemptCapabilityId;
  readonly secret: AttemptCapabilitySecret;
  readonly manifest: ResultManifestId;
}

export function asAttemptCapabilityId(value: string): AttemptCapabilityId {
  return value as AttemptCapabilityId;
}

export function asAttemptCapabilitySecret(
  value: string,
): AttemptCapabilitySecret {
  return value as AttemptCapabilitySecret;
}

/** One physical attempt: its fenced identity, its lease, and what it has reported. */
export interface PhysicalAttempt extends FencedAttempt {
  readonly attemptNumber: number;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly state: AttemptState;
  readonly authoritative: boolean;
  readonly placement?: PlacementId;
  readonly capability: AttemptCapability;
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
 * because the attempt ran, and `Withdrawn` does not, because a fabric that never
 * took the work and a provider that refused the account are both holds rather
 * than work failures.
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
  | "Fenced"
  | "RunFailed"
  | "RunRateLimited"
  | "RunTurnsExhausted"
  | "RunUploadRefused";

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
  "RunFailed",
  "RunRateLimited",
  "RunTurnsExhausted",
  "RunUploadRefused",
];

/**
 * What an ended attempt records: a label, or a label the fault that caused it
 * qualifies. Both arms are closed and their longest inhabitant is shorter than
 * the evidence column admits, so the diagnostic that explains a
 * `TicketConfigIncompatible` block survives the attempt without the reason
 * vocabulary or the label set growing to carry it.
 */
export type AttemptEvidenceRecord =
  | AttemptEvidence
  | `${AttemptEvidence}: ${BriefingFault | TaskConfigurationReadFault}`;

/**
 * The label a recorded evidence begins with, which is what a reader outside the
 * scheduler is shown; a stored value naming no label at all is nothing this
 * layer can speak for.
 */
export function attemptEvidenceLabel(
  recorded: string,
): AttemptEvidence | undefined {
  const label = recorded.split(": ", 1)[0];
  return allAttemptEvidence.find((known) => known === label);
}

/** What a registration pass found for one focused spawn request. */
export type SpawnRegistered =
  | { readonly registered: "Registered"; readonly created: number }
  | { readonly registered: "AlreadyRegistered"; readonly created: 0 }
  | { readonly registered: "Superseded" }
  | { readonly registered: "Conflicting"; readonly incident: string };

/**
 * What a cancellation pass found for one focused cancellation request. It
 * names the attempts it fenced as well as counting the logical tasks it
 * retired, because the placements behind those attempts are what the backend
 * is asked to cancel afterwards and a count cannot name them.
 */
export type CancellationRegistered =
  | {
      readonly cancelled: "Registered";
      readonly fenced: number;
      readonly placements: readonly FencedAttempt[];
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

/** What a placement reservation produced: the fenced physical attempt. */
export type AttemptOpened =
  | { readonly opened: "Opened"; readonly attempt: PhysicalAttempt }
  | { readonly opened: "NotLaunchable"; readonly status: ExecutionStatus }
  | { readonly opened: "BackingOff" }
  | { readonly opened: "RetriesExhausted" };

/** What the scheduler reports of one attempt, which the terminal transaction reduces. */
export interface AttemptReport extends FencedAttempt {
  readonly manifest: ResultManifest;
}

/**
 * What a terminal report found, distinguishing the first outcome from every
 * later claim. `Cancelled` is a fact about this logical task and `NotAdmitted`
 * one about the whole project, which are different holds on different things.
 */
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
  | { readonly terminalized: "NotAdmitted" }
  | { readonly terminalized: "Conflicting"; readonly incident: string };

/**
 * What blocking one execution found. A second denial under the same ticket
 * submits its own operation, which the writer refuses without a journal entry.
 */
export type Blocked =
  | { readonly blocked: "Blocked"; readonly operation: OperationId }
  | { readonly blocked: "AlreadyBlocked"; readonly operation: OperationId }
  | { readonly blocked: "AlreadyTerminal"; readonly outcome: ExecutionOutcome }
  | { readonly blocked: "Cancelled" }
  | { readonly blocked: "NotAdmitted" }
  | { readonly blocked: "Conflicting"; readonly incident: string };

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
  registerSpawn(
    claim: RequestClaim,
    tasksMax: DomainConfig["nTasks"],
  ): Promise<SpawnRegistered>;

  /** Fences every task a cancellation request names, then fulfills the request. */
  registerCancellation(claim: RequestClaim): Promise<CancellationRegistered>;

  /** Takes one slot for the preferred queued execution under the locked cluster ledger. */
  admit(cluster: ClusterId): Promise<Admitted>;

  /**
   * Opens the next sequential attempt for an execution that owns a slot, has no
   * live attempt and is not inside its placement backoff.
   */
  openAttempt(opening: AttemptOpening): Promise<AttemptOpened>;

  /** Records that the placement port accepted the attempt, moving it to `Running`. */
  attemptPlaced(
    attempt: FencedAttempt,
    placement: PlacementId,
  ): Promise<boolean>;

  /** Records that an attempt ended without a result, leaving the slot with its execution. */
  attemptEnded(
    attempt: FencedAttempt,
    loss: AttemptLoss,
    evidence: AttemptEvidenceRecord,
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

  /**
   * Ends at most `attemptsMax` attempts whose lease has run out, spending the
   * safe retry budget the way any attempt that ran and vanished does.
   */
  reapLapsedAttempts(
    epoch: RecoveryEpoch,
    attemptsMax: number,
  ): Promise<number>;

  /** Ended physical attempts whose external workload still needs idempotent removal. */
  attemptsAwaitingCleanup(
    attemptsMax: number,
  ): Promise<readonly FencedAttempt[]>;

  /** Acknowledges external cleanup only after the placement backend accepted removal. */
  attemptCleanupCompleted(attempt: FencedAttempt): Promise<boolean>;

  /** At most `executionsMax` executions that own a slot and have no live attempt. */
  unlaunched(
    epoch: RecoveryEpoch,
    executionsMax: number,
  ): Promise<readonly LogicalExecution[]>;

  /**
   * Marks at most `attemptsMax` attempts issued under an older recovery epoch
   * unable to report, which a later pass resumes where this one stopped.
   */
  fenceOldEpochAttempts(
    epoch: RecoveryEpoch,
    attemptsMax: number,
  ): Promise<number>;
}

/** The execution profile a backend enforces, resolved by policy and never weakened by authored content. */
export interface ExecutionProfile {
  readonly profile: string;
  readonly runtimeVersion: string;
}

/**
 * One placement asked of a backend, carrying only what an executor may be
 * told. The invocation is its briefing and bounds what it may
 * do; a placement that named a briefing and no authority, or the other way
 * round, is not a shape this port has.
 */
export interface AttemptPlacement extends FencedAttempt {
  readonly ticket: TicketId;
  readonly task: TaskId;
  readonly taskKind: ExecutionTaskKind;
  readonly stage?: number;
  readonly sourceRequest: string;
  readonly inputBundle: string;
  readonly inputBundleDigest: string;
  readonly configurationRevision: string;
  readonly configurationDigest: string;
  readonly requirementIdentity: string;
  readonly requirement: ExecutionRequirement;
  readonly requirementDigest: string;
  readonly profile: ExecutionProfile;
  readonly image?: string;
  readonly invocation: TaskInvocation;
  readonly capability: AttemptCapability;
}

/**
 * What a placement found. `Denied` is a definitive inability to run the
 * immutable contract and becomes `ExecutionBlocked`; `Unavailable` is
 * temporary and leaves the execution visibly held.
 */
export type AttemptPlacementOutcome =
  | { readonly placed: "Placed"; readonly placement: PlacementId }
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
      readonly image?: string;
    }
  | { readonly resolved: "Denied"; readonly reason: BlockedReason }
  | { readonly resolved: "Unavailable" };

/**
 * Physical attempt placement, behind a backend-neutral port. A Kubernetes
 * adapter and a registered-runner adapter consume the same immutable request;
 * neither backend's inventory or protocol is part of the capacity ledger.
 */
export interface AttemptPlacementPort {
  /** Places one fenced attempt, or says why the immutable contract cannot be run. */
  place(placement: AttemptPlacement): Promise<AttemptPlacementOutcome>;

  /** Cancels this exact generation; correctness never waits on the backend. */
  cancel(
    attempt: FencedAttempt,
  ): Promise<
    { readonly cancelled: "Accepted" } | { readonly cancelled: "Unavailable" }
  >;
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
 * is the scheduler's authority wherever it is mounted, and both sweeps share one
 * per-pass bound because both of them end attempts.
 */
export interface ExecutionSchedulerConfig extends Pick<DomainConfig, "nTasks"> {
  readonly requestClaimLeaseSecs: number;
  readonly requestsPerPassMax: number;
  readonly attemptLeaseSecs: number;
  readonly attemptRetriesMax: number;
  readonly attemptsPerPassMax: number;
  readonly placementBackoffSecs: number;
  readonly admissionsPerPassMax: number;
  readonly launchesPerPassMax: number;
  readonly projectBacklogMax: number;
  readonly installationBacklogMax: number;
  readonly backlogRetryAfterSeconds: number;
}

/** The values a deployment starts from when it names none. */
export const executionSchedulerDefaults: ExecutionSchedulerConfig = {
  nTasks: 200,
  requestClaimLeaseSecs: 30,
  requestsPerPassMax: 32,
  attemptLeaseSecs: 300,
  attemptRetriesMax: 3,
  attemptsPerPassMax: 256,
  placementBackoffSecs: 15,
  admissionsPerPassMax: 32,
  launchesPerPassMax: 32,
  projectBacklogMax: 200,
  installationBacklogMax: 5_000,
  backlogRetryAfterSeconds: 5,
};

/**
 * Every bound a configuration must name, read from the defaults so that a bound
 * added to the interface has a default and a required name at once. Reading the
 * offered configuration's own keys instead would check the bounds it happens to
 * carry rather than the ones it owes, and a deployment that named none would
 * pass.
 */
const executionSchedulerBounds = Object.keys(
  executionSchedulerDefaults,
) as readonly (keyof ExecutionSchedulerConfig)[];

/**
 * Refuses a configuration whose bounds are not positive safe integers, and one
 * whose project backlog ceiling and the finalizer's claim ceiling together
 * reserve no mailbox room for the completions they can submit. It takes all
 * three configurations because the relationship among them is what is being
 * checked, and it checks the finalizer's own bounds so that the sum is over
 * operands something has already refused a non-number for.
 */
export function checkedExecutionSchedulerConfig(
  config: ExecutionSchedulerConfig,
  service: TicketServiceConfig,
  finalizer: FinalizerConfig,
): ExecutionSchedulerConfig {
  for (const name of executionSchedulerBounds) {
    const value: number = config[name];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(
        `execution scheduler configuration: ${name} must be a positive safe integer`,
      );
    }
  }
  const claimed = checkedFinalizerConfig(finalizer).requestsPerPassMax;
  if (config.projectBacklogMax + claimed >= mailboxCompletionRoom(service)) {
    throw new RangeError(
      "execution scheduler configuration: projectBacklogMax and the finalizer's requestsPerPassMax together reserve no mailbox room for the completions they can submit",
    );
  }
  return config;
}

/** Which ceiling stopped a dispatch, which is the whole of what a submitter learns. */
export type BacklogScope = "Project" | "Installation";

/** Every backlog scope, so a suite iterates rather than restates. */
export const allBacklogScopes: readonly BacklogScope[] = [
  "Project",
  "Installation",
];

/** Which sweep made a batch of attempts unable to report. */
export type SchedulerFenceScope = "Epoch" | "Cancellation";

/** Closed, identifier-free observations emitted by the execution scheduler. */
export interface ExecutionSchedulerMetrics {
  registration(outcome: SpawnRegistered["registered"]): void;
  cancellation(outcome: CancellationRegistered["cancelled"]): void;
  fencing(scope: SchedulerFenceScope, attempts: number): void;
  reaping(attempts: number): void;
  admission(outcome: Admitted["admitted"]): void;
  attemptOpened(outcome: AttemptOpened["opened"]): void;
  briefing(fault: BriefingFault | TaskConfigurationReadFault): void;
  placement(outcome: AttemptPlacementOutcome["placed"]): void;
  attemptEnded(loss: AttemptLoss, evidence: AttemptEvidenceRecord): void;
  manifest(outcome: "Accepted" | "Rejected"): void;
  terminalization(outcome: Terminalized["terminalized"]): void;
  blocking(outcome: Blocked["blocked"], reason: BlockedReason): void;
  incident(kind: SchedulerIncidentKind): void;
  backlog(admits: "Admits" | "Backlogged", scope?: BacklogScope): void;
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
  fencing: () => undefined,
  reaping: () => undefined,
  admission: () => undefined,
  attemptOpened: () => undefined,
  briefing: () => undefined,
  placement: () => undefined,
  attemptEnded: () => undefined,
  manifest: () => undefined,
  terminalization: () => undefined,
  blocking: () => undefined,
  incident: () => undefined,
  backlog: () => undefined,
};

/**
 * The key a sealed sink is held under. It is not exported, so no module but
 * this one can read a sink back out of the value below or build one of its own.
 */
const schedulerSink: unique symbol = Symbol("chuggy:scheduler-telemetry");

/** A sink the scheduler may write to and cannot read, gate on, or be interrupted by. */
export interface SchedulerTelemetry {
  readonly [schedulerSink]: ExecutionSchedulerMetrics;
}

/** Seals a deployment's sink, which is the only way one enters the scheduler. */
export function schedulerTelemetry(
  metrics: ExecutionSchedulerMetrics,
): SchedulerTelemetry {
  return { [schedulerSink]: metrics };
}

/**
 * Records one observation. It answers nothing and raises nothing, so nothing a
 * sink does can reach the move that observed it.
 */
export function recordScheduler(
  telemetry: SchedulerTelemetry,
  observation: (metrics: ExecutionSchedulerMetrics) => void,
): void {
  observe(() => {
    observation(telemetry[schedulerSink]);
  });
}

/** The sealed sink a caller that supplies no telemetry gets. */
export const silentSchedulerTelemetry: SchedulerTelemetry = schedulerTelemetry(
  silentExecutionSchedulerMetrics,
);
