/**
 * The ports a worker pool registers and polls through, and the reconciliation
 * one poll is.
 *
 * ONE CHANNEL DOES FOUR JOBS. A pool sends what it currently holds and how
 * many more it has room for, and is answered with the assignments it may
 * claim and the ones it must stop; the same call extends the lease on
 * everything it still holds, and a pool that stops making it goes quiet, its
 * leases run out, and the reaper that already ends a lapsed attempt takes the
 * work back. That is why there is no heartbeat here, no declared capacity and
 * no job-status call: a pool's room is stated by the poll that would fill it,
 * a pool with none polls for the control signals alone, and liveness is the
 * poll.
 *
 * NOTHING HERE READS THE TICKET MACHINE. An assignment is built from the
 * attempt row and the requirement its execution recorded, so the process
 * serving pools never holds a journal, an obligation or a domain type. What it
 * hands out is the contract's assignment and nothing wider.
 *
 * THE BOX IS THE DEPLOYMENT'S ANSWER AND NOT THE WORK'S. An execution
 * requirement in this tree names a platform, an image and capabilities and
 * says nothing about cores or memory, so the size an assignment carries is the
 * plane's own setting — the same budget `kubernetesWorkerLaunch` gives an
 * in-cluster attempt. A per-execution profile is a requirement change, and
 * this contract already has the field waiting for it.
 *
 * A SESSION IS THE SAME CHANNEL'S SECOND KIND. A pool whose release reads
 * sessions states its room for them apart, and what it holds is told apart by
 * the rows each kind lives in, so each kind is renewed, bounded and claimed on
 * its own; `./workerPoolSessions.ts` says what claiming one opens. Such a poll
 * is also what a member's runner reads as live by, so only it is recorded.
 */
import { setTimeout as delay } from "node:timers/promises";

import type {
  AssignmentOutcome,
  WorkerPoolAssignment,
  WorkerPoolReconciliation,
  WorkerPoolSessionAssignment,
} from "../contract/workerPool.ts";
export { workerPoolsAnsweredMax } from "../contract/http.ts";
import type { ExecutionRequirement } from "./executionRequirement.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import {
  workerPoolImageHosted,
  type WorkerPoolImageHosts,
} from "./workerPoolImagePull.ts";
import {
  workerPoolPlatformToken,
  type WorkerPoolClass,
} from "./workerPoolAssignment.ts";
import {
  contractVersionAccepted,
  workerContractAccepted,
  workerContractRunnerSessions,
  type WorkerContractRange,
} from "./workerPlane.ts";
import type {
  WorkerPoolIdentity,
  WorkerPoolMint,
} from "./workerPoolIdentity.ts";
export type {
  WorkerPoolIdentity,
  WorkerPoolMint,
} from "./workerPoolIdentity.ts";
import {
  workerPoolSessionClaims,
  type WorkerPoolSessionPorts,
} from "./workerPoolSessions.ts";

/**
 * The worker contract versions the pool plane serves, from the one whose
 * `Unavailable` carries nothing. An earlier pool names a wait on it, which the
 * strict outcome schema refuses, so its unavailable would be answered 400 and
 * its attempt would wait out its lease rather than conclude.
 */
export const workerPoolContractAccepted: WorkerContractRange = {
  min: { major: 1, minor: 2 },
  max: workerContractAccepted.max,
};

/** What one poll asks: what the pool holds, its room for executions and for sessions, and whether its release reads sessions at all. */
export interface WorkerPoolAsked {
  readonly held: readonly string[];
  readonly wanted: number;
  readonly wantedSessions: number;
  readonly readsSessions: boolean;
}

/** Whether a pool naming `release` reads `sessions`, which an earlier pool's strict schema refuses and so is never handed. */
export function workerPoolSessionsRead(release: string | undefined): boolean {
  return contractVersionAccepted(workerContractRunnerSessions, release);
}

/** A reconciliation as a pool from before sessions reads it. */
export type WorkerPoolReconciliationUnsessioned = Omit<
  WorkerPoolReconciliation,
  "sessions"
>;

/** The answer to a pool that reads no sessions, which asked for none, so a session handed to it is a fault rather than a list to drop. */
export function workerPoolReconciliationUnsessioned(
  reconciled: WorkerPoolReconciliation,
): WorkerPoolReconciliationUnsessioned {
  if (reconciled.sessions.length > 0)
    throw new Error("a pool that reads no sessions was handed one");
  return { assignments: reconciled.assignments, stop: reconciled.stop };
}

/** What registering one pool records: who it is at the issuer, what it declared, and its class. */
export interface WorkerPoolRegistration {
  readonly partition: Partition;
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly class: WorkerPoolClass;
  readonly clientId: string;
  readonly principal: Principal;
  /** The person whose token registered the pool, which is provenance and grants nothing. */
  readonly registeredBy?: Principal;
}

/**
 * Registration, deregistration and the lookup a poll resolves its pool by; no
 * secret passes through here, because a pool authenticates as an OAuth2 client
 * of the issuer this installation already runs and a row keeps only the
 * principal that client's subject resolves to. Taking a pool off is a read of
 * the client its row names and a delete conditional on that client, so the
 * command that has to remove the client and the relation before the row can
 * do so in that order, and a pool registered again in between keeps its newer
 * one.
 */
export interface WorkerPoolRegistry {
  /** Records the pool under this registration's principal, and fences the live attempts an older registration of its name claimed. */
  register(registration: WorkerPoolRegistration): Promise<boolean>;
  clientOf(partition: Partition, pool: string): Promise<string | undefined>;
  deregister(
    partition: Partition,
    pool: string,
    clientId: string,
  ): Promise<boolean>;
  identify(principal: Principal): Promise<WorkerPoolIdentity | undefined>;
}

/** One registered pool as the scheduler reads it: its identity, what it declared, and its class. */
export interface WorkerPoolRegistered extends WorkerPoolIdentity {
  readonly capabilities: readonly string[];
  readonly class: WorkerPoolClass;
}

/** One project's registered pools, `truncated` saying it holds more than this answers. */
export interface WorkerPoolRosterPage {
  readonly pools: readonly WorkerPoolRegistered[];
  readonly truncated: boolean;
}

/** One registered pool as a project's members read it. */
export interface WorkerPoolListed {
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly registeredAt: string;
}

/** One project's registered pools as its members read them, `truncated` as the roster's. */
export interface WorkerPoolListing {
  readonly pools: readonly WorkerPoolListed[];
  readonly truncated: boolean;
}

/** The registry as the API reads it for a project's members. */
export interface WorkerPoolDirectory {
  listed(partition: Partition): Promise<WorkerPoolListing>;
}

/** The registry as the scheduler reads it, which is a project's pools and nothing a registration or a poll writes. */
export interface WorkerPoolRoster {
  registered(partition: Partition): Promise<WorkerPoolRosterPage>;
}

/**
 * The pool one authenticated principal acts as, and nothing where the authority
 * says it may not: `Execute` on the project is the permit, and revoking a pool
 * is therefore a revocation like any other and needs no row deleted here. An
 * authority that
 * could not answer throws `ProjectAccessUnavailable` through this function
 * rather than resolving to `undefined`, because a pool told it is not allowed
 * stops where a pool told to retry comes back.
 */
export async function workerPoolAdmitted(
  registry: WorkerPoolRegistry,
  access: ProjectAccess,
  principal: Principal,
): Promise<WorkerPoolIdentity | undefined> {
  const identity = await registry.identify(principal);
  if (identity === undefined) return undefined;
  return (await workerPoolExecutes(access, identity.partition, principal))
    ? identity
    : undefined;
}

/** Whether the authority permits a pool's principal to run its project's work, which is the one question a pool is admitted or revoked by. */
export async function workerPoolExecutes(
  access: ProjectAccess,
  partition: Partition,
  principal: Principal,
): Promise<boolean> {
  return (
    (await access.authorize(principal, partition, "Execute")) !== undefined
  );
}

/** A fault that left the issuer's client registry unchanged, or left it unknown whether it did. */
export class WorkerPoolClientUnavailable extends Error {
  constructor(why: string) {
    super(`worker pool client: ${why}`);
    this.name = "WorkerPoolClientUnavailable";
  }
}

/** What a pool's OAuth2 client was minted as, handed back once and kept nowhere. */
export interface WorkerPoolClientSecret {
  readonly clientId: string;
  readonly clientSecret: string;
}

/**
 * The issuer's client registration, held by the owner-side command and by no
 * process a pool can reach. The plane pools poll verifies tokens and mints
 * nothing, which is why this port is not among the ones it is composed with.
 */
export interface WorkerPoolClients {
  create(clientId: string): Promise<WorkerPoolClientSecret>;
  remove(clientId: string): Promise<void>;
}

/** What one claim produced, which is the requirement the claimed attempt's execution recorded. */
export interface WorkerPoolClaimed {
  readonly requirement: ExecutionRequirement;
}

/** What a claim is held to: how long the lease it takes runs, and how many live attempts the pool may hold with it. */
export interface WorkerPoolClaimTerms {
  readonly leaseSecs: number;
  readonly heldMax: number;
}

/**
 * The durable side of an assignment's whole life, every call scoped to the
 * pool's current registration and to what that registration claimed. None of
 * them names an execution or a task, because a pool that could read one would
 * learn the tenant's ticket structure.
 */
export interface WorkerPoolAssignments {
  claim(
    identity: WorkerPoolIdentity,
    terms: WorkerPoolClaimTerms,
    assignment: string,
    bearer: string,
  ): Promise<WorkerPoolClaimed | undefined>;
  renew(
    identity: WorkerPoolIdentity,
    assignment: string,
    leaseSecs: number,
  ): Promise<boolean>;
  refuse(
    identity: WorkerPoolIdentity,
    assignment: string,
    evidence: string,
  ): Promise<boolean>;
  release(identity: WorkerPoolIdentity, assignment: string): Promise<boolean>;
  held(identity: WorkerPoolIdentity, assignment: string): Promise<boolean>;
  /** The images pinned by the assignments this registration may still renew, at most `heldMax` of them. */
  heldImages(
    identity: WorkerPoolIdentity,
    heldMax: number,
  ): Promise<readonly string[]>;
}

export interface WorkerPoolPollSettings {
  readonly leaseSecs: number;
  readonly assignmentsPerPollMax: number;
  readonly heldMax: number;
  /** The sessions one poll claims at most, and the session attempts a pool may hold at once, each apart from its executions. */
  readonly sessionsPerPollMax: number;
  readonly sessionsHeldMax: number;
  readonly deadlineSecs: number;
  /** The box every assignment this plane hands out asks for, which is the deployment's. */
  readonly cpuMillis: number;
  readonly memoryMib: number;
  readonly callbackUrl: string;
  /** Where a pool-held session's own tools reach the API; a plane that names none claims no session. */
  readonly sessionApiUrl?: string;
  readonly pollIntervalMs: number;
  readonly pollsMax: number;
  /** The public host each internal registry host is published as, which an assignment names its image by. */
  readonly imageHosts: WorkerPoolImageHosts;
}

/** Everything a poll reaches: each kind's durable side, and where an assignment's name is drawn. */
export interface WorkerPoolPorts {
  readonly assignments: WorkerPoolAssignments;
  readonly sessions: WorkerPoolSessionPorts;
  readonly mint: WorkerPoolMint;
}

function workerPoolCheckedSettings(settings: WorkerPoolPollSettings): void {
  for (const [name, bound] of [
    ["leaseSecs", settings.leaseSecs],
    ["assignmentsPerPollMax", settings.assignmentsPerPollMax],
    ["heldMax", settings.heldMax],
    ["sessionsPerPollMax", settings.sessionsPerPollMax],
    ["sessionsHeldMax", settings.sessionsHeldMax],
    ["deadlineSecs", settings.deadlineSecs],
    ["cpuMillis", settings.cpuMillis],
    ["memoryMib", settings.memoryMib],
    ["pollIntervalMs", settings.pollIntervalMs],
    ["pollsMax", settings.pollsMax],
  ] as const)
    if (!Number.isSafeInteger(bound) || bound <= 0)
      throw new RangeError(
        `worker pool ${name} must be a positive safe integer`,
      );
}

/** The most a poll's `held` may name, which is both kinds' bounds where the pool reads sessions and its executions' alone where it does not. */
export function workerPoolHeldNamedMax(
  settings: WorkerPoolPollSettings,
  readsSessions: boolean,
): number {
  return readsSessions
    ? settings.heldMax + settings.sessionsHeldMax
    : settings.heldMax;
}

/** What a pool holds, told apart by kind, since each kind is renewed through its own rows and bounded by its own setting. */
export interface WorkerPoolHolding {
  readonly jobs: readonly string[];
  readonly sessions: readonly string[];
}

/**
 * The lease renewal and the cancellation delivery, which are one pass over
 * what the pool says it holds: a renewal that finds no live attempt of this
 * pool's is the stop flag, so asked-to-stop and already-gone are one answer
 * and a pool need not tell them apart.
 */
async function workerPoolHeldReconciled(
  renewing: Pick<WorkerPoolAssignments, "renew">,
  identity: WorkerPoolIdentity,
  held: readonly string[],
  leaseSecs: number,
): Promise<string[]> {
  const renewed = await Promise.all(
    held.map(async (assignment) => ({
      assignment,
      live: await renewing.renew(identity, assignment, leaseSecs),
    })),
  );
  return renewed.filter((row) => !row.live).map((row) => row.assignment);
}

/**
 * What a pool is told of the requirement it was assigned: the platform and the
 * capabilities it places the workload by, as the tokens it declared them in,
 * and the image where the requirement pinned one, named by the host a pool
 * pulls it from.
 */
function workerPoolClaimedPlacement(
  requirement: ExecutionRequirement,
  imageHosts: WorkerPoolImageHosts,
): Pick<WorkerPoolAssignment, "capabilities" | "image"> {
  switch (requirement.mode) {
    case "Container":
      return {
        capabilities: [workerPoolPlatformToken(requirement)],
        image: workerPoolImageHosted(requirement.image, imageHosts),
      };
    case "ContainerCapability":
      return {
        capabilities: [
          workerPoolPlatformToken(requirement),
          ...requirement.capabilities,
        ],
      };
    case "Native":
      throw new Error("a worker pool claimed a native requirement");
  }
}

/**
 * The claims one poll makes, each one a row taken and bound to a fresh bearer
 * in the same statement. A pool with no room asks for none and none is
 * claimed, so a full pool's poll costs no row a pool with room could take.
 */
async function workerPoolClaims(
  assignments: WorkerPoolAssignments,
  identity: WorkerPoolIdentity,
  settings: WorkerPoolPollSettings,
  mint: WorkerPoolMint,
  wanted: number,
): Promise<WorkerPoolAssignment[]> {
  const claimed: WorkerPoolAssignment[] = [];
  for (let taken = 0; taken < wanted; taken += 1) {
    const assignment = mint();
    const bearer = mint();
    const row = await assignments.claim(identity, settings, assignment, bearer);
    if (row === undefined) break;
    claimed.push({
      assignment,
      ...workerPoolClaimedPlacement(row.requirement, settings.imageHosts),
      cpuMillis: settings.cpuMillis,
      memoryMib: settings.memoryMib,
      deadlineSecs: settings.deadlineSecs,
      callbackUrl: settings.callbackUrl,
      bearer,
    });
  }
  return claimed;
}

/** The sessions one pass claims, which is none on a plane that names no API for a session to reach. */
function workerPoolSessionsClaimed(
  ports: WorkerPoolPorts,
  identity: WorkerPoolIdentity,
  settings: WorkerPoolPollSettings,
  wanted: number,
): Promise<WorkerPoolSessionAssignment[]> {
  const apiUrl = settings.sessionApiUrl;
  if (apiUrl === undefined) return Promise.resolve([]);
  return workerPoolSessionClaims(
    ports.sessions,
    identity,
    {
      leaseSecs: settings.leaseSecs,
      heldMax: settings.sessionsHeldMax,
      cpuMillis: settings.cpuMillis,
      memoryMib: settings.memoryMib,
      callbackUrl: settings.callbackUrl,
      apiUrl,
      imageHosts: settings.imageHosts,
    },
    ports.mint,
    wanted,
  );
}

/**
 * One reconciliation pass, which is a renewal of what is held and a claim of
 * what is not, each kind through its own rows. Each kind's room is the least
 * of what the pool asked, the plane's per-poll bound and what its held bound
 * leaves.
 */
export async function workerPoolReconcile(
  ports: WorkerPoolPorts,
  identity: WorkerPoolIdentity,
  holding: WorkerPoolHolding,
  asked: Pick<WorkerPoolAsked, "wanted" | "wantedSessions">,
  settings: WorkerPoolPollSettings,
): Promise<WorkerPoolReconciliation> {
  const stop = [
    ...(await workerPoolHeldReconciled(
      ports.assignments,
      identity,
      holding.jobs,
      settings.leaseSecs,
    )),
    ...(await workerPoolHeldReconciled(
      ports.sessions.store,
      identity,
      holding.sessions,
      settings.leaseSecs,
    )),
  ];
  return {
    assignments: await workerPoolClaims(
      ports.assignments,
      identity,
      settings,
      ports.mint,
      Math.min(
        asked.wanted,
        settings.assignmentsPerPollMax,
        settings.heldMax - holding.jobs.length,
      ),
    ),
    sessions: await workerPoolSessionsClaimed(
      ports,
      identity,
      settings,
      Math.min(
        asked.wantedSessions,
        settings.sessionsPerPollMax,
        settings.sessionsHeldMax - holding.sessions.length,
      ),
    ),
    stop,
  };
}

/** What a poll came to: an answer, or a held list naming more of one kind than its bound. */
export type WorkerPoolPolled =
  | {
      readonly polled: "Answered";
      readonly answer: WorkerPoolReconciliation;
    }
  | { readonly polled: "HeldOverBound" };

/**
 * What the pool holds, told apart by kind. A pool that reads no sessions was
 * never handed one, so everything it holds is an execution's.
 */
async function workerPoolHoldingRead(
  ports: WorkerPoolPorts,
  identity: WorkerPoolIdentity,
  asked: WorkerPoolAsked,
): Promise<WorkerPoolHolding> {
  if (!asked.readsSessions) return { jobs: asked.held, sessions: [] };
  const sessions = await ports.sessions.store.among(identity, asked.held);
  return {
    jobs: asked.held.filter((assignment) => !sessions.has(assignment)),
    sessions: asked.held.filter((assignment) => sessions.has(assignment)),
  };
}

/**
 * The long poll: reconciliation until it has something to say or until the
 * bounded wait runs out, where an empty answer is correct and the pool asks
 * again. A held list longer than a kind's bound is refused whole, since a cut
 * one reads as a pool that let go of work it still runs, and only a pool that
 * can take a session, reading them with room for one or holding one, is
 * recorded as polling.
 */
export async function workerPoolPoll(
  ports: WorkerPoolPorts,
  identity: WorkerPoolIdentity,
  asked: WorkerPoolAsked,
  settings: WorkerPoolPollSettings,
): Promise<WorkerPoolPolled> {
  workerPoolCheckedSettings(settings);
  for (const [name, room] of [
    ["wanted", asked.wanted],
    ["wantedSessions", asked.wantedSessions],
  ] as const)
    if (!Number.isSafeInteger(room) || room < 0)
      throw new RangeError(
        `worker pool ${name} must be a non-negative integer`,
      );
  const holding = await workerPoolHoldingRead(ports, identity, asked);
  if (
    holding.jobs.length > settings.heldMax ||
    holding.sessions.length > settings.sessionsHeldMax
  )
    return { polled: "HeldOverBound" };
  if (
    asked.readsSessions &&
    (asked.wantedSessions > 0 || holding.sessions.length > 0)
  )
    await ports.sessions.store.polled(identity);
  const rooms = {
    wanted: asked.wanted,
    wantedSessions: asked.readsSessions ? asked.wantedSessions : 0,
  };
  let answer = await workerPoolReconcile(
    ports,
    identity,
    holding,
    rooms,
    settings,
  );
  for (
    let polled = 1;
    polled < settings.pollsMax &&
    answer.assignments.length === 0 &&
    answer.sessions.length === 0 &&
    answer.stop.length === 0;
    polled += 1
  ) {
    await delay(settings.pollIntervalMs);
    answer = await workerPoolReconcile(
      ports,
      identity,
      holding,
      rooms,
      settings,
    );
  }
  return { polled: "Answered", answer };
}

/**
 * One settlement a pool reports, made against the kind the assignment is: an
 * accepted one is already leased and needs no write, a refusal is recorded
 * against its attempt, and an unavailable releases it.
 */
export async function workerPoolSettled(
  ports: WorkerPoolPorts,
  identity: WorkerPoolIdentity,
  assignment: string,
  offered: AssignmentOutcome,
): Promise<boolean> {
  const settling: Pick<WorkerPoolAssignments, "held" | "refuse" | "release"> = (
    await ports.sessions.store.among(identity, [assignment])
  ).has(assignment)
    ? ports.sessions.store
    : ports.assignments;
  switch (offered.outcome) {
    case "Accepted":
      return settling.held(identity, assignment);
    case "Refused":
      return settling.refuse(identity, assignment, offered.evidence);
    case "Unavailable":
      return settling.release(identity, assignment);
  }
}

/** The images pinned by what this registration may still renew of either kind, each kind to its own bound. */
export async function workerPoolHeldImages(
  ports: WorkerPoolPorts,
  identity: WorkerPoolIdentity,
  settings: WorkerPoolPollSettings,
): Promise<readonly string[]> {
  return [
    ...(await ports.assignments.heldImages(identity, settings.heldMax)),
    ...(await ports.sessions.store.heldImages(
      identity,
      settings.sessionsHeldMax,
    )),
  ];
}
