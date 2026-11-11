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
 *
 * THE READ ANSWERS WHAT EACH RUNNER HOLDS AND WHAT WAITS FOR THEM. A runner
 * holds what its registration claimed and is still placing or running, which
 * is the slot its claim counts. What waits in a project is the personal
 * claim's own predicate in `./personalExecutions.ts`, asked for any of the
 * member's runners, with the room a poll names and the slots its runner holds
 * left out, since neither is a fact of the project. That is a third copy of
 * the predicate, and `test/postgres/workerPoolClaim.test.ts` holds it to the
 * claim's answers as it holds the other two.
 */
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  personalRunnerHeldAnsweredMax,
  personalRunnerProjectsMax,
  personalRunnersMax,
  personalRunnerWaitingCountedMax,
} from "../../contract/http.ts";
import {
  personalRunnerPriorities,
  type PersonalRunnerPriority,
} from "../../contract/rosters.ts";
import {
  allRegistrationTokenKinds,
  personalRunnerTokensLiveMax,
  type PersonalRunnerAllowed,
  type PersonalRunnerHeldView,
  type PersonalRunnerKey,
  type PersonalRunnerOwnerView,
  type PersonalRunnerRegistration,
  type PersonalRunnerRegistrationTokens,
  type PersonalRunnerRegistry,
  type PersonalRunnerTokenTerms,
  type PersonalRunnerWritten,
  type RegistrationTokenKind,
} from "../../interpreter/personalRunnerRegistration.ts";
import { asPrincipal, type Principal } from "../../interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type ProjectId,
  type TenantId,
} from "../../interpreter/projectStore.ts";
import { sessionRunnerPolledSecsMax } from "../../interpreter/sessionPlacement.ts";
import {
  workerPoolMemoryMibDefault,
  type PersonalRunnerPlaneRegistry,
} from "../../interpreter/workerPool.ts";
import type { WorkerPoolTokenWritten } from "../../interpreter/workerPoolRegistrationToken.ts";
import { executionIdentity } from "./operationalReads.ts";
import { postgresTransaction } from "./pool.ts";
import { projectRowCounter } from "./rows.ts";
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

/** One addition to a member's allowlist, or its priority written over one already there, under the lock their runners are written under. */
async function personalRunnerProjectInserted(
  client: pg.PoolClient,
  key: PersonalRunnerKey,
  project: ProjectId,
  priority: PersonalRunnerPriority | undefined,
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
  if (row.held) {
    if (priority !== undefined)
      await client.query(sql`UPDATE personal_runner_project a SET priority=${priority}
        WHERE a.tenant=${key.tenant as string} AND a.owner=${key.owner as string}
          AND a.project=${project as string}`);
    return "Allowed";
  }
  if (row.allowed >= personalRunnerProjectsMax) return "LimitReached";
  await client.query(sql`INSERT INTO personal_runner_project(tenant,owner,project,priority)
    VALUES(${key.tenant as string},${key.owner as string},${project as string},
      ${priority ?? "Normal"})`);
  return "Allowed";
}

/** A member's runners, oldest first, each with its newest poll, its newest that could take an execution, the runner its newest poll named and what it holds. */
async function personalRunnersListed(
  pool: pg.Pool,
  key: PersonalRunnerKey,
): Promise<PersonalRunnerOwnerView["runners"]> {
  const held = await personalRunnersHeld(pool, key);
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
      r.last_polled_at AS polled_at,
      r.last_polled_at
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
    ...personalRunnerHeldOf(held.get(row.client_id) ?? []),
  }));
}

/** What one runner holds as its read answers it: as far as its bound, and whether it holds more. */
function personalRunnerHeldOf(
  held: readonly PersonalRunnerHeldView[],
): Pick<PersonalRunnerOwnerView["runners"][number], "held" | "heldTruncated"> {
  return {
    held: held.slice(0, personalRunnerHeldAnsweredMax),
    heldTruncated: held.length > personalRunnerHeldAnsweredMax,
  };
}

/**
 * What each of a member's runners holds, by the client it registered: every
 * attempt its registration claimed that is placing or running, the earliest
 * claimed first, and one past the bound so that holding more is seen.
 */
async function personalRunnersHeld(
  pool: pg.Pool,
  key: PersonalRunnerKey,
): Promise<ReadonlyMap<string, readonly PersonalRunnerHeldView[]>> {
  const found = await pool.query<{
    client_id: string;
    project: string;
    ticket: string;
    task_kind: string;
    cycle: string;
    stage: string | null;
    generation: string | null;
    evaluator: string | null;
  }>(sql`SELECT r.client_id,h.project,h.ticket,h.task_kind,h.cycle,h.stage,h.generation,h.evaluator
    FROM personal_runner r
    CROSS JOIN LATERAL (
      SELECT a.project,e.ticket::text AS ticket,t.kind AS task_kind,t.cycle::text AS cycle,
             t.stage::text AS stage,t.generation::text AS generation,
             t.evaluator::text AS evaluator,a.claimed_at,a.attempt
        FROM execution_attempt a
        JOIN execution e
          ON e.tenant=a.tenant AND e.project=a.project AND e.execution=a.execution
        JOIN execution_request_task t ON t.tenant=e.tenant AND t.project=e.project
         AND t.request=e.source_request AND t.task=e.task
       WHERE a.tenant=r.tenant AND a.personal AND a.pool=r.owner
         AND a.pool_principal=r.principal AND a.state IN ('Placing','Running')
       ORDER BY a.claimed_at,a.project,a.attempt
       LIMIT ${personalRunnerHeldAnsweredMax + 1}) h
    WHERE r.tenant=${key.tenant} AND r.owner=${key.owner}
    ORDER BY r.client_id,h.claimed_at,h.project,h.attempt`);
  const held = new Map<string, PersonalRunnerHeldView[]>();
  for (const row of found.rows) {
    const listed = held.get(row.client_id) ?? [];
    listed.push({
      project: asProjectId(row.project),
      ticket: projectRowCounter(row.ticket, "held attempt ticket"),
      identity: executionIdentity(row),
    });
    held.set(row.client_id, listed);
  }
  return held;
}

/** A priority as its row's CHECK holds it, which a value off the roster is a fault in. */
function personalRunnerPriorityRead(stored: string): PersonalRunnerPriority {
  const priority = personalRunnerPriorities.find((each) => each === stored);
  if (priority === undefined)
    throw new Error(`no personal runner priority is read as ${stored}`);
  return priority;
}

/** A member's runners and the projects they serve, each with what waits in it where `readable` answers it, or nothing where they have none. */
async function personalRunnersRead(
  pool: pg.Pool,
  memoryMibDefault: number,
  key: PersonalRunnerKey,
  readable: (project: ProjectId) => Promise<boolean>,
): Promise<PersonalRunnerOwnerView | undefined> {
  const runners = await personalRunnersListed(pool, key);
  if (runners.length === 0) return undefined;
  const allowed = await pool.query<{ project: string; priority: string }>(
    sql`SELECT a.project,a.priority FROM personal_runner_project a
      WHERE a.tenant=${key.tenant} AND a.owner=${key.owner}
      ORDER BY a.project LIMIT ${personalRunnerProjectsMax}`,
  );
  const read: ProjectId[] = [];
  for (const row of allowed.rows)
    if (await readable(asProjectId(row.project)))
      read.push(asProjectId(row.project));
  const waiting = await personalRunnersWaiting(
    pool,
    memoryMibDefault,
    key,
    read,
  );
  return {
    runners,
    projects: allowed.rows.map((row) => {
      const counted = waiting.get(row.project) ?? 0;
      return {
        project: asProjectId(row.project),
        priority: personalRunnerPriorityRead(row.priority),
        waiting: Math.min(counted, personalRunnerWaitingCountedMax),
        waitingTruncated: counted > personalRunnerWaitingCountedMax,
      };
    }),
  };
}

/**
 * How many attempts in each of `projects` one of the member's runners could
 * take now, by `personalExecutionClaimed`'s predicate with the room and the
 * slots left out, each counted one past the bound so that more is seen.
 */
async function personalRunnersWaiting(
  pool: pg.Pool,
  memoryMibDefault: number,
  key: PersonalRunnerKey,
  projects: readonly ProjectId[],
): Promise<ReadonlyMap<string, number>> {
  if (projects.length === 0) return new Map();
  const found = await pool.query<{ project: string; waiting: number }>(
    sql`SELECT l.project,(SELECT count(*)::int FROM (
        SELECT 1
        FROM execution_attempt q
        JOIN execution x
          ON x.tenant=q.tenant AND x.project=q.project AND x.execution=q.execution
        CROSS JOIN LATERAL agent_account_pause(l.owner,q.agent) held
        WHERE q.tenant=l.tenant AND q.project=l.project
          AND q.state='Placing' AND q.pool IS NULL AND q.invoked
          AND x.placement='Pool' AND x.status='Launching'
          AND x.owner_fallback IS NOT NULL AND x.owner=l.owner
          AND q.recovery_epoch=(SELECT e.epoch FROM recovery_epoch e ORDER BY e.ordinal DESC LIMIT 1)
          AND EXISTS(SELECT 1 FROM personal_runner r
            WHERE r.tenant=l.tenant AND r.owner=l.owner
              AND worker_pool_inventory_matches(x.requirement_value,r.capabilities)
              AND worker_pool_agent_offered(q.agent,r.capabilities,r.agents_advertised)
              AND (r.memory_ceiling_mib IS NULL
                   OR COALESCE(x.memory_mib,${memoryMibDefault}::bigint)<=r.memory_ceiling_mib))
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=q.tenant AND p.project=q.project AND p.lifecycle='Active')
          AND (held.paused_until IS NULL OR held.admitted_by_press)
        LIMIT ${personalRunnerWaitingCountedMax + 1}) w) AS waiting
      FROM personal_runner_project l
      WHERE l.tenant=${key.tenant} AND l.owner=${key.owner}
        AND l.project=ANY(${[...projects] as string[]}::text[])`,
  );
  return new Map(found.rows.map((row) => [row.project, row.waiting]));
}

/** The registry over the API's pool, an execution naming no memory sized at `memoryMibDefault` as the pool plane sizes it. */
export function postgresPersonalRunnerRegistry(
  pool: pg.Pool,
  memoryMibDefault = workerPoolMemoryMibDefault,
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
    runners: (key, readable) =>
      personalRunnersRead(pool, memoryMibDefault, key, readable),
    allow: (key, project, priority) =>
      postgresTransaction(pool, (client) =>
        personalRunnerProjectInserted(client, key, project, priority),
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
  minted_by: string;
  kind: string;
}): PersonalRunnerTokenTerms {
  return {
    tenant: asTenantId(row.tenant),
    mintedBy: asPrincipal(row.minted_by),
    kind: registrationTokenKindOf(row.kind),
  };
}

/** A token's kind as its row keeps it, which its constraint holds to the kinds this code knows. */
function registrationTokenKindOf(kind: string): RegistrationTokenKind {
  const found = allRegistrationTokenKinds.find((known) => known === kind);
  if (found === undefined)
    throw new Error(
      `registration token kind ${kind} is not one this code knows`,
    );
  return found;
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
  expiresAtMs: number,
  mintedBy: Principal,
  kind: RegistrationTokenKind,
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
  await client.query(sql`INSERT INTO personal_runner_registration_token(token_digest,tenant,minted_by,expires_at,kind)
    VALUES(${digest},${tenant as string},${mintedBy as string},to_timestamp(${expiresAtMs}::double precision/1000),${kind})`);
  return "Minted";
}

/** The tokens a member mints and their machine spends; `consume` is the one conditional update that decides single use. */
export function postgresPersonalRunnerRegistrationTokens(
  pool: pg.Pool,
): PersonalRunnerRegistrationTokens {
  return {
    mint: async (tenant, digest, expiresAtMs, mintedBy, kind) => {
      try {
        return await postgresTransaction(pool, (client) =>
          personalRunnerTokenMinted(
            client,
            tenant,
            digest,
            expiresAtMs,
            mintedBy,
            kind,
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
        minted_by: string;
        kind: string;
      }>(sql`SELECT t.tenant,t.minted_by,t.kind
        FROM personal_runner_registration_token t
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()`);
      const row = found.rows[0];
      return row === undefined ? undefined : personalRunnerTokenTerms(row);
    },
    consume: async (digest) => {
      const spent = await pool.query<{
        tenant: string;
        minted_by: string;
        kind: string;
      }>(sql`UPDATE personal_runner_registration_token t SET redeemed_at=now()
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()
        RETURNING t.tenant,t.minted_by,t.kind`);
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
