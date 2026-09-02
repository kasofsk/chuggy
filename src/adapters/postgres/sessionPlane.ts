/**
 * The bearer-scoped authority a session pod reaches through the worker plane,
 * and the one answer the API draws from the same bearer.
 *
 * THE SECRET IS DIGESTED HERE AND NEVER STORED. Every boundary below is keyed
 * by the SHA-256 of the bearer the pod holds, exactly as the attempt capability
 * is, so the durable side holds a digest and a leak of the database is not a
 * leak of a credential.
 *
 * EVERY CALL IS FENCED BY THE SERVER, not by this file. Liveness, the session
 * being open, the recovery epoch and the attempt's generation are one boundary
 * function's decision, so an adapter that pre-checked any of them would be a
 * second opinion that can only disagree.
 */

import { createHash } from "node:crypto";

import { nativeHttpPageItemsMax } from "../../contract/http.ts";
import { sql } from "@ts-safeql/sql-tag";
import type pg from "pg";

import {
  allSessionKinds,
  allSessionTurnInputKinds,
  asSessionAttemptId,
  asSessionId,
  asSessionTurnId,
  type SessionAttemptId,
  type SessionBearerAuthority,
  type SessionBearerIdentity,
  type SessionBearerSecret,
  type SessionCapability,
  type SessionTurnFailure,
  type SessionTurnId,
  type SessionTurnInputKind,
} from "../../interpreter/agentSession.ts";
import { asPrincipal } from "../../interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../interpreter/projectStore.ts";
import type { Partition } from "../../interpreter/projectStore.ts";
import type { SessionAttemptEvidence } from "../../interpreter/sessionScheduler.ts";
import type { SessionStoreRecorded } from "../../interpreter/sessionStore.ts";
import { projectRowCounter } from "./rows.ts";
import {
  sessionRowCapabilities,
  sessionRowMember,
  sessionRowText,
} from "./sessionRows.ts";

/** What one live attempt resolves to, and what its own session says it may do. */
export interface SessionAttemptAuthority extends SessionBearerIdentity {
  readonly attempt: SessionAttemptId;
  readonly generation: number;
  readonly capabilities: readonly SessionCapability[];
  readonly credentialSlot: string;
  readonly agentReference?: string;
  readonly live: boolean;
}

/** One turn handed to the pod that claimed it. */
export interface ClaimedSessionTurn {
  readonly turn: SessionTurnId;
  readonly ordinal: number;
  readonly inputKind: SessionTurnInputKind;
  readonly input: string;
}

/** What binding the runtime's own session id answered. */
export type SessionReferenceBound =
  "Bound" | "AlreadyBound" | "Conflict" | "Fenced";

/** What answering one turn answered. */
export type SessionTurnAnswered =
  "Answered" | "AlreadyAnswered" | "Conflict" | "Fenced";

/** What failing one turn answered. */
export type SessionTurnFailed =
  "Failed" | "AlreadyFailed" | "Conflict" | "Fenced";

/** One stored batch as a read of the store names it, without the bytes. */
export interface SessionStoreBatchStanding {
  readonly batch: number;
  readonly digest: string;
  readonly bytes: number;
}

/** One stream of a session's store and how many batches it holds. */
export interface SessionStreamStanding {
  readonly stream: string;
  readonly batches: number;
}

/** What every bearer-scoped call names: the secret the pod holds and its fence. */
export interface SessionPlaneFence {
  readonly secret: SessionBearerSecret;
  readonly gen: number;
}

/** The runtime's own session id, offered once. */
export interface SessionReferenceOffering extends SessionPlaneFence {
  readonly reference: string;
}

/** One answer offered for a claimed turn, with the batches it produced. */
export interface SessionTurnAnswer extends SessionPlaneFence {
  readonly turn: SessionTurnId;
  readonly result: string;
  readonly batchFirst?: number;
  readonly batchLast?: number;
}

/** One claimed turn given up without an answer. */
export interface SessionTurnFailing extends SessionPlaneFence {
  readonly turn: SessionTurnId;
  readonly failure: SessionTurnFailure;
}

/** One batch of one stream offered to the session's store. */
export interface SessionStoreBatchOffering extends SessionPlaneFence {
  readonly stream: string;
  readonly batch: number;
  readonly digest: string;
  readonly bytes: number;
  readonly events: number;
}

/** One page of one stream asked for, bounded by the page the plane may answer. */
export interface SessionStorePage extends SessionPlaneFence {
  readonly stream: string;
  readonly after: number;
  readonly limit: number;
}

/** Every move a session pod may make against the durable side. */
export interface SessionPlaneStore {
  authenticate(
    secret: SessionBearerSecret,
  ): Promise<SessionAttemptAuthority | undefined>;

  /** Who one live bearer resolves to, or nothing where it resolves to nobody. */
  binding(fence: SessionPlaneFence): Promise<SessionBearerIdentity | undefined>;

  heartbeat(
    secret: SessionBearerSecret,
    gen: number,
    leaseSecs: number,
  ): Promise<boolean>;

  /** Ends the attempt the bearer names, which is how a pod gives up its own. */
  lose(
    secret: SessionBearerSecret,
    gen: number,
    evidence: SessionAttemptEvidence,
  ): Promise<boolean>;

  bind(offering: SessionReferenceOffering): Promise<SessionReferenceBound>;

  claim(fence: SessionPlaneFence): Promise<ClaimedSessionTurn | undefined>;

  answer(answer: SessionTurnAnswer): Promise<SessionTurnAnswered>;

  fail(failing: SessionTurnFailing): Promise<SessionTurnFailed>;

  record(offering: SessionStoreBatchOffering): Promise<SessionStoreRecorded>;

  batches(
    page: SessionStorePage,
  ): Promise<readonly SessionStoreBatchStanding[]>;

  /**
   * The streams one session's store holds. `streamsMax` defaults to one past
   * the page the plane may answer with, so a store that overflows is refused
   * rather than silently listed short.
   */
  streams(
    fence: SessionPlaneFence & { readonly streamsMax?: number },
  ): Promise<readonly SessionStreamStanding[]>;
}

/** One row past the page the plane may answer with, which is the listing's own bound. */
const sessionStreamsAnswered = nativeHttpPageItemsMax + 1;

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
  if (row.kind === null || row.principal === null)
    throw new Error("postgres session plane: an identity carried no session");
  return {
    partition: sessionPartitionOf(row),
    session: asSessionId(sessionRowText(row.session, "session")),
    kind: sessionRowMember(allSessionKinds, row.kind, "session kind"),
    principal: asPrincipal(sessionRowText(row.principal, "principal")),
  };
}

function sessionAuthorityOf(row: SessionAuthorityRow): SessionAttemptAuthority {
  return {
    ...sessionIdentityOf(row),
    attempt: asSessionAttemptId(sessionRowText(row.attempt, "attempt")),
    generation: projectRowCounter(
      sessionRowText(row.generation, "generation"),
      "session attempt generation",
    ),
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

async function sessionPlaneAnswer(
  pool: pg.Pool,
  answer: SessionTurnAnswer,
): Promise<SessionTurnAnswered> {
  const answered = await pool.query<{ answered: string | null }>(
    sql`SELECT answer_session_turn(
      ${sessionSecretDigest(answer.secret)},${answer.gen},${answer.turn},
      ${answer.result},${answer.batchFirst ?? null},
      ${answer.batchLast ?? null})::text AS answered`,
  );
  return sessionVerdict(
    answerArms,
    answered.rows[0]?.answered,
    "answering a turn",
  );
}

async function sessionPlaneRecord(
  pool: pg.Pool,
  offering: SessionStoreBatchOffering,
): Promise<SessionStoreRecorded> {
  const stored = await pool.query<{ stored: string | null }>(
    sql`SELECT record_session_store_batch(
      ${sessionSecretDigest(offering.secret)},${offering.gen},
      ${offering.stream},${offering.batch},${offering.digest},
      ${offering.bytes},${offering.events})::text AS stored`,
  );
  return sessionVerdict(recordedArms, stored.rows[0]?.stored, "a store batch");
}

async function sessionPlaneClaim(
  pool: pg.Pool,
  secret: SessionBearerSecret,
  generation: number,
): Promise<ClaimedSessionTurn | undefined> {
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

async function sessionPlaneAuthenticate(
  pool: pg.Pool,
  secret: SessionBearerSecret,
): Promise<SessionAttemptAuthority | undefined> {
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

async function sessionPlaneRead(
  pool: pg.Pool,
  secret: SessionBearerSecret,
  generation: number,
  stream: string,
  page: { readonly after: number; readonly limit: number },
): Promise<readonly SessionStoreBatchStanding[]> {
  const found = await pool.query<{
    batch: string | null;
    digest: string | null;
    bytes: string | null;
  }>(
    sql`SELECT batch::text AS batch,digest,bytes::text AS bytes
          FROM read_session_store(${sessionSecretDigest(secret)},${generation},
            ${stream},${page.after},${page.limit})`,
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
  streamsMax: number,
): Promise<readonly SessionStreamStanding[]> {
  const found = await pool.query<{
    stream: string | null;
    batches: string | null;
  }>(
    sql`SELECT stream,batches::text AS batches
          FROM list_session_streams(
            ${sessionSecretDigest(secret)},${generation},${streamsMax})`,
  );
  return found.rows.map((row) => ({
    stream: sessionRowText(row.stream, "stream"),
    batches: projectRowCounter(
      sessionRowText(row.batches, "stream batches"),
      "stream batches",
    ),
  }));
}

/** Everything a session pod may ask of the durable side, over the plane's own pool. */
export function postgresSessionPlane(pool: pg.Pool): SessionPlaneStore {
  return {
    authenticate: (secret) => sessionPlaneAuthenticate(pool, secret),

    binding: (fence) => sessionPlaneBinding(pool, fence.secret, fence.gen),

    heartbeat: async (secret, gen, leaseSecs) => {
      const renewed = await pool.query<{ renewed: boolean | null }>(
        sql`SELECT heartbeat_session_attempt(${sessionSecretDigest(secret)},
          ${gen},${leaseSecs})::boolean AS renewed`,
      );
      return renewed.rows[0]?.renewed === true;
    },

    lose: async (secret, gen, evidence) => {
      const lost = await pool.query<{ lost: boolean | null }>(
        sql`SELECT lose_session_attempt(${sessionSecretDigest(secret)},
          ${gen},${evidence})::boolean AS lost`,
      );
      return lost.rows[0]?.lost === true;
    },

    bind: async (offering) => {
      const bound = await pool.query<{ bound: string | null }>(
        sql`SELECT bind_session_reference(${sessionSecretDigest(offering.secret)},
          ${offering.gen},${offering.reference})::text AS bound`,
      );
      return sessionVerdict(
        referenceArms,
        bound.rows[0]?.bound,
        "binding a runtime session",
      );
    },

    claim: (fence) => sessionPlaneClaim(pool, fence.secret, fence.gen),

    answer: (answer) => sessionPlaneAnswer(pool, answer),

    fail: async (failing) => {
      const failed = await pool.query<{ failed: string | null }>(
        sql`SELECT fail_session_turn(${sessionSecretDigest(failing.secret)},
          ${failing.gen},${failing.turn},${failing.failure})::text AS failed`,
      );
      return sessionVerdict(
        failureArms,
        failed.rows[0]?.failed,
        "failing a turn",
      );
    },

    record: (offering) => sessionPlaneRecord(pool, offering),

    batches: (page) =>
      sessionPlaneRead(pool, page.secret, page.gen, page.stream, {
        after: page.after,
        limit: page.limit,
      }),

    streams: (fence) =>
      sessionPlaneStreams(
        pool,
        fence.secret,
        fence.gen,
        fence.streamsMax ?? sessionStreamsAnswered,
      ),
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
