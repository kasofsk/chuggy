/**
 * Acceptance and cancellation: the two server-owned transactions that make an
 * authorized mutation durable and can take it back.
 *
 * ACCEPTANCE IS ONE TRANSACTION AND THE ORDINAL IS ALLOCATED BY THE STATEMENT
 * THAT CHECKS ADMISSION. A conditional `UPDATE` of the ingress counter
 * re-evaluates its condition against whatever a racing lifecycle transition
 * committed while it waited, and returns the ordinal it just allocated — so a
 * suspension that commits first leaves no operation behind it, and one that
 * commits second finds the operation already accounted for.
 *
 * THE API CALLS ONE SECURITY-DEFINER BOUNDARY. That function locks the project,
 * checks admission and capacity, allocates the ordinal, claims the operation,
 * publishes its typed decision input and raises readiness. The API role can
 * read operation standing, but cannot construct any of those writes directly.
 *
 * THE IDEMPOTENCY LOOKUP COMES FIRST AND THE CLAIM IS THE OPERATION INSERT.
 * The function receives paired key and payload digests for every retained key
 * version, because it must recognize and compare a retry accepted before a
 * rotation without receiving either plaintext keys or digest secrets. The
 * project lock serializes the lookup and current-key claim within a partition.
 *
 * NOTHING HERE CONSUMES. Acceptance publishes a pending decision input;
 * cancellation or the decision transaction alone may terminalize it.
 *
 * CANCELLATION LOCKS THE DECISION INPUT AND NOTHING ELSE. It takes no lease, no
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

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { assertNever } from "../../domain/assertNever.ts";

import {
  allAdmissionClasses,
  allOperationStates,
  asAuthorityKind,
  asOperationCommand,
  asOperationId,
  classifyCommand,
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
  encodeDecisionEventText,
  encodeTicketCommand,
} from "../../interpreter/wire.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../interpreter/projectStore.ts";
import {
  observe,
  type TicketServiceConfig,
  type TicketServiceMetrics,
} from "../../interpreter/ticketService.ts";
import {
  idempotencyKeyDigestCurrent,
  idempotencyKeyDigests,
  idempotencyPayloadDigest,
  type IdempotencyKeying,
  type IdempotencyScope,
} from "./keying.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter, projectRowLifecycle } from "./rows.ts";

/** One operation row with the ordinal of its decision input. */
export interface OperationRow {
  readonly tenant: string;
  readonly project: string;
  readonly operation: string;
  readonly authority_kind: string;
  readonly admission: string;
  readonly state: string;
  readonly lifecycle_generation: string;
  readonly ordinal: string;
}

/** Narrows a state column to the closed set, refusing a value no migration can have written. */
function operationRowState(value: string): OperationState {
  if (value === "Journaled") return "Succeeded";
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

/** What the row says about itself. */
export function operationRowStanding(row: OperationRow): OperationStanding {
  return {
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    operation: asOperationId(row.operation),
    ordinal: projectRowCounter(row.ordinal, "decision-input ordinal"),
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

function operationsRetainedOffering(
  keying: IdempotencyKeying,
  scope: IdempotencyScope,
  submission: Submission,
  command: ReturnType<typeof asOperationCommand>,
): { readonly keys: readonly string[]; readonly payloads: readonly string[] } {
  const keys: string[] = [];
  const payloads: string[] = [];
  const keyDigests = idempotencyKeyDigests(keying, scope, submission.key);
  for (const [index, { version }] of keying.versions.entries()) {
    const keyDigest = keyDigests[index];
    if (keyDigest === undefined)
      throw new Error(`idempotency key version ${version} has no digest`);
    keys.push(keyDigest);
    payloads.push(idempotencyPayloadDigest(keying, version, scope, command));
    if (submission.command.command === "Decide") {
      keys.push(keyDigest);
      payloads.push(
        idempotencyPayloadDigest(
          keying,
          version,
          scope,
          asOperationCommand(encodeDecisionEventText(submission.command.event)),
        ),
      );
    }
  }
  return { keys, payloads };
}

interface AcceptanceRow {
  readonly result: string | null;
  readonly operation: string | null;
  readonly ordinal: string | null;
  readonly state: string | null;
  readonly authority_kind: string | null;
  readonly admission: string | null;
  readonly lifecycle_generation: string | null;
  readonly lifecycle: string | null;
}

function acceptedStanding(
  submission: Submission,
  row: AcceptanceRow,
): OperationStanding {
  if (
    row.operation === null ||
    row.ordinal === null ||
    row.state === null ||
    row.authority_kind === null ||
    row.admission === null ||
    row.lifecycle_generation === null
  )
    throw new Error(
      `postgres acceptance: ${row.result} returned an incomplete operation`,
    );
  return operationRowStanding({
    tenant: submission.partition.tenant,
    project: submission.partition.project,
    operation: row.operation,
    ordinal: row.ordinal,
    state: row.state,
    authority_kind: row.authority_kind,
    admission: row.admission,
    lifecycle_generation: row.lifecycle_generation,
  });
}

function acceptanceResult(
  submission: Submission,
  row: AcceptanceRow,
  config: TicketServiceConfig,
  metrics: TicketServiceMetrics,
  priority: ReturnType<typeof classifyCommand>["priority"],
): Accepted {
  switch (row.result) {
    case null:
      throw new Error("postgres acceptance: function returned a null result");
    case "Accepted":
    case "Original":
      return {
        accepted: row.result,
        operation: acceptedStanding(submission, row),
      };
    case "IdempotencyConflict":
    case "InvalidCommand":
      return { accepted: row.result };
    case "Backpressure":
    case "Unavailable":
      observe(() => {
        metrics.backpressure(
          priority,
          row.result === "Unavailable" ? "HardLimit" : "SoftLimit",
        );
      });
      return {
        accepted: row.result,
        retryAfterSeconds: config.backpressureRetryAfterSeconds,
      };
    case "NotAdmitted":
      if (row.lifecycle === null)
        throw new Error(
          "postgres acceptance: NotAdmitted returned no lifecycle",
        );
      return {
        accepted: "NotAdmitted",
        lifecycle: projectRowLifecycle(row.lifecycle),
      };
    default:
      throw new Error(`postgres acceptance: unknown result ${row.result}`);
  }
}

/**
 * Calls the acceptance boundary the submission's command class is granted:
 * the two server functions share one signature and differ only in name, and
 * a query the checker can read must carry each name as literal text.
 */
async function operationsAcceptCall(
  client: pg.PoolClient,
  submission: Submission,
  keying: IdempotencyKeying,
  scope: IdempotencyScope,
  command: ReturnType<typeof asOperationCommand>,
  retained: {
    readonly keys: readonly string[];
    readonly payloads: readonly string[];
  },
  config: TicketServiceConfig,
): Promise<pg.QueryResult<AcceptanceRow>> {
  const tenant = submission.partition.tenant;
  const project = submission.partition.project;
  const operation = submission.operation;
  const authorityKind = submission.authority.kind;
  const authoritySubject = submission.authority.subject;
  const keyVersion = keying.current;
  const keyDigest = idempotencyKeyDigestCurrent(keying, scope, submission.key);
  const payloadDigest = idempotencyPayloadDigest(
    keying,
    keying.current,
    scope,
    command,
  );
  const dispatch =
    submission.command.command === "ManualDispatch" ||
    submission.command.command === "ProposeDispatch";
  return dispatch
    ? client.query<AcceptanceRow>(
        sql`SELECT * FROM accept_dispatch_operation(${tenant},${project},${operation},${authorityKind},${authoritySubject},${keyVersion},${keyDigest},${payloadDigest},${retained.keys}::text[],${retained.payloads}::text[],${command},${config.ordinarySoftLimit},${config.mailboxHardLimit})`,
      )
    : client.query<AcceptanceRow>(
        sql`SELECT * FROM accept_operation(${tenant},${project},${operation},${authorityKind},${authoritySubject},${keyVersion},${keyDigest},${payloadDigest},${retained.keys}::text[],${retained.payloads}::text[],${command},${config.ordinarySoftLimit},${config.mailboxHardLimit})`,
      );
}

/** Accepts one submission, writing its operation, decision input and readiness generation together. */
export async function postgresOperationsAccept(
  pool: pg.Pool,
  keying: IdempotencyKeying,
  submission: Submission,
  config: TicketServiceConfig,
  metrics: TicketServiceMetrics,
): Promise<Accepted> {
  if (
    submission.command.command === "Decide" &&
    submission.command.event.type === "Dispatch"
  )
    return { accepted: "InvalidCommand" };
  return postgresTransaction(pool, async (client) => {
    const scope = operationsScope(
      submission.partition,
      submission.authority.kind,
    );
    const command = asOperationCommand(encodeTicketCommand(submission.command));
    const classified = classifyCommand(submission.command);
    const retained = operationsRetainedOffering(
      keying,
      scope,
      submission,
      command,
    );
    const result = await operationsAcceptCall(
      client,
      submission,
      keying,
      scope,
      command,
      retained,
      config,
    );
    const row = result.rows[0];
    if (row === undefined || result.rows.length !== 1)
      throw new Error(
        `postgres acceptance: function returned ${String(result.rows.length)} rows`,
      );
    return acceptanceResult(
      submission,
      row,
      config,
      metrics,
      classified.priority,
    );
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
    sql`SELECT cancel_pending_operation(${cancellation.partition.tenant}, ${cancellation.partition.project}, ${cancellation.operation}, ${cancellation.authority.kind}, ${cancellation.authority.subject})::text AS locked`,
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
    sql`SELECT o.tenant, o.project, o.operation, o.authority_kind, o.admission,
           d.state, d.lifecycle_generation, d.ordinal
      FROM operation o
      JOIN decision_input d
        ON d.tenant = o.tenant AND d.project = o.project
       AND d.input_kind = 'Operation' AND d.input_id = o.operation
     WHERE o.tenant = ${cancellation.partition.tenant}
       AND o.project = ${cancellation.partition.project}
       AND o.operation = ${cancellation.operation}`,
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
    sql`SELECT o.tenant, o.project, o.operation, o.authority_kind, o.admission,
           d.state, d.lifecycle_generation, d.ordinal
      FROM operation o
      JOIN decision_input d
        ON d.tenant = o.tenant AND d.project = o.project
       AND d.input_kind = 'Operation' AND d.input_id = o.operation
     WHERE o.tenant = ${partition.tenant}
       AND o.project = ${partition.project}
       AND o.operation = ${operation}`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : operationRowStanding(row);
}
