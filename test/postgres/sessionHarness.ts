/**
 * What every session case needs of a real PostgreSQL: the three stores over the
 * migrated schema, a project to hold sessions, and identities no other case is
 * using.
 *
 * BOUNDS ARE THE CASE'S ARGUMENT AND NOT A FIXTURE'S. A ceiling is a parameter
 * of the boundary being driven, so a case that is about one names it and every
 * other case takes the wide default here — the suites of one worker share a
 * database, and a case asserting that a cluster is full would otherwise be
 * asserting about whatever an earlier suite left running.
 */

import { createHash, randomUUID } from "node:crypto";

import {
  asSessionAttemptId,
  asSessionBearerId,
  asSessionBearerSecret,
  asSessionId,
  asSessionTurnId,
  sessionBearerPrefix,
  type SessionBearerSecret,
  type SessionCapability,
  type SessionId,
  type SessionKind,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import type {
  Partition,
  RecoveryEpoch,
} from "../../src/interpreter/projectStore.ts";
import type {
  FencedSessionAttempt,
  SessionSchedulerStore,
} from "../../src/interpreter/sessionScheduler.ts";
import {
  postgresAgentSessions,
  type AgentSessionStore,
} from "../../src/adapters/postgres/agentSession.ts";
import {
  postgresSessionPlane,
  type SessionPlaneStore,
} from "../../src/adapters/postgres/sessionPlane.ts";
import { postgresSessionScheduler } from "../../src/adapters/postgres/sessionScheduler.ts";
import {
  postgresHarnessOpen,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

/** A ceiling no case reaches, so only the case that names its own is about one. */
export const sessionRigBoundless = 1_000_000;

/** A lease long enough that no case races its own expiry. */
export const sessionRigLeaseSecs = 60;

/** One opened subject: the harness, the three stores over it and the live epoch. */
export interface SessionRig {
  readonly harness: PostgresHarness;
  readonly sessions: AgentSessionStore;
  readonly scheduler: SessionSchedulerStore;
  readonly plane: SessionPlaneStore;
  readonly epoch: RecoveryEpoch;
}

/** One live attempt and the bearer secret only its launcher was given. */
export interface SessionRigAttempt {
  readonly attempt: FencedSessionAttempt;
  readonly secret: SessionBearerSecret;
  readonly digest: string;
}

export async function sessionRigOpen(): Promise<SessionRig> {
  const harness = await postgresHarnessOpen();
  return {
    harness,
    sessions: postgresAgentSessions(harness.pool),
    scheduler: postgresSessionScheduler(harness.pool),
    plane: postgresSessionPlane(harness.pool),
    epoch: await harness.store.currentRecoveryEpoch(),
  };
}

/** A provisioned project no other case is holding. */
export function sessionRigProject(
  rig: SessionRig,
  label: string,
): Promise<Partition> {
  return postgresHarnessProject(rig.harness.store, `session-${label}`);
}

/** What a case opens a session as when it is not about any of these. */
export interface SessionRigOpening {
  readonly kind?: SessionKind;
  readonly principal?: string;
  readonly parent?: SessionId;
  readonly capabilities?: readonly SessionCapability[];
}

/** Opens one session, refusing anything but the arm the case expected. */
export async function sessionRigSession(
  rig: SessionRig,
  partition: Partition,
  label: string,
  opening: SessionRigOpening = {},
): Promise<SessionId> {
  const session = asSessionId(`session-${label}-${randomUUID()}`);
  const opened = await rig.sessions.open({
    partition,
    session,
    kind: opening.kind ?? "Lead",
    principal: asPrincipal(opening.principal ?? `principal-${label}`),
    ...(opening.parent === undefined ? {} : { parent: opening.parent }),
    capabilities: opening.capabilities ?? ["RepositoryRead"],
    credentialSlot: "claude-code",
  });
  if (opened !== "Opened")
    throw new Error(`session rig: opening ${label} answered ${opened}`);
  return session;
}

/** A turn identity no other case is using. */
export function sessionRigTurnId(label: string): SessionTurnId {
  return asSessionTurnId(`turn-${label}-${randomUUID()}`);
}

/** Enqueues one turn, refusing anything but an enqueued one. */
export async function sessionRigTurn(
  rig: SessionRig,
  partition: Partition,
  session: SessionId,
  label: string,
): Promise<SessionTurnId> {
  const turn = sessionRigTurnId(label);
  const enqueued = await rig.sessions.enqueue({
    partition,
    session,
    turn,
    inputKind: "UserMessage",
    input: `ask ${label}`,
  });
  if (enqueued.enqueued !== "Enqueued")
    throw new Error(
      `session rig: enqueuing ${label} answered ${enqueued.enqueued}`,
    );
  return turn;
}

/** A bearer no other case holds, and the digest the durable side keys it by. */
export function sessionRigBearer(): {
  readonly secret: SessionBearerSecret;
  readonly digest: string;
} {
  const secret = asSessionBearerSecret(
    `${sessionBearerPrefix}${randomUUID()}${randomUUID()}`,
  );
  return {
    secret,
    digest: createHash("sha256").update(secret, "utf8").digest("hex"),
  };
}

/** What a case opens an attempt under when it is not about a ceiling. */
export interface SessionRigCeilings {
  readonly attemptsPerAccountMax?: number;
  readonly clusterAttemptsMax?: number;
  readonly placementBackoffSecs?: number;
  readonly leaseSecs?: number;
}

/** Opens the next attempt for a session, refusing anything but an opened one. */
export async function sessionRigAttempt(
  rig: SessionRig,
  partition: Partition,
  session: SessionId,
  label: string,
  ceilings: SessionRigCeilings = {},
): Promise<SessionRigAttempt> {
  const bearer = sessionRigBearer();
  const opened = await rig.scheduler.openAttempt({
    partition,
    session,
    epoch: rig.epoch,
    attempt: asSessionAttemptId(`attempt-${label}-${randomUUID()}`),
    bearer: asSessionBearerId(`bearer-${label}-${randomUUID()}`),
    bearerSecretDigest: bearer.digest,
    leaseSecs: ceilings.leaseSecs ?? sessionRigLeaseSecs,
    placementBackoffSecs: ceilings.placementBackoffSecs ?? 0,
    attemptsPerAccountMax:
      ceilings.attemptsPerAccountMax ?? sessionRigBoundless,
    clusterAttemptsMax: ceilings.clusterAttemptsMax ?? sessionRigBoundless,
  });
  if (opened.opened !== "Opened")
    throw new Error(
      `session rig: opening an attempt answered ${opened.opened}`,
    );
  return {
    attempt: opened.attempt,
    secret: bearer.secret,
    digest: bearer.digest,
  };
}

/** One session's turns as the mailbox holds them, keyed by turn identity. */
export async function sessionRigTurnState(
  rig: SessionRig,
  partition: Partition,
  session: SessionId,
  turn: SessionTurnId,
): Promise<Record<string, unknown>> {
  const rows = await rig.harness.query(
    `SELECT state,attempt,claim_generation::text AS claim_generation,
            attempts_spent::text AS attempts_spent,result,failure,
            batch_first::text AS batch_first,batch_last::text AS batch_last
       FROM session_turn
      WHERE tenant=$1 AND project=$2 AND session=$3 AND turn=$4`,
    [partition.tenant, partition.project, session, turn],
  );
  const row = rows[0];
  if (row === undefined)
    throw new Error(`session rig: no turn ${turn} to read back`);
  return row;
}

/** One attempt row as the durable side holds it, for the columns no port answers. */
export async function sessionRigAttemptState(
  rig: SessionRig,
  attempt: FencedSessionAttempt,
): Promise<Record<string, unknown>> {
  const rows = await rig.harness.query(
    `SELECT state,evidence,generation::text AS generation,placement,
            lease_owner,idle_since IS NULL AS idle_unset,
            ended_at IS NULL AS running,cleanup_completed_at IS NULL AS uncleaned
       FROM session_attempt WHERE attempt=$1`,
    [attempt.attempt],
  );
  const row = rows[0];
  if (row === undefined)
    throw new Error(`session rig: no attempt ${attempt.attempt} to read back`);
  return row;
}
