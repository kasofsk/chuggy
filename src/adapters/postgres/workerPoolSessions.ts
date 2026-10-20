/**
 * PostgreSQL side of a runner-held session: the launch the scheduler publishes,
 * and the definer functions the pool plane claims, renews and settles a
 * session attempt through. The pool plane holds no privilege on a session
 * relation, so every move here is a definer function, scoped as an
 * execution's assignment is to the registration that claimed it: a pool's by
 * its project and name, and a personal runner's by its tenant, its owner and
 * its principal.
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
import { asProjectId } from "../../interpreter/projectStore.ts";
import type {
  PersonalRunnerIdentity,
  PoolPlaneIdentity,
  WorkerPoolIdentity,
} from "../../interpreter/workerPoolIdentity.ts";
import type {
  SessionLaunchFacts,
  WorkerPoolSessionCandidate,
  WorkerPoolSessionOpened,
  WorkerPoolSessionOpening,
  WorkerPoolSessionRows,
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

/** The assignments among `found` a statement answered, its nulls dropped. */
function sessionAssignmentsAnswered(
  found: pg.QueryResult<{ assignment: string | null }>,
): ReadonlySet<string> {
  return new Set(
    found.rows.flatMap((row) =>
      row.assignment === null ? [] : [row.assignment],
    ),
  );
}

/** The candidates a statement read as waiting, each in the project it names. */
function sessionCandidatesOf(
  rows: readonly {
    project: string | null;
    session: string | null;
    kind: string | null;
    capabilities: string[] | null;
    agent_reference: string | null;
  }[],
): readonly WorkerPoolSessionCandidate[] {
  return rows.map((row) => ({
    project: asProjectId(sessionRowText(row.project, "project")),
    session: asSessionId(sessionRowText(row.session, "session")),
    kind: sessionRowMember(allSessionKinds, row.kind, "session kind"),
    capabilities: sessionRowCapabilities(row.capabilities),
    ...(row.agent_reference === null
      ? {}
      : { agentReference: row.agent_reference }),
  }));
}

/** What either side opens an attempt with beyond who claims it, each bound refused before anything is locked. */
function sessionOpeningTerms(opening: WorkerPoolSessionOpening): {
  readonly capabilities: string[];
  readonly agentReference: string | null;
  readonly leaseSecs: number;
  readonly heldMax: number;
  readonly invocation: string;
  readonly launch: string;
} {
  return {
    capabilities: [...opening.candidate.capabilities],
    agentReference: opening.candidate.agentReference ?? null,
    leaseSecs: workerPoolSessionBound(opening.leaseSecs, "lease"),
    heldMax: workerPoolSessionBound(opening.heldMax, "held bound"),
    invocation: JSON.stringify(opening.invocation),
    launch: JSON.stringify(opening.launch),
  };
}

const sessionOpenedArms = ["Opened", "NotClaimable", "PoolFull"] as const;

function sessionOpenedOf(
  opened: pg.QueryResult<{ opened: string | null }>,
): WorkerPoolSessionOpened {
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

/** The images a statement answered, its nulls dropped. */
function sessionImagesOf(
  found: pg.QueryResult<{ image: string | null }>,
): readonly string[] {
  return found.rows.flatMap((row) => (row.image === null ? [] : [row.image]));
}

/** The calls a poll claims a session through. */
type SessionClaimRows<Identity> = Pick<
  WorkerPoolSessionRows<Identity>,
  "among" | "awaiting" | "open"
>;

/** The calls a poll holds and settles a claimed session through. */
type SessionHoldRows<Identity> = Omit<
  WorkerPoolSessionRows<Identity>,
  keyof SessionClaimRows<Identity>
>;

/** A pool's claims: every call keyed by its project, its name and the registration that claimed. */
function postgresPoolSessionClaims(
  pool: pg.Pool,
): SessionClaimRows<WorkerPoolIdentity> {
  return {
    among: async (identity, assignments) =>
      assignments.length === 0
        ? new Set()
        : sessionAssignmentsAnswered(
            await pool.query<{ assignment: string | null }>(
              sql`SELECT a AS assignment FROM pool_session_assignments(
                    ${identity.partition.tenant},${identity.partition.project},
                    ${identity.pool},${identity.principal},${[...assignments]}::text[]) AS a`,
            ),
          ),
    awaiting: async (identity, backoffSecs, max) =>
      sessionCandidatesOf(
        (
          await pool.query<{
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
          )
        ).rows.map((row) => ({
          ...row,
          project: identity.partition.project,
        })),
      ),
    open: async (identity, opening) => {
      const { candidate } = opening;
      const terms = sessionOpeningTerms(opening);
      return sessionOpenedOf(
        await pool.query<{ opened: string | null }>(
          sql`SELECT open_pool_session_attempt(
                ${identity.partition.tenant},${identity.partition.project},
                ${identity.pool},${identity.principal},${candidate.session},
                ${terms.capabilities}::text[],${terms.agentReference}::text,
                ${opening.attempt},${opening.assignment},${opening.bearer},
                ${opening.bearerSecretDigest},${terms.leaseSecs},
                ${opening.placementBackoffSecs},${terms.heldMax},
                ${terms.invocation}::jsonb,${opening.image},
                ${terms.launch}::jsonb)::text AS opened`,
        ),
      );
    },
  };
}

/** What a pool holds, through the registration that claimed it. */
function postgresPoolSessionHolds(
  pool: pg.Pool,
): SessionHoldRows<WorkerPoolIdentity> {
  return {
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
    heldImages: async (identity, max) =>
      sessionImagesOf(
        await pool.query<{ image: string | null }>(
          sql`SELECT i AS image FROM pool_session_images(
                ${identity.partition.tenant},${identity.partition.project},
                ${identity.pool},${identity.principal},
                ${workerPoolSessionBound(max, "held bound")}) AS i`,
        ),
      ),
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

/** A personal runner's claims: every call keyed by its tenant, its owner and the registration that claimed, across its projects. */
function postgresPersonalSessionClaims(
  pool: pg.Pool,
): SessionClaimRows<PersonalRunnerIdentity> {
  return {
    among: async (identity, assignments) =>
      assignments.length === 0
        ? new Set()
        : sessionAssignmentsAnswered(
            await pool.query<{ assignment: string | null }>(
              sql`SELECT a AS assignment FROM personal_session_assignments(
                    ${identity.tenant},${identity.owner},${identity.principal},
                    ${[...assignments]}::text[]) AS a`,
            ),
          ),
    awaiting: async (identity, backoffSecs, max) =>
      sessionCandidatesOf(
        (
          await pool.query<{
            project: string | null;
            session: string | null;
            kind: string | null;
            capabilities: string[] | null;
            agent_reference: string | null;
          }>(
            sql`SELECT project,session,kind,capabilities,agent_reference
                  FROM personal_sessions_awaiting_claim(
                    ${identity.tenant},${identity.owner},${identity.principal},
                    ${backoffSecs},${workerPoolSessionBound(max, "claim bound")})`,
          )
        ).rows,
      ),
    open: async (identity, opening) => {
      const { candidate } = opening;
      const terms = sessionOpeningTerms(opening);
      return sessionOpenedOf(
        await pool.query<{ opened: string | null }>(
          sql`SELECT open_personal_session_attempt(
                ${identity.tenant},${identity.owner},${identity.principal},
                ${candidate.project},${candidate.session},
                ${terms.capabilities}::text[],${terms.agentReference}::text,
                ${opening.attempt},${opening.assignment},${opening.bearer},
                ${opening.bearerSecretDigest},${terms.leaseSecs},
                ${opening.placementBackoffSecs},${terms.heldMax},
                ${terms.invocation}::jsonb,${opening.image},
                ${terms.launch}::jsonb)::text AS opened`,
        ),
      );
    },
  };
}

/** What a personal runner holds, through the registration that claimed it. */
function postgresPersonalSessionHolds(
  pool: pg.Pool,
): SessionHoldRows<PersonalRunnerIdentity> {
  return {
    renew: async (identity, assignment, leaseSecs) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT renew_personal_session_attempt(
                ${identity.tenant},${identity.owner},${identity.principal},
                ${assignment},
                ${workerPoolSessionBound(leaseSecs, "lease")})::boolean AS answered`,
        ),
      ),
    held: async (identity, assignment) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT personal_session_attempt_held(
                ${identity.tenant},${identity.owner},${identity.principal},
                ${assignment})::boolean AS answered`,
        ),
      ),
    refuse: async (identity, assignment, evidence) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT refuse_personal_session_attempt(
                ${identity.tenant},${identity.owner},${identity.principal},
                ${assignment},${evidence})::boolean AS answered`,
        ),
      ),
    release: async (identity, assignment) =>
      sessionAnswered(
        await pool.query<{ answered: boolean | null }>(
          sql`SELECT release_personal_session_attempt(
                ${identity.tenant},${identity.owner},${identity.principal},
                ${assignment})::boolean AS answered`,
        ),
      ),
    heldImages: async (identity, max) =>
      sessionImagesOf(
        await pool.query<{ image: string | null }>(
          sql`SELECT i AS image FROM personal_session_images(
                ${identity.tenant},${identity.owner},${identity.principal},
                ${workerPoolSessionBound(max, "held bound")}) AS i`,
        ),
      ),
    polled: async (identity) => {
      await pool.query(
        sql`UPDATE personal_runner r SET last_polled_at=now()
              WHERE r.tenant=${identity.tenant} AND r.owner=${identity.owner}
                AND r.principal=${identity.principal}`,
      );
    },
  };
}

/** The answer of whichever side `identity` is held through. */
function sessionsRouted<Answer>(
  identity: PoolPlaneIdentity,
  pooled: (identity: WorkerPoolIdentity) => Answer,
  personal: (identity: PersonalRunnerIdentity) => Answer,
): Answer {
  switch (identity.kind) {
    case "Dedicated":
      return pooled(identity);
    case "Personal":
      return personal(identity);
  }
}

/** Both callers' sides behind one port, each call routed by who is asking. */
export function postgresWorkerPoolSessions(pool: pg.Pool): WorkerPoolSessions {
  const pools = {
    ...postgresPoolSessionClaims(pool),
    ...postgresPoolSessionHolds(pool),
  };
  const personal = {
    ...postgresPersonalSessionClaims(pool),
    ...postgresPersonalSessionHolds(pool),
  };
  return {
    launch: () => sessionLaunch(pool),
    among: (identity, assignments) =>
      sessionsRouted(
        identity,
        (held) => pools.among(held, assignments),
        (held) => personal.among(held, assignments),
      ),
    awaiting: (identity, backoffSecs, max) =>
      sessionsRouted(
        identity,
        (held) => pools.awaiting(held, backoffSecs, max),
        (held) => personal.awaiting(held, backoffSecs, max),
      ),
    open: (identity, opening) =>
      sessionsRouted(
        identity,
        (held) => pools.open(held, opening),
        (held) => personal.open(held, opening),
      ),
    renew: (identity, assignment, leaseSecs) =>
      sessionsRouted(
        identity,
        (held) => pools.renew(held, assignment, leaseSecs),
        (held) => personal.renew(held, assignment, leaseSecs),
      ),
    held: (identity, assignment) =>
      sessionsRouted(
        identity,
        (held) => pools.held(held, assignment),
        (held) => personal.held(held, assignment),
      ),
    refuse: (identity, assignment, evidence) =>
      sessionsRouted(
        identity,
        (held) => pools.refuse(held, assignment, evidence),
        (held) => personal.refuse(held, assignment, evidence),
      ),
    release: (identity, assignment) =>
      sessionsRouted(
        identity,
        (held) => pools.release(held, assignment),
        (held) => personal.release(held, assignment),
      ),
    heldImages: (identity, max) =>
      sessionsRouted(
        identity,
        (held) => pools.heldImages(held, max),
        (held) => personal.heldImages(held, max),
      ),
    polled: (identity) =>
      sessionsRouted(
        identity,
        (held) => pools.polled(held),
        (held) => personal.polled(held),
      ),
  };
}
