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
 * NOTHING HERE PERFORMS A GIT ACT. No view gathered here carries an observed
 * target, because reading the remote is the pass's own work through a port this
 * adapter does not hold; the permit and the reading it concludes are
 * `./finalizerPermit.ts`, and each is a transaction that opens and commits with
 * no remote call inside it. A durable move that assumed a promotion had happened
 * would forge the one outcome the repository is the only authority on.
 *
 * AN APPROVAL IS READ AND NEVER WRITTEN. The action a finalizer opens is the
 * ticket service's row and this role holds `SELECT` on it and no more, so the
 * standing gathered here is whatever answer that writer recorded — and the
 * action read is the one naming the attempt in hand, so a superseded ask
 * answers for the candidate it was about and not for this one.
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
import { sql } from "@ts-safeql/sql-tag";
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
  approvalStandingOf,
  type ApprovalAction,
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
import type { FinalizerPreparationStore } from "../../interpreter/finalizerPreparation.ts";
import { nativeActionResolutions } from "../../interpreter/ticketCommand.ts";
import {
  allLifecycles,
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type RecoveryEpoch,
} from "../../interpreter/projectStore.ts";
import { postgresOwnershipEpoch } from "./ownership.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
import {
  finalizerPermitGrant,
  finalizerPermitHolds,
  finalizerPermitReconcile,
} from "./finalizerPermit.ts";
import {
  finalizerPreparationApproval,
  finalizerPreparationGathering,
  finalizerPreparationRecord,
} from "./finalizerPreparation.ts";
import {
  finalizerBounded,
  finalizerRowPresent,
  finalizerRowValue,
} from "./finalizerRows.ts";
import { finalizerRole } from "./schema.ts";

/** The states migration three gave a native action, so a column narrows rather than restates. */
const allNativeActionStates: readonly ApprovalAction["state"][] = [
  "Open",
  "Resolved",
  "Withdrawn",
];

/** One claimed request row. */
interface ClaimRow {
  readonly tenant: string;
  readonly project: string;
  readonly request: string;
  readonly ticket: string | null;
  readonly authorizing_seq: string | null;
  readonly request_generation: string | null;
  readonly claim_generation: string | null;
  readonly state: string;
}

/** One gathered view row: the request, its binding, its latest attempt, and what followed from it. */
interface ViewRow {
  readonly state: string;
  readonly lifecycle: string;
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
  readonly approval_state: string | null;
  readonly approval_resolution: string | null;
  readonly attempts_made: string | null;
}

/** What the one door returned about one offered conclusion. */
interface SubmissionRow {
  readonly result: string | null;
  readonly operation: string | null;
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
    ticket: asTicketId(
      projectRowCounter(
        finalizerRowPresent(row.ticket, "request ticket"),
        "request ticket",
      ),
    ),
    authorizingSeq: projectRowCounter(
      finalizerRowPresent(row.authorizing_seq, "authorizing sequence"),
      "authorizing sequence",
    ),
    requestGeneration: projectRowCounter(
      finalizerRowPresent(row.request_generation, "request generation"),
      "request generation",
    ),
    claimGeneration: projectRowCounter(
      finalizerRowPresent(row.claim_generation, "claim generation"),
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
    sql`UPDATE finalization_request r
        SET state = 'Registered', claim_owner = ${owner},
            claim_generation = r.claim_generation + 1,
            claim_expires_at = now() + make_interval(secs => ${leaseSecs}::double precision),
            recovery_epoch = ${epoch}
      WHERE (r.tenant, r.project, r.request) IN (
              SELECT q.tenant, q.project, q.request FROM finalization_request q
               WHERE q.state = 'Open'
                 AND (q.claim_owner IS NULL OR q.claim_expires_at <= now())
               ORDER BY q.authorizing_seq, q.request
               LIMIT ${requestsMax} FOR UPDATE SKIP LOCKED)
      RETURNING r.tenant, r.project, r.request, r.ticket::text AS ticket,
                r.authorizing_seq::text AS authorizing_seq,
                r.request_generation::text AS request_generation,
                r.claim_generation::text AS claim_generation, r.state`,
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
    sql`UPDATE finalization_request
        SET claim_expires_at = now() + make_interval(secs => ${leaseSecs}::double precision)
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND claim_owner = ${claim.owner} AND claim_generation = ${claim.claimGeneration}
        AND recovery_epoch = ${claim.recoveryEpoch}
        AND state IN ('Open', 'Registered')`,
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
    sql`UPDATE finalization_request
        SET claim_owner = NULL, claim_expires_at = NULL, recovery_epoch = NULL,
            claim_generation = claim_generation + 1
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND claim_owner = ${claim.owner} AND claim_generation = ${claim.claimGeneration}
        AND state IN ('Fulfilled', 'Invalidated')`,
  );
  return released.rowCount === 1;
}

/** One claim a fence condemns, named by the key its reopening is driven from. */
interface CondemnedClaim {
  readonly tenant: string;
  readonly project: string;
  readonly request: string;
}

/** The held claims whose leases have run out, in key order and bounded. */
async function finalizerCondemnedLapsed(
  client: pg.PoolClient,
  requestsMax: number,
): Promise<readonly CondemnedClaim[]> {
  const found = await client.query<CondemnedClaim>(
    sql`SELECT r.tenant, r.project, r.request FROM finalization_request r
      WHERE r.claim_owner IS NOT NULL AND r.claim_expires_at <= now()
      ORDER BY r.tenant, r.project, r.request LIMIT ${requestsMax} FOR UPDATE`,
  );
  return found.rows;
}

/** The held claims a restore superseded, in key order and bounded. */
async function finalizerCondemnedStaleEpoch(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
  requestsMax: number,
): Promise<readonly CondemnedClaim[]> {
  const found = await client.query<CondemnedClaim>(
    sql`SELECT r.tenant, r.project, r.request FROM finalization_request r
      WHERE r.claim_owner IS NOT NULL
        AND r.recovery_epoch IS DISTINCT FROM ${epoch}
      ORDER BY r.tenant, r.project, r.request LIMIT ${requestsMax} FOR UPDATE`,
  );
  return found.rows;
}

/**
 * Reopens at most `requestsMax` claims the fence condemns, in key order, and
 * drops the lease without reopening where the request has already settled. The
 * claim generation is bumped either way, which is what retires the holder.
 */
async function finalizerReclaim(
  client: pg.PoolClient,
  condemn: (
    client: pg.PoolClient,
    requestsMax: number,
  ) => Promise<readonly CondemnedClaim[]>,
  epoch: RecoveryEpoch,
  requestsMax: number,
): Promise<number> {
  finalizerBounded(requestsMax, "requestsMax");
  if ((await postgresOwnershipEpoch(client)) !== epoch) return 0;
  const condemned = await condemn(client, requestsMax);
  if (condemned.length === 0) return 0;
  const tenants = condemned.map((row) => row.tenant);
  const projects = condemned.map((row) => row.project);
  const requests = condemned.map((row) => row.request);
  const reopened = await client.query(
    sql`UPDATE finalization_request r
        SET state = CASE WHEN r.state = 'Registered' THEN 'Open' ELSE r.state END,
            claim_owner = NULL, claim_expires_at = NULL, recovery_epoch = NULL,
            claim_generation = r.claim_generation + 1
       FROM unnest(${tenants}::text[], ${projects}::text[], ${requests}::text[])
         AS h(tenant, project, request)
      WHERE r.tenant = h.tenant AND r.project = h.project AND r.request = h.request`,
  );
  return reopened.rowCount ?? 0;
}

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

/** Where the approval for the attempt in hand stands, pending until an answer is recorded. */
function finalizerRowApproval(row: ViewRow): ApprovalStanding {
  if (row.approval_state === null) return approvalStandingOf(undefined);
  return approvalStandingOf({
    state: finalizerRowValue(
      allNativeActionStates,
      row.approval_state,
      "action state",
    ),
    ...(row.approval_resolution === null
      ? {}
      : {
          resolution: finalizerRowValue(
            nativeActionResolutions.FinalizationApproval,
            row.approval_resolution,
            "approval answer",
          ),
        }),
  });
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
    sql`SELECT
  f.state, j.lifecycle, b.repository, b.recovery_epoch AS binding_epoch,
  a.attempt, a.target_ref, a.target_commit, a.strategy,
  a.configuration_revision, a.configuration_digest, a.approval_required,
  a.outcome, a.candidate_commit, a.failure_kind, a.attempt_digest,
  p.permit, p.recovery_epoch AS permit_epoch,
  p.lifecycle_generation::text AS lifecycle_generation, p.state AS permit_state,
  r.verdict, r.candidate_commit AS reconciled_candidate,
  r.target_ref AS reconciled_ref, r.observed_commit,
  n.state AS approval_state, n.resolution AS approval_resolution,
  c.made::text AS attempts_made
      FROM finalization_request f
  JOIN project j ON j.tenant = f.tenant AND j.project = f.project
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
  LEFT JOIN native_action n
    ON n.tenant = a.tenant AND n.project = a.project AND n.attempt = a.attempt
  LEFT JOIN LATERAL (
    SELECT count(*) AS made FROM finalization_attempt y
     WHERE y.tenant = f.tenant AND y.project = f.project AND y.request = f.request) c
    ON true
      WHERE f.tenant = ${claim.partition.tenant} AND f.project = ${claim.partition.project}
        AND f.request = ${claim.request}`,
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
    lifecycle: finalizerRowValue(allLifecycles, row.lifecycle, "lifecycle"),
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
    approval: finalizerRowApproval(row),
    ...finalizerRowPermit(row),
    attemptsMade: projectRowCounter(
      finalizerRowPresent(row.attempts_made, "attempts made"),
      "attempts made",
    ),
  };
}

/** Takes the request out of the open set for good, which a project admitting no result leaves behind. */
async function finalizerInvalidate(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<void> {
  await client.query(
    sql`UPDATE finalization_request SET state = 'Invalidated'
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND state IN ('Open', 'Registered')`,
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
  const failure =
    conclusion.outcome === "FinalizationFailed" ? conclusion.kind : null;
  const operation = `finalization-${randomUUID()}`;
  const submitted = await client.query<SubmissionRow>(
    sql`SELECT result, operation FROM submit_finalization_result(
      ${claim.partition.tenant},${claim.partition.project},${claim.request},
      ${offer.attempt},${conclusion.outcome},${failure},
      ${claim.requestGeneration},${claim.recoveryEpoch},${operation},
      ${finalizerRole})`,
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

/** The three moves preparation owns, over the same pool the rest of the authority runs on. */
function postgresFinalizerPreparation(
  pool: pg.Pool,
): FinalizerPreparationStore {
  return {
    handoffGathering: (claim) =>
      postgresTransaction(pool, (client) =>
        finalizerPreparationGathering(client, claim),
      ),
    recordAttempt: (record) =>
      postgresTransaction(pool, (client) =>
        finalizerPreparationRecord(client, record),
      ),
    requestApproval: (ask) =>
      postgresTransaction(pool, (client) =>
        finalizerPreparationApproval(client, ask),
      ),
  };
}

/** The durable finalization authority for one installation, over a finalizer-role pool. */
export function postgresFinalizer(
  pool: pg.Pool,
): FinalizerStore & FinalizerPreparationStore {
  return {
    ...postgresFinalizerPreparation(pool),
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
    grantPermit: (request) =>
      postgresTransaction(pool, (client) =>
        finalizerPermitGrant(client, request),
      ),
    recordReconciliation: (record) =>
      postgresTransaction(pool, (client) =>
        finalizerPermitReconcile(client, record),
      ),
    heldPermits: (epoch, permitsMax) => {
      finalizerBounded(permitsMax, "permitsMax");
      return postgresTransaction(pool, (client) =>
        finalizerPermitHolds(client, epoch, permitsMax),
      );
    },
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
        finalizerReclaim(client, finalizerCondemnedLapsed, epoch, requestsMax),
      ),
    reclaimStaleEpoch: (epoch, requestsMax) =>
      postgresTransaction(pool, (client) =>
        finalizerReclaim(
          client,
          (held, bound) => finalizerCondemnedStaleEpoch(held, epoch, bound),
          epoch,
          requestsMax,
        ),
      ),
  };
}
