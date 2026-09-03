/**
 * The session scheduler service: what one bounded pass does between a session
 * with a queued turn and a pod holding that turn.
 *
 * EVERY PASS IS BOUNDED AND EVERY STEP IS A DURABLE MOVE, exactly as the
 * execution pass is: a pass fences, cleans up, reaps and places at most its
 * configured count and returns, and the loop that calls it again is a
 * deployment's. Nothing retries in place, because a retry that outlives a
 * process is a row rather than a loop.
 *
 * A PASS FENCES BEFORE IT MOVES ANYTHING ELSE. After a takeover the previous
 * epoch's session pods may still be running, and one still holds a bearer it
 * could claim and answer turns under. Fencing first is what makes the rest of
 * the pass safe to run at all, and it is idempotent, so a pass with nothing
 * left to fence fences nothing.
 *
 * AN IDLE SESSION COSTS NO POD. A session is the truth and its pod is a cache,
 * so an attempt that has claimed nothing for `idleSecsMax` is ended and its pod
 * deleted; the next turn opens a new attempt, and the runtime session it
 * resumes is the one the store holds. That reaping is what makes the whole
 * arrangement affordable, and it is bounded like every other step.
 *
 * THE TWO INABILITIES ARE KEPT APART, which is why the placement port answers
 * with three arms rather than a boolean — but a session has no execution to
 * retire, so a denial ends the attempt with `PlacementDenied` rather than
 * blocking anything, and the placement backoff the durable side applies is what
 * keeps a site that will never admit this pod from being asked every pass.
 *
 * THE BEARER IS MINTED OUTSIDE AND THE DIGEST IS WHAT IS STORED. The launcher
 * needs the secret and the durable row must never hold one, so the identity and
 * the bearer are drawn through a port: this layer takes its identifiers as
 * arguments like every other pure module here.
 *
 * NOTHING HERE READS A CLOCK. The lease, the placement backoff and the idle
 * horizon are durations handed to the store, which asks the database what time
 * it is; `eslint.config.js` says so for this directory.
 *
 * THE REPOSITORY IS RESOLVED PER SESSION AND A PROJECT THAT BINDS NONE IS
 * PLACED ANYWAY. Which repository a session reads is the project's own binding
 * rather than the site's policy, so it is read here, once per placement — per
 * *placement*, not per tenant: the binding is a project fact, one page of
 * `awaitingPlacement` routinely carries several projects of one tenant, and a
 * session handed another project's reference would clone another project's
 * tree and `cwd` its model into it. Two placements carry no checkout: one whose
 * project binds no repository, and one whose ROSTER DOES NOT READ ONE — an
 * inquiry holds the project's reads alone, and cloning a tree it may not open
 * is a cost per question with no consequence. Either way the session reads the
 * project through the API and has no tree. A binding read that *fails* stops
 * the pass instead, because placing every session with no checkout is how a
 * missing grant would look, and a control that degrades silently is one nobody
 * can tell from a working one.
 *
 * THAT READ NEEDS A GRANT THIS TREE DOES NOT YET CARRY. The pass runs as
 * `chuggy_scheduler`, and every `GRANT EXECUTE ON FUNCTION
 * read_project_repository_binding` in the ledger names some other role;
 * slice 3's migration 061 adds the scheduler's. Until it lands, the first
 * placement of every deployment raises `permission denied` and — by the
 * paragraph above — stops the session half of the pass.
 * `test/postgres/sessionPrivileges.test.ts` asserts the grant and is what says
 * when this is no longer true. It is read BEFORE the attempt is opened for that
 * reason: the read depends on nothing an attempt produces, and a raise after
 * `openAttempt` would leave an opened, unplaced attempt that nothing cancels
 * and that costs a whole lease window to reap — once per pass, per deployment,
 * for as long as the grant is missing. It reads for a session whose attempt is
 * then refused, which the older order did not; that is one definer call per
 * refused session per pass, and simplicity over performance takes it.
 */

import type { AgentSession, SessionAttemptId } from "./agentSession.ts";
import type { RecoveryEpoch } from "./projectStore.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import {
  checkedSessionSchedulerConfig,
  type FencedSessionAttempt,
  type SessionBearer,
  type SessionPlacementPort,
  type SessionPolicy,
  type SessionSchedulerConfig,
  type SessionSchedulerStore,
} from "./sessionScheduler.ts";

/** One attempt identity, its bearer, and the digest the durable row keeps of the secret. */
export interface SessionAttemptMinted {
  readonly attempt: SessionAttemptId;
  readonly bearer: SessionBearer;
  readonly bearerSecretDigest: string;
}

/** Where an attempt's identity and its bearer are drawn, since this layer draws nothing. */
export interface SessionAttemptMint {
  mint(): SessionAttemptMinted;
}

/** Everything a session pass calls out through, and the bounds it works within. */
export interface SessionSchedulerService {
  readonly store: SessionSchedulerStore;
  readonly placement: SessionPlacementPort;
  readonly bearers: SessionAttemptMint;
  readonly policy: SessionPolicy;
  /** Where the repository a placed session reads comes from, which is the project's binding. */
  readonly bindings: ProjectRepositoryBindingRead;
  readonly config: SessionSchedulerConfig;
}

/** What one bounded pass moved, which is what a deployment's loop paces itself by. */
export interface SessionPassReport {
  readonly fenced: number;
  readonly cleaned: number;
  readonly reaped: number;
  readonly idled: number;
  readonly placed: number;
}

/** Fences every session attempt an older recovery epoch issued, which is what a takeover owes. */
export async function sessionSchedulerFence(
  service: SessionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedSessionSchedulerConfig(service.config);
  return service.store.fenceOldEpochAttempts(epoch, config.attemptsPerPassMax);
}

/** Removes a bounded batch of ended session pods, acknowledging only accepted cleanup. */
export async function sessionSchedulerCleanup(
  service: SessionSchedulerService,
): Promise<number> {
  const config = checkedSessionSchedulerConfig(service.config);
  const attempts = await service.store.attemptsAwaitingCleanup(
    config.attemptsPerPassMax,
  );
  let cleaned = 0;
  for (const attempt of attempts) {
    const cancelled = await service.placement.cancel(attempt);
    if (cancelled.cancelled === "Unavailable")
      throw new Error("session scheduler: attempt cleanup is unavailable");
    if (await service.store.attemptCleanupCompleted(attempt)) cleaned += 1;
  }
  return cleaned;
}

/** Ends a bounded batch of attempts whose lease has run out, returning their turns. */
export async function sessionSchedulerReap(
  service: SessionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedSessionSchedulerConfig(service.config);
  return service.store.reapLapsedAttempts(epoch, config.attemptsPerPassMax);
}

/** Ends a bounded batch of attempts that have gone idle, so an empty mailbox costs no pod. */
export async function sessionSchedulerIdle(
  service: SessionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedSessionSchedulerConfig(service.config);
  return service.store.reapIdleAttempts(
    epoch,
    config.idleSecsMax,
    config.attemptsPerPassMax,
  );
}

/** Records the placement, or cancels the pod the durable row would not take. */
async function sessionAttemptPlaced(
  service: SessionSchedulerService,
  attempt: FencedSessionAttempt,
  placement: Awaited<ReturnType<SessionPlacementPort["place"]>>,
): Promise<boolean> {
  switch (placement.placed) {
    case "Placed": {
      const recorded = await service.store.attemptPlaced(
        attempt,
        placement.placement,
      );
      if (!recorded) await service.placement.cancel(attempt);
      return recorded;
    }
    case "Denied":
      await service.store.attemptEnded(attempt, "PlacementDenied");
      return false;
    case "Unavailable":
      await service.store.attemptEnded(attempt, "PlacementUnavailable");
      return false;
  }
}

/** Opens and places the next attempt for one session that has a turn waiting. */
async function sessionPlaceOne(
  service: SessionSchedulerService,
  session: AgentSession,
  epoch: RecoveryEpoch,
): Promise<boolean> {
  const config = checkedSessionSchedulerConfig(service.config);
  const binding = await service.bindings.binding(session.partition);
  const minted = service.bearers.mint();
  const opened = await service.store.openAttempt({
    partition: session.partition,
    session: session.session,
    epoch,
    attempt: minted.attempt,
    bearer: minted.bearer.id,
    bearerSecretDigest: minted.bearerSecretDigest,
    leaseSecs: config.attemptLeaseSecs,
    placementBackoffSecs: config.placementBackoffSecs,
    attemptsPerAccountMax: config.attemptsPerAccountMax,
    clusterAttemptsMax: config.clusterAttemptsMax,
  });
  if (opened.opened !== "Opened") return false;
  return sessionAttemptPlaced(
    service,
    opened.attempt,
    await service.placement.place({
      ...opened.attempt,
      kind: session.kind,
      capabilities: session.capabilities,
      credentialSlot: session.credentialSlot,
      ...(session.agentReference === undefined
        ? {}
        : { agentReference: session.agentReference }),
      profile: service.policy.profile,
      image: service.policy.image,
      authority: service.policy.grant,
      bearer: minted.bearer,
      /** A checkout nothing on the roster may read is a cost with no consequence. */
      ...(binding === undefined ||
      !session.capabilities.includes("RepositoryRead")
        ? {}
        : { repository: binding.repository }),
    }),
  );
}

/** Places attempts for the sessions with a queued turn and no live attempt. */
export async function sessionSchedulerPlace(
  service: SessionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<number> {
  const config = checkedSessionSchedulerConfig(service.config);
  const waiting = await service.store.awaitingPlacement(
    epoch,
    config.placementsPerPassMax,
  );
  let placed = 0;
  for (const session of waiting) {
    if (await sessionPlaceOne(service, session, epoch)) placed += 1;
  }
  return placed;
}

/** One bounded pass over every durable move the session scheduler owns, in dependency order. */
export async function sessionSchedulerPass(
  service: SessionSchedulerService,
  epoch: RecoveryEpoch,
): Promise<SessionPassReport> {
  const fenced = await sessionSchedulerFence(service, epoch);
  const cleaned = await sessionSchedulerCleanup(service);
  const reaped = await sessionSchedulerReap(service, epoch);
  const idled = await sessionSchedulerIdle(service, epoch);
  const placed = await sessionSchedulerPlace(service, epoch);
  return { fenced, cleaned, reaped, idled, placed };
}
