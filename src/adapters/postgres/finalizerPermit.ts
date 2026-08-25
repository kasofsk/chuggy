/**
 * The two durable transactions that surround the one irreversible act: granting
 * the permit that authorizes it, and recording what the target ref afterwards
 * proved about the candidate it was granted for.
 *
 * THE PERMIT IS GRANTED AND COMMITTED BEFORE THE REF UPDATE IS ATTEMPTED, and
 * abandoned only by a reading that concluded. `model/refinement.qnt` carries the
 * other order as a proved counterexample — the same candidate merged twice with
 * the journal showing one clean completion — so a crash anywhere after this
 * transaction commits leaves a granted permit with no conclusion, which the
 * claim recovery finds and reconciles by ancestry rather than by assumption.
 *
 * NO GIT CALL HAPPENS INSIDE EITHER TRANSACTION. Every function here takes a
 * client and returns; the port that reaches the remote is the caller's and is
 * held nowhere in this file, so the ordering is structural rather than careful.
 *
 * EXCLUSIVITY IS DECIDED UNDER A LOCK AND NOT BY CATCHING A VIOLATION. At most
 * one permit is live per project and `commit_permit_one_live` carries that rule,
 * but a transaction that learned the rule from the index would have to
 * distinguish that violation from every other one after the fact. The finalizer
 * may not lock the project row — a row lock needs write privilege on it and
 * project lifecycle is not the finalizer's to write, the same reason the
 * scheduler locks no cluster — so the serialization is a transaction-scoped
 * advisory lock keyed by the project, and the lifecycle generation read under it
 * is recorded on the permit so a takeover cannot use one granted before it.
 *
 * A PERMIT IS SPENT IN THE TRANSACTION THAT CONCLUDES ITS READING. A granted
 * permit beside a conclusive verdict is contradictory evidence and the pure pass
 * says so, so the reconciliation row and the permit's conclusion commit together
 * or not at all. An unreadable ref writes the row alone and leaves the permit
 * granted, which is the hold: a durable state, and never an absent row.
 *
 * A READING NEEDS NO CLAIM. The permit is the authority for the act and
 * therefore for the reading of it, so a re-reading of a held permit is fenced by
 * the permit's own state and epoch alone. Two processes that both read it record
 * one verdict between them under two rules rather than one: the locked permit
 * must still be `Granted`, and the reconciliation row is written over an earlier
 * one only where that one is `Unreadable`. Neither alone is the mechanism — a
 * held permit stays `Granted` through a settled hold, so it is the row's own
 * conflict rule that refuses the second verdict there.
 *
 * THE GLOBAL LOCK ORDER IS REQUEST, THEN REPOSITORY, THEN PROJECT, THEN PERMIT,
 * THEN ATTEMPT, and within each class in key order. The grant takes the request
 * row, then the project's advisory lock, then the permit; the reading takes the
 * permit alone. Both take one row of each class, so no statement here needs an
 * ordered lock of its own.
 *
 * NOTHING HERE READS A CLOCK. Every timestamp is the server's `now()`, which is
 * the only clock the durable state may depend on.
 */

import { randomUUID } from "node:crypto";
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allCommitPermitStates,
  asCommitPermitId,
  asFinalizationAttemptId,
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type CommitPermit,
  type FinalizationClaim,
  type HeldPermit,
  type PermitGranted,
  type PermitRefusal,
  type PermitRequest,
  type Reconciled,
  type ReconciliationRecord,
} from "../../interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
  type RecoveryEpoch,
} from "../../interpreter/projectStore.ts";
import { postgresOwnershipEpoch } from "./ownership.ts";
import { projectRowCounter } from "./rows.ts";
import { finalizerRowPresent, finalizerRowValue } from "./finalizerRows.ts";

/**
 * The namespace the permit lock is taken in. It is an arbitrary constant whose
 * only requirement is that nothing else in this database uses it.
 */
const finalizerPermitLockNamespace = 0x63687537;

/** The one lifecycle a project may be promoted into, which every other one refuses. */
const promotableLifecycle = "Active";

/** One project's standing as the grant reads it under the lock. */
interface PermitProjectRow {
  readonly lifecycle: string;
  readonly lifecycle_generation: string;
}

/** One permit row, whatever state it is in. */
interface PermitRow {
  readonly permit: string;
  readonly attempt: string;
  readonly recovery_epoch: string;
  readonly lifecycle_generation: string;
  readonly state: string;
}

/**
 * The same row as postgres types it coming back out of the insert that wrote
 * it, where the generation is the parameter's nullability rather than the
 * column's.
 */
interface GrantedPermitRow {
  readonly permit: string;
  readonly attempt: string;
  readonly recovery_epoch: string;
  readonly lifecycle_generation: string | null;
  readonly state: string;
}

/** One permit whose reading could not settle, joined to everything a re-reading needs. */
interface HeldPermitRow {
  readonly tenant: string;
  readonly project: string;
  readonly permit: string;
  readonly repository: string;
  readonly binding_epoch: string;
  readonly target_ref: string;
  readonly candidate_commit: string;
  readonly credential_reference: string | null;
}

/** The refusal a grant answers with, which is a value and never a raised failure. */
function finalizerPermitRefused(refusal: PermitRefusal): PermitGranted {
  return { granted: "Refused", refusal };
}

/** What one stored permit row grants, narrowed to the closed sets the port declares. */
function finalizerPermitOf(row: PermitRow): CommitPermit {
  return {
    permit: asCommitPermitId(row.permit),
    attempt: asFinalizationAttemptId(row.attempt),
    recoveryEpoch: asRecoveryEpoch(row.recovery_epoch),
    lifecycleGeneration: projectRowCounter(
      row.lifecycle_generation,
      "lifecycle generation",
    ),
    state: finalizerRowValue(allCommitPermitStates, row.state, "permit state"),
  };
}

/** Whether the claim that asked for the permit is still the one the request row names. */
async function finalizerPermitClaimStands(
  client: pg.PoolClient,
  claim: FinalizationClaim,
): Promise<boolean> {
  const held = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM finalization_request
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND request = ${claim.request}
        AND claim_owner = ${claim.owner} AND claim_generation = ${claim.claimGeneration}
        AND recovery_epoch = ${claim.recoveryEpoch}
        AND state IN ('Open', 'Registered')
      FOR UPDATE`,
  );
  return held.rowCount === 1;
}

/** The project's standing, read under the advisory lock that serializes grants for it. */
async function finalizerPermitProjectStanding(
  client: pg.PoolClient,
  partition: Partition,
): Promise<PermitProjectRow | undefined> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(
       ${finalizerPermitLockNamespace},
       ('x' || substr(md5(${partition.tenant} || ':' || ${partition.project}), 1, 8))::bit(32)::integer
     )::text AS locked`,
  );
  const found = await client.query<PermitProjectRow>(
    sql`SELECT lifecycle, lifecycle_generation::text AS lifecycle_generation
       FROM project WHERE tenant = ${partition.tenant} AND project = ${partition.project}`,
  );
  return found.rows[0];
}

/** The permit standing for one attempt, in whatever state an earlier grant left it. */
async function finalizerPermitForAttempt(
  client: pg.PoolClient,
  partition: Partition,
  attempt: string,
): Promise<PermitRow | undefined> {
  const found = await client.query<PermitRow>(
    sql`SELECT permit, attempt, recovery_epoch,
            lifecycle_generation::text AS lifecycle_generation, state
       FROM commit_permit
      WHERE tenant = ${partition.tenant} AND project = ${partition.project}
        AND attempt = ${attempt}`,
  );
  return found.rows[0];
}

/** Whether any permit in the project is still the live authority for the one act. */
async function finalizerPermitLiveIn(
  client: pg.PoolClient,
  partition: Partition,
): Promise<boolean> {
  const found = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM commit_permit
      WHERE tenant = ${partition.tenant} AND project = ${partition.project}
        AND state = 'Granted'`,
  );
  return found.rowCount === 1;
}

/** Whether the attempt named is one this request prepared and pinned a candidate for. */
async function finalizerPermitAttemptIsPrepared(
  client: pg.PoolClient,
  claim: FinalizationClaim,
  attempt: string,
): Promise<boolean> {
  const found = await client.query<{ one: number }>(
    sql`SELECT 1 AS one FROM finalization_attempt
      WHERE tenant = ${claim.partition.tenant} AND project = ${claim.partition.project}
        AND attempt = ${attempt} AND request = ${claim.request}
        AND outcome = 'Prepared' AND candidate_commit IS NOT NULL`,
  );
  return found.rowCount === 1;
}

/**
 * Grants the one permit for one prepared attempt, refusing every fence it does
 * not pass. The identity is minted here and never reused, so a retry that
 * reached the remote is found by the permit it already left behind.
 */
export async function finalizerPermitGrant(
  client: pg.PoolClient,
  request: PermitRequest,
): Promise<PermitGranted> {
  const { claim, attempt } = request;
  if ((await postgresOwnershipEpoch(client)) !== claim.recoveryEpoch) {
    return finalizerPermitRefused("Fenced");
  }
  if (!(await finalizerPermitClaimStands(client, claim)))
    return finalizerPermitRefused("Fenced");
  const standing = await finalizerPermitProjectStanding(
    client,
    claim.partition,
  );
  if (standing === undefined || standing.lifecycle !== promotableLifecycle) {
    return finalizerPermitRefused("ProjectClosed");
  }
  const already = await finalizerPermitForAttempt(
    client,
    claim.partition,
    attempt,
  );
  if (already !== undefined) {
    return already.state === "Granted"
      ? { granted: "Permit", permit: finalizerPermitOf(already) }
      : finalizerPermitRefused("PermitSpent");
  }
  if (await finalizerPermitLiveIn(client, claim.partition)) {
    return finalizerPermitRefused("PermitLive");
  }
  if (!(await finalizerPermitAttemptIsPrepared(client, claim, attempt))) {
    return finalizerPermitRefused("AttemptUnprepared");
  }
  const permit = `permit-${randomUUID()}`;
  const granted = await client.query<GrantedPermitRow>(
    sql`INSERT INTO commit_permit
       (tenant, project, permit, attempt, recovery_epoch, lifecycle_generation)
     VALUES (${claim.partition.tenant},${claim.partition.project},${permit},
             ${attempt},${claim.recoveryEpoch},
             ${standing.lifecycle_generation}::bigint)
     RETURNING permit, attempt, recovery_epoch,
               lifecycle_generation::text AS lifecycle_generation, state`,
  );
  const row = granted.rows[0];
  if (row === undefined) {
    throw new Error("postgres finalizer: the permit insert returned no permit");
  }
  return {
    granted: "Permit",
    permit: finalizerPermitOf({
      ...row,
      lifecycle_generation: finalizerRowPresent(
        row.lifecycle_generation,
        "lifecycle generation",
      ),
    }),
  };
}

/** Writes the reading, over an earlier unreadable one where a hold is being settled. */
async function finalizerPermitReadingWritten(
  client: pg.PoolClient,
  record: ReconciliationRecord,
): Promise<boolean> {
  const { partition, reconciliation } = record;
  const written = await client.query(
    sql`INSERT INTO finalization_reconciliation
       (tenant, project, permit, candidate_commit, target_ref, verdict, observed_commit)
     VALUES (${partition.tenant},${partition.project},${reconciliation.permit},
             ${reconciliation.candidate},${reconciliation.target},
             ${reconciliation.verdict},${reconciliation.observed ?? null})
     ON CONFLICT (tenant, project, permit) DO UPDATE
        SET verdict = EXCLUDED.verdict,
            observed_commit = EXCLUDED.observed_commit,
            reconciled_at = now()
      WHERE finalization_reconciliation.verdict = 'Unreadable'`,
  );
  return written.rowCount === 1;
}

/**
 * Records what the target ref proved and spends the permit where the reading
 * concluded. An unreadable ref writes the row and leaves the permit granted,
 * which is the hold the finalization then carries.
 */
export async function finalizerPermitReconcile(
  client: pg.PoolClient,
  record: ReconciliationRecord,
): Promise<Reconciled> {
  const { partition, reconciliation } = record;
  if ((await postgresOwnershipEpoch(client)) !== record.recoveryEpoch) {
    return { recorded: "Refused" };
  }
  const held = await client.query<{ state: string }>(
    sql`SELECT state FROM commit_permit
      WHERE tenant = ${partition.tenant} AND project = ${partition.project}
        AND permit = ${reconciliation.permit} AND recovery_epoch = ${record.recoveryEpoch}
      FOR UPDATE`,
  );
  if (held.rows[0]?.state !== "Granted") return { recorded: "Refused" };
  if (!(await finalizerPermitReadingWritten(client, record))) {
    return { recorded: "Refused" };
  }
  if (reconciliation.verdict === "Unreadable") return { recorded: "Held" };
  const spent = await client.query(
    sql`UPDATE commit_permit SET state = 'Concluded', concluded_at = now()
      WHERE tenant = ${partition.tenant} AND project = ${partition.project}
        AND permit = ${reconciliation.permit} AND state = 'Granted'`,
  );
  if (spent.rowCount !== 1) {
    throw new Error(
      "postgres finalizer: a locked granted permit refused its own conclusion",
    );
  }
  return { recorded: "Concluded" };
}

/**
 * The permits whose readings could not settle, in key order and bounded. This is
 * the hold under attention, and a fresh process finds it here because the row
 * says so rather than because a row is missing.
 */
export async function finalizerPermitHolds(
  client: pg.PoolClient,
  epoch: RecoveryEpoch,
  permitsMax: number,
): Promise<readonly HeldPermit[]> {
  const found = await client.query<HeldPermitRow>(
    sql`SELECT p.tenant, p.project, p.permit, b.repository,
            b.recovery_epoch AS binding_epoch,
            r.target_ref, r.candidate_commit, h.credential_reference
       FROM commit_permit p
       JOIN finalization_attempt a
         ON a.tenant=p.tenant AND a.project=p.project AND a.attempt=p.attempt
       JOIN finalization_reconciliation r
         ON r.tenant = p.tenant AND r.project = p.project AND r.permit = p.permit
       JOIN project_repository b
         ON b.tenant = p.tenant AND b.project = p.project
        AND b.repository = a.repository
       LEFT JOIN finalization_request_configuration h
         ON h.tenant=a.tenant AND h.project=a.project AND h.request=a.request
      WHERE p.state = 'Granted' AND r.verdict = 'Unreadable'
        AND p.recovery_epoch = ${epoch}
      ORDER BY p.tenant, p.project, p.permit LIMIT ${permitsMax}`,
  );
  return found.rows.map((row) => {
    const partition: Partition = {
      tenant: asTenantId(row.tenant),
      project: asProjectId(row.project),
    };
    return {
      partition,
      permit: asCommitPermitId(row.permit),
      repository: {
        partition,
        repository: asRepositoryId(row.repository),
        recoveryEpoch: asRecoveryEpoch(row.binding_epoch),
        ...(row.credential_reference === null
          ? {}
          : { credentialReference: row.credential_reference }),
      },
      target: asGitRefName(row.target_ref),
      candidate: asGitObjectId(row.candidate_commit),
    };
  });
}
