/**
 * The registry a member's own runner is known by, its allowlist, and the tokens
 * it is registered with, all over the API's pool.
 *
 * A ROW IS WRITTEN OVER THE CLIENT IT WAS READ WITH. Registering a member who
 * has no runner inserts only where they still have none, and replacing one
 * updates only the row naming the client that was removed, so of two
 * registrations racing for one member exactly one writes and the other is
 * answered `Moved`. Replacing keeps the allowlist; deleting the row takes it.
 *
 * REPLACING FENCES NOTHING YET. No attempt and no session records a personal
 * runner as its holder, so there is nothing an older registration holds; the
 * claim that first records one owes this update the fence a pool's
 * registration takes.
 *
 * AN ALLOWLIST IS BOUNDED AND ADDED TO UNDER THE RUNNER'S ROW LOCK, so two
 * additions racing cannot both see room for one, and a project is added only
 * while it is active.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { personalRunnerProjectsMax } from "../../contract/http.ts";
import {
  personalRunnerTokensLiveMax,
  type PersonalRunnerAllowed,
  type PersonalRunnerKey,
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
import type { WorkerPoolTokenWritten } from "../../interpreter/workerPoolRegistrationToken.ts";
import { postgresTransaction } from "./pool.ts";

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

/** A member's first registration in the tenant, written only where they have no runner and refused where the tenant is no row. */
async function personalRunnerInserted(
  pool: pg.Pool,
  registration: PersonalRunnerRegistration,
): Promise<PersonalRunnerWritten> {
  try {
    const written = await pool.query(
      sql`INSERT INTO personal_runner(tenant,owner,capabilities,principal,client_id)
          VALUES(${registration.tenant as string},${registration.owner as string},${[...registration.capabilities]}::text[],${registration.principal as string},${registration.clientId})
          ON CONFLICT (tenant,owner) DO NOTHING`,
    );
    return (written.rowCount ?? 0) === 1 ? "Registered" : "Moved";
  } catch (failure) {
    if (tenantAbsent(failure, "personal_runner_names_a_tenant"))
      return "NotFound";
    throw failure;
  }
}

/** A member's runner replaced, only where its row still names the client `replacing` is. */
async function personalRunnerReplaced(
  pool: pg.Pool,
  registration: PersonalRunnerRegistration,
  replacing: string,
): Promise<PersonalRunnerWritten> {
  const updated = await pool.query(sql`UPDATE personal_runner r
    SET capabilities=${[...registration.capabilities]}::text[],
        principal=${registration.principal as string},
        client_id=${registration.clientId},
        registered_at=now(),
        last_polled_at=NULL
    WHERE r.tenant=${registration.tenant as string} AND r.owner=${registration.owner as string}
      AND r.client_id=${replacing}`);
  return (updated.rowCount ?? 0) === 1 ? "Registered" : "Moved";
}

/** One addition to a member's allowlist, under their runner's row lock. */
async function personalRunnerProjectInserted(
  client: pg.PoolClient,
  key: PersonalRunnerKey,
  project: ProjectId,
): Promise<PersonalRunnerAllowed> {
  const locked = await client.query<{ owner: string }>(
    sql`SELECT r.owner FROM personal_runner r
      WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}
      FOR UPDATE`,
  );
  if (locked.rows.length === 0) return "NotFound";
  const standing = await client.query<{
    active: boolean;
    held: boolean;
    allowed: number;
  }>(
    sql`SELECT EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=${key.tenant} AND p.project=${project}
            AND p.lifecycle='Active') AS active,
        EXISTS(SELECT 1 FROM personal_runner_project a
          WHERE a.tenant=${key.tenant} AND a.owner=${key.owner}
            AND a.project=${project}) AS held,
        (SELECT count(*)::int FROM personal_runner_project a
          WHERE a.tenant=${key.tenant} AND a.owner=${key.owner}) AS allowed`,
  );
  const row = standing.rows[0];
  if (row === undefined || !row.active) return "NotFound";
  if (row.held) return "Allowed";
  if (row.allowed >= personalRunnerProjectsMax) return "LimitReached";
  await client.query(sql`INSERT INTO personal_runner_project(tenant,owner,project)
    VALUES(${key.tenant as string},${key.owner as string},${project as string})`);
  return "Allowed";
}

export function postgresPersonalRunnerRegistry(
  pool: pg.Pool,
): PersonalRunnerRegistry {
  return {
    clientOf: async (key) => {
      const found = await pool.query<{ client_id: string }>(
        sql`SELECT r.client_id FROM personal_runner r
          WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}`,
      );
      return found.rows[0]?.client_id;
    },
    register: (registration, replacing) =>
      replacing === undefined
        ? personalRunnerInserted(pool, registration)
        : personalRunnerReplaced(pool, registration, replacing),
    deregister: async (key, clientId) => {
      const deleted = await pool.query(sql`DELETE FROM personal_runner r
        WHERE r.tenant=${key.tenant as string} AND r.owner=${key.owner as string}
          AND r.client_id=${clientId}`);
      return (deleted.rowCount ?? 0) === 1;
    },
    runner: async (key) => {
      const found = await pool.query<{
        capabilities: string[];
        registered_at: Date;
        projects: string[] | null;
      }>(sql`SELECT r.capabilities,r.registered_at,
          (SELECT array_agg(a.project ORDER BY a.project)
             FROM personal_runner_project a
            WHERE a.tenant=r.tenant AND a.owner=r.owner) AS projects
        FROM personal_runner r
        WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}`);
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : {
            capabilities: row.capabilities,
            registeredAt: row.registered_at.toISOString(),
            projects: (row.projects ?? []).map(asProjectId),
          };
    },
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
