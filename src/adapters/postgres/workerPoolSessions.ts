/**
 * PostgreSQL side of a pool-held session: the launch the scheduler publishes,
 * and the definer functions the pool plane claims, renews and settles a
 * session attempt through. The pool plane holds no privilege on a session
 * relation, so every move here is one of 033's functions, scoped as an
 * execution's assignment is to the registration that claimed it.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";
import { z } from "zod";

import { sessionTaskDocumentSchema } from "../../contract/workerTask.ts";
import {
  allSessionKinds,
  asSessionId,
} from "../../interpreter/agentSession.ts";
import { asRepositoryId } from "../../interpreter/finalizer.ts";
import type { RuntimePrecondition } from "../../interpreter/serviceRuntime.ts";
import type { WorkerPoolIdentity } from "../../interpreter/workerPoolIdentity.ts";
import type {
  SessionLaunchFacts,
  WorkerPoolSessionCandidate,
  WorkerPoolSessionOpened,
  WorkerPoolSessions,
} from "../../interpreter/workerPoolSessions.ts";
import { projectRowCounter } from "./rows.ts";
import {
  sessionRowCapabilities,
  sessionRowMember,
  sessionRowText,
} from "./sessionRows.ts";

/** Publishes what this scheduler launches a session with, before its loop reads anything, so a pool's claim launches the same. */
export function postgresSessionLaunchPrecondition(
  pool: pg.Pool,
  launch: SessionLaunchFacts,
): RuntimePrecondition {
  return {
    name: "session-launch-published",
    check: async (signal) => {
      signal.throwIfAborted();
      await pool.query(
        sql`INSERT INTO session_launch
              (singleton,image,authority,mirrors,bounds,model,deadline_secs,
               backoff_secs,published_at)
            VALUES (1,${launch.image},${JSON.stringify(launch.authority)}::jsonb,
                    ${JSON.stringify(launch.mirrors)}::jsonb,
                    ${JSON.stringify(launch.bounds)}::jsonb,${launch.model},
                    ${launch.deadlineSecs},${launch.placementBackoffSecs},now())
            ON CONFLICT (singleton) DO UPDATE
              SET image=EXCLUDED.image,authority=EXCLUDED.authority,
                  mirrors=EXCLUDED.mirrors,bounds=EXCLUDED.bounds,
                  model=EXCLUDED.model,deadline_secs=EXCLUDED.deadline_secs,
                  backoff_secs=EXCLUDED.backoff_secs,
                  published_at=EXCLUDED.published_at`,
      );
      signal.throwIfAborted();
      return { met: "Met" };
    },
  };
}

/** The published launch's documents, held to the shapes a session's task names them in. */
const sessionLaunchDocumentsSchema = z.strictObject({
  authority: sessionTaskDocumentSchema.shape.authority,
  mirrors: z.record(z.string(), z.string()),
  bounds: sessionTaskDocumentSchema.shape.bounds,
});

async function sessionLaunch(
  pool: pg.Pool,
): Promise<SessionLaunchFacts | undefined> {
  const found = await pool.query<{
    image: string;
    authority: unknown;
    mirrors: unknown;
    bounds: unknown;
    model: string;
    deadline_secs: string;
    backoff_secs: string;
  }>(
    sql`SELECT image,authority,mirrors,bounds,model,
               deadline_secs::text AS deadline_secs,
               backoff_secs::text AS backoff_secs
          FROM session_launch WHERE singleton=1`,
  );
  const row = found.rows[0];
  if (row === undefined) return undefined;
  const documents = sessionLaunchDocumentsSchema.parse({
    authority: row.authority,
    mirrors: row.mirrors,
    bounds: row.bounds,
  });
  return {
    image: row.image,
    authority: documents.authority,
    mirrors: Object.fromEntries(
      Object.entries(documents.mirrors).map(([bound, mirror]) => [
        asRepositoryId(bound),
        asRepositoryId(mirror),
      ]),
    ),
    bounds: documents.bounds,
    model: row.model,
    deadlineSecs: projectRowCounter(
      row.deadline_secs,
      "session launch deadline",
    ),
    placementBackoffSecs: projectRowCounter(
      row.backoff_secs,
      "session launch backoff",
    ),
  };
}

/** A bound a statement is asked with, refused before anything is locked. */
function workerPoolSessionBound(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new RangeError(`invalid pool session ${what}`);
  return value;
}

async function sessionsAmong(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  assignments: readonly string[],
): Promise<ReadonlySet<string>> {
  if (assignments.length === 0) return new Set();
  const found = await pool.query<{ assignment: string | null }>(
    sql`SELECT a AS assignment FROM pool_session_assignments(
          ${identity.partition.tenant},${identity.partition.project},
          ${identity.pool},${identity.principal},${[...assignments]}::text[]) AS a`,
  );
  return new Set(
    found.rows.flatMap((row) =>
      row.assignment === null ? [] : [row.assignment],
    ),
  );
}

async function sessionsAwaiting(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  backoffSecs: number,
  max: number,
): Promise<readonly WorkerPoolSessionCandidate[]> {
  const found = await pool.query<{
    session: string | null;
    kind: string | null;
    capabilities: string[] | null;
    agent_reference: string | null;
  }>(
    sql`SELECT session,kind,capabilities,agent_reference
          FROM pool_sessions_awaiting_claim(
            ${identity.partition.tenant},${identity.partition.project},
            ${identity.pool},${identity.principal},${backoffSecs},
            ${workerPoolSessionBound(max, "claim bound")})`,
  );
  return found.rows.map((row) => ({
    session: asSessionId(sessionRowText(row.session, "session")),
    kind: sessionRowMember(allSessionKinds, row.kind, "session kind"),
    capabilities: sessionRowCapabilities(row.capabilities),
    ...(row.agent_reference === null
      ? {}
      : { agentReference: row.agent_reference }),
  }));
}

const sessionOpenedArms = ["Opened", "NotClaimable", "PoolFull"] as const;

async function sessionOpened(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  opening: Parameters<WorkerPoolSessions["open"]>[1],
): Promise<WorkerPoolSessionOpened> {
  const { candidate } = opening;
  const opened = await pool.query<{ opened: string | null }>(
    sql`SELECT open_pool_session_attempt(
          ${identity.partition.tenant},${identity.partition.project},
          ${identity.pool},${identity.principal},${candidate.session},
          ${[...candidate.capabilities]}::text[],
          ${candidate.agentReference ?? null}::text,
          ${opening.attempt},${opening.assignment},${opening.bearer},
          ${opening.bearerSecretDigest},
          ${workerPoolSessionBound(opening.leaseSecs, "lease")},
          ${opening.placementBackoffSecs},
          ${workerPoolSessionBound(opening.heldMax, "held bound")},
          ${JSON.stringify(opening.invocation)}::jsonb,${opening.image},
          ${JSON.stringify(opening.launch)}::jsonb)::text AS opened`,
  );
  return sessionRowMember(
    sessionOpenedArms,
    opened.rows[0]?.opened ?? null,
    "pool session opening",
  );
}

/** One of the boolean doors a held assignment is renewed, held, refused or released through. */
function sessionAnswered(
  found: pg.QueryResult<{ answered: boolean | null }>,
): boolean {
  return found.rows[0]?.answered === true;
}

async function sessionHeldImages(
  pool: pg.Pool,
  identity: WorkerPoolIdentity,
  max: number,
): Promise<readonly string[]> {
  const found = await pool.query<{ image: string | null }>(
    sql`SELECT i AS image FROM pool_session_images(
          ${identity.partition.tenant},${identity.partition.project},
          ${identity.pool},${identity.principal},
          ${workerPoolSessionBound(max, "held bound")}) AS i`,
  );
  return found.rows.flatMap((row) => (row.image === null ? [] : [row.image]));
}

export function postgresWorkerPoolSessions(pool: pg.Pool): WorkerPoolSessions {
  return {
    launch: () => sessionLaunch(pool),
    among: (identity, assignments) =>
      sessionsAmong(pool, identity, assignments),
    awaiting: (identity, backoffSecs, max) =>
      sessionsAwaiting(pool, identity, backoffSecs, max),
    open: (identity, opening) => sessionOpened(pool, identity, opening),
    renew: async (identity, assignment, leaseSecs) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT renew_pool_session_attempt(
                ${identity.partition.tenant},${identity.partition.project},
                ${identity.pool},${identity.principal},${assignment},
                ${workerPoolSessionBound(leaseSecs, "lease")})::boolean AS answered`,
        ),
      ),
    held: async (identity, assignment) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT pool_session_attempt_held(
                ${identity.partition.tenant},${identity.partition.project},
                ${identity.pool},${identity.principal},${assignment})::boolean AS answered`,
        ),
      ),
    refuse: async (identity, assignment, evidence) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT refuse_pool_session_attempt(
                ${identity.partition.tenant},${identity.partition.project},
                ${identity.pool},${identity.principal},${assignment},
                ${evidence})::boolean AS answered`,
        ),
      ),
    release: async (identity, assignment) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT release_pool_session_attempt(
                ${identity.partition.tenant},${identity.partition.project},
                ${identity.pool},${identity.principal},${assignment})::boolean AS answered`,
        ),
      ),
    heldImages: (identity, max) => sessionHeldImages(pool, identity, max),
    polled: async (identity) => {
      await pool.query(
        sql`UPDATE worker_pool w SET last_polled_at=now()
              WHERE w.tenant=${identity.partition.tenant}
                AND w.project=${identity.partition.project}
                AND w.pool=${identity.pool}
                AND w.principal=${identity.principal}`,
      );
    },
  };
}
