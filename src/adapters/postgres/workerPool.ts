/**
 * The registry a pool is known by, and the durable side of every assignment a
 * personal runner or a chat host holds, all of them reachable without one line
 * of the ticket machine.
 *
 * NO POOL SECRET IS STORED HERE AT ALL. A row keeps the principal the issuer's
 * subject resolves to, which is a public name rather than a credential. The
 * digest that remains is one attempt bearer's, written by a claim, and the
 * separation is the grant rather than a check any caller could forget: the
 * plane a harness reaches holds no privilege on `worker_pool`, and this one
 * holds none on an outcome.
 *
 * A REGISTERED POOL CLAIMS NOTHING. Its row is still written, listed and read
 * for registration, but the plane admits no poll of it, so nothing here claims,
 * holds, settles or stamps a poll under one. Registering one again still
 * fences what an older registration of its name claimed: the attempt keeps its
 * lease and loses its bearer, so its harness is refused at once and the lapse
 * ends it `Lost`.
 *
 * A CLAIM TAKES AN ATTEMPT THE SCHEDULER OPENED AND DID NOT PLACE. Opening one
 * needs the pinned revision, the briefing and the retry budget, all of which
 * are the scheduler's; what a runner adds is the placement. So the predicate
 * reads `placement = 'Pool'` and an attempt no runner holds yet, and it rebinds
 * `capability_secret_digest` to the bearer the assignment carries — the secret
 * the scheduler minted went to an in-cluster pod that was never launched, and
 * an attempt whose bearer nobody holds is an attempt nothing can report. The
 * attempt waited with no lease, and the claim leases it and stamps
 * `claimed_at`, which is how a reader that may not read `pool` tells a claimed
 * attempt from a waiting one. The claim and every call that holds and settles
 * it are a personal runner's, in `./personalExecutions.ts`.
 *
 * AN ATTEMPT A CLAIM HANDS OUT IS ONE THE SITE ADMITTED. A claim sees an
 * attempt only once its invocation is recorded, and the scheduler records one
 * only after `schedulerPrepare` resolved the execution's profile, which refuses
 * a pinned image for an agent chuggy's runtime does not provide as
 * `ExecutionPolicyDenied`.
 */
import { sql } from "@ts-safeql/sql-tag";
import { createHash } from "node:crypto";
import type pg from "pg";

import { personalRunnersMax } from "../../contract/http.ts";
import {
  workerRunnerCredentialAgents,
  type WorkerPoolCredentialPause,
  type WorkerRunner,
  type WorkerRunnerCredentials,
} from "../../contract/workerPool.ts";
import { asPrincipal, type Principal } from "../../interpreter/principal.ts";
import { asProjectId, type Partition } from "../../interpreter/projectStore.ts";
import { sessionRunnerPolledSecsMax } from "../../interpreter/sessionPlacement.ts";
import {
  workerPoolsAnsweredMax,
  type ChatHostIdentity,
  type PersonalRunnerIdentity,
  type PoolPlaneIdentity,
  type WorkerPoolAssignments,
  type WorkerPoolClaimTerms,
  type WorkerPoolDirectory,
  type WorkerPoolExecutionHolds,
  type WorkerPoolRegistration,
  type WorkerPoolRegistry,
  type WorkerPoolRoster,
  type WorkerPoolRunners,
} from "../../interpreter/workerPool.ts";
import {
  workerPoolTokensLiveMax,
  type WorkerPoolRegistrationTokens,
  type WorkerPoolTokenWritten,
} from "../../interpreter/workerPoolRegistrationToken.ts";
import {
  personalExecutionClaimed,
  personalExecutionCredentialOutcomes,
  personalExecutionWaiting,
  personalExecutionsAllowlisted,
  personalExecutionsPolled,
  postgresPersonalExecutionHolds,
} from "./personalExecutions.ts";
import { postgresTransaction } from "./pool.ts";

/**
 * One mint under the project's bound: the project's mints are serialized on an
 * advisory lock, its expired tokens are swept, and the row is written only
 * where an active project is named and fewer than `workerPoolTokensLiveMax`
 * unspent, unexpired tokens remain. A spent token is left until it expires,
 * because its redemption may still be under way and a fault there gives the
 * token back; the lifetime bound is what bounds how long a spent row stays.
 */
async function workerPoolTokenMinted(
  client: pg.PoolClient,
  partition: Partition,
  digest: string,
  expiresAtMs: number,
  mintedBy: Principal,
): Promise<WorkerPoolTokenWritten> {
  await client.query<{ locked: string | null }>(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(
          'worker-pool-token:' || ${partition.tenant} || '/' || ${partition.project}, 0))::text AS locked`,
  );
  await client.query(sql`DELETE FROM worker_pool_registration_token t
    WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
      AND t.expires_at<=now()`);
  const counted = await client.query<{ active: boolean; live: number }>(
    sql`SELECT EXISTS(SELECT 1 FROM project p
          WHERE p.tenant=${partition.tenant} AND p.project=${partition.project}
            AND p.lifecycle='Active') AS active,
        (SELECT count(*)::int FROM worker_pool_registration_token t
          WHERE t.tenant=${partition.tenant} AND t.project=${partition.project}
            AND t.redeemed_at IS NULL AND t.expires_at>now()) AS live`,
  );
  const row = counted.rows[0];
  if (row === undefined || !row.active) return "NotFound";
  if (row.live >= workerPoolTokensLiveMax) return "LimitReached";
  await client.query(sql`INSERT INTO worker_pool_registration_token(token_digest,tenant,project,expires_at,minted_by)
    VALUES(${digest},${partition.tenant},${partition.project},to_timestamp(${expiresAtMs}::double precision/1000),${mintedBy as string})`);
  return "Minted";
}

/**
 * The tokens an owner mints and a machine spends. `consume` is a conditional
 * update rather than a read and a write, so two machines redeeming one token
 * are separated by the statement and not by this process.
 */
export function postgresWorkerPoolRegistrationTokens(
  pool: pg.Pool,
): WorkerPoolRegistrationTokens {
  return {
    mint: (partition, digest, expiresAtMs, mintedBy) =>
      postgresTransaction(pool, (client) =>
        workerPoolTokenMinted(client, partition, digest, expiresAtMs, mintedBy),
      ),
    consume: async (digest) => {
      const spent = await pool.query<{
        tenant: string;
        project: string;
        minted_by: string | null;
      }>(sql`UPDATE worker_pool_registration_token t SET redeemed_at=now()
        WHERE t.token_digest=${digest} AND t.redeemed_at IS NULL AND t.expires_at>now()
        RETURNING t.tenant,t.project,t.minted_by`);
      const row = spent.rows[0];
      if (row === undefined) return undefined;
      return {
        partition: { tenant: row.tenant, project: row.project } as Partition,
        ...(row.minted_by === null
          ? {}
          : { mintedBy: asPrincipal(row.minted_by) }),
      };
    },
    restore: async (digest) => {
      const restored =
        await pool.query(sql`UPDATE worker_pool_registration_token t SET redeemed_at=NULL
        WHERE t.token_digest=${digest} AND t.expires_at>now()`);
      return (restored.rowCount ?? 0) === 1;
    },
  };
}

/** The digest one attempt bearer is stored as, which is the only secret this module handles. */
function workerPoolDigest(bearer: string): string {
  return createHash("sha256").update(bearer, "utf8").digest("hex");
}

/**
 * Registration is a fresh registration every time, so a re-register re-declares
 * the pool and fences every live attempt an older registration of the name
 * claimed.
 */
async function workerPoolRegistered(
  client: pg.PoolClient,
  registration: WorkerPoolRegistration,
): Promise<boolean> {
  const { partition } = registration;
  await client.query(sql`DELETE FROM worker_pool
    WHERE tenant=${partition.tenant} AND project=${partition.project} AND pool=${registration.pool}`);
  const inserted =
    await client.query(sql`INSERT INTO worker_pool(tenant,project,pool,capabilities,class,principal,client_id,registered_by)
    SELECT ${partition.tenant},${partition.project},${registration.pool},${[...registration.capabilities]}::text[],${registration.class},${registration.principal as string},${registration.clientId},${(registration.registeredBy ?? null) as string | null}
    WHERE EXISTS(SELECT 1 FROM project p
      WHERE p.tenant=${partition.tenant} AND p.project=${partition.project} AND p.lifecycle='Active')`);
  if ((inserted.rowCount ?? 0) !== 1) return false;
  await client.query<{ fenced: string | null }>(
    sql`SELECT fence_worker_pool_attempts(${partition.tenant},${partition.project},${registration.pool})::text AS fenced`,
  );
  return true;
}

export function postgresWorkerPoolRegistry(pool: pg.Pool): WorkerPoolRegistry {
  return {
    register: (registration) =>
      postgresTransaction(pool, (client) =>
        workerPoolRegistered(client, registration),
      ),
    clientOf: async (partition, named) => {
      const found = await pool.query<{ client_id: string }>(
        sql`SELECT w.client_id FROM worker_pool w
        WHERE w.tenant=${partition.tenant} AND w.project=${partition.project} AND w.pool=${named}`,
      );
      return found.rows[0]?.client_id;
    },
    deregister: async (partition, named, clientId) => {
      const deleted = await pool.query(sql`DELETE FROM worker_pool
        WHERE tenant=${partition.tenant} AND project=${partition.project} AND pool=${named}
          AND client_id=${clientId}`);
      return (deleted.rowCount ?? 0) === 1;
    },
    identify: async (principal) => {
      const found = await pool.query<{
        tenant: string;
        project: string;
        pool: string;
        principal: string;
      }>(sql`SELECT w.tenant,w.project,w.pool,w.principal FROM worker_pool w
        WHERE w.principal=${principal}
          AND EXISTS(SELECT 1 FROM project p
            WHERE p.tenant=w.tenant AND p.project=w.project AND p.lifecycle='Active')`);
      const row = found.rows[0];
      return row === undefined
        ? undefined
        : {
            partition: {
              tenant: row.tenant,
              project: row.project,
            } as Partition,
            pool: row.pool,
            principal: asPrincipal(row.principal),
          };
    },
  };
}

/** The runner a row keeps, which its constraints keep whole or absent. */
export function workerPoolRunnerKept(row: {
  readonly runner_package: string | null;
  readonly runner_version: string | null;
}): { readonly runner?: WorkerRunner } {
  return row.runner_package === null || row.runner_version === null
    ? {}
    : {
        runner: { package: row.runner_package, version: row.runner_version },
      };
}

/** A project's registered pools over the API's pool, in name order and read one past the page as the roster's, each live by its newest poll of either kind as a personal runner is. */
export function postgresWorkerPoolDirectory(
  pool: pg.Pool,
): WorkerPoolDirectory {
  return {
    listed: async (partition) => {
      const found = await pool.query<{
        pool: string;
        capabilities: string[];
        registered_at: Date;
        polled_at: Date | null;
        live: boolean | null;
        runner_package: string | null;
        runner_version: string | null;
      }>(sql`SELECT w.pool,w.capabilities,w.registered_at,w.runner_package,w.runner_version,
          greatest(w.last_polled_at,w.executions_polled_at) AS polled_at,
          greatest(w.last_polled_at,w.executions_polled_at)
            > now()-make_interval(secs=>${sessionRunnerPolledSecsMax}::double precision) AS live
        FROM worker_pool w
        WHERE w.tenant=${partition.tenant} AND w.project=${partition.project}
        ORDER BY w.pool LIMIT ${workerPoolsAnsweredMax + 1}`);
      return {
        pools: found.rows.slice(0, workerPoolsAnsweredMax).map((row) => ({
          pool: row.pool,
          capabilities: row.capabilities,
          registeredAt: row.registered_at.toISOString(),
          ...(row.polled_at === null
            ? {}
            : { polledAt: row.polled_at.toISOString() }),
          live: row.live === true,
          ...workerPoolRunnerKept(row),
        })),
        truncated: found.rows.length > workerPoolsAnsweredMax,
      };
    },
  };
}

/** A memory ceiling as its row keeps it, a count the poll's header bounded to what a number holds exactly, or none where no poll named one. */
function workerPoolCeilingRead(kept: string | null): number | undefined {
  return kept === null ? undefined : Number(kept);
}

/** What a chat host's newest poll named, on its row under its current registration, written only where it differs from what is kept. */
async function postgresChatHostNamed(
  pool: pg.Pool,
  identity: ChatHostIdentity,
  kept: {
    readonly named: string | null;
    readonly version: string | null;
    readonly credentialsNamed: string | null;
    readonly hosted: string[] | null;
    readonly ticketWakes: string | null;
  },
): Promise<void> {
  const { named, version, credentialsNamed, hosted, ticketWakes } = kept;
  await pool.query(sql`UPDATE chat_host h
    SET runner_package=${named},runner_version=${version},
        credentials_named=${credentialsNamed}::jsonb,
        session_capabilities=${hosted}::text[],
        ticket_wakes=${ticketWakes}::text
    WHERE h.tenant=${identity.tenant} AND h.owner=${identity.owner}
      AND h.principal=${identity.principal}
      AND (h.runner_package,h.runner_version,h.credentials_named,
           h.session_capabilities,h.ticket_wakes)
        IS DISTINCT FROM (${named}::text,${version}::text,
          ${credentialsNamed}::jsonb,${hosted}::text[],${ticketWakes}::text)`);
}

/**
 * The runner, capabilities and memory ceiling each caller's newest poll named,
 * whether a personal runner's advertises its agents, and the credentials it
 * named, on its own row and under its current
 * registration, written as one statement and only where it differs from what
 * is kept, so a poll that names what it named before writes nothing;
 * capabilities or a ceiling named as none keep what is recorded, and
 * credentials, or a chat host's session capabilities or ticket wakes, named as
 * none clear what is.
 */
export function postgresWorkerPoolRunners(pool: pg.Pool): WorkerPoolRunners {
  return {
    named: async (
      identity,
      runner,
      capabilities,
      memoryCeilingMib,
      agentsAdvertised = false,
      credentials = {},
      sessionCapabilities,
      ticketWakes,
    ) => {
      const named = runner?.package ?? null;
      const version = runner?.version ?? null;
      const advertised = capabilities === undefined ? null : [...capabilities];
      const ceiling = memoryCeilingMib ?? null;
      const credentialsNamed =
        Object.keys(credentials).length === 0
          ? null
          : JSON.stringify(credentials);
      switch (identity.kind) {
        case "Personal":
          await pool.query(sql`UPDATE personal_runner r
            SET runner_package=${named},runner_version=${version},
                capabilities=COALESCE(${advertised}::text[],r.capabilities),
                memory_ceiling_mib=COALESCE(${ceiling}::bigint,r.memory_ceiling_mib),
                agents_advertised=${agentsAdvertised}::boolean,
                credentials_named=${credentialsNamed}::jsonb
            WHERE r.tenant=${identity.tenant} AND r.owner=${identity.owner}
              AND r.principal=${identity.principal}
              AND (r.runner_package,r.runner_version,r.capabilities,r.memory_ceiling_mib,
                   r.agents_advertised,r.credentials_named)
                IS DISTINCT FROM (${named}::text,${version}::text,
                  COALESCE(${advertised}::text[],r.capabilities),
                  COALESCE(${ceiling}::bigint,r.memory_ceiling_mib),
                  ${agentsAdvertised}::boolean,${credentialsNamed}::jsonb)`);
          return;
        case "ChatHost":
          await postgresChatHostNamed(pool, identity, {
            named,
            version,
            credentialsNamed,
            hosted:
              sessionCapabilities === undefined
                ? null
                : [...sessionCapabilities],
            ticketWakes: ticketWakes ?? null,
          });
          return;
      }
    },
  };
}

/**
 * A member's personal runners in the project's tenant over a scheduler-role
 * pool, each with every project its owner's allowlist names.
 */
export function postgresWorkerPoolRoster(pool: pg.Pool): WorkerPoolRoster {
  return {
    personal: async (partition, owner) => {
      const found = await pool.query<{
        principal: string;
        capabilities: string[];
        memory_ceiling_mib: string | null;
        projects: string[] | null;
      }>(sql`SELECT r.principal,r.capabilities,r.memory_ceiling_mib,
          (SELECT array_agg(l.project ORDER BY l.project)
             FROM personal_runner_project l
            WHERE l.tenant=r.tenant AND l.owner=r.owner) AS projects
        FROM personal_runner r
        WHERE r.tenant=${partition.tenant} AND r.owner=${owner}
        ORDER BY r.principal LIMIT ${personalRunnersMax}`);
      return found.rows.map((row) => ({
        owner,
        principal: asPrincipal(row.principal),
        capabilities: row.capabilities,
        memoryCeilingMib: workerPoolCeilingRead(row.memory_ceiling_mib),
        allowlist: (row.projects ?? []).map((project) => ({
          tenant: partition.tenant,
          project: asProjectId(project),
        })),
      }));
    },
  };
}

/** A claim's terms, each a positive whole number and its room a whole number, checked before anything is locked. */
function workerPoolClaimTermsChecked(terms: WorkerPoolClaimTerms): void {
  if (!Number.isSafeInteger(terms.leaseSecs) || terms.leaseSecs < 1)
    throw new RangeError("invalid worker pool lease");
  if (!Number.isSafeInteger(terms.heldMax) || terms.heldMax < 1)
    throw new RangeError("invalid worker pool held bound");
  if (
    !Number.isSafeInteger(terms.memoryMibDefault) ||
    terms.memoryMibDefault < 1
  )
    throw new RangeError("invalid worker pool memory default");
  if (
    terms.memoryRoomMib !== undefined &&
    (!Number.isSafeInteger(terms.memoryRoomMib) || terms.memoryRoomMib < 0)
  )
    throw new RangeError("invalid worker pool memory room");
}

/** A chat host's execution holds, which are none: it never claims an execution, so whatever it names as one is not its own. */
const chatHostExecutionHolds: WorkerPoolExecutionHolds<ChatHostIdentity> = {
  renew: () => Promise.resolve(false),
  refuse: () => Promise.resolve(false),
  release: () => Promise.resolve(false),
  held: () => Promise.resolve(false),
  heldImages: () => Promise.resolve([]),
};

/** The execution holds of whichever side `identity` holds through. */
function executionHoldsRouted<Answer>(
  identity: PoolPlaneIdentity,
  sides: {
    readonly Personal: WorkerPoolExecutionHolds<PersonalRunnerIdentity>;
    readonly ChatHost: WorkerPoolExecutionHolds<ChatHostIdentity>;
  },
  call: <Identity>(
    side: WorkerPoolExecutionHolds<Identity>,
    held: Identity,
  ) => Answer,
): Answer {
  switch (identity.kind) {
    case "Personal":
      return call(sides.Personal, identity);
    case "ChatHost":
      return call(sides.ChatHost, identity);
  }
}

/** Each holding call of a runner or a chat host, routed to the side the caller holds through. */
function postgresExecutionHoldsRouted(
  pool: pg.Pool,
): WorkerPoolExecutionHolds<PoolPlaneIdentity> {
  const sides = {
    Personal: postgresPersonalExecutionHolds(pool),
    ChatHost: chatHostExecutionHolds,
  };
  return {
    renew: (identity, assignment, leaseSecs) =>
      executionHoldsRouted(identity, sides, (side, held) =>
        side.renew(held, assignment, leaseSecs),
      ),
    refuse: (identity, assignment, evidence, fault) =>
      executionHoldsRouted(identity, sides, (side, held) =>
        side.refuse(held, assignment, evidence, fault),
      ),
    release: (identity, assignment) =>
      executionHoldsRouted(identity, sides, (side, held) =>
        side.release(held, assignment),
      ),
    held: (identity, assignment) =>
      executionHoldsRouted(identity, sides, (side, held) =>
        side.held(held, assignment),
      ),
    heldImages: (identity, heldMax) =>
      executionHoldsRouted(identity, sides, (side, held) =>
        side.heldImages(held, heldMax),
      ),
  };
}

/** Each of `credentials` that is paused for the account a caller's work spends, which is its owner's. */
async function workerPoolCredentialPauses(
  pool: pg.Pool,
  identity: PoolPlaneIdentity,
  credentials: WorkerRunnerCredentials,
): Promise<WorkerPoolCredentialPause[]> {
  if (Object.keys(credentials).length === 0) return [];
  return workerPoolCredentialPausesOf(pool, identity.owner, credentials);
}

/**
 * Each of `credentials` that is paused for `account` now, by agent and name,
 * and when that pause ends, in whole Unix seconds rounded up so a runner told
 * it is never early.
 */
async function workerPoolCredentialPausesOf(
  pool: pg.Pool,
  account: Principal,
  credentials: WorkerRunnerCredentials,
): Promise<WorkerPoolCredentialPause[]> {
  const found = await pool.query<{
    agent: string | null;
    credential: string | null;
    paused_until: string;
  }>(
    sql`SELECT n.agent,p.credential,
          ceil(extract(epoch FROM p.paused_until))::bigint::text AS paused_until
        FROM jsonb_each(${JSON.stringify(credentials)}::jsonb) n(agent,names)
        CROSS JOIN LATERAL agent_account_named_credential_pauses(${account},n.agent,
          ARRAY(SELECT jsonb_array_elements_text(n.names))) p
        ORDER BY n.agent,p.credential`,
  );
  return found.rows.map(workerPoolCredentialPauseRow);
}

/** The pause one row of `workerPoolCredentialPausesOf` names. */
function workerPoolCredentialPauseRow(row: {
  readonly agent: string | null;
  readonly credential: string | null;
  readonly paused_until: string;
}): WorkerPoolCredentialPause {
  if (row.credential === null)
    throw new Error("a credential pause names no credential");
  const agent = workerRunnerCredentialAgents.find(
    (known) => known === row.agent,
  );
  if (agent === undefined)
    throw new Error(
      `no credential pause is read of agent ${String(row.agent)}`,
    );
  return {
    agent,
    credential: row.credential,
    pausedUntil: Number(row.paused_until),
  };
}

/** Every caller's assignments behind one port, each holding call routed by who is asking. */
export function postgresWorkerPoolAssignments(
  pool: pg.Pool,
): WorkerPoolAssignments {
  return {
    claimPersonal: async (identity, terms, assignment, bearer, projects) => {
      workerPoolClaimTermsChecked(terms);
      return postgresTransaction(pool, (client) =>
        personalExecutionClaimed(client, identity, terms, {
          assignment,
          digest: workerPoolDigest(bearer),
          projects,
        }),
      );
    },
    waitingPersonal: async (identity, terms, projects) => {
      workerPoolClaimTermsChecked(terms);
      return personalExecutionWaiting(pool, identity, terms, projects);
    },
    allowlisted: (identity) => personalExecutionsAllowlisted(pool, identity),
    credentialOutcomes: (identity, assignments) =>
      personalExecutionCredentialOutcomes(pool, identity, assignments),
    credentialPauses: (identity, credentials) =>
      workerPoolCredentialPauses(pool, identity, credentials),
    polled: (identity, executions, memoryRoomMib) =>
      personalExecutionsPolled(pool, identity, executions, memoryRoomMib),
    ...postgresExecutionHoldsRouted(pool),
  };
}
