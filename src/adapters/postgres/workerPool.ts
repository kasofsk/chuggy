/**
 * The durable side of every assignment a personal runner or a chat host holds,
 * all of it reachable without one line of the ticket machine.
 *
 * NO RUNNER SECRET IS STORED HERE AT ALL. The digest this module writes is one
 * attempt bearer's, written by a claim.
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
import { asProjectId } from "../../interpreter/projectStore.ts";
import type {
  ChatHostIdentity,
  PersonalRunnerIdentity,
  PoolPlaneIdentity,
  WorkerPoolAssignments,
  WorkerPoolClaimTerms,
  WorkerPoolExecutionHolds,
  WorkerPoolRoster,
  WorkerPoolRunners,
} from "../../interpreter/workerPool.ts";
import {
  personalExecutionClaimed,
  personalExecutionCredentialOutcomes,
  personalExecutionWaiting,
  personalExecutionsAllowlisted,
  personalExecutionsPolled,
  postgresPersonalExecutionHolds,
} from "./personalExecutions.ts";
import { postgresTransaction } from "./pool.ts";

/** The digest one attempt bearer is stored as, which is the only secret this module handles. */
function workerPoolDigest(bearer: string): string {
  return createHash("sha256").update(bearer, "utf8").digest("hex");
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
