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
 * A JOB'S RUNTIME IS THE ONE ITS ATTEMPT WAS OPENED UNDER. The scheduler keeps
 * it on the attempt row, and an assignment names it, by the host a pool pulls
 * it from, only to a pool whose release reads it; an earlier pool starts its
 * image's own entrypoint. A pool holding the attempt may pull the runtime as it
 * pulls the image.
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
 * is what a member's runner reads as live for a session by, so only it is
 * recorded as one; a personal runner's poll that could take an execution is
 * recorded apart, as what a pool's claim reads it as live by.
 *
 * A MEMBER'S PERSONAL RUNNER POLLS THE SAME CHANNEL. It is admitted by its row
 * in its tenant and its owner's standing permit to register one, since no
 * relation names its principal, and it claims its owner's executions in the
 * projects it allowlists that allow one, as its sessions are claimed: the
 * authority is asked whether its owner may still read each project before
 * anything is claimed, so an outage fails the poll with nothing claimed.
 *
 * A POOL'S CLAIM DEFERS TO AN OWNER'S PERSONAL RUNNER as the owner's fallback
 * says, and a runner the authority revoked is none of the owner's, as the
 * model's `ownerRunners` reads it. The claim cannot ask the authority, so the
 * owners it would defer to are read first and asked, and the claim is told
 * which of them are revoked; an owner past the bound is not asked, and is
 * deferred to as though their runner stood.
 */
import { setTimeout as delay } from "node:timers/promises";

import type {
  AssignmentOutcome,
  WorkerPoolAssignment,
  WorkerPoolReconciliation,
  WorkerPoolSessionAssignment,
} from "../contract/workerPool.ts";
import type { WorkerImageFault } from "../contract/workerEnvironment.ts";
export { workerPoolsAnsweredMax } from "../contract/http.ts";
import type { ExecutionRequirement } from "./executionRequirement.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition, ProjectId } from "./projectStore.ts";
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
  workerContractRunnerRuntime,
  workerContractRunnerSessions,
  type WorkerContractRange,
} from "./workerPlane.ts";
import type {
  PersonalRunnerIdentity,
  PoolPlaneIdentity,
  WorkerPoolIdentity,
  WorkerPoolMint,
} from "./workerPoolIdentity.ts";
export type {
  DedicatedPoolIdentity,
  PersonalRunnerIdentity,
  PoolPlaneIdentity,
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

/** What one poll asks: what the pool holds, its room for executions and for sessions, and whether its release reads sessions and a job's runtime at all. */
export interface WorkerPoolAsked {
  readonly held: readonly string[];
  readonly wanted: number;
  readonly wantedSessions: number;
  readonly readsSessions: boolean;
  readonly readsRuntime: boolean;
}

/** Whether a pool naming `release` reads `sessions`, which an earlier pool's strict schema refuses and so is never handed. */
export function workerPoolSessionsRead(release: string | undefined): boolean {
  return contractVersionAccepted(workerContractRunnerSessions, release);
}

/** Whether a pool naming `release` reads a job assignment's `runtime`, which an earlier pool's strict schema refuses and so is never handed. */
export function workerPoolRuntimeRead(release: string | undefined): boolean {
  return contractVersionAccepted(workerContractRunnerRuntime, release);
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
  /** The person whose token registered the pool, whose own inquiries are the only ones it is handed; a pool no person registered is handed leads alone. */
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

/** The registry as the scheduler reads it, which is a project's pools, a member's personal runner, and nothing a registration or a poll writes. */
export interface WorkerPoolRoster {
  registered(partition: Partition): Promise<WorkerPoolRosterPage>;
  personal(
    partition: Partition,
    owner: Principal,
  ): Promise<PersonalRunnerRegistered | undefined>;
}

/** One member's personal runner as the scheduler reads it: who it is, what it declared, and the projects it allowlists. */
export interface PersonalRunnerRegistered {
  readonly owner: Principal;
  readonly principal: Principal;
  readonly capabilities: readonly string[];
  readonly allowlist: readonly Partition[];
}

/** The lookup a poll resolves a member's personal runner by: its row, in a tenant, by the principal its client resolves to. */
export interface PersonalRunnerPlaneRegistry {
  identify(principal: Principal): Promise<PersonalRunnerIdentity | undefined>;
}

/**
 * The pool or personal runner one authenticated principal acts as, and nothing
 * where the authority says it may not: a pool's permit is `Execute` on its
 * project and a personal runner's is its owner's `RegisterPersonalRunner` in
 * its tenant, so revoking either is a revocation like any other and needs no
 * row deleted here. An authority that could not answer throws
 * `ProjectAccessUnavailable` through this function rather than resolving to
 * `undefined`, because a pool told it is not allowed stops where a pool told
 * to retry comes back.
 */
export async function workerPoolAdmitted(
  registry: WorkerPoolRegistry,
  personal: PersonalRunnerPlaneRegistry,
  access: ProjectAccess,
  principal: Principal,
): Promise<PoolPlaneIdentity | undefined> {
  const pool = await registry.identify(principal);
  if (pool !== undefined)
    return (await workerPoolExecutes(access, pool.partition, principal))
      ? { ...pool, kind: "Dedicated" }
      : undefined;
  const runner = await personal.identify(principal);
  if (runner === undefined) return undefined;
  return (await access.authorizeTenant(
    runner.owner,
    runner.tenant,
    "RegisterPersonalRunner",
  )) === undefined
    ? undefined
    : { ...runner, kind: "Personal" };
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

/** What one claim produced: the requirement the claimed attempt's execution recorded, and the runtime the attempt was opened under where it kept one. */
export interface WorkerPoolClaimed {
  readonly requirement: ExecutionRequirement;
  readonly runtime?: string;
}

/** What a claim is held to: how long the lease it takes runs, and how many live attempts the pool may hold with it. */
export interface WorkerPoolClaimTerms {
  readonly leaseSecs: number;
  readonly heldMax: number;
}

/**
 * The most owners one poll asks the authority about before a pool claims. Each
 * poll asks a window of the waiting owners drawn afresh, so an owner outside
 * this poll's is deferred to by this poll's claim alone and is in a later
 * poll's window by the same chance as any other.
 */
export const workerPoolOwnersAskedMax = 16;

/** The calls one kind of caller holds and settles what it claimed through, each scoped to its current registration and to what that registration claimed. */
export interface WorkerPoolExecutionHolds<Identity> {
  renew(
    identity: Identity,
    assignment: string,
    leaseSecs: number,
  ): Promise<boolean>;
  /** Records a refusal against the attempt it ends, with the image fault that caused it where the pool named one. */
  refuse(
    identity: Identity,
    assignment: string,
    evidence: string,
    fault?: WorkerImageFault,
  ): Promise<boolean>;
  release(identity: Identity, assignment: string): Promise<boolean>;
  held(identity: Identity, assignment: string): Promise<boolean>;
  /** The images pinned by the assignments this registration may still renew and the runtimes they were opened under, from at most `heldMax` of them. */
  heldImages(identity: Identity, heldMax: number): Promise<readonly string[]>;
}

/**
 * The durable side of an assignment's whole life, for whichever caller the
 * pool plane admitted. None of its calls names an execution or a task, because
 * a pool that could read one would learn the tenant's ticket structure.
 */
export interface WorkerPoolAssignments extends WorkerPoolExecutionHolds<PoolPlaneIdentity> {
  /** One claim by a pool, deferring to no runner of the owners named revoked. */
  claim(
    identity: WorkerPoolIdentity,
    terms: WorkerPoolClaimTerms,
    assignment: string,
    bearer: string,
    ownersRevoked: readonly Principal[],
  ): Promise<WorkerPoolClaimed | undefined>;
  /** At most `max` of the owners whose personal runners a claim by this pool would defer to, in an order `rotation` draws, so a fresh rotation draws a fresh window. */
  ownersDeferredTo(
    identity: WorkerPoolIdentity,
    max: number,
    rotation: string,
  ): Promise<readonly Principal[]>;
  /** One claim by a personal runner, in one of `projects` alone. */
  claimPersonal(
    identity: PersonalRunnerIdentity,
    terms: WorkerPoolClaimTerms,
    assignment: string,
    bearer: string,
    projects: readonly ProjectId[],
  ): Promise<WorkerPoolClaimed | undefined>;
  /** The projects a personal runner's current registration allowlists. */
  allowlisted(identity: PersonalRunnerIdentity): Promise<readonly ProjectId[]>;
  /** Records a personal runner's poll as one that could take an execution, under its current registration alone. */
  polled(identity: PersonalRunnerIdentity): Promise<void>;
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

/** Everything a poll reaches: each kind's durable side, the authority an owner is asked of, and where an assignment's name is drawn. */
export interface WorkerPoolPorts {
  readonly assignments: WorkerPoolAssignments;
  readonly sessions: WorkerPoolSessionPorts;
  readonly access: ProjectAccess;
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
async function workerPoolHeldReconciled<Identity>(
  renewing: {
    renew(
      identity: Identity,
      assignment: string,
      leaseSecs: number,
    ): Promise<boolean>;
  },
  identity: Identity,
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

/** Whether a personal runner's owner still holds both what admits it and `Read` of `partition`, which is the model's runner not revoked for an execution there. */
export async function workerPoolOwnerStands(
  access: ProjectAccess,
  owner: Principal,
  partition: Partition,
): Promise<boolean> {
  return (
    (await access.authorizeTenant(
      owner,
      partition.tenant,
      "RegisterPersonalRunner",
    )) !== undefined &&
    (await access.authorize(owner, partition, "Read")) !== undefined
  );
}

/** One claim's binding, decided for whichever caller the plane admitted with what the authority answered first. */
type WorkerPoolClaimMade = (
  assignment: string,
  bearer: string,
) => Promise<WorkerPoolClaimed | undefined>;

/**
 * How this caller claims: a pool deferring to no revoked owner's runner, and a
 * personal runner in the projects its owner may still read. Every answer is
 * the authority's before anything is claimed.
 */
async function workerPoolClaimMade(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  settings: WorkerPoolPollSettings,
): Promise<WorkerPoolClaimMade> {
  const { access, assignments } = ports;
  switch (identity.kind) {
    case "Dedicated": {
      const owners = await assignments.ownersDeferredTo(
        identity,
        workerPoolOwnersAskedMax,
        ports.mint(),
      );
      const revoked: Principal[] = [];
      for (const owner of owners)
        if (!(await workerPoolOwnerStands(access, owner, identity.partition)))
          revoked.push(owner);
      return (assignment, bearer) =>
        assignments.claim(identity, settings, assignment, bearer, revoked);
    }
    case "Personal": {
      const projects: ProjectId[] = [];
      for (const project of await assignments.allowlisted(identity))
        if (
          (await access.authorize(
            identity.owner,
            { tenant: identity.tenant, project },
            "Read",
          )) !== undefined
        )
          projects.push(project);
      return (assignment, bearer) =>
        projects.length === 0
          ? Promise.resolve(undefined)
          : assignments.claimPersonal(
              identity,
              settings,
              assignment,
              bearer,
              projects,
            );
    }
  }
}

/** The runtime an assignment names, by the host a pool pulls it from, where the attempt kept one and the pool's release reads it. */
function workerPoolClaimedRuntime(
  row: WorkerPoolClaimed,
  readsRuntime: boolean,
  imageHosts: WorkerPoolImageHosts,
): Pick<WorkerPoolAssignment, "runtime"> {
  return readsRuntime && row.runtime !== undefined
    ? { runtime: workerPoolImageHosted(row.runtime, imageHosts) }
    : {};
}

/**
 * The claims one poll makes, each one a row taken and bound to a fresh bearer
 * in the same statement. A caller with no room asks for none and none is
 * claimed, so a full pool's poll costs no row a pool with room could take and
 * no question of the authority.
 */
async function workerPoolClaims(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  settings: WorkerPoolPollSettings,
  wanted: number,
  readsRuntime: boolean,
): Promise<WorkerPoolAssignment[]> {
  const claimed: WorkerPoolAssignment[] = [];
  if (wanted <= 0) return claimed;
  const claim = await workerPoolClaimMade(ports, identity, settings);
  for (let taken = 0; taken < wanted; taken += 1) {
    const assignment = ports.mint();
    const bearer = ports.mint();
    const row = await claim(assignment, bearer);
    if (row === undefined) break;
    claimed.push({
      assignment,
      ...workerPoolClaimedPlacement(row.requirement, settings.imageHosts),
      ...workerPoolClaimedRuntime(row, readsRuntime, settings.imageHosts),
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
  identity: PoolPlaneIdentity,
  settings: WorkerPoolPollSettings,
  wanted: number,
): Promise<WorkerPoolSessionAssignment[]> {
  const apiUrl = settings.sessionApiUrl;
  if (apiUrl === undefined) return Promise.resolve([]);
  return workerPoolSessionClaims(
    ports.sessions,
    ports.access,
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
  identity: PoolPlaneIdentity,
  holding: WorkerPoolHolding,
  asked: Pick<WorkerPoolAsked, "wanted" | "wantedSessions" | "readsRuntime">,
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
      ports,
      identity,
      settings,
      Math.min(
        asked.wanted,
        settings.assignmentsPerPollMax,
        settings.heldMax - holding.jobs.length,
      ),
      asked.readsRuntime,
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
  identity: PoolPlaneIdentity,
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
 * Records this poll as the caller's last of each kind of work it could take: a
 * session, reading them with room for one or holding one from a plane that
 * names the API a session reaches, and, for a personal runner, an execution,
 * with room for one or holding one, which is what a pool's claim reads it as
 * live by.
 */
async function workerPoolPollRecorded(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  asked: WorkerPoolAsked,
  holding: WorkerPoolHolding,
  settings: WorkerPoolPollSettings,
): Promise<void> {
  if (
    settings.sessionApiUrl !== undefined &&
    asked.readsSessions &&
    (asked.wantedSessions > 0 || holding.sessions.length > 0)
  )
    await ports.sessions.store.polled(identity);
  if (
    identity.kind === "Personal" &&
    (asked.wanted > 0 || holding.jobs.length > 0)
  )
    await ports.assignments.polled(identity);
}

/**
 * The long poll: reconciliation until it has something to say or until the
 * bounded wait runs out, where an empty answer is correct and the pool asks
 * again. A held list longer than a kind's bound is refused whole, since a cut
 * one reads as a pool that let go of work it still runs.
 */
export async function workerPoolPoll(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
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
  await workerPoolPollRecorded(ports, identity, asked, holding, settings);
  const rooms = {
    wanted: asked.wanted,
    wantedSessions: asked.readsSessions ? asked.wantedSessions : 0,
    readsRuntime: asked.readsRuntime,
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

/** One settlement against the side `assignment` is held on, whichever kind of caller holds it. */
function workerPoolSettledOn<Identity>(
  settling: {
    held(identity: Identity, assignment: string): Promise<boolean>;
    refuse(
      identity: Identity,
      assignment: string,
      evidence: string,
      fault?: WorkerImageFault,
    ): Promise<boolean>;
    release(identity: Identity, assignment: string): Promise<boolean>;
  },
  identity: Identity,
  assignment: string,
  offered: AssignmentOutcome,
): Promise<boolean> {
  switch (offered.outcome) {
    case "Accepted":
      return settling.held(identity, assignment);
    case "Refused":
      return settling.refuse(
        identity,
        assignment,
        offered.evidence,
        offered.fault,
      );
    case "Unavailable":
      return settling.release(identity, assignment);
  }
}

/** A settlement as a session's rows record it: a refusal keeps its evidence and not its fault, a session running its site's own image. */
function workerPoolSessionSettlement(
  offered: AssignmentOutcome,
): AssignmentOutcome {
  return offered.outcome === "Refused"
    ? { outcome: "Refused", evidence: offered.evidence }
    : offered;
}

/**
 * One settlement a pool reports, made against the kind the assignment is: an
 * accepted one is already leased and needs no write, a refusal is recorded
 * against its attempt, and an unavailable releases it.
 */
export async function workerPoolSettled(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  assignment: string,
  offered: AssignmentOutcome,
): Promise<boolean> {
  if (
    (await ports.sessions.store.among(identity, [assignment])).has(assignment)
  )
    return workerPoolSettledOn(
      ports.sessions.store,
      identity,
      assignment,
      workerPoolSessionSettlement(offered),
    );
  return workerPoolSettledOn(ports.assignments, identity, assignment, offered);
}

/** The images pinned by what this registration may still renew of either kind, and the runtimes its jobs were opened under, each kind to its own bound. */
export async function workerPoolHeldImages(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
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
