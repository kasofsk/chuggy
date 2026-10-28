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
 * A JOB'S BOX IS THE ONE ITS TASK WAS RELEASED WITH. The execution keeps the
 * CPUs and memory its configuration named, and an assignment asks for each
 * field it names; a field it names none of is the plane's own setting. A
 * session is sized by the plane alone.
 *
 * A SESSION IS THE SAME CHANNEL'S SECOND KIND. A pool states its room for
 * sessions apart, and what it holds is told apart by the rows each kind lives
 * in, so each kind is renewed, bounded and claimed on its own;
 * `./workerPoolSessions.ts` says what claiming one opens. A poll that could take
 * a session is what a member's runner reads as live for a session by, so only
 * it is recorded as one; a personal runner's poll that could take an execution
 * is recorded apart, as what a pool's claim reads it as live by.
 *
 * A MEMBER'S PERSONAL RUNNER POLLS THE SAME CHANNEL. It is admitted by its row
 * in its tenant and its owner's standing permit to register one, since no
 * relation names its principal, and it claims its owner's executions in the
 * projects it allowlists that allow one, as its sessions are claimed: the
 * authority is asked whether its owner may still read each project before
 * anything is claimed, so an outage fails the poll with nothing claimed. Each
 * execution it is assigned names its project, to a poll whose release reads
 * one, since an earlier runner refuses the whole answer over it.
 *
 * A MEMBER'S CHAT HOST POLLS IT TOO, admitted as a personal runner is, by its
 * row and its owner's permit. It claims sessions and never an execution, and
 * may name how long a session it claims may sit idle, which the plane caps at
 * the scheduler's own bound; no other caller's poll is read for one.
 *
 * A POLL MAY NAME WHAT ITS CALLER CAN RUN: the set it names, and the most
 * memory it takes one job of, each replace the one recorded before anything
 * is claimed, so its own claims match them; a poll naming neither leaves the
 * record as it is. What the caller already holds was claimed under what was
 * recorded then, and is renewed and settled as before, since nothing after a
 * claim reads either.
 *
 * A POLL MAY NAME ITS ROOM, the memory it can give jobs now, and each job it
 * claims fits what the claims before it left of that room; a poll naming none
 * is claimed by count alone. A poll naming its room whose release reads it is
 * also told whether a job it would be given is still waiting, which ends at
 * once such a poll that wants no job, so a runner holding back learns there is
 * work it fits. A poll naming no room is never told, so a pool that wants no
 * job because it is full waits out its whole poll. A poll may name how long it
 * waits for an answer with nothing in it, up to the plane's own longest wait.
 *
 * A POOL'S CLAIM DEFERS TO AN OWNER'S PERSONAL RUNNERS as the owner's fallback
 * says, and a runner the authority revoked is none of the owner's, as the
 * model's `ownerRunners` reads it. The claim cannot ask the authority, so the
 * owners it would defer to are read first and asked, and the claim is told
 * which of them are revoked; an owner past the bound is not asked, and is
 * deferred to as though their runners stood.
 */
import { setTimeout as delay } from "node:timers/promises";

import type {
  AssignmentOutcome,
  WorkerPoolAssignment,
  WorkerPoolReconciliation,
  WorkerPoolSessionAssignment,
  WorkerRunner,
} from "../contract/workerPool.ts";
import type { WorkerImageFault } from "../contract/workerEnvironment.ts";
export { workerPoolsAnsweredMax } from "../contract/http.ts";
import type { ExecutionRequirement } from "./executionRequirement.ts";
import type { TaskResources } from "./taskResources.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition, ProjectId, TenantId } from "./projectStore.ts";
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
  workerContractRunnerJobsWaiting,
  workerContractRunnerProjects,
  type WorkerContractRange,
} from "./workerPlane.ts";
import type {
  ChatHostIdentity,
  PersonalRunnerIdentity,
  PoolPlaneIdentity,
  WorkerPoolIdentity,
  WorkerPoolMint,
} from "./workerPoolIdentity.ts";
export type {
  ChatHostIdentity,
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
import type { WorkerRunnerListed } from "./workerRunnerRelease.ts";

/**
 * The worker contract versions the pool plane serves, from the first in which
 * a pool reads a job assignment's runtime. An earlier pool starts the image's
 * own entrypoint, which an image a project chose need not have, so it is
 * refused at its poll rather than handed work it would run without chuggy.
 */
export const workerPoolContractAccepted: WorkerContractRange = {
  min: { major: 1, minor: 7 },
  max: workerContractAccepted.max,
};

/** What one poll asks: what the pool holds, its room for executions and for sessions, the runner it named, the capabilities it has, the most memory, in MiB, it takes one job of, the memory it has room for now, the longest it waits for an empty answer, how long a session it claims may sit idle and the contract release it offered, where it named each. */
export interface WorkerPoolAsked {
  readonly held: readonly string[];
  readonly wanted: number;
  readonly wantedSessions: number;
  readonly runner?: WorkerRunner;
  readonly capabilities?: readonly string[];
  readonly memoryCeilingMib?: number;
  readonly memoryRoomMib?: number;
  readonly pollWaitSecs?: number;
  readonly idleSecs?: number;
  readonly contract?: string;
}

/** The memory, in MiB, an execution naming none runs with on a pool, where the plane names no size of its own. */
export const workerPoolMemoryMibDefault = 4_096;

/** What registering one pool records: who it is at the issuer, what it declared, and its class. */
export interface WorkerPoolRegistration {
  readonly partition: Partition;
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly class: WorkerPoolClass;
  readonly clientId: string;
  readonly principal: Principal;
  /** The person whose token registered the pool, recorded as who registered it; every pool is handed its project's lead alone. */
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

/** One registered pool as the scheduler reads it: its identity, what it declared, the memory ceiling its polls named where they named one, and its class. */
export interface WorkerPoolRegistered extends WorkerPoolIdentity {
  readonly capabilities: readonly string[];
  readonly memoryCeilingMib: number | undefined;
  readonly class: WorkerPoolClass;
}

/** One project's registered pools, `truncated` saying it holds more than this answers. */
export interface WorkerPoolRosterPage {
  readonly pools: readonly WorkerPoolRegistered[];
  readonly truncated: boolean;
}

/** One registered pool as a project's members read it, with the runner its newest poll named where it named one. */
export interface WorkerPoolListed {
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly registeredAt: string;
  readonly runner?: WorkerRunnerListed;
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

/** The registry as the scheduler reads it, which is a project's pools, a member's personal runners, and nothing a registration or a poll writes. */
export interface WorkerPoolRoster {
  registered(partition: Partition): Promise<WorkerPoolRosterPage>;
  personal(
    partition: Partition,
    owner: Principal,
  ): Promise<readonly PersonalRunnerRegistered[]>;
}

/** One of a member's personal runners as the scheduler reads it: who it is, what it declared, the memory ceiling its polls named where they named one, and the projects its owner's allowlist names. */
export interface PersonalRunnerRegistered {
  readonly owner: Principal;
  readonly principal: Principal;
  readonly capabilities: readonly string[];
  readonly memoryCeilingMib: number | undefined;
  readonly allowlist: readonly Partition[];
}

/** The lookup a poll resolves a member's personal runner by: its row, in a tenant, by the principal its client resolves to. */
export interface PersonalRunnerPlaneRegistry {
  identify(principal: Principal): Promise<PersonalRunnerIdentity | undefined>;
}

/** The lookup a poll resolves a member's chat host by: its row, in a tenant, by the principal its client resolves to. */
export interface ChatHostPlaneRegistry {
  identify(principal: Principal): Promise<ChatHostIdentity | undefined>;
}

/** The registries a poll's principal is looked up in, a pool's first. */
export interface PoolPlaneRegistries {
  readonly pools: WorkerPoolRegistry;
  readonly personal: PersonalRunnerPlaneRegistry;
  readonly chatHosts: ChatHostPlaneRegistry;
}

/** Whether a member's owner still holds the tenant's permit a personal runner and a chat host are both registered and admitted under. */
async function workerPoolMemberPermitted(
  access: ProjectAccess,
  member: { readonly tenant: TenantId; readonly owner: Principal },
): Promise<boolean> {
  return (
    (await access.authorizeTenant(
      member.owner,
      member.tenant,
      "RegisterPersonalRunner",
    )) !== undefined
  );
}

/**
 * The pool, personal runner or chat host one authenticated principal acts as,
 * and nothing where the authority says it may not: a pool's permit is
 * `Execute` on its project, and a personal runner's and a chat host's is their
 * owner's `RegisterPersonalRunner` in their tenant, so revoking either is a
 * revocation like any other and needs no row deleted here. An authority that
 * could not answer throws `ProjectAccessUnavailable` through this function
 * rather than resolving to `undefined`, because a pool told it is not allowed
 * stops where a pool told to retry comes back.
 */
export async function workerPoolAdmitted(
  registries: PoolPlaneRegistries,
  access: ProjectAccess,
  principal: Principal,
): Promise<PoolPlaneIdentity | undefined> {
  const pool = await registries.pools.identify(principal);
  if (pool !== undefined)
    return (await workerPoolExecutes(access, pool.partition, principal))
      ? { ...pool, kind: "Dedicated" }
      : undefined;
  const runner = await registries.personal.identify(principal);
  if (runner !== undefined)
    return (await workerPoolMemberPermitted(access, runner))
      ? { ...runner, kind: "Personal" }
      : undefined;
  const host = await registries.chatHosts.identify(principal);
  if (host === undefined) return undefined;
  return (await workerPoolMemberPermitted(access, host))
    ? { ...host, kind: "ChatHost" }
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

/** What one claim produced: the requirement and the size the claimed attempt's execution recorded, and the runtime the attempt was opened under where it kept one. */
export interface WorkerPoolClaimed {
  readonly requirement: ExecutionRequirement;
  readonly resources?: TaskResources;
  readonly runtime?: string;
}

/** What a personal runner's claim produced: a claim's, and the project of the attempt it took. */
export interface WorkerPoolPersonalClaimed extends WorkerPoolClaimed {
  readonly project: ProjectId;
}

/** What a claim is held to: how long the lease it takes runs, how many live attempts the pool may hold with it, the memory, in MiB, an execution naming none is sized at, and the most memory the execution it takes may have where its poll named its room. */
export interface WorkerPoolClaimTerms {
  readonly leaseSecs: number;
  readonly heldMax: number;
  readonly memoryMibDefault: number;
  readonly memoryRoomMib?: number;
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
  ): Promise<WorkerPoolPersonalClaimed | undefined>;
  /** Whether `claim` on the same terms would take an attempt now, taking none. */
  waiting(
    identity: WorkerPoolIdentity,
    terms: WorkerPoolClaimTerms,
    ownersRevoked: readonly Principal[],
  ): Promise<boolean>;
  /** Whether `claimPersonal` on the same terms would take an attempt now, taking none. */
  waitingPersonal(
    identity: PersonalRunnerIdentity,
    terms: WorkerPoolClaimTerms,
    projects: readonly ProjectId[],
  ): Promise<boolean>;
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
  /** The box an assignment asks for in each field its execution names no size of, and every session's. */
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

/**
 * Where what a caller's newest poll named is kept, under its current
 * registration alone: the runner, which a poll naming none keeps none of, so a
 * machine moved back to a runner too old to name itself is not shown as the
 * version it left; and the capabilities and the memory ceiling, which a poll
 * naming none leaves as they were recorded.
 */
export interface WorkerPoolRunners {
  named(
    identity: PoolPlaneIdentity,
    runner: WorkerRunner | undefined,
    capabilities: readonly string[] | undefined,
    memoryCeilingMib?: number,
  ): Promise<void>;
}

/** Everything a poll reaches: each kind's durable side, where its runner is kept, the authority an owner is asked of, and where an assignment's name is drawn. */
export interface WorkerPoolPorts {
  readonly assignments: WorkerPoolAssignments;
  readonly sessions: WorkerPoolSessionPorts;
  readonly runners: WorkerPoolRunners;
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

/** The most a poll's `held` may name, which is both kinds' bounds. */
export function workerPoolHeldNamedMax(
  settings: WorkerPoolPollSettings,
): number {
  return settings.heldMax + settings.sessionsHeldMax;
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
    case "Capability":
      return {
        capabilities: [
          workerPoolPlatformToken(requirement),
          ...requirement.capabilities,
        ],
      };
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

/** How one caller claims, decided for whichever caller the plane admitted with what the authority answered first: each claim held to the room it is given, and whether a claim in a room would take anything. */
interface WorkerPoolClaimer {
  claim(
    assignment: string,
    bearer: string,
    memoryRoomMib: number | undefined,
  ): Promise<WorkerPoolClaimed | WorkerPoolPersonalClaimed | undefined>;
  waiting(memoryRoomMib: number | undefined): Promise<boolean>;
}

/**
 * How this caller claims: a pool deferring to no revoked owner's runners, a
 * personal runner in the projects its owner may still read, and a chat host
 * nothing, since it takes sessions alone. Every answer is the authority's
 * before anything is claimed.
 */
async function workerPoolClaimMade(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  settings: WorkerPoolPollSettings,
): Promise<WorkerPoolClaimer> {
  const { access, assignments } = ports;
  const held = (memoryRoomMib: number | undefined): WorkerPoolClaimTerms => ({
    leaseSecs: settings.leaseSecs,
    heldMax: settings.heldMax,
    memoryMibDefault: settings.memoryMib,
    ...(memoryRoomMib === undefined ? {} : { memoryRoomMib }),
  });
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
      return {
        claim: (assignment, bearer, room) =>
          assignments.claim(identity, held(room), assignment, bearer, revoked),
        waiting: (room) => assignments.waiting(identity, held(room), revoked),
      };
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
      if (projects.length === 0)
        return {
          claim: () => Promise.resolve(undefined),
          waiting: () => Promise.resolve(false),
        };
      return {
        claim: (assignment, bearer, room) =>
          assignments.claimPersonal(
            identity,
            held(room),
            assignment,
            bearer,
            projects,
          ),
        waiting: (room) =>
          assignments.waitingPersonal(identity, held(room), projects),
      };
    }
    case "ChatHost":
      return {
        claim: () => Promise.resolve(undefined),
        waiting: () => Promise.resolve(false),
      };
  }
}

/**
 * The project an assignment names: a personal runner's claimed attempt's own,
 * where the release its poll offered reads one, and none for a pool's claim.
 */
function workerPoolClaimedProject(
  row: WorkerPoolClaimed | WorkerPoolPersonalClaimed,
  contract: string | undefined,
): Pick<WorkerPoolAssignment, "project"> {
  return "project" in row &&
    contractVersionAccepted(workerContractRunnerProjects, contract)
    ? { project: row.project }
    : {};
}

/** The runtime an assignment names, by the host a pool pulls it from, where the attempt kept one. */
function workerPoolClaimedRuntime(
  row: WorkerPoolClaimed,
  imageHosts: WorkerPoolImageHosts,
): Pick<WorkerPoolAssignment, "runtime"> {
  return row.runtime !== undefined
    ? { runtime: workerPoolImageHosted(row.runtime, imageHosts) }
    : {};
}

/** What a poll's room is left at once a job of `memoryMib` is claimed in it, which a claim never takes past. */
function workerPoolRoomLeft(
  memoryRoomMib: number | undefined,
  memoryMib: number,
): number | undefined {
  if (memoryRoomMib === undefined) return undefined;
  if (memoryMib > memoryRoomMib)
    throw new Error("a worker pool claim took a job larger than its room");
  return memoryRoomMib - memoryMib;
}

/**
 * The claims one poll makes, each one a row taken and bound to a fresh bearer
 * in the same statement and each fitting the room the claims before it left,
 * and, for a poll naming its room whose release reads it, whether one more is
 * waiting, which a claim that took nothing answers without asking, as does a
 * room of nothing that wants none, since no job fits it. Any other caller that
 * wants no job asks for none and none is claimed, so a full pool's or runner's
 * poll costs no row a pool with room could take and no question of the
 * authority.
 */
async function workerPoolClaims(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  settings: WorkerPoolPollSettings,
  asked: {
    readonly wanted: number;
    readonly memoryRoomMib?: number;
    readonly contract?: string;
  },
): Promise<Pick<WorkerPoolReconciliation, "assignments" | "jobsWaiting">> {
  const { wanted } = asked;
  const answersWaiting =
    asked.memoryRoomMib !== undefined &&
    contractVersionAccepted(workerContractRunnerJobsWaiting, asked.contract);
  const assignments: WorkerPoolAssignment[] = [];
  if (wanted <= 0 && !answersWaiting) return { assignments };
  if (wanted <= 0 && asked.memoryRoomMib === 0)
    return { assignments, jobsWaiting: false };
  const claimer = await workerPoolClaimMade(ports, identity, settings);
  let room = asked.memoryRoomMib;
  let exhausted = false;
  for (let taken = 0; taken < wanted; taken += 1) {
    const assignment = ports.mint();
    const bearer = ports.mint();
    const row = await claimer.claim(assignment, bearer, room);
    if (row === undefined) {
      exhausted = true;
      break;
    }
    const memoryMib = row.resources?.memoryMib ?? settings.memoryMib;
    room = workerPoolRoomLeft(room, memoryMib);
    assignments.push({
      assignment,
      ...workerPoolClaimedPlacement(row.requirement, settings.imageHosts),
      ...workerPoolClaimedRuntime(row, settings.imageHosts),
      ...workerPoolClaimedProject(row, asked.contract),
      cpuMillis: row.resources?.cpuMillis ?? settings.cpuMillis,
      memoryMib,
      deadlineSecs: settings.deadlineSecs,
      callbackUrl: settings.callbackUrl,
      bearer,
    });
  }
  if (!answersWaiting) return { assignments };
  return {
    assignments,
    jobsWaiting: !exhausted && (await claimer.waiting(room)),
  };
}

/** The sessions one pass claims, which is none on a plane that names no API for a session to reach. */
function workerPoolSessionsClaimed(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  settings: WorkerPoolPollSettings,
  asked: { readonly wanted: number; readonly idleSecs?: number },
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
    asked,
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
  asked: Pick<
    WorkerPoolAsked,
    "wanted" | "wantedSessions" | "memoryRoomMib" | "idleSecs" | "contract"
  >,
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
  const claimed = await workerPoolClaims(ports, identity, settings, {
    wanted: Math.min(
      asked.wanted,
      settings.assignmentsPerPollMax,
      settings.heldMax - holding.jobs.length,
    ),
    ...(asked.memoryRoomMib === undefined
      ? {}
      : { memoryRoomMib: asked.memoryRoomMib }),
    ...(asked.contract === undefined ? {} : { contract: asked.contract }),
  });
  return {
    assignments: claimed.assignments,
    ...(claimed.jobsWaiting === undefined
      ? {}
      : { jobsWaiting: claimed.jobsWaiting }),
    sessions: await workerPoolSessionsClaimed(ports, identity, settings, {
      wanted: Math.min(
        asked.wantedSessions,
        settings.sessionsPerPollMax,
        settings.sessionsHeldMax - holding.sessions.length,
      ),
      ...(asked.idleSecs === undefined ? {} : { idleSecs: asked.idleSecs }),
    }),
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

/** What the pool holds, told apart by kind. */
async function workerPoolHoldingRead(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  asked: WorkerPoolAsked,
): Promise<WorkerPoolHolding> {
  const sessions = await ports.sessions.store.among(identity, asked.held);
  return {
    jobs: asked.held.filter((assignment) => !sessions.has(assignment)),
    sessions: asked.held.filter((assignment) => sessions.has(assignment)),
  };
}

/**
 * Records the runner this poll named, and the capabilities it has and the
 * memory ceiling it takes jobs under where it named them, and the poll as the
 * caller's last of each kind of work it could take: a session, with room for
 * one or holding one from a plane that names the API a session reaches, and,
 * for a personal runner, an execution, with room for one, holding one, or
 * naming a memory room above nothing, which a runner holding back from
 * claiming names while it would take what fits and a runner taking nothing
 * names as 0. That is what a pool's claim reads a personal runner as live by.
 */
async function workerPoolPollRecorded(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  asked: WorkerPoolAsked,
  holding: WorkerPoolHolding,
  settings: WorkerPoolPollSettings,
): Promise<void> {
  await ports.runners.named(
    identity,
    asked.runner,
    asked.capabilities,
    asked.memoryCeilingMib,
  );
  if (
    settings.sessionApiUrl !== undefined &&
    (asked.wantedSessions > 0 || holding.sessions.length > 0)
  )
    await ports.sessions.store.polled(identity);
  if (
    identity.kind === "Personal" &&
    (asked.wanted > 0 ||
      holding.jobs.length > 0 ||
      (asked.memoryRoomMib ?? 0) > 0)
  )
    await ports.assignments.polled(identity);
}

/** How many passes a poll makes at most: the plane's own, or no more than the wait its poll named lets follow the first. */
function workerPoolPollPasses(
  settings: WorkerPoolPollSettings,
  pollWaitSecs: number | undefined,
): number {
  return pollWaitSecs === undefined
    ? settings.pollsMax
    : Math.min(
        settings.pollsMax,
        1 + Math.floor((pollWaitSecs * 1_000) / settings.pollIntervalMs),
      );
}

/**
 * The long poll: reconciliation until it has something to say, or a job its
 * caller would be given is waiting, or the bounded wait runs out, where an
 * empty answer is correct and the pool asks again. A held list longer than a
 * kind's bound is refused whole, since a cut one reads as a pool that let go
 * of work it still runs.
 */
export async function workerPoolPoll(
  ports: WorkerPoolPorts,
  identity: PoolPlaneIdentity,
  asked: WorkerPoolAsked,
  settings: WorkerPoolPollSettings,
): Promise<WorkerPoolPolled> {
  workerPoolCheckedSettings(settings);
  for (const [name, count] of [
    ["wanted", asked.wanted],
    ["wantedSessions", asked.wantedSessions],
    ["memoryCeilingMib", asked.memoryCeilingMib ?? 0],
    ["memoryRoomMib", asked.memoryRoomMib ?? 0],
    ["pollWaitSecs", asked.pollWaitSecs ?? 0],
  ] as const)
    if (!Number.isSafeInteger(count) || count < 0)
      throw new RangeError(
        `worker pool ${name} must be a non-negative integer`,
      );
  if (
    asked.idleSecs !== undefined &&
    (!Number.isSafeInteger(asked.idleSecs) || asked.idleSecs < 1)
  )
    throw new RangeError("worker pool idleSecs must be a positive integer");
  const holding = await workerPoolHoldingRead(ports, identity, asked);
  if (
    holding.jobs.length > settings.heldMax ||
    holding.sessions.length > settings.sessionsHeldMax
  )
    return { polled: "HeldOverBound" };
  await workerPoolPollRecorded(ports, identity, asked, holding, settings);
  let answer = await workerPoolReconcile(
    ports,
    identity,
    holding,
    asked,
    settings,
  );
  const passes = workerPoolPollPasses(settings, asked.pollWaitSecs);
  for (
    let polled = 1;
    polled < passes &&
    answer.assignments.length === 0 &&
    answer.sessions.length === 0 &&
    answer.stop.length === 0 &&
    answer.jobsWaiting !== true;
    polled += 1
  ) {
    await delay(settings.pollIntervalMs);
    answer = await workerPoolReconcile(
      ports,
      identity,
      holding,
      asked,
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
