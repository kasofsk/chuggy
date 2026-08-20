/**
 * The durable project authority: what a dispatcher needs of PostgreSQL before
 * it may decide anything for one project partition.
 *
 * WHY ONE PORT AND NOT THREE. Ownership, the journal and the recovery epoch
 * read as three contracts, and splitting them would be the obvious shape — but
 * a lease is only worth holding if the fencing epoch and the recovery epoch it
 * was issued under are rechecked wherever it is presented. Three ports invite
 * an implementation that checks ownership in one call and acts in the next,
 * which is exactly the race `docs/design/006-durable-project-dispatch.md`
 * forbids when it says every decision commit checks both the observed journal
 * head and the current fencing epoch. So the lease is an argument, and no
 * caller can hold one without having proved it.
 *
 * NOTHING HERE APPENDS. An entry names exactly one durable cause and settles
 * it in the same transaction, so a method that wrote an entry alone would be a
 * way to move the head and leave the operation that authorized it pending —
 * the half-written decision the transaction exists to prevent.
 * `./projectDecision.ts` is where an entry is written, and it is the only
 * place.
 *
 * NO CLOCK CROSSES THIS BOUNDARY. Database time determines lease validity, so
 * a lease carries a duration to grant and never an instant to compare; the
 * adapter asks PostgreSQL what time it is and this layer never learns. That is
 * also why `establishRecoveryEpoch` takes the new epoch rather than minting
 * one — the interpreter names no ambient capability, and `eslint.config.js`
 * says so for this directory.
 *
 * NOT EVERY METHOD IS THE RUNTIME'S. `acquire`, `renew`, `release`, `load`,
 * `standing` and `currentRecoveryEpoch` are what a dispatcher holds.
 * `establishRecoveryEpoch`, `createProject` and `fence` are the control
 * plane's, and the runtime database role is granted nothing that would let it
 * run them — provisioning is not a decision, and suspension is out-of-band
 * precisely so an unhealthy writer cannot lift it. They share one port because
 * they share one set of rows and one set of fences; the caller they are
 * addressed to is stated here rather than discovered at run time.
 *
 * EVERY REFUSAL IS A VALUE. Losing a race, holding a stale head, arriving
 * after a takeover and finding a project that is not active are outcomes a
 * caller must handle, not exceptions it may ignore. A thrown error here means
 * the database could not answer at all, which is the one thing a dispatcher
 * cannot decide its way around.
 *
 * IT DOES NOT REPLACE `JournalStore`, and the two coexist deliberately. That
 * one is the unpartitioned in-memory log 006 calls pre-production scaffolding;
 * this one is the partitioned durable authority. The executor still drives the
 * old one because its cursor is the emission model 006 replaces with focused
 * consumer requests written inside the decision transaction — slice I3 — and
 * a store retired before its replacement exists leaves the effects the
 * conformance suites walk with nowhere to go.
 */

import type { Entry } from "../actor/journal.ts";
import type { Parsed } from "./wire.ts";

declare const tenantIdBrand: unique symbol;
declare const projectIdBrand: unique symbol;
declare const ownerIdBrand: unique symbol;
declare const recoveryEpochBrand: unique symbol;

/** A tenant's identity: globally unique, opaque, and never interpreted here. */
export type TenantId = string & { readonly [tenantIdBrand]: true };

/** A project's identity: globally unique and opaque, and the partition key every call carries. */
export type ProjectId = string & { readonly [projectIdBrand]: true };

/** A dispatcher instance's identity, which is what a lease is granted to and fenced against. */
export type OwnerId = string & { readonly [ownerIdBrand]: true };

/**
 * The global recovery epoch: unpredictable, never reused, and advanced before
 * mutation after a point-in-time restore. It is opaque because its only
 * operation is equality.
 */
export type RecoveryEpoch = string & { readonly [recoveryEpochBrand]: true };

/** Brands an opaque identity, refusing the empty string a missing value arrives as. */
function asOpaqueIdentity(value: string, what: string): string {
  if (value.length === 0) throw new RangeError(`${what}: an identity is empty`);
  return value;
}

/** Brands an opaque tenant identity. */
export function asTenantId(value: string): TenantId {
  return asOpaqueIdentity(value, "tenant id") as TenantId;
}

/** Brands an opaque project identity. */
export function asProjectId(value: string): ProjectId {
  return asOpaqueIdentity(value, "project id") as ProjectId;
}

/** Brands an opaque dispatcher-instance identity. */
export function asOwnerId(value: string): OwnerId {
  return asOpaqueIdentity(value, "owner id") as OwnerId;
}

/** Brands an opaque recovery epoch. */
export function asRecoveryEpoch(value: string): RecoveryEpoch {
  return asOpaqueIdentity(value, "recovery epoch") as RecoveryEpoch;
}

/** The partition every call names, and the composite key every relation carries. */
export interface Partition {
  readonly tenant: TenantId;
  readonly project: ProjectId;
}

/**
 * A project's operational availability, which is not ticket state and never
 * appears in `Core`. Only `Active` admits a dispatcher.
 */
export type Lifecycle =
  "Active" | "Suspended" | "IntegrityBlocked" | "Deleting" | "Retention";

/** Every lifecycle, in the order this file declares them, so a suite can iterate rather than restate. */
export const allLifecycles: readonly Lifecycle[] = [
  "Active",
  "Suspended",
  "IntegrityBlocked",
  "Deleting",
  "Retention",
];

/**
 * A granted ownership of one project partition. It is the only thing that
 * authorizes an append, and holding one proves nothing on its own — the append
 * rechecks every field of it against the row.
 */
export interface Lease {
  readonly partition: Partition;
  readonly owner: OwnerId;
  readonly fencingEpoch: number;
  readonly recoveryEpoch: RecoveryEpoch;
  readonly head: number;
}

/** What an acquisition attempt found: the lease, a live owner that is not this one, or a project no dispatcher may hold. */
export type Acquired =
  | { readonly acquired: "Granted"; readonly lease: Lease }
  | { readonly acquired: "HeldByAnother"; readonly owner: OwnerId }
  | { readonly acquired: "NotActive"; readonly lifecycle: Lifecycle };

/** What a renewal found, distinguishing a lease that is still this owner's from one that was taken away. */
export type Renewed =
  | { readonly renewed: "Extended"; readonly lease: Lease }
  | { readonly renewed: "Fenced"; readonly fencingEpoch: number };

/** What a project row says about itself, for a reader that holds no lease. */
export interface ProjectStanding {
  readonly partition: Partition;
  readonly lifecycle: Lifecycle;
  readonly lifecycleGeneration: number;
  readonly fencingEpoch: number;
  readonly head: number;
}

/**
 * The durable authority for project partitions. Every method names its
 * partition, and no method reads or writes across two of them.
 */
export interface ProjectStore {
  /**
   * The epoch every lease is issued under. It is read rather than assumed
   * because a restore may have advanced it while this process was running.
   */
  currentRecoveryEpoch(): Promise<RecoveryEpoch>;

  /** Records a new global epoch, fencing every authority issued under an older one; refuses one already used. */
  establishRecoveryEpoch(epoch: RecoveryEpoch): Promise<RecoveryEpoch>;

  /** Provisions an `Active` project with an empty journal, idempotently on the composite key. */
  createProject(partition: Partition): Promise<ProjectStanding>;

  /** What the project row says, or undefined when no such project was ever provisioned. */
  standing(partition: Partition): Promise<ProjectStanding | undefined>;

  /**
   * Takes ownership for `leaseSecs` of database time, advancing the fencing
   * epoch so a former owner cannot commit after this returns.
   */
  acquire(
    partition: Partition,
    owner: OwnerId,
    leaseSecs: number,
  ): Promise<Acquired>;

  /** Extends a held lease without advancing its fencing epoch, so an unbroken tenure keeps one identity. */
  renew(lease: Lease, leaseSecs: number): Promise<Renewed>;

  /** Gives up a held lease early; a lease already fenced is left exactly as it is. */
  release(lease: Lease): Promise<void>;

  /** Every stored entry for the partition in sequence order, parsed at this boundary and refused rather than thrown. */
  load(partition: Partition): Promise<Parsed<readonly Entry[]>>;

  /**
   * Advances the lifecycle generation and the fencing epoch and clears
   * ownership in one transaction, which is the primitive an audited suspension
   * or closure is later built from.
   */
  fence(partition: Partition, lifecycle: Lifecycle): Promise<ProjectStanding>;
}
