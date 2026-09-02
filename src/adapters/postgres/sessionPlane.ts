/**
 * The bearer-scoped authority a session pod reaches through the worker plane,
 * and the one answer the API draws from the same bearer. Every port here is
 * `src/interpreter/sessionPlane.ts`'s; this module says how PostgreSQL answers
 * them and declares nothing of its own.
 *
 * THE SECRET IS DIGESTED HERE AND NEVER STORED. Every boundary below is keyed
 * by the SHA-256 of the bearer the pod holds, exactly as the attempt capability
 * is, so the durable side holds a digest and a leak of the database is not a
 * leak of a credential.
 *
 * EVERY CALL IS ONE FENCED BOUNDARY AND THIS FILE JOINS NOTHING TO IT.
 * Liveness, the session being open, the recovery epoch and the attempt's
 * generation are one `SECURITY DEFINER` function's decision; a join written
 * around one would run as the caller, which is a role that holds no privilege
 * on any relation a session lives in.
 */

import { createHash } from "node:crypto";

import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import { sessionStoreStreamsAnswered } from "../../contract/http.ts";
import {
  allSessionKinds,
  allSessionTurnInputKinds,
  asSessionAttemptId,
  asSessionId,
  asSessionStoreStream,
  asSessionTurnId,
  type SessionBearerAuthority,
  type SessionBearerIdentity,
  type SessionBearerSecret,
} from "../../interpreter/agentSession.ts";
import { asPrincipal } from "../../interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type {
  SessionAttemptBindingPort,
  SessionAttemptLossPort,
  SessionHeartbeatPort,
  SessionPlaneAuthority,
  SessionPlaneIdentity,
  SessionReferenceBound,
  SessionReferencePort,
  SessionStoreBatchRow,
  SessionStoreQueryPort,
  SessionStoreRecordPort,
  SessionStoreStreamRow,
  SessionTurnAnswered,
  SessionTurnClaimed,
  SessionTurnClaimPort,
  SessionTurnFailed,
  SessionTurnSettlePort,
} from "../../interpreter/sessionPlane.ts";
import type { SessionStoreRecorded } from "../../interpreter/sessionStore.ts";
import { projectRowCounter } from "./rows.ts";
import {
  sessionRowCapabilities,
  sessionRowMember,
  sessionRowText,
} from "./sessionRows.ts";

/**
 * Everything a session pod may ask of the durable side, which is every port
 * `src/interpreter/sessionPlane.ts` declares.
 */
export type SessionPlaneStore = SessionPlaneAuthority &
  SessionAttemptBindingPort &
  SessionAttemptLossPort &
  SessionHeartbeatPort &
  SessionReferencePort &
  SessionTurnClaimPort &
  SessionTurnSettlePort &
  SessionStoreRecordPort &
  SessionStoreQueryPort;

/** The digest a session bearer is keyed by, which is all the database holds of it. */
function sessionSecretDigest(secret: SessionBearerSecret): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** One `authenticate_session_bearer` or `session_attempt_binding` row. */
interface SessionIdentityRow {
  readonly tenant: string | null;
  readonly project: string | null;
  readonly session: string | null;
  readonly kind: string | null;
  readonly principal: string | null;
}

/** One `read_session_attempt` row, with the liveness the server computed. */
interface SessionAuthorityRow extends SessionIdentityRow {
  readonly attempt: string | null;
  readonly generation: string | null;
  readonly capabilities: string[] | null;
  readonly credential_slot: string | null;
  readonly agent_reference: string | null;
  readonly live: boolean | null;
}

/** One claimed turn as the mailbox hands it back. */
interface ClaimedTurnRow {
  readonly turn: string | null;
  readonly ordinal: string | null;
  readonly input_kind: string | null;
  readonly input: string | null;
}

function sessionPartitionOf(row: SessionIdentityRow): Partition {
  return {
    tenant: asTenantId(sessionRowText(row.tenant, "tenant")),
    project: asProjectId(sessionRowText(row.project, "project")),
  };
}

/** The roster columns a session identity carries, refused when the join lost one. */
function sessionIdentityOf(row: SessionIdentityRow): SessionBearerIdentity {
  return {
    partition: sessionPartitionOf(row),
    session: asSessionId(sessionRowText(row.session, "session")),
    kind: sessionRowMember(allSessionKinds, row.kind, "session kind"),
    principal: asPrincipal(sessionRowText(row.principal, "principal")),
  };
}

function sessionAuthorityOf(row: SessionAuthorityRow): SessionPlaneIdentity {
  return {
    partition: sessionPartitionOf(row),
    session: asSessionId(sessionRowText(row.session, "session")),
    attempt: asSessionAttemptId(sessionRowText(row.attempt, "attempt")),
    generation: projectRowCounter(
      sessionRowText(row.generation, "generation"),
      "session attempt generation",
    ),
    kind: sessionRowMember(allSessionKinds, row.kind, "session kind"),
    capabilities: sessionRowCapabilities(row.capabilities),
    credentialSlot: sessionRowText(row.credential_slot, "credential slot"),
    ...(row.agent_reference === null
      ? {}
      : { agentReference: row.agent_reference }),
    live: row.live === true,
  };
}

/** Narrows one boundary's verdict to the arms it declares, refusing anything else. */
function sessionVerdict<Arm extends string>(
  arms: readonly Arm[],
  value: string | null | undefined,
  what: string,
): Arm {
  const found = arms.find((arm) => arm === value);
  if (found === undefined)
    throw new Error(
      `postgres session plane: ${what} answered ${String(value)}`,
    );
  return found;
}

const referenceArms = [
  "Bound",
  "AlreadyBound",
  "Conflict",
  "Fenced",
] as const satisfies readonly SessionReferenceBound[];

const answerArms = [
  "Answered",
  "AlreadyAnswered",
  "Conflict",
  "Fenced",
] as const satisfies readonly SessionTurnAnswered[];

const failureArms = [
  "Failed",
  "AlreadyFailed",
  "Conflict",
  "Fenced",
] as const satisfies readonly SessionTurnFailed[];

const recordedArms = [
  "Stored",
  "AlreadyStored",
  "OutOfOrder",
  "Conflict",
  "QuotaExceeded",
  "Fenced",
] as const satisfies readonly SessionStoreRecorded[];

async function sessionPlaneAuthenticate(
  pool: pg.Pool,
  secret: SessionBearerSecret,
): Promise<SessionPlaneIdentity | undefined> {
  const found = await pool.query<SessionAuthorityRow>(
    sql`SELECT tenant,project,session,attempt,generation::text AS generation,
               kind,principal,capabilities,credential_slot,agent_reference,live
          FROM read_session_attempt(${sessionSecretDigest(secret)})`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : sessionAuthorityOf(row);
}

async function sessionPlaneBinding(
  pool: pg.Pool,
  secret: SessionBearerSecret,
  generation: number,
): Promise<SessionBearerIdentity | undefined> {
  const found = await pool.query<SessionIdentityRow>(
    sql`SELECT tenant,project,session,kind,principal
          FROM session_attempt_binding(
                 ${sessionSecretDigest(secret)},${generation})`,
  );
  const row = found.rows[0];
  return row === undefined ? undefined : sessionIdentityOf(row);
}

async function sessionPlaneClaim(
  pool: pg.Pool,
  secret: SessionBearerSecret,
  generation: number,
): Promise<SessionTurnClaimed | undefined> {
  const claimed = await pool.query<ClaimedTurnRow>(
    sql`SELECT turn,ordinal::text AS ordinal,input_kind,input
          FROM claim_session_turn(${sessionSecretDigest(secret)},${generation})`,
  );
  const row = claimed.rows[0];
  if (row === undefined) return undefined;
  return {
    turn: asSessionTurnId(sessionRowText(row.turn, "turn")),
    ordinal: projectRowCounter(
      sessionRowText(row.ordinal, "turn ordinal"),
      "session turn ordinal",
    ),
    inputKind: sessionRowMember(
      allSessionTurnInputKinds,
      row.input_kind,
      "session turn input kind",
    ),
    input: sessionRowText(row.input, "turn input"),
  };
}

async function sessionPlaneRead(
  pool: pg.Pool,
  secret: SessionBearerSecret,
  generation: number,
  page: {
    readonly stream: string;
    readonly after: number;
    readonly limit: number;
  },
): Promise<readonly SessionStoreBatchRow[]> {
  const found = await pool.query<{
    batch: string | null;
    digest: string | null;
    bytes: string | null;
  }>(
    sql`SELECT batch::text AS batch,digest,bytes::text AS bytes
          FROM read_session_store(${sessionSecretDigest(secret)},${generation},
            ${page.stream},${page.after},${page.limit})`,
  );
  return found.rows.map((row) => ({
    batch: projectRowCounter(sessionRowText(row.batch, "batch"), "store batch"),
    digest: sessionRowText(row.digest, "batch digest"),
    bytes: projectRowCounter(
      sessionRowText(row.bytes, "batch bytes"),
      "store batch bytes",
    ),
  }));
}

async function sessionPlaneStreams(
  pool: pg.Pool,
  secret: SessionBearerSecret,
  generation: number,
): Promise<readonly SessionStoreStreamRow[]> {
  const found = await pool.query<{
    stream: string | null;
    batches: string | null;
  }>(
    sql`SELECT stream,batches::text AS batches
          FROM list_session_streams(${sessionSecretDigest(secret)},${generation},
            ${sessionStoreStreamsAnswered})`,
  );
  return found.rows.map((row) => ({
    stream: asSessionStoreStream(sessionRowText(row.stream, "stream")),
    batches: projectRowCounter(
      sessionRowText(row.batches, "stream batches"),
      "stream batches",
    ),
  }));
}

async function sessionPlaneAnswer(
  pool: pg.Pool,
  input: Parameters<SessionTurnSettlePort["answer"]>[0],
): Promise<SessionTurnAnswered> {
  const answered = await pool.query<{ answered: string | null }>(
    sql`SELECT answer_session_turn(${sessionSecretDigest(input.secret)},
      ${input.generation},${input.turn},${input.result},
      ${input.batchFirst ?? null},${input.batchLast ?? null})::text AS answered`,
  );
  return sessionVerdict(
    answerArms,
    answered.rows[0]?.answered,
    "answering a turn",
  );
}

async function sessionPlaneFail(
  pool: pg.Pool,
  input: Parameters<SessionTurnSettlePort["fail"]>[0],
): Promise<SessionTurnFailed> {
  const failed = await pool.query<{ failed: string | null }>(
    sql`SELECT fail_session_turn(${sessionSecretDigest(input.secret)},
      ${input.generation},${input.turn},${input.failure})::text AS failed`,
  );
  return sessionVerdict(failureArms, failed.rows[0]?.failed, "failing a turn");
}

async function sessionPlaneRecord(
  pool: pg.Pool,
  input: Parameters<SessionStoreRecordPort["record"]>[0],
): Promise<SessionStoreRecorded> {
  const stored = await pool.query<{ stored: string | null }>(
    sql`SELECT record_session_store_batch(
      ${sessionSecretDigest(input.secret)},${input.generation},
      ${input.stream},${input.batch},${input.digest},
      ${input.bytes},${input.events})::text AS stored`,
  );
  return sessionVerdict(recordedArms, stored.rows[0]?.stored, "a store batch");
}

/** Everything a session pod may ask of the durable side, over the plane's own pool. */
export function postgresSessionPlane(pool: pg.Pool): SessionPlaneStore {
  return {
    authenticate: (secret) => sessionPlaneAuthenticate(pool, secret),

    binding: (input) =>
      sessionPlaneBinding(pool, input.secret, input.generation),

    heartbeat: async (secret, generation, leaseSecs) => {
      const renewed = await pool.query<{ renewed: boolean | null }>(
        sql`SELECT heartbeat_session_attempt(${sessionSecretDigest(secret)},
          ${generation},${leaseSecs})::boolean AS renewed`,
      );
      return renewed.rows[0]?.renewed === true;
    },

    lose: async (secret, generation, evidence) => {
      const lost = await pool.query<{ lost: boolean | null }>(
        sql`SELECT lose_session_attempt(${sessionSecretDigest(secret)},
          ${generation},${evidence})::boolean AS lost`,
      );
      return lost.rows[0]?.lost === true;
    },

    bind: async (input) => {
      const bound = await pool.query<{ bound: string | null }>(
        sql`SELECT bind_session_reference(${sessionSecretDigest(input.secret)},
          ${input.generation},${input.reference})::text AS bound`,
      );
      return sessionVerdict(
        referenceArms,
        bound.rows[0]?.bound,
        "binding a runtime session",
      );
    },

    claim: (input) => sessionPlaneClaim(pool, input.secret, input.generation),

    answer: (input) => sessionPlaneAnswer(pool, input),

    fail: (input) => sessionPlaneFail(pool, input),

    record: (input) => sessionPlaneRecord(pool, input),

    batches: (input) =>
      sessionPlaneRead(pool, input.secret, input.generation, {
        stream: input.stream,
        after: input.after,
        limit: input.limit,
      }),

    streams: (input) =>
      sessionPlaneStreams(pool, input.secret, input.generation),
  };
}

/**
 * The API's side of the same bearer: a principal and the session it acted
 * through, or nothing at all. Nothing means the token is invalid; a raised
 * failure means the authority could not answer, and the two are different
 * statuses on the wire.
 */
export function postgresSessionBearerAuthority(
  pool: pg.Pool,
): SessionBearerAuthority {
  return {
    authenticate: async (secret) => {
      const found = await pool.query<SessionIdentityRow>(
        sql`SELECT tenant,project,session,kind,principal
              FROM authenticate_session_bearer(${sessionSecretDigest(secret)})`,
      );
      const row = found.rows[0];
      return row === undefined ? undefined : sessionIdentityOf(row);
    },
  };
}
