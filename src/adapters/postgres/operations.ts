/**
 * Acceptance and cancellation: the two transactions that make an authorized
 * mutation durable and the one that takes it back.
 *
 * ACCEPTANCE IS ONE TRANSACTION AND THE ORDINAL IS ALLOCATED BY THE STATEMENT
 * THAT CHECKS ADMISSION. A conditional `UPDATE` of the ingress counter
 * re-evaluates its condition against whatever a racing lifecycle transition
 * committed while it waited, and returns the ordinal it just allocated — so a
 * suspension that commits first leaves no operation behind it, and one that
 * commits second finds the operation already accounted for.
 *
 * THE LIFECYCLE ROW IS LOCKED BEFORE THAT STATEMENT AND NOT BY IT. A
 * conditional `UPDATE` whose `WHERE` does not match locks nothing, so a
 * refusal that then read the lifecycle would be reading a row a racing fence
 * was free to change in between — and would report `NotAdmitted` against a
 * lifecycle that admits the class. Taking the row lock first costs an accepted
 * submission nothing, because it holds that row to commit either way, and it
 * is what lets the refusal name the row it was actually refused by.
 *
 * THE IDEMPOTENCY LOOKUP COMES FIRST AND THE CLAIM IS THE OPERATION INSERT.
 * The lookup offers every retained key version, because a key accepted before
 * a rotation must still find its operation. The insert then claims the current
 * version's digest with `ON CONFLICT DO NOTHING`, which waits for a
 * concurrent twin to commit or abort rather than guessing — so a lost claim
 * re-reads and answers with the twin's operation instead of creating a second.
 * Its ordinal is discarded, which 006 permits: an aborted acceptance may leave
 * a harmless gap, and never a duplicate.
 *
 * NOTHING HERE CONSUMES. The inbox item is written consumable and only
 * cancellation lowers that flag; acknowledging one is the decision
 * transaction's, and so is any terminal state but `Cancelled`.
 *
 * CANCELLATION LOCKS THE OPERATION ROW AND NOTHING ELSE. It takes no lease, no
 * lifecycle and no project row, because 006 requires it to remain available
 * without a healthy project writer — and it races that writer on the one row
 * lock they share, with the server's own trigger refusing whichever of them
 * arrives second.
 *
 * IT ALSO TAKES THAT LOCK INSIDE THE SERVER RATHER THAN AROUND IT. The whole
 * transition belongs to `./schema.ts`'s cancellation function, because the API
 * role is granted no `UPDATE` on `operation` at all — which is what stops a
 * caller deciding one — and a role that may not update the relation may not
 * lock its rows either. So this file calls that function and reports the state
 * it found, and the row it reads afterwards is a row it already holds.
 */

import type pg from "pg";

import { assertNever } from "../../domain/assertNever.ts";

import {
  admissionLifecycles,
  allAdmissionClasses,
  allOperationStates,
  asAuthorityKind,
  asOperationId,
  type Accepted,
  type AdmissionClass,
  type AuthorityKind,
  type Cancellation,
  type Cancelled,
  type OperationId,
  type OperationStanding,
  type OperationState,
  type Submission,
} from "../../interpreter/operationInbox.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import {
  idempotencyKeyDigestCurrent,
  idempotencyKeyDigests,
  idempotencyPayloadDigest,
  type IdempotencyKeying,
  type IdempotencyScope,
} from "./keying.ts";
import { postgresOwnershipLockKnown } from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter, projectRowStanding } from "./rows.ts";
import { cancellationFunction } from "./schema.ts";

/** One operation row with the ordinal of the inbox item it was accepted into. */
export interface OperationRow {
  readonly tenant: string;
  readonly project: string;
  readonly operation: string;
  readonly authority_kind: string;
  readonly admission: string;
  readonly state: string;
  readonly key_version: string;
  readonly payload_digest: string;
  readonly lifecycle_generation: string;
  readonly ordinal: string | null;
}

/** The columns every read of an operation needs, named once so the queries cannot drift apart. */
const operationRowColumns = `
  o.tenant, o.project, o.operation, o.authority_kind, o.admission, o.state,
  o.key_version, o.payload_digest, o.lifecycle_generation, i.ordinal
`;

/** An operation is read with its inbox item, because its ordinal is what the item carries. */
const operationRowFrom = `
  operation o
  LEFT JOIN inbox_item i
    ON i.tenant = o.tenant AND i.project = o.project AND i.operation = o.operation
`;

/** Narrows a state column to the closed set, refusing a value no migration can have written. */
function operationRowState(value: string): OperationState {
  const found = allOperationStates.find((state) => state === value);
  if (found === undefined) {
    throw new Error(`operation row: ${value} is not a state this code knows`);
  }
  return found;
}

/** Narrows an admission column to the closed set the matrix is declared over. */
function operationRowAdmission(value: string): AdmissionClass {
  const found = allAdmissionClasses.find((admission) => admission === value);
  if (found === undefined) {
    throw new Error(
      `operation row: ${value} is not an admission class this code knows`,
    );
  }
  return found;
}

/** What the row says about itself, refusing an accepted operation that reached no inbox item. */
export function operationRowStanding(row: OperationRow): OperationStanding {
  if (row.ordinal === null) {
    throw new Error(
      `operation row: ${row.operation} was accepted with no inbox item, which no acceptance writes`,
    );
  }
  return {
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    operation: asOperationId(row.operation),
    ordinal: projectRowCounter(row.ordinal, "inbox ordinal"),
    state: operationRowState(row.state),
    authorityKind: asAuthorityKind(row.authority_kind),
    admission: operationRowAdmission(row.admission),
    lifecycleGeneration: projectRowCounter(
      row.lifecycle_generation,
      "lifecycle generation",
    ),
  };
}

/** What a key is scoped by, which 006 limits to the project and the authority kind. */
function operationsScope(
  partition: Partition,
  authorityKind: AuthorityKind,
): IdempotencyScope {
  return { partition, authorityKind };
}

/** The operation this key already has in this scope, offered under every retained version. */
async function operationsByKey(
  client: pg.PoolClient,
  keying: IdempotencyKeying,
  submission: Submission,
): Promise<OperationRow | undefined> {
  const scope = operationsScope(
    submission.partition,
    submission.authority.kind,
  );
  const found = await client.query<OperationRow>(
    `SELECT ${operationRowColumns} FROM ${operationRowFrom}
      WHERE o.tenant = $1 AND o.project = $2 AND o.authority_kind = $3
        AND o.key_digest = ANY($4::text[])`,
    [
      submission.partition.tenant,
      submission.partition.project,
      submission.authority.kind,
      idempotencyKeyDigests(keying, scope, submission.key),
    ],
  );
  return found.rows[0];
}

/**
 * What a repeat of an existing key answers with: its original operation when
 * the command is behaviourally the same, and a conflict when it is not. The
 * payload digest is recomputed under the version the row was written with, so
 * a rotation does not turn every retry into a conflict.
 */
function operationsRepeated(
  keying: IdempotencyKeying,
  row: OperationRow,
  submission: Submission,
): Accepted {
  const scope = operationsScope(
    submission.partition,
    submission.authority.kind,
  );
  const payload = idempotencyPayloadDigest(
    keying,
    row.key_version,
    scope,
    submission.command,
  );
  if (payload !== row.payload_digest)
    return { accepted: "IdempotencyConflict" };
  return { accepted: "Original", operation: operationRowStanding(row) };
}

/** Allocates the next ordinal under the lifecycle row's lock, or nothing when the class is not admitted. */
async function operationsAllocate(
  client: pg.PoolClient,
  submission: Submission,
): Promise<
  { readonly ordinal: number; readonly generation: number } | undefined
> {
  const allocated = await client.query<{
    ordinal: string;
    lifecycle_generation: string;
  }>(
    `UPDATE project SET ingress_next = ingress_next + 1
      WHERE tenant = $1 AND project = $2 AND lifecycle = ANY($3::text[])
      RETURNING ingress_next - 1 AS ordinal, lifecycle_generation`,
    [
      submission.partition.tenant,
      submission.partition.project,
      admissionLifecycles[submission.admission],
    ],
  );
  const row = allocated.rows[0];
  if (row === undefined) return undefined;
  return {
    ordinal: projectRowCounter(row.ordinal, "inbox ordinal"),
    generation: projectRowCounter(
      row.lifecycle_generation,
      "lifecycle generation",
    ),
  };
}

/** Claims the idempotency key by inserting the operation, answering false when a twin holds it. */
async function operationsClaim(
  client: pg.PoolClient,
  keying: IdempotencyKeying,
  submission: Submission,
  generation: number,
): Promise<boolean> {
  const scope = operationsScope(
    submission.partition,
    submission.authority.kind,
  );
  const claimed = await client.query(
    `INSERT INTO operation
       (tenant, project, operation, authority_kind, authority_subject, admission,
        key_version, key_digest, payload_digest, command, lifecycle_generation)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT ON CONSTRAINT operation_idempotency_is_scoped DO NOTHING
     RETURNING operation`,
    [
      submission.partition.tenant,
      submission.partition.project,
      submission.operation,
      submission.authority.kind,
      submission.authority.subject,
      submission.admission,
      keying.current,
      idempotencyKeyDigestCurrent(keying, scope, submission.key),
      idempotencyPayloadDigest(
        keying,
        keying.current,
        scope,
        submission.command,
      ),
      submission.command,
      generation,
    ],
  );
  return claimed.rows.length === 1;
}

/** Writes the inbox item and raises readiness, which is the half of acceptance a dispatcher discovers. */
async function operationsEnqueue(
  client: pg.PoolClient,
  submission: Submission,
  ordinal: number,
): Promise<void> {
  await client.query(
    "INSERT INTO inbox_item (tenant, project, ordinal, operation) VALUES ($1, $2, $3, $4)",
    [
      submission.partition.tenant,
      submission.partition.project,
      ordinal,
      submission.operation,
    ],
  );
  await client.query(
    `INSERT INTO project_readiness (tenant, project, ready, generation)
     VALUES ($1, $2, true, 1)
     ON CONFLICT (tenant, project)
     DO UPDATE SET ready = true, generation = project_readiness.generation + 1`,
    [submission.partition.tenant, submission.partition.project],
  );
}

/** Accepts one submission, writing its operation, inbox item and readiness generation together. */
export async function postgresOperationsAccept(
  pool: pg.Pool,
  keying: IdempotencyKeying,
  submission: Submission,
): Promise<Accepted> {
  return postgresTransaction(pool, async (client) => {
    const existing = await operationsByKey(client, keying, submission);
    if (existing !== undefined) {
      return operationsRepeated(keying, existing, submission);
    }
    const locked = await postgresOwnershipLockKnown(
      client,
      submission.partition,
    );
    const allocated = await operationsAllocate(client, submission);
    if (allocated === undefined) {
      return {
        accepted: "NotAdmitted",
        lifecycle: projectRowStanding(locked).lifecycle,
      };
    }
    if (
      !(await operationsClaim(client, keying, submission, allocated.generation))
    ) {
      const twin = await operationsByKey(client, keying, submission);
      if (twin === undefined) {
        throw new Error(
          "postgres operations: an idempotency key was held and then absent, which no interleaving allows",
        );
      }
      return operationsRepeated(keying, twin, submission);
    }
    await operationsEnqueue(client, submission, allocated.ordinal);
    return {
      accepted: "Accepted",
      operation: {
        partition: submission.partition,
        operation: submission.operation,
        ordinal: allocated.ordinal,
        state: "Pending",
        authorityKind: submission.authority.kind,
        admission: submission.admission,
        lifecycleGeneration: allocated.generation,
      },
    };
  });
}

/** The single row a statement that changes exactly one operation must have returned. */
function operationsRow(result: pg.QueryResult<OperationRow>): OperationRow {
  const row = result.rows[0];
  if (row === undefined || result.rows.length !== 1) {
    throw new Error(
      `postgres operations: an operation statement touched ${String(result.rows.length)} rows`,
    );
  }
  return row;
}

/**
 * Runs the whole cancellation and reports the state the operation was in when
 * the server locked it, or undefined when this partition has no such
 * operation.
 */
async function operationsWithdraw(
  client: pg.PoolClient,
  cancellation: Cancellation,
): Promise<OperationState | undefined> {
  const called = await client.query<{ locked: string | null }>(
    `SELECT ${cancellationFunction}($1, $2, $3, $4, $5) AS locked`,
    [
      cancellation.partition.tenant,
      cancellation.partition.project,
      cancellation.operation,
      cancellation.authority.kind,
      cancellation.authority.subject,
    ],
  );
  const row = called.rows[0];
  if (row === undefined || called.rows.length !== 1) {
    throw new Error(
      `postgres operations: a cancellation answered with ${String(called.rows.length)} rows`,
    );
  }
  return row.locked === null ? undefined : operationRowState(row.locked);
}

/** What the operation says about itself under the lock the cancellation just took on it. */
async function operationsSettled(
  client: pg.PoolClient,
  cancellation: Cancellation,
): Promise<OperationStanding> {
  const found = await client.query<OperationRow>(
    `SELECT ${operationRowColumns} FROM ${operationRowFrom}
      WHERE o.tenant = $1 AND o.project = $2 AND o.operation = $3`,
    [
      cancellation.partition.tenant,
      cancellation.partition.project,
      cancellation.operation,
    ],
  );
  return operationRowStanding(operationsRow(found));
}

/** Cancels a still-pending operation, under the row lock a deciding writer takes on the same row. */
export async function postgresOperationsCancel(
  pool: pg.Pool,
  cancellation: Cancellation,
): Promise<Cancelled> {
  return postgresTransaction(pool, async (client) => {
    const locked = await operationsWithdraw(client, cancellation);
    if (locked === undefined) return { cancelled: "Unknown" };
    switch (locked) {
      case "Succeeded":
      case "Refused":
        return { cancelled: "NotPending", state: locked };
      case "Pending":
        return {
          cancelled: "Cancelled",
          operation: await operationsSettled(client, cancellation),
        };
      case "Cancelled":
        return {
          cancelled: "AlreadyCancelled",
          operation: await operationsSettled(client, cancellation),
        };
      default:
        return assertNever(locked);
    }
  });
}

/** What an accepted operation says about itself, without taking any lock on it. */
export async function postgresOperationsRead(
  pool: pg.Pool,
  partition: Partition,
  operation: OperationId,
): Promise<OperationStanding | undefined> {
  const found = await pool.query<OperationRow>(
    `SELECT ${operationRowColumns} FROM ${operationRowFrom}
      WHERE o.tenant = $1 AND o.project = $2 AND o.operation = $3`,
    [partition.tenant, partition.project, operation],
  );
  const row = found.rows[0];
  return row === undefined ? undefined : operationRowStanding(row);
}
