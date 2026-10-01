/**
 * The session half of a pool's poll: which of a project's sessions a pool may
 * claim, what claiming one opens, and what a runner is handed for it.
 *
 * A CLAIM OPENS THE ATTEMPT. The scheduler opens no attempt for a session whose
 * oldest queued turn was admitted for runners, so the claim is where its bearer
 * is minted and its invocation recorded, exactly as `sessionPlaceOne` records
 * one, and the durable side opens it already running under the pool's lease:
 * no pod is placed and nothing observes one, so the poll's renewal is what
 * keeps it, and it ends by the runner's report, its idleness or its lease.
 *
 * WHAT A SITE LAUNCHES A SESSION WITH IS THE SCHEDULER'S. It publishes its
 * image, grant, mirrors, bounds, model and deadline at boot, and a claim reads
 * them rather than a second copy in this plane's settings, so a session runs
 * the same image under the same grant whichever route it took. A plane with
 * nothing published, or with no API its runners can reach, claims no session.
 *
 * A CANDIDATE IS READ AND THEN OPENED. The durable side re-checks everything
 * the read found under the session's row lock — that a runner may take it,
 * that this pool may, and that the roster and runtime session the invocation
 * was built from are still the session's — so a session another pool claimed
 * in between is skipped and one this pool has no room for ends the claims.
 */
import type { SessionBounds } from "../contract/workerTask.ts";
import type { WorkerPoolSessionAssignment } from "../contract/workerPool.ts";
import type {
  SessionAttemptId,
  SessionBearerId,
  SessionCapability,
  SessionId,
  SessionKind,
} from "./agentSession.ts";
import type { RepositoryId } from "./finalizer.ts";
import type { ProjectRepositoryBindingRead } from "./repositoryConfiguration.ts";
import {
  sessionRepositoryPlaced,
  type RepositoryMirrors,
  type SessionTaskInvocation,
} from "./sessionScheduler.ts";
import type { SessionAttemptMint } from "./sessionSchedulerRun.ts";
import type { PolicyAuthorityGrant } from "./taskAuthority.ts";
import {
  workerPoolImageHosted,
  type WorkerPoolImageHosts,
} from "./workerPoolImagePull.ts";
import type {
  WorkerPoolIdentity,
  WorkerPoolMint,
} from "./workerPoolIdentity.ts";
import { sessionTaskInvocation, type SessionTaskLaunch } from "./workerTask.ts";

/** What a site launches every session with, as its scheduler publishes it. */
export interface SessionLaunchFacts {
  readonly image: string;
  readonly authority: PolicyAuthorityGrant;
  readonly mirrors: RepositoryMirrors;
  readonly bounds: SessionBounds;
  readonly model: string;
  /** How long a runner lets one session's container run, which is the in-cluster pod's deadline. */
  readonly deadlineSecs: number;
  /** How long after an attempt ends before its session is opened again, which is the scheduler's own. */
  readonly placementBackoffSecs: number;
}

/** One session a pool may claim, with what its invocation is built from. */
export interface WorkerPoolSessionCandidate {
  readonly session: SessionId;
  readonly kind: SessionKind;
  readonly capabilities: readonly SessionCapability[];
  readonly agentReference?: string;
}

/** What one claim asks the durable side to open. */
export interface WorkerPoolSessionOpening {
  readonly candidate: WorkerPoolSessionCandidate;
  readonly attempt: SessionAttemptId;
  readonly assignment: string;
  readonly bearer: SessionBearerId;
  readonly bearerSecretDigest: string;
  readonly leaseSecs: number;
  readonly placementBackoffSecs: number;
  /** The live session attempts the pool may hold with this one. */
  readonly heldMax: number;
  readonly invocation: SessionTaskInvocation;
  readonly image: string;
  readonly launch: SessionTaskLaunch;
}

/** `NotClaimable` skips one session; `PoolFull` ends the claims. */
export type WorkerPoolSessionOpened = "Opened" | "NotClaimable" | "PoolFull";

/**
 * The durable side of a pool-held session attempt, every call scoped to the
 * pool's current registration and to what that registration claimed, as an
 * execution's assignment is.
 */
export interface WorkerPoolSessions {
  launch(): Promise<SessionLaunchFacts | undefined>;
  /** Which of `assignments` are session attempts this pool's name claimed, in any state. */
  among(
    identity: WorkerPoolIdentity,
    assignments: readonly string[],
  ): Promise<ReadonlySet<string>>;
  awaiting(
    identity: WorkerPoolIdentity,
    placementBackoffSecs: number,
    max: number,
  ): Promise<readonly WorkerPoolSessionCandidate[]>;
  open(
    identity: WorkerPoolIdentity,
    opening: WorkerPoolSessionOpening,
  ): Promise<WorkerPoolSessionOpened>;
  renew(
    identity: WorkerPoolIdentity,
    assignment: string,
    leaseSecs: number,
  ): Promise<boolean>;
  held(identity: WorkerPoolIdentity, assignment: string): Promise<boolean>;
  refuse(
    identity: WorkerPoolIdentity,
    assignment: string,
    evidence: string,
  ): Promise<boolean>;
  release(identity: WorkerPoolIdentity, assignment: string): Promise<boolean>;
  heldImages(
    identity: WorkerPoolIdentity,
    max: number,
  ): Promise<readonly string[]>;
  /** Records that a pool able to take sessions polled, which is what a member reads a runner as live by. */
  polled(identity: WorkerPoolIdentity): Promise<void>;
}

/** Everything a session claim reaches beyond its rows: the project's binding, and where a bearer is drawn. */
export interface WorkerPoolSessionPorts {
  readonly store: WorkerPoolSessions;
  readonly bindings: ProjectRepositoryBindingRead;
  readonly bearers: SessionAttemptMint;
}

/** What a claim is held to and handed out with, which is the plane's own. */
export interface WorkerPoolSessionTerms {
  readonly leaseSecs: number;
  readonly heldMax: number;
  readonly cpuMillis: number;
  readonly memoryMib: number;
  readonly callbackUrl: string;
  readonly apiUrl: string;
  readonly imageHosts: WorkerPoolImageHosts;
}

/** The invocation a claimed session's runner fetches, built as `sessionPlaceOne` builds a pod's. */
function workerPoolSessionInvocation(
  candidate: WorkerPoolSessionCandidate,
  launch: SessionLaunchFacts,
  repository: RepositoryId | undefined,
): SessionTaskInvocation {
  return sessionTaskInvocation({
    capabilities: candidate.capabilities,
    ...(candidate.agentReference === undefined
      ? {}
      : { agentReference: candidate.agentReference }),
    authority: launch.authority,
    ...(repository === undefined ? {} : { repository }),
  });
}

/**
 * The sessions one poll claims, at most `wanted` of them. The binding is read
 * once, and only once a session is waiting, because every candidate is of the
 * pool's own project.
 */
export async function workerPoolSessionClaims(
  ports: WorkerPoolSessionPorts,
  identity: WorkerPoolIdentity,
  terms: WorkerPoolSessionTerms,
  mint: WorkerPoolMint,
  wanted: number,
): Promise<WorkerPoolSessionAssignment[]> {
  if (wanted <= 0) return [];
  const launch = await ports.store.launch();
  if (launch === undefined) return [];
  const waiting = await ports.store.awaiting(
    identity,
    launch.placementBackoffSecs,
    wanted,
  );
  if (waiting.length === 0) return [];
  const binding = await ports.bindings.binding(identity.partition);
  const claimed: WorkerPoolSessionAssignment[] = [];
  for (const candidate of waiting) {
    if (claimed.length >= wanted) break;
    const minted = ports.bearers.mint();
    const assignment = mint();
    const opened = await ports.store.open(identity, {
      candidate,
      attempt: minted.attempt,
      assignment,
      bearer: minted.bearer.id,
      bearerSecretDigest: minted.bearerSecretDigest,
      leaseSecs: terms.leaseSecs,
      placementBackoffSecs: launch.placementBackoffSecs,
      heldMax: terms.heldMax,
      invocation: workerPoolSessionInvocation(
        candidate,
        launch,
        sessionRepositoryPlaced(
          binding,
          candidate.capabilities,
          launch.mirrors,
        ),
      ),
      image: launch.image,
      launch: {
        api: { url: terms.apiUrl },
        bounds: launch.bounds,
        model: launch.model,
      },
    });
    if (opened === "PoolFull") break;
    if (opened === "NotClaimable") continue;
    claimed.push({
      assignment,
      capabilities: [],
      image: workerPoolImageHosted(launch.image, terms.imageHosts),
      cpuMillis: terms.cpuMillis,
      memoryMib: terms.memoryMib,
      deadlineSecs: launch.deadlineSecs,
      callbackUrl: terms.callbackUrl,
      bearer: minted.bearer.secret,
    });
  }
  return claimed;
}
