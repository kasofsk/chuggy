/**
 * The project row as PostgreSQL returns it, and its translation into the
 * values `src/interpreter/projectStore.ts` declares.
 *
 * WHY A TRANSLATION AT ALL. The driver hands back `bigint` columns as strings
 * and `text` columns as unbranded strings, so a row is a foreign shape and the
 * port's types are this tree's. Parsing once, here, is what stops the widening
 * from happening at each call site — and it is where a counter too large for
 * an exact integer is refused rather than silently rounded.
 *
 * THE LIVENESS FLAG IS COMPUTED BY THE DATABASE, never here. Every query that
 * reads a lease asks PostgreSQL whether it has expired, because 006 makes
 * database time the authority on lease validity and a process clock that
 * disagreed would hand out two owners.
 */

import { asSafeInteger } from "../../domain/ids.ts";
import {
  allLifecycles,
  asOwnerId,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Lease,
  type Lifecycle,
  type Partition,
  type ProjectStanding,
} from "../../interpreter/projectStore.ts";

/**
 * One project row, with the liveness the database computed for its lease. The
 * liveness column is a SQL expression, and the checker cannot prove an
 * expression non-null in every clause that carries it, so the field admits a
 * null; a null means the same thing false does — no live lease — and is read
 * that way.
 */
export interface ProjectRow {
  readonly tenant: string;
  readonly project: string;
  readonly lifecycle: string;
  readonly lifecycle_generation: string;
  readonly fencing_epoch: string;
  readonly head: string;
  readonly owner: string | null;
  readonly recovery_epoch: string | null;
  readonly lease_live: boolean | null;
}

/** Reads a counter column, refusing a value JavaScript cannot represent exactly. */
export function projectRowCounter(value: string, what: string): number {
  const counter = Number(value);
  asSafeInteger(counter, what);
  return counter;
}

/** Narrows a lifecycle column to the closed set, refusing a value no migration can have written. */
export function projectRowLifecycle(value: string): Lifecycle {
  const found = allLifecycles.find((lifecycle) => lifecycle === value);
  if (found === undefined) {
    throw new Error(`project row: ${value} is not a lifecycle this code knows`);
  }
  return found;
}

/** The partition a row belongs to. */
export function projectRowPartition(row: ProjectRow): Partition {
  return { tenant: asTenantId(row.tenant), project: asProjectId(row.project) };
}

/** What the row says about itself, for a reader that holds no lease. */
export function projectRowStanding(row: ProjectRow): ProjectStanding {
  return {
    partition: projectRowPartition(row),
    lifecycle: projectRowLifecycle(row.lifecycle),
    lifecycleGeneration: projectRowCounter(
      row.lifecycle_generation,
      "lifecycle generation",
    ),
    fencingEpoch: projectRowCounter(row.fencing_epoch, "fencing epoch"),
    head: projectRowCounter(row.head, "journal head"),
  };
}

/**
 * The lease the row currently grants, or undefined when it grants none. A row
 * whose lease has expired grants nothing, which is why the flag is checked
 * before the columns are read.
 */
export function projectRowLease(row: ProjectRow): Lease | undefined {
  if (!row.lease_live || row.owner === null || row.recovery_epoch === null) {
    return undefined;
  }
  return {
    partition: projectRowPartition(row),
    owner: asOwnerId(row.owner),
    fencingEpoch: projectRowCounter(row.fencing_epoch, "fencing epoch"),
    recoveryEpoch: asRecoveryEpoch(row.recovery_epoch),
    head: projectRowCounter(row.head, "journal head"),
  };
}

/** Whether the row still grants exactly the lease a caller is holding, which is what fences a former owner. */
export function projectRowHonours(row: ProjectRow, lease: Lease): boolean {
  const current = projectRowLease(row);
  return (
    current !== undefined &&
    current.owner === lease.owner &&
    current.fencingEpoch === lease.fencingEpoch &&
    current.recoveryEpoch === lease.recoveryEpoch
  );
}
