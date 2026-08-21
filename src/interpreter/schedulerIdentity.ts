/**
 * The opaque identities the execution scheduler's relations are keyed by, in a
 * module of their own so the ports that name them do not have to name each
 * other.
 *
 * WHY THEY ARE NOT IN `./executionScheduler.ts`. `./resultManifest.ts` binds a
 * manifest to the execution and attempt that produced it, and that port already
 * imports the manifest — so the identities living beside the ports would make
 * the two modules import each other. `.dependency-cruiser.cjs` refuses a cycle
 * at all, and `tsPreCompilationDeps` makes a type-only import an edge like any
 * other, so a shared leaf is the shape rather than a preference. `Partition` is
 * in `./projectStore.ts` for the same reason.
 *
 * EVERY ONE OF THEM IS OPAQUE, AND OPAQUE MEANS BOUNDED. They are minted
 * outside this tree's arithmetic and their only operation is equality, so the
 * one thing this module does with them is refuse the two shapes a stored row
 * cannot hold: text past the column's bound, and text carrying an unpaired
 * surrogate, which every UTF-8 encoding folds to one replacement character —
 * so two such identities would share one row and one digest.
 */

import { asBoundedText } from "./boundedText.ts";

declare const executionIdBrand: unique symbol;
declare const attemptIdBrand: unique symbol;
declare const capacityAccountBrand: unique symbol;
declare const clusterIdBrand: unique symbol;
declare const workloadIdBrand: unique symbol;
declare const schedulerOwnerBrand: unique symbol;

/** A logical execution's identity: globally unique, opaque, and never reused. */
export type ExecutionId = string & { readonly [executionIdBrand]: true };

/** One physical attempt's identity, distinct for every attempt ever made under an execution. */
export type AttemptId = string & { readonly [attemptIdBrand]: true };

/** The entitlement axis a release pinned, which is never an identity axis. */
export type CapacityAccountId = string & {
  readonly [capacityAccountBrand]: true;
};

/** The placement pool an account draws its slots from. */
export type ClusterId = string & { readonly [clusterIdBrand]: true };

/** What the worker-launch port calls the workload it placed, opaque to everything here. */
export type WorkloadId = string & { readonly [workloadIdBrand]: true };

/** A scheduler process instance, which is what a claim lease is granted to. */
export type SchedulerOwnerId = string & {
  readonly [schedulerOwnerBrand]: true;
};

/** The longest opaque scheduler identity a stored row carries. */
export const schedulerIdentityCharsMax = 256;

/** Refuses text a bounded column cannot hold, and text no digest can separate. */
export function asSchedulerText(value: string, what: string): string {
  return asBoundedText(value, what, schedulerIdentityCharsMax);
}

/** Brands an opaque logical execution identity. */
export function asExecutionId(value: string): ExecutionId {
  return asSchedulerText(value, "execution id") as ExecutionId;
}

/** Brands an opaque physical attempt identity. */
export function asAttemptId(value: string): AttemptId {
  return asSchedulerText(value, "attempt id") as AttemptId;
}

/** Brands an opaque capacity-account identity. */
export function asCapacityAccountId(value: string): CapacityAccountId {
  return asSchedulerText(value, "capacity account") as CapacityAccountId;
}

/** Brands an opaque cluster identity. */
export function asClusterId(value: string): ClusterId {
  return asSchedulerText(value, "cluster id") as ClusterId;
}

/** Brands an opaque workload identity. */
export function asWorkloadId(value: string): WorkloadId {
  return asSchedulerText(value, "workload id") as WorkloadId;
}

/** Brands an opaque scheduler instance identity. */
export function asSchedulerOwnerId(value: string): SchedulerOwnerId {
  return asSchedulerText(value, "scheduler owner") as SchedulerOwnerId;
}
