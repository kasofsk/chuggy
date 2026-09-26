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
 */
import { setTimeout as delay } from "node:timers/promises";

import type {
  WorkerPoolAssignment,
  WorkerPoolReconciliation,
} from "../contract/workerPool.ts";
import type { ExecutionRequirement } from "./executionRequirement.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";
import {
  workerPoolPlatformToken,
  type WorkerPoolClass,
} from "./workerPoolAssignment.ts";
import {
  workerContractAccepted,
  type WorkerContractRange,
} from "./workerPlane.ts";

/**
 * The worker contract versions the pool plane serves. They start at the one
 * whose assignment names the pinned image, because a pool speaking an earlier
 * one would run its own image in that image's place.
 */
export const workerPoolContractAccepted: WorkerContractRange = {
  min: { major: 1, minor: 1 },
  max: workerContractAccepted.max,
};

/** One registered pool as its principal resolves it: whose it is, and the principal a claim is current under. */
export interface WorkerPoolIdentity {
  readonly partition: Partition;
  readonly pool: string;
  readonly principal: Principal;
}

/** What registering one pool records: who it is at the issuer, what it declared, and its class. */
export interface WorkerPoolRegistration {
  readonly partition: Partition;
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly class: WorkerPoolClass;
  readonly clientId: string;
  readonly principal: Principal;
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
  register(registration: WorkerPoolRegistration): Promise<boolean>;
  clientOf(partition: Partition, pool: string): Promise<string | undefined>;
  deregister(
    partition: Partition,
    pool: string,
    clientId: string,
  ): Promise<boolean>;
  identify(principal: Principal): Promise<WorkerPoolIdentity | undefined>;
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
  const authority = await access.authorize(
    principal,
    identity.partition,
    "Execute",
  );
  return authority === undefined ? undefined : identity;
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
 * pool that holds it. None of them names an execution or a task, because a
 * pool that could read one would learn the tenant's ticket structure.
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
  release(
    identity: WorkerPoolIdentity,
    assignment: string,
    retryAfterSecs: number,
  ): Promise<boolean>;
  held(identity: WorkerPoolIdentity, assignment: string): Promise<boolean>;
}

export interface WorkerPoolPollSettings {
  readonly leaseSecs: number;
  readonly assignmentsPerPollMax: number;
  readonly heldMax: number;
  readonly deadlineSecs: number;
  /** The box every assignment this plane hands out asks for, which is the deployment's. */
  readonly cpuMillis: number;
  readonly memoryMib: number;
  readonly callbackUrl: string;
  readonly pollIntervalMs: number;
  readonly pollsMax: number;
}

/** Draws an assignment's identity and the one-shot bearer its harness answers under. */
export type WorkerPoolMint = () => string;

function workerPoolCheckedSettings(settings: WorkerPoolPollSettings): void {
  for (const [name, bound] of [
    ["leaseSecs", settings.leaseSecs],
    ["assignmentsPerPollMax", settings.assignmentsPerPollMax],
    ["heldMax", settings.heldMax],
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

/**
 * The lease renewal and the cancellation delivery, which are one pass over
 * what the pool says it holds: a renewal that finds no live attempt of this
 * pool's is the stop flag, so asked-to-stop and already-gone are one answer
 * and a pool need not tell them apart.
 */
async function workerPoolHeldReconciled(
  assignments: WorkerPoolAssignments,
  identity: WorkerPoolIdentity,
  held: readonly string[],
  leaseSecs: number,
): Promise<string[]> {
  const renewed = await Promise.all(
    held.map(async (assignment) => ({
      assignment,
      live: await assignments.renew(identity, assignment, leaseSecs),
    })),
  );
  return renewed.filter((row) => !row.live).map((row) => row.assignment);
}

/**
 * What a pool is told of the requirement it was assigned: the platform and the
 * capabilities it places the workload by, as the tokens it declared them in,
 * and the image where the requirement pinned one.
 */
function workerPoolClaimedPlacement(
  requirement: ExecutionRequirement,
): Pick<WorkerPoolAssignment, "capabilities" | "image"> {
  switch (requirement.mode) {
    case "Container":
      return {
        capabilities: [workerPoolPlatformToken(requirement)],
        image: requirement.image,
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
      ...workerPoolClaimedPlacement(row.requirement),
      cpuMillis: settings.cpuMillis,
      memoryMib: settings.memoryMib,
      deadlineSecs: settings.deadlineSecs,
      callbackUrl: settings.callbackUrl,
      bearer,
    });
  }
  return claimed;
}

/**
 * One reconciliation pass, which is a renewal of what is held and a claim of
 * what is not. The pool's `wanted` is its room and the plane's settings are
 * the plane's, so what is claimed is the least of the three.
 */
export async function workerPoolReconcile(
  assignments: WorkerPoolAssignments,
  identity: WorkerPoolIdentity,
  held: readonly string[],
  wanted: number,
  settings: WorkerPoolPollSettings,
  mint: WorkerPoolMint,
): Promise<WorkerPoolReconciliation> {
  workerPoolCheckedSettings(settings);
  if (held.length > settings.heldMax)
    throw new RangeError("worker pool holds more than its bound");
  if (!Number.isSafeInteger(wanted) || wanted < 0)
    throw new RangeError("worker pool wanted must be a non-negative integer");
  const stop = await workerPoolHeldReconciled(
    assignments,
    identity,
    held,
    settings.leaseSecs,
  );
  const claimable = Math.min(
    wanted,
    settings.assignmentsPerPollMax,
    settings.heldMax - held.length,
  );
  return {
    assignments: await workerPoolClaims(
      assignments,
      identity,
      settings,
      mint,
      claimable,
    ),
    stop,
  };
}

/**
 * The long poll: reconciliation until it has something to say or until the
 * bounded wait runs out. An empty answer is a correct answer rather than a
 * failure, and the pool asks again.
 */
export async function workerPoolPoll(
  assignments: WorkerPoolAssignments,
  identity: WorkerPoolIdentity,
  held: readonly string[],
  wanted: number,
  settings: WorkerPoolPollSettings,
  mint: WorkerPoolMint,
): Promise<WorkerPoolReconciliation> {
  let answer = await workerPoolReconcile(
    assignments,
    identity,
    held,
    wanted,
    settings,
    mint,
  );
  for (
    let polled = 1;
    polled < settings.pollsMax &&
    answer.assignments.length === 0 &&
    answer.stop.length === 0;
    polled += 1
  ) {
    await delay(settings.pollIntervalMs);
    answer = await workerPoolReconcile(
      assignments,
      identity,
      held,
      wanted,
      settings,
      mint,
    );
  }
  return answer;
}
