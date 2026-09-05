/**
 * The durable session authority the scheduler drives: which sessions want a
 * pod, opening the attempt that becomes one, and every way an attempt ends.
 *
 * EVERY CALL IS ONE SERVER FUNCTION, unlike the execution scheduler beside it,
 * whose pass composes statements inside a transaction of its own. A session
 * attempt has no capacity ledger to serialize against and no execution row to
 * lock in order, so each move is a single fenced boundary and the ordering
 * problem that made the other side a transaction does not arise.
 *
 * NOTHING HERE READS A CLOCK. Every lease, backoff and idle window is a
 * duration handed to the server, which is the only party whose clock the
 * durable state may depend on.
 */

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allSessionTurnFailures,
  asSessionAttemptId,
  asSessionId,
  type AgentSession,
  type SessionTurnFailure,
} from "../../interpreter/agentSession.ts";
import type { RecoveryEpoch } from "../../interpreter/projectStore.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import type { PlacementId } from "../../interpreter/schedulerIdentity.ts";
import type {
  FencedSessionAttempt,
  ObservableSessionAttempt,
  SessionAttemptEvidence,
  SessionAttemptOpened,
  SessionAttemptOpening,
  SessionSchedulerStore,
} from "../../interpreter/sessionScheduler.ts";
import {
  agentSessionRowOf,
  sessionRowMember,
  sessionRowText,
  type AgentSessionRow,
} from "./sessionRows.ts";
import { projectRowCounter } from "./rows.ts";

/** One ended attempt as the cleanup sweep names it. */
interface SessionAttemptRow {
  readonly tenant: string | null;
  readonly project: string | null;
  readonly session: string | null;
  readonly attempt: string | null;
  readonly generation: string | null;
}

function fencedSessionAttemptOf(row: SessionAttemptRow): FencedSessionAttempt {
  return {
    partition: {
      tenant: asTenantId(sessionRowText(row.tenant, "tenant")),
      project: asProjectId(sessionRowText(row.project, "project")),
    },
    session: asSessionId(sessionRowText(row.session, "session")),
    attempt: asSessionAttemptId(sessionRowText(row.attempt, "attempt")),
    generation: projectRowCounter(
      sessionRowText(row.generation, "generation"),
      "session attempt generation",
    ),
  };
}

/** One live attempt as the observation read names it, its last turn's failure and all. */
interface SessionObservationRow extends SessionAttemptRow {
  readonly turn_failure: string | null;
}

function observableSessionAttemptOf(
  row: SessionObservationRow,
): ObservableSessionAttempt {
  return {
    ...fencedSessionAttemptOf(row),
    ...(row.turn_failure === null
      ? {}
      : {
          turnFailure: sessionRowMember<SessionTurnFailure>(
            [...allSessionTurnFailures],
            row.turn_failure,
            "session turn failure",
          ),
        }),
  };
}

/** Refuses a bound no work can be handed out under, naming the argument. */
function sessionRequirePositive(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new RangeError(
      `postgres session scheduler: ${what} is ${String(value)}, and a bound is a positive safe integer`,
    );
}

/** The arm `open_session_attempt` answered, with the fence the opened arm carries. */
function sessionAttemptOpenedOf(
  opening: SessionAttemptOpening,
  opened: string,
  attempt: string | null,
  generation: string | null,
): SessionAttemptOpened {
  switch (opened) {
    case "NotLaunchable":
    case "BackingOff":
    case "AccountAtMaximum":
    case "ClusterFull":
      return { opened };
    case "Opened":
      if (attempt === null || generation === null)
        throw new Error(
          "postgres session scheduler: an opened attempt carried no fence",
        );
      return {
        opened: "Opened",
        attempt: {
          partition: opening.partition,
          session: opening.session,
          attempt: asSessionAttemptId(attempt),
          generation: projectRowCounter(
            generation,
            "session attempt generation",
          ),
        },
      };
    default:
      throw new Error(
        `postgres session scheduler: opening an attempt answered ${String(opened)}`,
      );
  }
}

async function sessionAwaitingPlacement(
  pool: pg.Pool,
  epoch: RecoveryEpoch,
  sessionsMax: number,
): Promise<readonly AgentSession[]> {
  sessionRequirePositive(sessionsMax, "the sessions bound");
  const found = await pool.query<AgentSessionRow>(
    sql`SELECT tenant,project,session,kind,principal,parent_session,agent_reference,
               capabilities,credential_slot,account,cluster,state
          FROM sessions_awaiting_placement(${epoch},${sessionsMax})`,
  );
  return found.rows.map(agentSessionRowOf);
}

async function sessionOpenAttempt(
  pool: pg.Pool,
  opening: SessionAttemptOpening,
): Promise<SessionAttemptOpened> {
  sessionRequirePositive(opening.leaseSecs, "the attempt lease");
  sessionRequirePositive(opening.attemptsPerAccountMax, "the account ceiling");
  sessionRequirePositive(opening.clusterAttemptsMax, "the cluster ceiling");
  const opened = await pool.query<{
    opened: string | null;
    attempt: string | null;
    generation: string | null;
  }>(
    sql`SELECT opened,attempt,generation::text AS generation FROM open_session_attempt(
      ${opening.partition.tenant},${opening.partition.project},${opening.session},
      ${opening.epoch},${opening.attempt},${opening.bearer},${opening.bearerSecretDigest},
      ${opening.leaseSecs},${opening.placementBackoffSecs},
      ${opening.attemptsPerAccountMax},${opening.clusterAttemptsMax})`,
  );
  const row = opened.rows[0];
  if (row === undefined || row.opened === null)
    throw new Error("postgres session scheduler: opening returned no arm");
  return sessionAttemptOpenedOf(
    opening,
    row.opened,
    row.attempt,
    row.generation,
  );
}

async function sessionAwaitingObservation(
  pool: pg.Pool,
  epoch: RecoveryEpoch,
  attemptsMax: number,
): Promise<readonly ObservableSessionAttempt[]> {
  sessionRequirePositive(attemptsMax, "the observation bound");
  const found = await pool.query<SessionObservationRow>(
    sql`SELECT tenant,project,session,attempt,generation::text AS generation,
               turn_failure
          FROM session_attempts_awaiting_observation(${epoch},${attemptsMax})`,
  );
  return found.rows.map(observableSessionAttemptOf);
}

/** How many rows one bounded sweep moved, refusing an answer that is not a count. */
function sessionSweptCount(value: string | null | undefined): number {
  if (value === null || value === undefined)
    throw new Error("postgres session scheduler: a sweep returned no count");
  return projectRowCounter(value, "swept session attempts");
}

/** The session scheduler's durable store, over the scheduler role's own pool. */
export function postgresSessionScheduler(pool: pg.Pool): SessionSchedulerStore {
  return {
    awaitingPlacement: (epoch, sessionsMax) =>
      sessionAwaitingPlacement(pool, epoch, sessionsMax),

    openAttempt: (opening) => sessionOpenAttempt(pool, opening),

    attemptPlaced: async (
      attempt: FencedSessionAttempt,
      placement: PlacementId,
    ) => {
      const placed = await pool.query<{ placed: boolean | null }>(
        sql`SELECT place_session_attempt(
          ${attempt.attempt},${attempt.generation},${placement})::boolean AS placed`,
      );
      return placed.rows[0]?.placed === true;
    },

    attemptEnded: async (
      attempt: FencedSessionAttempt,
      evidence: SessionAttemptEvidence,
    ) => {
      const ended = await pool.query<{ ended: boolean | null }>(
        sql`SELECT end_session_attempt(
          ${attempt.attempt},${attempt.generation},${evidence})::boolean AS ended`,
      );
      return ended.rows[0]?.ended === true;
    },

    attemptsAwaitingObservation: (epoch, attemptsMax) =>
      sessionAwaitingObservation(pool, epoch, attemptsMax),

    reapLapsedAttempts: async (epoch, attemptsMax) => {
      sessionRequirePositive(attemptsMax, "the reap bound");
      const reaped = await pool.query<{ reaped: string | null }>(
        sql`SELECT reap_lapsed_session_attempts(
          ${epoch},${attemptsMax})::text AS reaped`,
      );
      return sessionSweptCount(reaped.rows[0]?.reaped);
    },

    reapIdleAttempts: async (epoch, idleSecsMax, attemptsMax) => {
      sessionRequirePositive(idleSecsMax, "the idle window");
      sessionRequirePositive(attemptsMax, "the reap bound");
      const reaped = await pool.query<{ reaped: string | null }>(
        sql`SELECT reap_idle_session_attempts(
          ${epoch},${idleSecsMax},${attemptsMax})::text AS reaped`,
      );
      return sessionSweptCount(reaped.rows[0]?.reaped);
    },

    fenceOldEpochAttempts: async (epoch, attemptsMax) => {
      sessionRequirePositive(attemptsMax, "the fencing bound");
      const fenced = await pool.query<{ fenced: string | null }>(
        sql`SELECT fence_old_epoch_session_attempts(
          ${epoch},${attemptsMax})::text AS fenced`,
      );
      return sessionSweptCount(fenced.rows[0]?.fenced);
    },

    attemptsAwaitingCleanup: async (attemptsMax) => {
      sessionRequirePositive(attemptsMax, "the cleanup bound");
      const found = await pool.query<SessionAttemptRow>(
        sql`SELECT tenant,project,session,attempt,generation::text AS generation
              FROM session_attempts_awaiting_cleanup(${attemptsMax})`,
      );
      return found.rows.map(fencedSessionAttemptOf);
    },

    attemptCleanupCompleted: async (attempt: FencedSessionAttempt) => {
      const completed = await pool.query<{ completed: boolean | null }>(
        sql`SELECT session_attempt_cleanup_completed(
          ${attempt.attempt},${attempt.generation})::boolean AS completed`,
      );
      return completed.rows[0]?.completed === true;
    },
  };
}
