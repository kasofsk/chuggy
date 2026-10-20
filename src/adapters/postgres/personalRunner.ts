/**
 * The registry a member's own runners are known by, their allowlist, and the
 * tokens they are registered with, all over the API's pool.
 *
 * A MEMBER'S RUNNERS ARE WRITTEN UNDER ONE LOCK. Registering one, removing one
 * and adding to their allowlist each take an advisory lock per member and
 * tenant, so a registration counts the member's runners against
 * `personalRunnersMax` with no other registration between its count and its
 * row, and an allowlist is added to only while the member has a runner and is
 * deleted with the last of them.
 *
 * REMOVING A RUNNER FENCES WHAT IT HELD. A session or execution attempt it
 * claimed records its owner and the principal that claimed, so the delete
 * ends, in the same transaction, every live attempt whose principal is none
 * of the owner's runners now; what another of their runners holds stands.
 *
 * AN ALLOWLIST IS BOUNDED, so two additions racing under the lock cannot both
 * see room for one, and a project is added only while it is active.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  personalRunnerProjectsMax,
  personalRunnersMax,
} from "../../contract/http.ts";
import {
  personalRunnerTokensLiveMax,
  type PersonalRunnerAllowed,
  type PersonalRunnerKey,
  type PersonalRunnerOwnerView,
  type PersonalRunnerRegistration,
  type PersonalRunnerRegistrationTokens,
  type PersonalRunnerRegistry,
  type PersonalRunnerTokenTerms,
  type PersonalRunnerWritten,
} from "../../interpreter/personalRunnerRegistration.ts";
import { asPrincipal, type Principal } from "../../interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type ProjectId,
  type TenantId,
} from "../../interpreter/projectStore.ts";
import { sessionRunnerPolledSecsMax } from "../../interpreter/sessionPlacement.ts";
import type { PersonalRunnerPlaneRegistry } from "../../interpreter/workerPool.ts";
import type { WorkerPoolTokenWritten } from "../../interpreter/workerPoolRegistrationToken.ts";
import { postgresTransaction } from "./pool.ts";
import { workerPoolRunnerKept } from "./workerPool.ts";

/** Whether `failure` is `constraint` refusing a row whose tenant is not a row. */
function tenantAbsent(failure: unknown, constraint: string): boolean {
  return (
    typeof failure === "object" &&
    failure !== null &&
    "code" in failure &&
    failure.code === foreignKeyViolation &&
    "constraint" in failure &&
    failure.constraint === constraint
  );
}

const foreignKeyViolation = "23503";

/** The lock every write to one member's runners or their allowlist takes, held to the end of its transaction. */
async function personalRunnerLocked(
  client: pg.PoolClient,
  key: PersonalRunnerKey,
): Promise<void> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'personal-runner-registry:' || ${key.tenant} || '/' || ${key.owner}, 0))::text AS locked`,
  );
}

/** One more runner of the member's, written only while they hold fewer than their bound. */
async function personalRunnerInserted(
  client: pg.PoolClient,
  registration: PersonalRunnerRegistration,
): Promise<PersonalRunnerWritten> {
  await personalRunnerLocked(client, registration);
  const counted = await client.query<{ held: number }>(
    sql`SELECT count(*)::int AS held FROM personal_runner r
        WHERE r.tenant=${registration.tenant} AND r.owner=${registration.owner}`,
  );
  if ((counted.rows[0]?.held ?? 0) >= personalRunnersMax) return "LimitReached";
  await client.query(
    sql`INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
        VALUES(${registration.tenant as string},${registration.owner as string},${[...registration.capabilities]}::text[],${registration.principal as string},${registration.clientId})`,
  );
  return "Registered";
}

/** A runner registered, or the tenant answered absent where it is no row. */
async function personalRunnerRegistered(
  pool: pg.Pool,
  registration: PersonalRunnerRegistration,
): Promise<PersonalRunnerWritten> {
  try {
    return await postgresTransaction(pool, (client) =>
      personalRunnerInserted(client, registration),
    );
  } catch (failure) {
    if (tenantAbsent(failure, "personal_runner_names_a_tenant"))
      return "NotFound";
    throw failure;
  }
}

/**
 * The member's runner naming `clientId` deleted, what it held fenced, and their
 * allowlist deleted where it was the last of their runners.
 */
async function personalRunnerDeleted(
  client: pg.PoolClient,
  key: PersonalRunnerKey,
  clientId: string,
): Promise<boolean> {
  await personalRunnerLocked(client, key);
  const deleted = await client.query(sql`DELETE FROM personal_runner r
    WHERE r.tenant=${key.tenant as string} AND r.owner=${key.owner as string}
      AND r.client_id=${clientId}`);
  if ((deleted.rowCount ?? 0) !== 1) return false;
  await client.query<{ fenced: string | null }>(
    sql`SELECT fence_personal_runner_attempts(${key.tenant},${key.owner})::text AS fenced`,
  );
  await client.query(sql`DELETE FROM personal_runner_project a
    WHERE a.tenant=${key.tenant as string} AND a.owner=${key.owner as string}
      AND NOT EXISTS(SELECT 1 FROM personal_runner r
        WHERE r.tenant=a.tenant AND r.owner=a.owner)`);
  return true;
}

/** One addition to a member's allowlist, under the lock their runners are written under. */
async function personalRunnerProjectInserted(
  client: pg.PoolClient,
  key: PersonalRunnerKey,
  project: ProjectId,
): Promise<PersonalRunnerAllowed> {
  await personalRunnerLocked(client, key);
  const standing = await client.query<{
    registered: boolean;
    active: boolean;
    held: boolean;
    allowed: number;
  }>(
    sql`SELECT EXISTS(SELECT 1 FROM personal_runner r
          WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}) AS registered,
        EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=${key.tenant} AND p.project=${project}
            AND p.lifecycle='Active') AS active,
        EXISTS(SELECT 1 FROM personal_runner_project a
          WHERE a.tenant=${key.tenant} AND a.owner=${key.owner}
            AND a.project=${project}) AS held,
        (SELECT count(*)::int FROM personal_runner_project a
          WHERE a.tenant=${key.tenant} AND a.owner=${key.owner}) AS allowed`,
  );
  const row = standing.rows[0];
  if (row === undefined || !row.registered || !row.active) return "NotFound";
  if (row.held) return "Allowed";
  if (row.allowed >= personalRunnerProjectsMax) return "LimitReached";
  await client.query(sql`INSERT INTO personal_runner_project(tenant,owner,project)
    VALUES(${key.tenant as string},${key.owner as string},${project as string})`);
  return "Allowed";
}

/** A member's runners, oldest first, each with its newest poll of either kind and the runner that poll named. */
async function personalRunnersListed(
  pool: pg.Pool,
  key: PersonalRunnerKey,
): Promise<PersonalRunnerOwnerView["runners"]> {
  const found = await pool.query<{
    client_id: string;
    capabilities: string[];
    registered_at: Date;
    polled_at: Date | null;
    live: boolean | null;
    executions_live: boolean | null;
    runner_package: string | null;
    runner_version: string | null;
  }>(sql`SELECT r.client_id,r.capabilities,r.registered_at,r.runner_package,r.runner_version,
      greatest(r.last_polled_at,r.executions_polled_at) AS polled_at,
      greatest(r.last_polled_at,r.executions_polled_at)
        > now()-make_interval(secs=>${sessionRunnerPolledSecsMax}::double precision) AS live,
      r.executions_polled_at
        > now()-make_interval(secs=>${sessionRunnerPolledSecsMax}::double precision) AS executions_live
    FROM personal_runner r
    WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}
    ORDER BY r.registered_at,r.client_id LIMIT ${personalRunnersMax}`);
  return found.rows.map((row) => ({
    id: row.client_id,
    capabilities: row.capabilities,
    registeredAt: row.registered_at.toISOString(),
    ...(row.polled_at === null
      ? {}
      : { polledAt: row.polled_at.toISOString() }),
    live: row.live === true,
    executionsLive: row.executions_live === true,
    ...workerPoolRunnerKept(row),
  }));
}

/** A member's runners and the projects they serve, or nothing where they have none. */
async function personalRunnersRead(
  pool: pg.Pool,
  key: PersonalRunnerKey,
): Promise<PersonalRunnerOwnerView | undefined> {
  const runners = await personalRunnersListed(pool, key);
  if (runners.length === 0) return undefined;
  const allowed = await pool.query<{ project: string }>(
    sql`SELECT a.project FROM personal_runner_project a
      WHERE a.tenant=${key.tenant} AND a.owner=${key.owner}
      ORDER BY a.project LIMIT ${personalRunnerProjectsMax}`,
  );
  return {
    runners,
    projects: allowed.rows.map((row) => asProjectId(row.project)),
  };
}

export function postgresPersonalRunnerRegistry(
  pool: pg.Pool,
): PersonalRunnerRegistry {
  return {
    clientsOf: async (key) => {
      const found = await pool.query<{ client_id: string }>(
        sql`SELECT r.client_id FROM personal_runner r
          WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}
          ORDER BY r.registered_at,r.client_id LIMIT ${personalRunnersMax}`,
      );
      return found.rows.map((row) => row.client_id);
    },
    register: (registration) => personalRunnerRegistered(pool, registration),
    deregister: (key, clientId) =>
      postgresTransaction(pool, (client) =>
        personalRunnerDeleted(client, key, clientId),
      ),
    runners: (key) => personalRunnersRead(pool, key),
    allow: (key, project) =>
      postgresTransaction(pool, (client) =>
        personalRunnerProjectInserted(client, key, project),
      ),
    disallow: async (key, project) => {
      const found = await pool.query<{ registered: boolean }>(
        sql`WITH removed AS (
              DELETE FROM personal_runner_project a
               WHERE a.tenant=${key.tenant} AND a.owner=${key.owner}
                 AND a.project=${project}
              RETURNING 1 AS one)
            SELECT EXISTS(SELECT 1 FROM personal_runner r
              WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}) AS registered`,
      );
      return found.rows[0]?.registered === true;
    },
  };
}

/** The personal runner a poll's principal resolves to, read over the pool plane's pool. */
export function postgresPersonalRunnerPlaneRegistry(
  pool: pg.Pool,
): PersonalRunnerPlaneRegistry {
  return {
    identify: async (principal) => {
      const found = await pool.query<{
        tenant: string;
        owner: string;
        principal: string;
      }>(sql`SELECT r.tenant,r.owner,r.principal FROM personal_runner r
        WHERE r.principal=${principal}`);
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : {
            tenant: asTenantId(row.tenant),
            owner: asPrincipal(row.owner),
            principal: asPrincipal(row.principal),
          };
    },
  };
}

/** One personal token's terms as every statement returns them. */
function personalRunnerTokenTerms(row: {
  tenant: string;
  capabilities: string[];
  minted_by: string;
}): PersonalRunnerTokenTerms {
  return {
    tenant: asTenantId(row.tenant),
    capabilities: row.capabilities,
    mintedBy: asPrincipal(row.minted_by),
  };
}

/**
 * One mint under the member's bound in the tenant, serialized on an advisory
 * lock per member and tenant, sweeping that member's expired tokens, and
 * refused by its foreign key where the tenant is no row. A spent token stays until it expires,
 * as a pool token does, because its redemption may still give it back.
 */
async function personalRunnerTokenMinted(
  client: pg.PoolClient,
  tenant: TenantId,
  digest: string,
  capabilities: readonly string[],
  expiresAtMs: number,
  mintedBy: Principal,
): Promise<WorkerPoolTokenWritten> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'personal-runner-token:' || ${tenant} || '/' || ${mintedBy}, 0))::text AS locked`,
  );
  await client.query(sql`DELETE FROM personal_runner_registration_token t
    WHERE t.tenant=${tenant as string} AND t.minted_by=${mintedBy as string}
      AND t.expires_at<=now()`);
  const counted = await client.query<{ live: number }>(
    sql`SELECT count(*)::int AS live FROM personal_runner_registration_token t
        WHERE t.tenant=${tenant} AND t.minted_by=${mintedBy}
          AND t.redeemed_at IS NULL AND t.expires_at>now()`,
  );
  if ((counted.rows[0]?.live ?? 0) >= personalRunnerTokensLiveMax)
    return "LimitReached";
  await client.query(sql`INSERT INTO personal_runner_registration_token(token_digest,tenant,minted_by,capabilities,expires_at)
    VALUES(${digest},${tenant as string},${mintedBy as string},${[...capabilities]}::text[],to_timestamp(${expiresAtMs}::double precision/1000))`);
  return "Minted";
}

/** The tokens a member mints and their machine spends; `consume` is the one conditional update that decides single use. */
export function postgresPersonalRunnerRegistrationTokens(
  pool: pg.Pool,
): PersonalRunnerRegistrationTokens {
  return {
    mint: async (tenant, digest, capabilities, expiresAtMs, mintedBy) => {
      try {
        return await postgresTransaction(pool, (client) =>
          personalRunnerTokenMinted(
            client,
            tenant,
            digest,
            capabilities,
            expiresAtMs,
            mintedBy,
          ),
        );
      } catch (failure) {
        if (
          tenantAbsent(
            failure,
            "personal_runner_registration_token_names_a_tenant",
          )
        )
          return "NotFound";
        throw failure;
      }
    },
    permitted: async (digest) => {
      const found = await pool.query<{
        tenant: string;
        capabilities: string[];
        minted_by: string;
      }>(sql`SELECT t.tenant,t.capabilities,t.minted_by
        FROM personal_runner_registration_token t
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()`);
      const row = found.rows[0];
      return row === undefined ? undefined : personalRunnerTokenTerms(row);
    },
    consume: async (digest) => {
      const spent = await pool.query<{
        tenant: string;
        capabilities: string[];
        minted_by: string;
      }>(sql`UPDATE personal_runner_registration_token t SET redeemed_at=now()
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()
        RETURNING t.tenant,t.capabilities,t.minted_by`);
      const row = spent.rows[0];
      return row === undefined ? undefined : personalRunnerTokenTerms(row);
    },
    restore: async (digest) => {
      const restored =
        await pool.query(sql`UPDATE personal_runner_registration_token t SET redeemed_at=NULL
        WHERE t.token_digest=${digest} AND t.expires_at>now()`);
      return (restored.rowCount ?? 0) === 1;
    },
  };
}
