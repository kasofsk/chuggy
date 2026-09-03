/**
 * What the scheduler holds one agent session's placement in: the fence every
 * durable move is made under, the bearer one attempt speaks through, the
 * placement a backend is asked for, and the bounds a deployment names.
 *
 * A SESSION CARRIES NO REQUIREMENT AND NO INVOCATION. It has no ticket, no
 * pinned configuration and no briefing, so its image, profile and grant are one
 * site-level `SessionPolicy` and the briefing machinery is never entered. The
 * mailbox endpoint is not on the placement either: the worker plane URL and the
 * paths a pod reads are site data on the launch configuration, and a placement
 * carrying them would be a placement carrying a cluster fact this port is not
 * supposed to know.
 *
 * ITS REPOSITORY IS PLACEMENT DATA WHERE ITS MAILBOX IS NOT. Which repository a
 * session reads is the project's own binding, resolved when the attempt is
 * placed and different for every project the scheduler serves, so it belongs on
 * the placement exactly as the mailbox endpoint does not. It carries no commit:
 * a session has no ticket, so it has no decision to freeze one, and a standing
 * reader wants the tree as it is rather than as it was.
 *
 * AND THE BINDING IS NOT ALWAYS THE REMOTE THE SESSION READS. One binding has
 * two consumers wanting different remotes: the finalizer opens pull requests
 * against it, so it names the forge, while a session only ever reads and wants
 * whichever remote it can reach and hold a credential for. Repointing the
 * binding would move the promotion path, and granting a reader the forge's
 * credential would give it a push it has no use for, so the site says instead
 * which read stands for which binding — `SessionPolicy.mirrors` — and the
 * binding is left alone. A bound repository that map does not name is placed as
 * it is bound, and whether this site can reach that remote is the pod's to find
 * out: the credential of a repository is `CHUG_WORKER_REPOSITORIES`' to state,
 * and that map is the image's device.
 *
 * ITS EVIDENCE IS ITS OWN ROSTER rather than the execution scheduler's widened.
 * A session has no manifest, no verdict and no retry budget, so widening the
 * execution roster with `SessionIdle` would put a label on an execution attempt
 * that no execution can reach.
 *
 * A DENIED SESSION PLACEMENT RECORDS BARE `PlacementDenied`, AND ITS REASON IS
 * DISCARDED. The placement outcome is the execution scheduler's unchanged, so
 * its `Denied` arm carries a `BlockedReason` — and a `BlockedReason` exists to
 * become `ExecutionBlocked`, which a session has no execution to become. The
 * reason is a diagnostic here and nothing more: there is no session state it
 * names, and wiring it to one would be reading a decision about a ticket into a
 * session that has none.
 */

import type {
  AgentSession,
  SessionAttemptId,
  SessionBearerId,
  SessionBearerSecret,
  SessionCapability,
  SessionId,
  SessionKind,
} from "./agentSession.ts";
import type {
  AttemptPlacementOutcome,
  ExecutionProfile,
} from "./executionScheduler.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { Partition, RecoveryEpoch } from "./projectStore.ts";
import type { PlacementId } from "./schedulerIdentity.ts";
import type { PolicyAuthorityGrant } from "./taskAuthority.ts";

/** The identity every durable move against one session attempt is fenced by. */
export interface FencedSessionAttempt {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly attempt: SessionAttemptId;
  readonly generation: number;
}

/** The bearer minted atomically with a session attempt and handed only to its launcher. */
export interface SessionBearer {
  readonly id: SessionBearerId;
  readonly secret: SessionBearerSecret;
}

/** One session placement asked of a backend, carrying only what a pod may be told. */
export interface SessionPlacement extends FencedSessionAttempt {
  readonly kind: SessionKind;
  readonly capabilities: readonly SessionCapability[];
  readonly credentialSlot: string;
  readonly agentReference?: string;
  readonly profile: ExecutionProfile;
  readonly image: string;
  readonly authority: PolicyAuthorityGrant;
  readonly bearer: SessionBearer;
  /**
   * The repository the session reads, which is the project's binding resolved
   * through the site's mirrors. A project that binds none places a session with
   * no checkout, which is the honest arm: the session reads the project through
   * the API and has no tree.
   */
  readonly repository?: RepositoryId;
}

/** The three arms an execution placement already has, reused unchanged. */
export type SessionPlacementOutcome = AttemptPlacementOutcome;

/** Session placement, behind the same backend-neutral port an execution attempt is placed through. */
export interface SessionPlacementPort {
  place(placement: SessionPlacement): Promise<SessionPlacementOutcome>;

  /** Cancels this exact generation; correctness never waits on the backend. */
  cancel(
    attempt: FencedSessionAttempt,
  ): Promise<
    { readonly cancelled: "Accepted" } | { readonly cancelled: "Unavailable" }
  >;
}

/** Which read a session takes of a bound repository, keyed by the binding it stands for. */
export type RepositoryMirrors = Readonly<Record<string, RepositoryId>>;

/** What a site resolves for every session it runs: one image, one profile, one grant, one set of mirrors. */
export interface SessionPolicy {
  readonly profile: ExecutionProfile;
  readonly image: string;
  readonly grant: PolicyAuthorityGrant;
  readonly mirrors: RepositoryMirrors;
}

/**
 * The repository a session actually clones: the read the site put in front of
 * the binding, or the binding itself where it named none. `Object.hasOwn` is
 * what asks, so a bound repository named `toString` resolves to itself rather
 * than to a function off the prototype.
 */
export function sessionRepositoryRead(
  mirrors: RepositoryMirrors,
  bound: RepositoryId,
): RepositoryId {
  return Object.hasOwn(mirrors, bound) ? (mirrors[bound] ?? bound) : bound;
}

/**
 * The closed vocabulary an ended session attempt records instead of free text,
 * so a label is never a payload.
 */
export const allSessionAttemptEvidences = [
  "PolicyDenied",
  "PolicyUnavailable",
  "PlacementDenied",
  "PlacementUnavailable",
  "Evicted",
  "Vanished",
  "LeaseExpired",
  "Fenced",
  "SessionIdle",
  "SessionClosed",
  "TurnFailed",
  "StoreRefused",
  /**
   * The provider refused the account the pod was running under. It is the one
   * evidence a pod may end its own attempt on, and the only one that ends it
   * `Withdrawn`: the session never got to spend its turn.
   */
  "AgentRateLimited",
] as const;
export type SessionAttemptEvidence =
  (typeof allSessionAttemptEvidences)[number];

/**
 * What opening the next attempt for a session is asked for. The attempt's
 * identity, its bearer and that bearer's digest are minted by the caller,
 * because the secret itself is what the launcher needs and is not a value the
 * durable side ever holds.
 */
export interface SessionAttemptOpening {
  readonly partition: Partition;
  readonly session: SessionId;
  readonly epoch: RecoveryEpoch;
  readonly attempt: SessionAttemptId;
  readonly bearer: SessionBearerId;
  readonly bearerSecretDigest: string;
  readonly leaseSecs: number;
  readonly placementBackoffSecs: number;
  readonly attemptsPerAccountMax: number;
  readonly clusterAttemptsMax: number;
}

/**
 * What opening an attempt found. Every arm but the first leaves the session
 * exactly as it was, and each names which ceiling or condition stopped it.
 */
export type SessionAttemptOpened =
  | { readonly opened: "Opened"; readonly attempt: FencedSessionAttempt }
  | { readonly opened: "NotLaunchable" }
  | { readonly opened: "BackingOff" }
  | { readonly opened: "AccountAtMaximum" }
  | { readonly opened: "ClusterFull" };

/**
 * The durable session authority for one installation, every call of it fenced
 * or bounded. It is a sibling of the execution scheduler's store rather than a
 * widening of it, because a session has no execution to hang off.
 */
export interface SessionSchedulerStore {
  /** At most `sessionsMax` open sessions with a queued turn, no live attempt and no backoff left to serve. */
  awaitingPlacement(
    epoch: RecoveryEpoch,
    sessionsMax: number,
  ): Promise<readonly AgentSession[]>;

  /** Opens the next sequential attempt for a session that may have one. */
  openAttempt(opening: SessionAttemptOpening): Promise<SessionAttemptOpened>;

  /** Records that the placement port accepted the attempt, moving it to `Running`. */
  attemptPlaced(
    attempt: FencedSessionAttempt,
    placement: PlacementId,
  ): Promise<boolean>;

  /**
   * Ends one attempt, returning every turn it claimed to the mailbox and
   * spending one of that turn's attempts.
   */
  attemptEnded(
    attempt: FencedSessionAttempt,
    evidence: SessionAttemptEvidence,
  ): Promise<boolean>;

  /** Ends at most `attemptsMax` attempts whose lease has run out. */
  reapLapsedAttempts(
    epoch: RecoveryEpoch,
    attemptsMax: number,
  ): Promise<number>;

  /** Ends at most `attemptsMax` attempts idle past `idleSecsMax`, so an empty mailbox costs no pod. */
  reapIdleAttempts(
    epoch: RecoveryEpoch,
    idleSecsMax: number,
    attemptsMax: number,
  ): Promise<number>;

  /** Marks at most `attemptsMax` attempts issued under an older recovery epoch unable to report. */
  fenceOldEpochAttempts(
    epoch: RecoveryEpoch,
    attemptsMax: number,
  ): Promise<number>;

  /** Ended session attempts whose external workload still needs idempotent removal. */
  attemptsAwaitingCleanup(
    attemptsMax: number,
  ): Promise<readonly FencedSessionAttempt[]>;

  /** Acknowledges external cleanup only after the placement backend accepted removal. */
  attemptCleanupCompleted(attempt: FencedSessionAttempt): Promise<boolean>;
}

/**
 * The session scheduler's bounded configuration, every value of it an
 * operational choice.
 */
export interface SessionSchedulerConfig {
  readonly attemptLeaseSecs: number;
  readonly attemptsPerPassMax: number;
  readonly placementsPerPassMax: number;
  readonly placementBackoffSecs: number;
  readonly idleSecsMax: number;
  readonly attemptsPerAccountMax: number;
  /** The installation-wide ceiling on live session attempts, which is the cluster's own. */
  readonly clusterAttemptsMax: number;
}

/** The values a deployment starts from when it names none. */
export const sessionSchedulerDefaults: SessionSchedulerConfig = {
  attemptLeaseSecs: 300,
  attemptsPerPassMax: 64,
  placementsPerPassMax: 16,
  placementBackoffSecs: 15,
  idleSecsMax: 300,
  attemptsPerAccountMax: 2,
  clusterAttemptsMax: 16,
};

/**
 * Every bound a configuration must name, read from the defaults so that a bound
 * added to the interface has a default and a required name at once. Reading the
 * offered configuration's own keys would check the bounds it happens to carry
 * rather than the ones it owes, and a deployment that named none would pass.
 */
const sessionSchedulerBounds = Object.keys(
  sessionSchedulerDefaults,
) as readonly (keyof SessionSchedulerConfig)[];

/**
 * Refuses a configuration whose bounds are not positive safe integers, and one
 * reserving a bigger share for one account than the installation runs at all —
 * which is a ceiling that can never bind and so is an unverified control.
 */
export function checkedSessionSchedulerConfig(
  config: SessionSchedulerConfig,
): SessionSchedulerConfig {
  for (const name of sessionSchedulerBounds) {
    const value: number = config[name];
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(
        `session scheduler configuration: ${name} must be a positive safe integer`,
      );
    }
  }
  if (config.attemptsPerAccountMax > config.clusterAttemptsMax) {
    throw new RangeError(
      "session scheduler configuration: attemptsPerAccountMax is above clusterAttemptsMax, so the per-account ceiling never binds",
    );
  }
  return config;
}
