/**
 * The ports a worker pool registers and polls through, and the reconciliation
 * one poll is.
 *
 * ONE CHANNEL DOES FOUR JOBS. A pool sends what it currently holds and is
 * answered with the assignments it may claim and the ones it must stop; the
 * same call extends the lease on everything it still holds, and a pool that
 * stops making it goes quiet, its leases run out, and the claim predicate that
 * already reclaims an expired attempt takes the work back. That is why there
 * is no heartbeat here, no capacity field and no job-status call: a pool at
 * capacity polls for the control signals alone, and liveness is the poll.
 *
 * NOTHING HERE READS THE TICKET MACHINE. An assignment is built from the row's
 * own denormalised columns and from the view the orchestrator materialised
 * before the claim, so the process serving pools never holds the journal, the
 * obligation or a domain type. What it hands out is the contract's assignment
 * and nothing wider.
 */
import { setTimeout as delay } from "node:timers/promises";

import type { WorkerPoolAssignment } from "../contract/workerPool.ts";
import { execution_profile } from "./executionProfile.ts";
import type { Principal } from "./principal.ts";
import type { ProjectAccess } from "./projectAccess.ts";
import type { Partition } from "./projectStore.ts";

/** One registered pool as its principal resolves it: whose it is, and what it declared. */
export interface WorkerPoolIdentity {
  readonly partition: Partition;
  readonly pool: string;
  readonly capabilities: readonly string[];
}

/** What registering one pool records: who it is at the issuer, and what it declared. */
export interface WorkerPoolRegistration {
  readonly partition: Partition;
  readonly pool: string;
  readonly capabilities: readonly string[];
  readonly clientId: string;
  readonly principal: Principal;
}

/**
 * Registration, deregistration and the lookup a poll resolves its pool by. No
 * secret passes through here — a pool authenticates as an OAuth2 client of the
 * issuer this installation already runs, and what a row keeps is the principal
 * that client's subject resolves to — and deregistration answers with the
 * client it took off rather than a flag, because the command that removes the
 * row is the one that has to remove the client and nothing else in this tree
 * may read a subject back out of a principal.
 */
export interface WorkerPoolRegistry {
  register(registration: WorkerPoolRegistration): Promise<boolean>;
  deregister(partition: Partition, pool: string): Promise<string | undefined>;
  identify(principal: Principal): Promise<WorkerPoolIdentity | undefined>;
}

/**
 * The pool one authenticated principal acts as, and nothing where the authority
 * says it may not: a registration is who the caller is and never what it may
 * do, `Execute` on the project is the permit, and revoking a pool is therefore a
 * revocation like any other and needs no row deleted here. An authority that
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

/** What one claim produced: the view the orchestrator had already resolved for it. */
export interface WorkerPoolClaimed {
  readonly view: unknown;
  readonly capabilities: readonly string[];
}

/**
 * The durable side of an assignment's whole life, every call scoped to the
 * pool that holds it. None of them names a task key, because a pool that could
 * read one would learn the tenant's ticket structure.
 */
export interface WorkerPoolAssignments {
  claim(
    identity: WorkerPoolIdentity,
    leaseSecs: number,
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
  readonly callbackUrl: string;
  readonly pollIntervalMs: number;
  readonly pollsMax: number;
}

/** What a poll answers: what the pool may take, and what it must stop. */
export interface WorkerPoolReconciliation {
  readonly assignments: readonly WorkerPoolAssignment[];
  readonly stop: readonly string[];
}

/** Draws the one-shot bearer an assignment's harness answers under. */
export type WorkerPoolMint = () => string;

/**
 * How large a box the work wants, read out of the materialised view's own
 * workload rather than out of any capability token. A workload that declared
 * no profile takes the profile parser's defaults, which is what the in-cluster
 * backend gives it too.
 */
function workerPoolAssignmentSize(view: unknown): {
  readonly cpuMillis: number;
  readonly memoryMib: number;
} {
  const declared = workerPoolViewProfile(view);
  const profile = execution_profile({
    required_capabilities: declared["required_capabilities"] ?? [],
    cpu: declared["cpu"],
    memory_mb: declared["memory_mb"],
  });
  return { cpuMillis: profile.cpu, memoryMib: profile.memory_mb };
}

/** The profile a materialised view's workload declared, or the empty one it did not. */
function workerPoolViewProfile(view: unknown): Record<string, unknown> {
  const workload = workerPoolRecord(view)["workload"];
  const declared = workerPoolRecord(workload)["execution_profile"];
  return workerPoolRecord(declared);
}

function workerPoolRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function workerPoolCheckedSettings(settings: WorkerPoolPollSettings): void {
  for (const [name, bound] of [
    ["leaseSecs", settings.leaseSecs],
    ["assignmentsPerPollMax", settings.assignmentsPerPollMax],
    ["heldMax", settings.heldMax],
    ["deadlineSecs", settings.deadlineSecs],
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
): Promise<readonly string[]> {
  const renewed = await Promise.all(
    held.map(async (assignment) => ({
      assignment,
      live: await assignments.renew(identity, assignment, leaseSecs),
    })),
  );
  return renewed.filter((row) => !row.live).map((row) => row.assignment);
}

/**
 * The claims one poll makes, each one a row taken and bound to a fresh bearer
 * in the same statement. A pool already holding its own limit sends its whole
 * list and asks for none, which is how a pool at capacity still gets its
 * control signals.
 */
async function workerPoolClaims(
  assignments: WorkerPoolAssignments,
  identity: WorkerPoolIdentity,
  settings: WorkerPoolPollSettings,
  mint: WorkerPoolMint,
  wanted: number,
): Promise<readonly WorkerPoolAssignment[]> {
  const claimed: WorkerPoolAssignment[] = [];
  for (let taken = 0; taken < wanted; taken += 1) {
    const assignment = mint();
    const bearer = mint();
    const row = await assignments.claim(
      identity,
      settings.leaseSecs,
      assignment,
      bearer,
    );
    if (row === undefined) break;
    claimed.push({
      assignment,
      capabilities: [...row.capabilities],
      ...workerPoolAssignmentSize(row.view),
      deadlineSecs: settings.deadlineSecs,
      callbackUrl: settings.callbackUrl,
      bearer,
    });
  }
  return claimed;
}

/** One reconciliation pass, which is a renewal of what is held and a claim of what is not. */
export async function workerPoolReconcile(
  assignments: WorkerPoolAssignments,
  identity: WorkerPoolIdentity,
  held: readonly string[],
  settings: WorkerPoolPollSettings,
  mint: WorkerPoolMint,
): Promise<WorkerPoolReconciliation> {
  workerPoolCheckedSettings(settings);
  if (held.length > settings.heldMax)
    throw new RangeError("worker pool holds more than its bound");
  const stop = await workerPoolHeldReconciled(
    assignments,
    identity,
    held,
    settings.leaseSecs,
  );
  const wanted = Math.min(
    settings.assignmentsPerPollMax,
    Math.max(settings.heldMax - held.length, 0),
  );
  return {
    assignments: await workerPoolClaims(
      assignments,
      identity,
      settings,
      mint,
      wanted,
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
  settings: WorkerPoolPollSettings,
  mint: WorkerPoolMint,
): Promise<WorkerPoolReconciliation> {
  let answer = await workerPoolReconcile(
    assignments,
    identity,
    held,
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
      settings,
      mint,
    );
  }
  return answer;
}
