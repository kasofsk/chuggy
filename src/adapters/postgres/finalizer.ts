/**
 * The durable finalization authority against PostgreSQL: ordering the requests
 * a decision authorized, holding one for a bounded stretch, gathering what the
 * pure pass reads, and submitting the one conclusion `Core` is ever told.
 *
 * THE QUEUE IS THE REQUEST TABLE AND THERE IS NO PROJECTION OF IT. Requests are
 * drawn in `authorizing_seq` order, which is journal-derived and therefore
 * rebuilt by replay; a stored copy of that order would be the duplicate standing
 * rule three rejects, and a second thing to repair after a restore.
 *
 * THE ROW LOCK HANDS WORK OUT AND THE EPOCH SAYS WHO MAY HOLD IT. A claim is a
 * lease taken under `FOR UPDATE SKIP LOCKED`, stamped with the epoch it was
 * taken in, and every move here refuses outright unless that epoch is still the
 * current one. So an executor alive after a takeover can neither claim, extend,
 * release nor reopen: the epoch it holds is not the epoch the database is in,
 * and no statement below matches on any other.
 *
 * A CLAIM MOVES THE REQUEST OUT OF THE OPEN SET, AND ONLY RECOVERY MOVES IT
 * BACK. `Registered` is what a held request is, so the claimable index offers
 * only work nobody holds and two passes never draw the same row. A lease that
 * lapses is not self-healing, for the same reason a permit is not: the row still
 * says it is held. Reopening is a durable move a fresh process asks for by name,
 * and it bumps the claim generation, which is what stops the previous holder's
 * later moves from matching anything.
 *
 * NOTHING HERE CONCLUDES A TICKET. The role holds no privilege on `operation`,
 * `decision_input`, `journal_entry` or `ticket_projection`, so the only way a
 * result reaches the mailbox is `submit_finalization_result`, which builds the
 * envelope from durable rows and refuses a binding those rows disagree with.
 * `Invalidated` is written for exactly one answer from that door — a project
 * that will admit no result at all — because a request no submission can ever
 * fulfil is a request no later claim should draw again.
 *
 * NOTHING HERE PERFORMS A GIT ACT. `GitPromotionPort` has no adapter yet, so no
 * view gathered here carries an observed target and the pure pass holds rather
 * than concluding. A durable move that assumed a promotion had happened would
 * forge the one outcome the repository is the only authority on.
 *
 * NOTHING HERE READS AN ANSWER TO AN APPROVAL. The action a finalizer opens is
 * the ticket service's row, and the resolution that answers one records nothing
 * this role can read yet, so every standing gathered here is pending.
 *
 * THE GLOBAL LOCK ORDER IS REQUEST, THEN REPOSITORY, THEN PROJECT, THEN PERMIT,
 * THEN ATTEMPT, and within each class in key order. The sweeps take their
 * requests in key order and the door this file calls takes the request and then
 * the project inside it. The claim is the one statement that takes requests in
 * queue order instead, and it may: `SKIP LOCKED` makes it wait for nothing, so
 * it is in no cycle whatever order it reaches rows in.
 *
 * NOTHING HERE READS A CLOCK. Every lease and expiry is a duration handed to the
 * server, which is the only party whose clock the durable state may depend on.
 */

import { randomUUID } from "node:crypto";
import type pg from "pg";

import { asTicketId, type TicketId } from "../../domain/ids.ts";
import {
  allCommitPermitStates,
  allFinalizationAttemptOutcomes,
  allFinalizationFailureKinds,
  allFinalizationRequestStates,
  allIntegrationStrategies,
  allReconciliationVerdicts,
  asCommitPermitId,
  asFinalizationAttemptId,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type ApprovalStanding,
  type CommitPermitId,
  type FinalizationAttempt,
  type FinalizationClaim,
  type FinalizationOffer,
  type FinalizationSubmitted,
  type FinalizationView,
  type FinalizerOwnerId,
  type FinalizerStore,
} from "../../interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type RecoveryEpoch,
} from "../../interpreter/projectStore.ts";
import { postgresOwnershipEpoch } from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import { finalizationFunction, finalizerRole } from "./schema.ts";

/** The states a request is still working through, which a claim and a submission both need it to be in. */
const liveRequestStates = "'Open', 'Registered'";

/** The states no claim outlives, which is where a lease is dropped rather than reopened. */
const settledRequestStates = "'Fulfilled', 'Invalidated'";

/** Where an approval stands, which nothing this role may read yet records an answer to. */
const approvalUnanswered: ApprovalStanding = "Pending";

/** One claimed request row. */
interface ClaimRow {
  readonly tenant: string;
  readonly project: string;
  readonly request: string;
  readonly ticket: string;
  readonly authorizing_seq: string;
  readonly request_generation: string;
  readonly claim_generation: string;
  readonly state: string;
}

/** One gathered view row: the request, its binding, its latest attempt, and what followed from it. */
interface ViewRow {
  readonly state: string;
  readonly repository: string | null;
  readonly binding_epoch: string | null;
  readonly attempt: string | null;
  readonly target_ref: string | null;
  readonly target_commit: string | null;
  readonly strategy: string | null;
  readonly configuration_revision: string | null;
  readonly configuration_digest: string | null;
  readonly approval_required: boolean | null;
  readonly outcome: string | null;
  readonly candidate_commit: string | null;
  readonly failure_kind: string | null;
  readonly attempt_digest: string | null;
  readonly permit: string | null;
  readonly permit_epoch: string | null;
  readonly lifecycle_generation: string | null;
  readonly permit_state: string | null;
  readonly verdict: string | null;
  readonly reconciled_candidate: string | null;
  readonly reconciled_ref: string | null;
  readonly observed_commit: string | null;
  readonly attempts_made: string;
}

/** What the one door returned about one offered conclusion. */
interface SubmissionRow {
  readonly result: string;
  readonly operation: string | null;
}

/** Refuses a bound no work can be drawn under, naming the argument rather than the row. */
function finalizerBounded(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(
      `postgres finalizer: ${what} of ${String(value)} is not a positive bound`,
    );
  }
}

/** Narrows a column to the closed set the port declares, refusing what no migration can have written. */
function finalizerRowValue<Value extends string>(
  admitted: readonly Value[],
  value: string,
  what: string,
): Value {
  const found = admitted.find((each) => each === value);
  if (found === undefined) {
    throw new Error(`finalizer row: ${value} is not a ${what} this code knows`);
  }
  return found;
}

/** What one claimed row grants its holder. */
function finalizerRowClaim(
  row: ClaimRow,
  owner: FinalizerOwnerId,
  epoch: RecoveryEpoch,
): FinalizationClaim {
  return {
    partition: {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    },
    request: row.request,
    ticket: asTicketId(projectRowCounter(row.ticket, "request ticket")),
    authorizingSeq: projectRowCounter(
      row.authorizing_seq,
      "authorizing sequence",
    ),
    requestGeneration: projectRowCounter(
      row.request_generation,
      "request generation",
    ),
    claimGeneration: projectRowCounter(
      row.claim_generation,
      "claim generation",
    ),
    state: finalizerRowValue(
      allFinalizationRequestStates,
      row.state,
      "delivery state",
    ),
    recoveryEpoch: epoch,
    owner,
  };
}

/** Takes a bounded lease on the oldest requests nobody holds, drawing nothing under a superseded epoch. */
async function finalizerClaimRequests(
  client: pg.PoolClient,
  owner: FinalizerOwnerId,
  epoch: RecoveryEpoch,
  requestsMax: number,
  leaseSecs: number,
): Promise<readonly FinalizationClaim[]> {
  finalizerBounded(requestsMax, "requestsMax");
  finalizerBounded(leaseSecs, "leaseSecs");
  if ((await postgresOwnershipEpoch(client)) !== epoch) return [];
  const claimed = await client.query<ClaimRow>(
    `UPDATE finalization_request r
        SET state = 'Registered', claim_owner = $1,
            claim_generation = r.claim_generation + 1,
            claim_expires_at = now() + make_interval(secs => $2::double precision),
            recovery_epoch = $3
      WHERE (r.tenant, r.project, r.request) IN (
              SELECT q.tenant, q.project, q.request FROM finalization_request q
               WHERE q.state = 'Open'
                 AND (q.claim_owner IS NULL OR q.claim_expires_at <= now())
               ORDER BY q.authorizing_seq, q.request
               LIMIT $4 FOR UPDATE SKIP LOCKED)
      RETURNING r.tenant, r.project, r.request, r.ticket::text AS ticket,
                r.authorizing_seq::text AS authorizing_seq,
                r.request_generation::text AS request_generation,
                r.claim_generation::text AS claim_generation, r.state`,
    [owner, leaseSecs, epoch, requestsMax],
  );
  return claimed.rows.map((row) => finalizerRowClaim(row, owner, epoch));
}

/** Extends a lease the caller still holds at its own generation, under the epoch it took it in. */
async function finalizerExtendClaim(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  leaseSecs: number,
): Promise<boolean> {
  finalizerBounded(leaseSecs, "leaseSecs");
  if ((await postgresOwnershipEpoch(client)) !== claim.recoveryEpoch)
    return false;
  const held = await client.query(
    `UPDATE finalization_request
        SET claim_expires_at = now() + make_interval(secs => $6::double precision)
      WHERE tenant = $1 AND project = $2 AND request = $3
        AND claim_owner = $4 AND claim_generation = $5
        AND recovery_epoch = $7 AND state IN (${liveRequestStates})`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.request,
      claim.owner,
      claim.claimGeneration,
      leaseSecs,
      claim.recoveryEpoch,
    ],
  );
  return held.rowCount === 1;
}

/** Gives a claim back once its request has settled, so no lease outlives the work it covered. */
async function finalizerSettleClaim(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<boolean> {
  if ((await postgresOwnershipEpoch(client)) !== claim.recoveryEpoch)
    return false;
  const released = await client.query(
    `UPDATE finalization_request
        SET claim_owner = NULL, claim_expires_at = NULL, recovery_epoch = NULL,
            claim_generation = claim_generation + 1
      WHERE tenant = $1 AND project = $2 AND request = $3
        AND claim_owner = $4 AND claim_generation = $5
        AND state IN (${settledRequestStates})`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.request,
      claim.owner,
      claim.claimGeneration,
    ],
  );
  return released.rowCount === 1;
}

/**
 * Reopens at most `requestsMax` claims the fence condemns, in key order, and
 * drops the lease without reopening where the request has already settled. The
 * claim generation is bumped either way, which is what retires the holder.
 */
async function finalizerReclaim(
  client: pg.PoolClient,
  fence: { readonly predicate: string; readonly values: readonly unknown[] },
  epoch: RecoveryEpoch,
  requestsMax: number,
): Promise<number> {
  finalizerBounded(requestsMax, "requestsMax");
  if ((await postgresOwnershipEpoch(client)) !== epoch) return 0;
  const condemned = await client.query<{
    tenant: string;
    project: string;
    request: string;
  }>(
    `SELECT r.tenant, r.project, r.request FROM finalization_request r
      WHERE r.claim_owner IS NOT NULL AND ${fence.predicate}
      ORDER BY r.tenant, r.project, r.request LIMIT $1 FOR UPDATE`,
    [requestsMax, ...fence.values],
  );
  if (condemned.rows.length === 0) return 0;
  const reopened = await client.query(
    `UPDATE finalization_request r
        SET state = CASE WHEN r.state = 'Registered' THEN 'Open' ELSE r.state END,
            claim_owner = NULL, claim_expires_at = NULL, recovery_epoch = NULL,
            claim_generation = r.claim_generation + 1
       FROM unnest($1::text[], $2::text[], $3::text[]) AS h(tenant, project, request)
      WHERE r.tenant = h.tenant AND r.project = h.project AND r.request = h.request`,
    [
      condemned.rows.map((row) => row.tenant),
      condemned.rows.map((row) => row.project),
      condemned.rows.map((row) => row.request),
    ],
  );
  return reopened.rowCount ?? 0;
}

/** The columns one claimed request's whole durable view is read from. */
const viewColumns = `
  f.state, b.repository, b.recovery_epoch AS binding_epoch,
  a.attempt, a.target_ref, a.target_commit, a.strategy,
  a.configuration_revision, a.configuration_digest, a.approval_required,
  a.outcome, a.candidate_commit, a.failure_kind, a.attempt_digest,
  p.permit, p.recovery_epoch AS permit_epoch,
  p.lifecycle_generation::text AS lifecycle_generation, p.state AS permit_state,
  r.verdict, r.candidate_commit AS reconciled_candidate,
  r.target_ref AS reconciled_ref, r.observed_commit,
  c.made::text AS attempts_made
`;

/** The joins that reach every row one claimed request's view is gathered from. */
const viewFrom = `
  finalization_request f
  LEFT JOIN project_repository b
    ON b.tenant = f.tenant AND b.project = f.project
  LEFT JOIN LATERAL (
    SELECT x.* FROM finalization_attempt x
     WHERE x.tenant = f.tenant AND x.project = f.project AND x.request = f.request
     ORDER BY x.prepared_at DESC, x.attempt DESC LIMIT 1) a ON true
  LEFT JOIN commit_permit p
    ON p.tenant = a.tenant AND p.project = a.project AND p.attempt = a.attempt
  LEFT JOIN finalization_reconciliation r
    ON r.tenant = p.tenant AND r.project = p.project AND r.permit = p.permit
  LEFT JOIN LATERAL (
    SELECT count(*) AS made FROM finalization_attempt y
     WHERE y.tenant = f.tenant AND y.project = f.project AND y.request = f.request) c
    ON true
`;

/** The one preparation the view was gathered around, or nothing where none was made. */
function finalizerRowAttempt(
  row: ViewRow,
  request: string,
  ticket: TicketId,
): FinalizationAttempt | undefined {
  if (
    row.attempt === null ||
    row.repository === null ||
    row.target_ref === null ||
    row.target_commit === null ||
    row.strategy === null ||
    row.configuration_revision === null ||
    row.configuration_digest === null ||
    row.approval_required === null ||
    row.outcome === null ||
    row.attempt_digest === null
  ) {
    return undefined;
  }
  return {
    attempt: asFinalizationAttemptId(row.attempt),
    request,
    ticket,
    repository: asRepositoryId(row.repository),
    target: {
      ref: asGitRefName(row.target_ref),
      commit: asGitObjectId(row.target_commit),
    },
    strategy: finalizerRowValue(
      allIntegrationStrategies,
      row.strategy,
      "integration strategy",
    ),
    configurationRevision: row.configuration_revision,
    configurationDigest: row.configuration_digest,
    approvalRequired: row.approval_required,
    outcome: finalizerRowValue(
      allFinalizationAttemptOutcomes,
      row.outcome,
      "attempt outcome",
    ),
    ...(row.candidate_commit === null
      ? {}
      : { candidate: asGitObjectId(row.candidate_commit) }),
    ...(row.failure_kind === null
      ? {}
      : {
          failureKind: finalizerRowValue(
            allFinalizationFailureKinds,
            row.failure_kind,
            "failure kind",
          ),
        }),
    attemptDigest: row.attempt_digest,
  };
}

/** What reading the target ref proved about the candidate, absent until reconciliation wrote it. */
function finalizerRowReconciliation(
  row: ViewRow,
  permit: CommitPermitId,
): Pick<FinalizationView, "reconciliation"> {
  if (
    row.verdict === null ||
    row.reconciled_candidate === null ||
    row.reconciled_ref === null
  ) {
    return {};
  }
  return {
    reconciliation: {
      permit,
      candidate: asGitObjectId(row.reconciled_candidate),
      target: asGitRefName(row.reconciled_ref),
      verdict: finalizerRowValue(
        allReconciliationVerdicts,
        row.verdict,
        "reconciliation verdict",
      ),
      ...(row.observed_commit === null
        ? {}
        : { observed: asGitObjectId(row.observed_commit) }),
    },
  };
}

/** The permit that authorizes the one irreversible act, absent until it is granted. */
function finalizerRowPermit(
  row: ViewRow,
): Pick<FinalizationView, "permit" | "reconciliation"> {
  if (
    row.permit === null ||
    row.permit_epoch === null ||
    row.lifecycle_generation === null ||
    row.permit_state === null ||
    row.attempt === null
  ) {
    return {};
  }
  const permit = asCommitPermitId(row.permit);
  return {
    permit: {
      permit,
      attempt: asFinalizationAttemptId(row.attempt),
      recoveryEpoch: asRecoveryEpoch(row.permit_epoch),
      lifecycleGeneration: projectRowCounter(
        row.lifecycle_generation,
        "lifecycle generation",
      ),
      state: finalizerRowValue(
        allCommitPermitStates,
        row.permit_state,
        "permit state",
      ),
    },
    ...finalizerRowReconciliation(row, permit),
  };
}

/**
 * Everything the pure pass reads, gathered before it runs. The observed target
 * is not among it: reading the remote is the caller's, through a port this
 * adapter does not hold.
 */
async function finalizerDurableView(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<FinalizationView | undefined> {
  const found = await client.query<ViewRow>(
    `SELECT ${viewColumns} FROM ${viewFrom}
      WHERE f.tenant = $1 AND f.project = $2 AND f.request = $3`,
    [claim.partition.tenant, claim.partition.project, claim.request],
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const attempt = finalizerRowAttempt(row, claim.request, claim.ticket);
  return {
    claim: {
      ...claim,
      state: finalizerRowValue(
        allFinalizationRequestStates,
        row.state,
        "delivery state",
      ),
    },
    ...(row.repository === null || row.binding_epoch === null
      ? {}
      : {
          repository: {
            partition: claim.partition,
            repository: asRepositoryId(row.repository),
            recoveryEpoch: asRecoveryEpoch(row.binding_epoch),
          },
        }),
    ...(attempt === undefined ? {} : { attempt }),
    approval: approvalUnanswered,
    ...finalizerRowPermit(row),
    attemptsMade: projectRowCounter(row.attempts_made, "attempts made"),
  };
}

/** Takes the request out of the open set for good, which a project admitting no result leaves behind. */
async function finalizerInvalidate(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<void> {
  await client.query(
    `UPDATE finalization_request SET state = 'Invalidated'
      WHERE tenant = $1 AND project = $2 AND request = $3
        AND state IN (${liveRequestStates})`,
    [claim.partition.tenant, claim.partition.project, claim.request],
  );
}

/** Narrows the door's verdict to the closed set the port declares. */
function finalizerSubmissionOf(row: SubmissionRow): FinalizationSubmitted {
  if (row.result === "Submitted" || row.result === "AlreadySubmitted") {
    if (row.operation === null) {
      throw new Error(
        `postgres finalizer: the door said ${row.result} and named no operation`,
      );
    }
    return row.result === "Submitted"
      ? { submitted: "Submitted", operation: row.operation }
      : { submitted: "AlreadySubmitted", operation: row.operation };
  }
  if (row.result === "UnknownRequest") return { submitted: "UnknownRequest" };
  if (row.result === "NotAdmitted") return { submitted: "NotAdmitted" };
  if (row.result === "BindingMismatch") return { submitted: "BindingMismatch" };
  throw new Error(
    `postgres finalizer: ${row.result} is not a verdict this door returns`,
  );
}

/**
 * Offers one conclusion to the one authenticated door. What the envelope says is
 * the function's own work; what this passes is the binding it claims to hold,
 * and a project that will admit no result at all retires the request.
 */
async function finalizerSubmitResult(
  client: pg.PoolClient,
  offer: FinalizationOffer,
): Promise<FinalizationSubmitted> {
  const { claim, conclusion } = offer;
  const submitted = await client.query<SubmissionRow>(
    `SELECT result, operation FROM ${finalizationFunction}($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      claim.partition.tenant,
      claim.partition.project,
      claim.request,
      offer.attempt,
      conclusion.outcome,
      conclusion.outcome === "FinalizationFailed" ? conclusion.kind : null,
      claim.requestGeneration,
      claim.recoveryEpoch,
      `finalization-${randomUUID()}`,
      finalizerRole,
    ],
  );
  const row = submitted.rows[0];
  if (row === undefined) {
    throw new Error(
      "postgres finalizer: the finalization door returned no verdict at all",
    );
  }
  const verdict = finalizerSubmissionOf(row);
  if (verdict.submitted === "NotAdmitted")
    await finalizerInvalidate(client, claim);
  return verdict;
}

/** The durable finalization authority for one installation, over a finalizer-role pool. */
export function postgresFinalizer(pool: pg.Pool): FinalizerStore {
  return {
    claimRequests: (owner, epoch, requestsMax, leaseSecs) =>
      postgresTransaction(pool, (client) =>
        finalizerClaimRequests(client, owner, epoch, requestsMax, leaseSecs),
      ),
    extendClaim: (claim, leaseSecs) =>
      postgresTransaction(pool, (client) =>
        finalizerExtendClaim(client, claim, leaseSecs),
      ),
    durableView: (claim) =>
      postgresTransaction(pool, (client) =>
        finalizerDurableView(client, claim),
      ),
    submitResult: (offer) =>
      postgresTransaction(pool, (client) =>
        finalizerSubmitResult(client, offer),
      ),
    settleClaim: (claim) =>
      postgresTransaction(pool, (client) =>
        finalizerSettleClaim(client, claim),
      ),
    reclaimLapsed: (epoch, requestsMax) =>
      postgresTransaction(pool, (client) =>
        finalizerReclaim(
          client,
          { predicate: "r.claim_expires_at <= now()", values: [] },
          epoch,
          requestsMax,
        ),
      ),
    reclaimStaleEpoch: (epoch, requestsMax) =>
      postgresTransaction(pool, (client) =>
        finalizerReclaim(
          client,
          {
            predicate: "r.recovery_epoch IS DISTINCT FROM $2",
            values: [epoch],
          },
          epoch,
          requestsMax,
        ),
      ),
  };
}
