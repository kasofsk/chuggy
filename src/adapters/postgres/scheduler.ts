/**
 * The durable execution authority against PostgreSQL: claiming the work a
 * decision authorized, registering it, admitting it against capacity, and
 * opening and accounting for the attempts that run it.
 *
 * THE REQUEST ROW LOCK IS THE AUTHORITY AND THE CLAIM IS ONLY A LEASE.
 * `claimRequests` hands work out with `FOR UPDATE SKIP LOCKED` and a bounded
 * lease, so two scheduler processes never draw the same request and a lapsed
 * one is redrawn — that is what the lease is for. It is not what makes
 * registration safe: registration locks the request row and reads its state, so
 * a process whose lease lapsed mid-flight finds the work already registered
 * rather than doing it twice. Fencing registration on the lease as well would
 * add a second answer to a question the durable state already settles.
 *
 * REGISTRATION IS IDEMPOTENT AT THE LOGICAL TASK AND NOWHERE ELSE.
 * `execution_names_one_logical_task` is the idempotency key, so a retry creates
 * exactly the rows it is missing and collides on the ones it made, and the
 * immutable payload of a row it made earlier is never rewritten. A logical task
 * already registered under a different spawn request is not a retry at all: it
 * is a contradiction, and it raises an incident instead of quietly winning.
 *
 * A DELAYED REGISTRATION CANNOT RESURRECT REVOKED WORK. Cancellation invalidates
 * every still-open spawn request for its ticket that an earlier sequence
 * authorized, and registration refuses a request whose ticket a later
 * cancellation has already retired. Both halves are needed: the first closes the
 * window where the spawn has not been claimed yet, the second the window where
 * it was claimed before the cancellation and reached its transaction after.
 *
 * ADMISSION SERIALIZES ON THE CLUSTER AND DECIDES FROM DURABLE ROWS.
 * `model/capacity.qnt`'s `mayAdmit` reads a count over the whole ledger, so two
 * admissions reading it concurrently would both see room that only one of them
 * can have. The scheduler role may not lock `execution_cluster` — locking a row
 * needs write privilege on it and capacity policy is not the scheduler's to
 * write — so the serialization is a transaction-scoped advisory lock keyed by
 * the cluster. It guards an arithmetic rather than an authority; the authority
 * stays the durable allocations, which is why no count is cached anywhere.
 *
 * A LAPSED ATTEMPT LEASE IS ENDED BEFORE ANY LAUNCH IS OFFERED, AND ENDING IT IS
 * ITS OWN CALL. An attempt whose lease has run out is no longer live, but its
 * row still says it is, and the partial unique index that makes one unfenced
 * reporter would refuse the replacement. So reaping is a durable move the pass
 * asks for by name, spending the safe retry budget the way any attempt that ran
 * and vanished does, and the launch read that follows it writes nothing. Both
 * refuse to do anything at all under a superseded recovery epoch, because a
 * restore withdraws the authority a scheduler was holding before it.
 *
 * ROWS ARE TAKEN IN ONE ORDER: REQUEST, THEN EXECUTION, THEN PROJECT, THEN
 * ATTEMPT. A worker reporting on a task while the same pass cancels its ticket
 * is two transactions over the same three rows, and two orders between them is
 * a deadlock the server resolves by aborting one — which discards the rest of a
 * pass that has no retry. So a cancellation retires the registrations before it
 * fences their attempts, attempt accounting takes the registration's row before
 * the attempt's, and the reaping sweep locks the registrations it is about to
 * charge before it ends anything. `schedulerFenceOldEpochs` takes attempt rows
 * and nothing else, which is the last name in the order and therefore no side
 * of a cycle. The order is what makes the deadlock unreachable rather than
 * merely rare, which no retry can do.
 *
 * NOTHING HERE READS A CLOCK. Every lease, expiry and backoff is a duration
 * handed to the server, which is the only party whose clock the durable state
 * is allowed to depend on.
 */

import { randomUUID } from "node:crypto";
import type pg from "pg";

import {
  allExecutionStatuses,
  asAttemptId,
  asExecutionId,
  executionOwnsSlot,
  type Admitted,
  type AttemptEvidence,
  type AttemptLoss,
  type AttemptOpened,
  type AttemptOpening,
  type CancellationRegistered,
  type ClusterId,
  type ExecutionId,
  type ExecutionSchedulerStore,
  type FencedAttempt,
  type LogicalExecution,
  type RequestClaim,
  type SchedulerOwnerId,
  type SpawnRegistered,
  type WorkloadId,
} from "../../interpreter/executionScheduler.ts";
import type {
  Partition,
  RecoveryEpoch,
} from "../../interpreter/projectStore.ts";
import { asTicketId } from "../../domain/ids.ts";
import { postgresOwnershipEpoch } from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import {
  schedulerBlockExecution,
  schedulerEvidence,
  schedulerFulfilRequest,
  schedulerRecordIncident,
  schedulerRetriesExhausted,
  schedulerTerminalize,
} from "./schedulerCompletion.ts";
import {
  attemptRowColumns,
  attemptRowPhysical,
  executionRowColumns,
  executionRowFrom,
  executionRowLogical,
  schedulerRowPartition,
  type AttemptRow,
  type ExecutionRow,
} from "./schedulerRows.ts";

/**
 * The namespace the admission lock is taken in. It is an arbitrary constant
 * whose only requirement is that nothing else in this database uses it.
 */
const admissionLockNamespace = 0x63687536;

/** The statuses that own a logical slot, spelled for SQL by the arithmetic that decides them. */
const slotHolders = allExecutionStatuses
  .filter(executionOwnsSlot)
  .map((status) => `'${status}'`)
  .join(", ");

/** The statuses no further move is possible from, which is where a slot is already released. */
const settledStatuses = "'Terminal', 'Cancelled'";

/** The attempt states an attempt may still report from. */
const liveAttemptStates = "'Placing', 'Running'";

/** One claimed request row. */
interface ClaimRow {
  readonly tenant: string;
  readonly project: string;
  readonly request: string;
  readonly kind: string;
  readonly ticket: string;
  readonly authorizing_seq: string;
  readonly claim_generation: string;
}

/** One request row as registration and cancellation read it under their lock. */
interface RequestRow {
  readonly state: string;
  readonly authorizing_seq: string;
}

/** Refuses a bound no work can be handed out under, naming the argument rather than the row. */
function schedulerRequirePositive(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `postgres scheduler: ${what} is ${String(value)}, and a bound is a positive safe integer`,
    );
  }
}

/** Narrows the request kind column to the closed set the port declares. */
function claimRowKind(value: string): RequestClaim["kind"] {
  if (
    value !== "SpawnWork" &&
    value !== "SpawnEvaluation" &&
    value !== "CancelTicketWork"
  ) {
    throw new Error(
      `execution request row: ${value} is not a focused request kind this code knows`,
    );
  }
  return value;
}

/** What one claimed row grants its holder. */
function claimRowClaim(row: ClaimRow, owner: SchedulerOwnerId): RequestClaim {
  return {
    partition: schedulerRowPartition(row),
    request: row.request,
    kind: claimRowKind(row.kind),
    ticket: asTicketId(projectRowCounter(row.ticket, "request ticket")),
    authorizingSeq: projectRowCounter(
      row.authorizing_seq,
      "authorizing sequence",
    ),
    generation: projectRowCounter(row.claim_generation, "claim generation"),
    owner,
  };
}

/** Takes a bounded lease on the unclaimed or lapsed requests of the kinds named. */
async function schedulerClaimRequests(
  pool: pg.Pool,
  owner: SchedulerOwnerId,
  kinds: readonly RequestClaim["kind"][],
  requestsMax: number,
  leaseSecs: number,
): Promise<readonly RequestClaim[]> {
  schedulerRequirePositive(requestsMax, "requestsMax");
  schedulerRequirePositive(leaseSecs, "leaseSecs");
  const claimed = await pool.query<ClaimRow>(
    `UPDATE execution_request r
        SET claim_owner = $1,
            claim_generation = r.claim_generation + 1,
            claim_expires_at = now() + make_interval(secs => $2::double precision)
      WHERE (r.tenant, r.project, r.request) IN (
              SELECT q.tenant, q.project, q.request FROM execution_request q
               WHERE q.kind = ANY($3::text[]) AND q.state = 'Open'
                 AND (q.claim_owner IS NULL OR q.claim_expires_at <= now())
               ORDER BY q.authorizing_seq, q.request
               LIMIT $4 FOR UPDATE SKIP LOCKED)
      RETURNING r.tenant, r.project, r.request, r.kind, r.ticket::text AS ticket,
                r.authorizing_seq::text AS authorizing_seq,
                r.claim_generation::text AS claim_generation`,
    [owner, leaseSecs, [...kinds], requestsMax],
  );
  return claimed.rows.map((row) => claimRowClaim(row, owner));
}

/** Locks the request this claim names and reads the delivery state it is in. */
async function schedulerLockRequest(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<RequestRow> {
  const found = await client.query<RequestRow>(
    `SELECT state, authorizing_seq::text AS authorizing_seq FROM execution_request
      WHERE tenant = $1 AND project = $2 AND request = $3 FOR UPDATE`,
    [claim.partition.tenant, claim.partition.project, claim.request],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${claim.partition.tenant}/${claim.partition.project} has no request ${claim.request}`,
    );
  }
  return row;
}

/**
 * Locks every request authorizing work under this claim's ticket, in request
 * order, and answers the state of the claim's own. Taking all of them before any
 * registration is read is what makes a registration committing alongside a
 * cancellation visible to it rather than missed: a registration holds its own
 * request row for the whole of its transaction, so a cancellation that is past
 * this call is a cancellation no registration for the ticket is still inside.
 */
async function schedulerLockTicketRequests(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<RequestRow> {
  const found = await client.query<RequestRow & { request: string }>(
    `SELECT request, state, authorizing_seq::text AS authorizing_seq
       FROM execution_request
      WHERE tenant = $1 AND project = $2 AND ticket = $3
      ORDER BY request FOR UPDATE`,
    [claim.partition.tenant, claim.partition.project, claim.ticket],
  );
  const row = found.rows.find((each) => each.request === claim.request);
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${claim.partition.tenant}/${claim.partition.project} has no request ${claim.request}`,
    );
  }
  return row;
}

/** Moves the request to the delivery state named and gives its claim back. */
async function schedulerRequestState(
  client: pg.PoolClient,
  claim: RequestClaim,
  state: "Registered" | "Fulfilled" | "Invalidated",
): Promise<void> {
  await client.query(
    `UPDATE execution_request
        SET state = $4, claim_owner = NULL, claim_expires_at = NULL
      WHERE tenant = $1 AND project = $2 AND request = $3`,
    [claim.partition.tenant, claim.partition.project, claim.request, state],
  );
}

/**
 * Whether a cancellation authorized after this spawn has retired the work it
 * would create. The cancellation request's own delivery state is deliberately
 * not read: the revocation is durable as soon as the writer journaled it, and a
 * registration that waited for the scheduler to process it would create work
 * the cancellation had not reached yet and would then have to retire.
 */
async function schedulerTicketRetired(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<boolean> {
  const found = await client.query(
    `SELECT 1 FROM execution_request
      WHERE tenant = $1 AND project = $2 AND ticket = $3
        AND kind = 'CancelTicketWork' AND authorizing_seq > $4`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.ticket,
      claim.authorizingSeq,
    ],
  );
  return found.rows.length > 0;
}

/** A logical task this request declares that another request has already registered. */
async function schedulerRegistrationConflict(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<string | undefined> {
  const found = await client.query<{ execution: string }>(
    `SELECT e.execution FROM execution e
       JOIN execution_request_task t
         ON t.tenant = e.tenant AND t.project = e.project AND t.task = e.task
      WHERE e.tenant = $1 AND e.project = $2 AND e.ticket = $3
        AND t.request = $4 AND e.source_request <> $4 LIMIT 1`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.ticket,
      claim.request,
    ],
  );
  return found.rows[0]?.execution;
}

/** Creates the executions this request authorizes that do not exist yet, and only those. */
async function schedulerCreateExecutions(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<number> {
  const created = await client.query(
    `INSERT INTO execution
       (tenant, project, execution, ticket, task, source_request, account, cluster,
        configuration_revision, configuration_digest)
     SELECT q.tenant, q.project, $4::text || '-' || t.task::text, q.ticket, t.task, q.request,
            q.capacity_account, a.cluster, q.configuration_revision, q.configuration_digest
       FROM execution_request q
       JOIN execution_request_task t
         ON t.tenant = q.tenant AND t.project = q.project AND t.request = q.request
       JOIN capacity_account a ON a.account = q.capacity_account
      WHERE q.tenant = $1 AND q.project = $2 AND q.request = $3
     ON CONFLICT (tenant, project, ticket, task) DO NOTHING`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.request,
      `execution-${randomUUID()}`,
    ],
  );
  return created.rowCount ?? 0;
}

/** How many of the request's declared tasks are still missing a registration. */
async function schedulerUnregisteredTasks(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<number> {
  const found = await client.query<{ owed: string }>(
    `SELECT count(*)::text AS owed FROM execution_request_task t
      WHERE t.tenant = $1 AND t.project = $2 AND t.request = $3
        AND NOT EXISTS (SELECT 1 FROM execution e
                         WHERE e.tenant = t.tenant AND e.project = t.project
                           AND e.source_request = t.request AND e.task = t.task)`,
    [claim.partition.tenant, claim.partition.project, claim.request],
  );
  return projectRowCounter(found.rows[0]?.owed ?? "0", "unregistered tasks");
}

/** Creates or finds the exact logical executions one spawn request authorized. */
async function schedulerRegisterSpawn(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<SpawnRegistered> {
  const request = await schedulerLockRequest(client, claim);
  if (request.state === "Invalidated") return { registered: "Superseded" };
  if (request.state !== "Open") {
    return { registered: "AlreadyRegistered", created: 0 };
  }
  if (await schedulerTicketRetired(client, claim)) {
    await schedulerRequestState(client, claim, "Invalidated");
    return { registered: "Superseded" };
  }
  const conflict = await schedulerRegistrationConflict(client, claim);
  if (conflict !== undefined) {
    return {
      registered: "Conflicting",
      incident: await schedulerRecordIncident(
        client,
        claim.partition,
        "ConflictingRegistration",
        schedulerEvidence.ConflictingRegistration,
        { execution: conflict },
      ),
    };
  }
  const created = await schedulerCreateExecutions(client, claim);
  if ((await schedulerUnregisteredTasks(client, claim)) > 0) {
    return {
      registered: "Conflicting",
      incident: await schedulerRecordIncident(
        client,
        claim.partition,
        "ImpossibleState",
        schedulerEvidence.PartialRegistration,
      ),
    };
  }
  await schedulerRequestState(client, claim, "Registered");
  await schedulerFulfilRequest(client, claim.partition, claim.request);
  return created > 0
    ? { registered: "Registered", created }
    : { registered: "AlreadyRegistered", created: 0 };
}

/** One retired registration: the row whose slot was released, and what authorized it. */
interface RetiredRow {
  readonly execution: string;
  readonly source_request: string;
}

/** Retires every logical task under the ticket, releasing one slot for each. */
async function schedulerRetireTicket(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<readonly RetiredRow[]> {
  const retired = await client.query<RetiredRow>(
    `UPDATE execution SET status = 'Cancelled', terminal_at = now()
      WHERE tenant = $1 AND project = $2 AND ticket = $3
        AND status NOT IN (${settledStatuses})
      RETURNING execution, source_request`,
    [claim.partition.tenant, claim.partition.project, claim.ticket],
  );
  return retired.rows;
}

/** Fences every attempt still able to report under the registrations just retired. */
async function schedulerFenceRetired(
  client: pg.PoolClient,
  claim: RequestClaim,
  retired: readonly RetiredRow[],
): Promise<readonly string[]> {
  const fenced = await client.query<{ attempt: string }>(
    `UPDATE execution_attempt a
        SET state = 'Superseded', generation = a.generation + 1,
            evidence = 'Fenced', ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE a.tenant = $1 AND a.project = $2
        AND a.execution = ANY($3::text[])
        AND a.state IN (${liveAttemptStates})
      RETURNING a.attempt`,
    [
      claim.partition.tenant,
      claim.partition.project,
      retired.map((row) => row.execution),
    ],
  );
  return fenced.rows.map((row) => row.attempt);
}

/** Invalidates the spawn requests an earlier sequence authorized for this retired ticket. */
async function schedulerInvalidateSpawns(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<void> {
  await client.query(
    `UPDATE execution_request
        SET state = 'Invalidated', claim_owner = NULL, claim_expires_at = NULL
      WHERE tenant = $1 AND project = $2 AND ticket = $3
        AND kind IN ('SpawnWork', 'SpawnEvaluation') AND state = 'Open'
        AND authorizing_seq < $4`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.ticket,
      claim.authorizingSeq,
    ],
  );
}

/** Fences every task a cancellation request names, then fulfills the request. */
async function schedulerRegisterCancellation(
  client: pg.PoolClient,
  claim: RequestClaim,
): Promise<CancellationRegistered> {
  const request = await schedulerLockTicketRequests(client, claim);
  if (request.state !== "Open") return { cancelled: "AlreadyFulfilled" };
  const retired = await schedulerRetireTicket(client, claim);
  const workloads = await schedulerFenceRetired(client, claim, retired);
  await schedulerInvalidateSpawns(client, claim);
  for (const source of new Set(retired.map((row) => row.source_request))) {
    await schedulerFulfilRequest(client, claim.partition, source);
  }
  await schedulerRequestState(client, claim, "Fulfilled");
  return {
    cancelled: "Registered",
    fenced: retired.length,
    workloads: workloads.map(asAttemptId),
  };
}

/** The cluster ledger as admission reads it, under the lock that serializes admissions. */
async function schedulerClusterLedger(
  client: pg.PoolClient,
  cluster: ClusterId,
): Promise<{ readonly slotsMax: number; readonly active: number }> {
  await client.query(
    "SELECT pg_advisory_xact_lock($1, ('x' || substr(md5($2), 1, 8))::bit(32)::integer)",
    [admissionLockNamespace, cluster],
  );
  const found = await client.query<{ slots_max: string; active: string }>(
    `SELECT c.slots_max::text AS slots_max,
            (SELECT count(*)::text FROM execution e
              WHERE e.cluster = c.cluster
                AND e.status IN (${slotHolders})) AS active
       FROM execution_cluster c WHERE c.cluster = $1`,
    [cluster],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: cluster ${cluster} has no ledger to admit against`,
    );
  }
  return {
    slotsMax: projectRowCounter(row.slots_max, "cluster slots"),
    active: projectRowCounter(row.active, "cluster active count"),
  };
}

/** Takes one slot for the preferred queued execution under the locked cluster ledger. */
async function schedulerAdmit(
  client: pg.PoolClient,
  cluster: ClusterId,
): Promise<Admitted> {
  const ledger = await schedulerClusterLedger(client, cluster);
  if (ledger.active >= ledger.slotsMax) return { admitted: "ClusterFull" };
  const candidate = await client.query<{
    tenant: string;
    project: string;
    execution: string;
  }>(
    `SELECT e.tenant, e.project, e.execution
       FROM execution e
       JOIN capacity_account a ON a.account = e.account
       LEFT JOIN LATERAL (SELECT count(*) AS held FROM execution x
                           WHERE x.account = e.account
                             AND x.status IN (${slotHolders})) h ON true
      WHERE e.cluster = $1 AND e.status = 'Queued' AND h.held < a.maximum
      ORDER BY (greatest(a.reserved - h.held, 0) > 0) DESC,
               e.registered_at, e.execution LIMIT 1
      FOR UPDATE OF e`,
    [cluster],
  );
  const row = candidate.rows[0];
  if (row === undefined) return schedulerNoCandidate(client, cluster);
  const taken = await client.query(
    `UPDATE execution SET status = 'Admitted'
      WHERE tenant = $1 AND project = $2 AND execution = $3 AND status = 'Queued'`,
    [row.tenant, row.project, row.execution],
  );
  if (taken.rowCount !== 1) {
    throw new Error(
      `postgres scheduler: execution ${row.execution} was locked queued and then took no slot`,
    );
  }
  return { admitted: "Admitted", execution: asExecutionId(row.execution) };
}

/** Which bound stopped an admission that found nothing to admit. */
async function schedulerNoCandidate(
  client: pg.PoolClient,
  cluster: ClusterId,
): Promise<Admitted> {
  const queued = await client.query(
    `SELECT 1 FROM execution WHERE cluster = $1 AND status = 'Queued' LIMIT 1`,
    [cluster],
  );
  return queued.rows.length > 0
    ? { admitted: "AccountAtMaximum" }
    : { admitted: "NoCandidate" };
}

/** One execution row read with the launch conditions the server decided about it. */
interface LaunchRow extends ExecutionRow {
  readonly backing_off: boolean;
  readonly attempt_live: boolean;
}

/** Locks the registration a launch is about, with the backoff and liveness it is subject to. */
async function schedulerLockForLaunch(
  client: pg.PoolClient,
  opening: AttemptOpening,
): Promise<LaunchRow> {
  const found = await client.query<LaunchRow>(
    `SELECT ${executionRowColumns},
            (e.placement_backoff_from IS NOT NULL
             AND e.placement_backoff_from
                 + make_interval(secs => $4::double precision) > now()) AS backing_off,
            EXISTS (SELECT 1 FROM execution_attempt a
                     WHERE a.tenant = e.tenant AND a.project = e.project
                       AND a.execution = e.execution
                       AND a.state IN (${liveAttemptStates})) AS attempt_live
       FROM ${executionRowFrom}
      WHERE e.tenant = $1 AND e.project = $2 AND e.execution = $3
      FOR UPDATE OF e`,
    [
      opening.partition.tenant,
      opening.partition.project,
      opening.execution,
      opening.placementBackoffSecs,
    ],
  );
  const row = found.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: ${opening.partition.tenant}/${opening.partition.project} has no execution ${opening.execution} to launch`,
    );
  }
  return row;
}

/** Takes the next attempt number and moves an admitted registration into placement. */
async function schedulerTakeAttemptNumber(
  client: pg.PoolClient,
  opening: AttemptOpening,
): Promise<string> {
  const taken = await client.query<{ attempt_number: string }>(
    `UPDATE execution
        SET attempt_next = attempt_next + 1,
            status = CASE WHEN status = 'Admitted' THEN 'Launching' ELSE status END
      WHERE tenant = $1 AND project = $2 AND execution = $3
      RETURNING (attempt_next - 1)::text AS attempt_number`,
    [opening.partition.tenant, opening.partition.project, opening.execution],
  );
  const row = taken.rows[0];
  if (row === undefined) {
    throw new Error(
      `postgres scheduler: execution ${opening.execution} handed out no attempt number`,
    );
  }
  return row.attempt_number;
}

/** Opens the next sequential attempt, or names the condition that stopped it. */
async function schedulerOpenAttempt(
  client: pg.PoolClient,
  opening: AttemptOpening,
): Promise<AttemptOpened> {
  schedulerRequirePositive(opening.leaseSecs, "leaseSecs");
  schedulerRequirePositive(opening.retriesMax, "retriesMax");
  schedulerRequirePositive(
    opening.placementBackoffSecs,
    "placementBackoffSecs",
  );
  const row = await schedulerLockForLaunch(client, opening);
  const execution = executionRowLogical(row);
  if (!executionOwnsSlot(execution.status) || row.attempt_live) {
    return { opened: "NotLaunchable", status: execution.status };
  }
  if (execution.retriesSpent >= opening.retriesMax) {
    return { opened: "RetriesExhausted" };
  }
  if (row.backing_off) return { opened: "BackingOff" };
  const attempt = `attempt-${randomUUID()}`;
  const attemptNumber = await schedulerTakeAttemptNumber(client, opening);
  const opened = await client.query<AttemptRow>(
    `INSERT INTO execution_attempt
       (tenant, project, execution, attempt, attempt_number, generation,
        recovery_epoch, state, lease_owner, lease_expires_at)
     VALUES ($1,$2,$3,$4,$5,1,$6,'Placing',$4,
             now() + make_interval(secs => $7::double precision))
     RETURNING ${attemptRowColumns}`,
    [
      opening.partition.tenant,
      opening.partition.project,
      opening.execution,
      attempt,
      attemptNumber,
      opening.epoch,
      opening.leaseSecs,
    ],
  );
  const written = opened.rows[0];
  if (written === undefined) {
    throw new Error(
      `postgres scheduler: opening an attempt on ${opening.execution} wrote no row`,
    );
  }
  return { opened: "Opened", attempt: attemptRowPhysical(written) };
}

/** Takes the registration's own row lock, which every attempt move is made under. */
async function schedulerLockAttemptExecution(
  client: pg.PoolClient,
  attempt: FencedAttempt,
): Promise<void> {
  await client.query(
    `SELECT 1 FROM execution
      WHERE tenant = $1 AND project = $2 AND execution = $3 FOR UPDATE`,
    [attempt.partition.tenant, attempt.partition.project, attempt.execution],
  );
}

/** Records that the worker port placed the attempt, moving the execution to `Running`. */
async function schedulerAttemptPlaced(
  client: pg.PoolClient,
  attempt: FencedAttempt,
  workload: WorkloadId,
): Promise<boolean> {
  await schedulerLockAttemptExecution(client, attempt);
  const placed = await client.query(
    `UPDATE execution_attempt SET state = 'Running', workload = $6
      WHERE tenant = $1 AND project = $2 AND execution = $3 AND attempt = $4
        AND generation = $5 AND state = 'Placing'`,
    [
      attempt.partition.tenant,
      attempt.partition.project,
      attempt.execution,
      attempt.attempt,
      attempt.generation,
      workload,
    ],
  );
  if (placed.rowCount !== 1) return false;
  await client.query(
    `UPDATE execution SET status = 'Running'
      WHERE tenant = $1 AND project = $2 AND execution = $3 AND status = 'Launching'`,
    [attempt.partition.tenant, attempt.partition.project, attempt.execution],
  );
  return true;
}

/** Records that an attempt ended without a result, leaving the slot with its execution. */
async function schedulerAttemptEnded(
  client: pg.PoolClient,
  attempt: FencedAttempt,
  loss: AttemptLoss,
  evidence: AttemptEvidence,
): Promise<boolean> {
  await schedulerLockAttemptExecution(client, attempt);
  const ended = await client.query(
    `UPDATE execution_attempt
        SET state = $6, evidence = $7, ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE tenant = $1 AND project = $2 AND execution = $3 AND attempt = $4
        AND generation = $5 AND state IN (${liveAttemptStates})`,
    [
      attempt.partition.tenant,
      attempt.partition.project,
      attempt.execution,
      attempt.attempt,
      attempt.generation,
      loss,
      evidence,
    ],
  );
  if (ended.rowCount !== 1) return false;
  await client.query(
    `UPDATE execution
        SET retries_spent = retries_spent + $4, placement_backoff_from = now()
      WHERE tenant = $1 AND project = $2 AND execution = $3
        AND status NOT IN (${settledStatuses})`,
    [
      attempt.partition.tenant,
      attempt.partition.project,
      attempt.execution,
      loss === "Lost" ? 1 : 0,
    ],
  );
  return true;
}

/** Ends every live attempt whose lease has run out, spending the budget an attempt that ran spends. */
async function schedulerReapLapsedAttempts(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
): Promise<number> {
  if ((await postgresOwnershipEpoch(client)) !== epoch) return 0;
  const reaped = await client.query<{ reaped: string }>(
    `WITH held AS (
       SELECT e.tenant, e.project, e.execution, e.status FROM execution e
        WHERE EXISTS (SELECT 1 FROM execution_attempt a
                       WHERE a.tenant = e.tenant AND a.project = e.project
                         AND a.execution = e.execution
                         AND a.state IN (${liveAttemptStates})
                         AND a.lease_expires_at <= now())
        ORDER BY e.tenant, e.project, e.execution FOR UPDATE),
     spent AS (
       UPDATE execution e
          SET retries_spent = e.retries_spent + 1, placement_backoff_from = now()
         FROM held h
        WHERE e.tenant = h.tenant AND e.project = h.project AND e.execution = h.execution
          AND h.status NOT IN (${settledStatuses})
        RETURNING e.execution),
     lapsed AS (
       UPDATE execution_attempt a
          SET state = 'Lost', evidence = 'LeaseExpired', ended_at = now(),
              lease_owner = NULL, lease_expires_at = NULL
         FROM held h
        WHERE a.tenant = h.tenant AND a.project = h.project AND a.execution = h.execution
          AND a.state IN (${liveAttemptStates}) AND a.lease_expires_at <= now()
        RETURNING a.attempt)
     SELECT count(*)::text AS reaped FROM lapsed`,
  );
  return projectRowCounter(reaped.rows[0]?.reaped ?? "0", "reaped attempts");
}

/** At most `executionsMax` executions that own a slot and have no live attempt. */
async function schedulerUnlaunched(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
  executionsMax: number,
): Promise<readonly LogicalExecution[]> {
  schedulerRequirePositive(executionsMax, "executionsMax");
  if ((await postgresOwnershipEpoch(client)) !== epoch) return [];
  const waiting = await client.query<ExecutionRow>(
    `SELECT ${executionRowColumns} FROM ${executionRowFrom}
      WHERE e.status IN ('Admitted', 'Launching', 'Running')
        AND NOT EXISTS (SELECT 1 FROM execution_attempt a
                         WHERE a.tenant = e.tenant AND a.project = e.project
                           AND a.execution = e.execution
                           AND a.state IN (${liveAttemptStates}))
      ORDER BY e.registered_at, e.execution LIMIT $1`,
    [executionsMax],
  );
  return waiting.rows.map(executionRowLogical);
}

/** Marks every attempt issued under an older recovery epoch unable to report. */
async function schedulerFenceOldEpochs(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
): Promise<number> {
  const fenced = await client.query(
    `UPDATE execution_attempt
        SET state = 'Superseded', generation = generation + 1,
            evidence = 'Fenced', ended_at = now(),
            lease_owner = NULL, lease_expires_at = NULL
      WHERE state IN (${liveAttemptStates}) AND recovery_epoch <> $1`,
    [epoch],
  );
  return fenced.rowCount ?? 0;
}

/** What one execution durably says about itself, which resolves an ambiguous commit. */
async function schedulerExecution(
  pool: pg.Pool,
  partition: Partition,
  execution: ExecutionId,
): Promise<LogicalExecution | undefined> {
  const found = await pool.query<ExecutionRow>(
    `SELECT ${executionRowColumns} FROM ${executionRowFrom}
      WHERE e.tenant = $1 AND e.project = $2 AND e.execution = $3`,
    [partition.tenant, partition.project, execution],
  );
  const row = found.rows[0];
  return row === undefined ? undefined : executionRowLogical(row);
}

/** The durable execution authority for one installation, over a scheduler-role pool. */
export function postgresExecutionScheduler(
  pool: pg.Pool,
): ExecutionSchedulerStore {
  return {
    claimRequests: (owner, kinds, requestsMax, leaseSecs) =>
      schedulerClaimRequests(pool, owner, kinds, requestsMax, leaseSecs),
    registerSpawn: (claim) =>
      postgresTransaction(pool, (client) =>
        schedulerRegisterSpawn(client, claim),
      ),
    registerCancellation: (claim) =>
      postgresTransaction(pool, (client) =>
        schedulerRegisterCancellation(client, claim),
      ),
    admit: (cluster) =>
      postgresTransaction(pool, (client) => schedulerAdmit(client, cluster)),
    openAttempt: (opening) =>
      postgresTransaction(pool, (client) =>
        schedulerOpenAttempt(client, opening),
      ),
    attemptPlaced: (attempt, workload) =>
      postgresTransaction(pool, (client) =>
        schedulerAttemptPlaced(client, attempt, workload),
      ),
    attemptEnded: (attempt, loss, evidence) =>
      postgresTransaction(pool, (client) =>
        schedulerAttemptEnded(client, attempt, loss, evidence),
      ),
    retriesExhausted: (partition, execution) =>
      postgresTransaction(pool, (client) =>
        schedulerRetriesExhausted(client, partition, execution),
      ),
    terminalize: (report) =>
      postgresTransaction(pool, (client) =>
        schedulerTerminalize(client, report),
      ),
    blockExecution: (partition, execution, reason) =>
      postgresTransaction(pool, (client) =>
        schedulerBlockExecution(client, partition, execution, reason),
      ),
    execution: (partition, execution) =>
      schedulerExecution(pool, partition, execution),
    reapLapsedAttempts: (epoch) =>
      postgresTransaction(pool, (client) =>
        schedulerReapLapsedAttempts(client, epoch),
      ),
    unlaunched: (epoch, executionsMax) =>
      postgresTransaction(pool, (client) =>
        schedulerUnlaunched(client, epoch, executionsMax),
      ),
    fenceOldEpochAttempts: (epoch) =>
      postgresTransaction(pool, (client) =>
        schedulerFenceOldEpochs(client, epoch),
      ),
  };
}
