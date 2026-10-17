/**
 * When a worker pool may be assigned an execution, and what can be said of an
 * execution no pool has taken: `model/runner.qnt`'s `canAssign` and
 * `placementOutcome`, restated for a pool.
 *
 * THIS IS A REFINEMENT AND NOT A SECOND OPINION. Every predicate below has a
 * counterpart in `model/runner.qnt` of the same name, the paragraphs below say
 * where a pool reads a term differently, and `test/interpreter/runner.test.ts`
 * reads the model at run time to hold the two together; its header names what
 * it reads. Nothing here takes a row. The claim that binds an assignment is a
 * PostgreSQL predicate, because only under the row lock is it exclusive, and
 * this states what that predicate must decide.
 *
 * A POOL IS THE MODEL'S RUNNER, SCOPED BY PROJECT. An execution draws on its
 * project's capacity account, which names no other project, so a pool's
 * partition standing equal to the execution's is the model's
 * `r.account == e.account`, and a personal pool's allowlist of partitions is
 * the model's `r.allowlist`. Registering a pool
 * enables it, withholding `Execute` from its principal revokes it, and
 * registering it again mints a new principal, which is the generation a
 * session is current under. A poll is the session: it resolves to one pool,
 * authenticates as a principal whose token is its lease, and holds its slots
 * against the plane's bound.
 *
 * ONE INVENTORY, BECAUSE A POLL ADVERTISES NONE. What a pool runs is what its
 * registration declares among its capability tokens: platforms, and
 * whatever else its owner declared. The model matches a session's observed inventory in
 * `canAssign` and a retained one in `placementOutcome`, and here both are the
 * registration's, which is `inventoryObservationSafe` holding by there being
 * one copy. So a configured pool's inventory is already its poll's, and
 * `placementOutcome` does not match it again for a pool it would place.
 *
 * THE POLICY THE REGISTRY HAS NO COLUMN FOR IS DATA, NOT AN OMISSION. Class,
 * drain, trust, the allowance of secrets and source, an owner and an allowlist are
 * the model's administrator-owned authority, and the route and a demand on
 * each of them are the model's `ExecutionProfile`. The registry carries a
 * pool's class, and a personal pool's owner and allowlist; every other term of
 * its policy is `workerPoolPolicyRegistered`'s. An execution carries its owner
 * and the fallback its project named, and every other term of its demand is
 * `workerPoolDemandRouted`'s, which `workerPoolDemandOf` reads it with; the
 * guard reads both as it reads any other field, so a registry that carries
 * more of them changes values and not terms.
 *
 * AN OWNER'S FALLBACK READS EVERY POOL, as the model's reads every runner: a
 * pool other than a personal one takes an owned execution only as the
 * demand's fallback allows, which turns on the owner's personal pools
 * configured for it and whether any of them is polling. So the guard and the
 * outcome are asked of a pool beside the registry it is one of.
 *
 * THE SCHEDULER ASKS THE OUTCOME OF THE REGISTRY AND THE AUTHORITY. A poll is
 * not durable, so the scheduler sees no session and no pool is placeable to
 * it. A registered pool is enabled, and revoked where the authority withholds
 * the `Execute` its polls are admitted by; an owner's personal pool is revoked
 * where it withholds the permit its polls are admitted by, or the owner's
 * `Read` of the project its claims are asked under.
 */

import type {
  ExecutionRoute,
  ExecutionStatus,
  LogicalExecution,
} from "./executionScheduler.ts";
import type { ExecutionRequirement, Platform } from "./executionRequirement.ts";
import type { Principal } from "./principal.ts";
import type { WorkerPoolOwnerFallback } from "./projectOwnerFallback.ts";
import type { Partition } from "./projectStore.ts";
export {
  allWorkerPoolOwnerFallbacks,
  type WorkerPoolOwnerFallback,
} from "./projectOwnerFallback.ts";

/** The model's `RunnerClass`, and the roster the type derives from. */
export const allWorkerPoolClasses = [
  "Personal",
  "Dedicated",
  "Shared",
] as const;
export type WorkerPoolClass = (typeof allWorkerPoolClasses)[number];

/** Narrows text to the class it names, refusing one the model does not know. */
export function asWorkerPoolClass(value: string): WorkerPoolClass {
  const known = allWorkerPoolClasses.find((named) => named === value);
  if (known === undefined)
    throw new RangeError(`worker pool class: ${value} is not a known class`);
  return known;
}

/** The model's `PlacementPhase`: an execution's placement waits, is assigned, has a result pending, or was cancelled. */
export const allWorkerPoolPlacementPhases = [
  "Waiting",
  "Assigned",
  "ResultPending",
  "PlacementCancelled",
] as const;
export type WorkerPoolPlacementPhase =
  (typeof allWorkerPoolPlacementPhases)[number];

/** The model's `PlacementOutcome`, which is what can be said of an execution routed to pools that none has taken. */
export const allWorkerPoolPlacementOutcomes = [
  "NotApplicable",
  "Placeable",
  "Unavailable",
  "DefinitiveIncompatibility",
] as const;
export type WorkerPoolPlacementOutcome =
  (typeof allWorkerPoolPlacementOutcomes)[number];

/** The administrator-owned policy of the model's `Runner`; an owner is a principal, undefined where the model writes 0 for none. */
export interface WorkerPoolPolicy {
  readonly class: WorkerPoolClass;
  readonly draining: boolean;
  readonly trust: number;
  readonly secretsAllowed: boolean;
  readonly sourceAllowed: boolean;
  readonly dedicatedOwner: Principal | undefined;
  readonly allowlist: readonly Partition[];
}

/** What the model's `ExecutionProfile` demands of a runner beside the route; an owner is a principal, undefined where the model writes 0 for none. */
export interface WorkerPoolDemand {
  readonly personalRunnerAllowed: boolean;
  readonly trustMin: number;
  readonly secretsRequired: boolean;
  readonly sourceRequired: boolean;
  readonly dedicatedOwnerRequired: Principal | undefined;
  readonly ownerOf: Principal | undefined;
  readonly ownerFallback: WorkerPoolOwnerFallback;
}

/** The policy a pool is registered with; the registry carries its class per pool and none of the rest. */
export const workerPoolPolicyRegistered: WorkerPoolPolicy = {
  class: "Dedicated",
  draining: false,
  trust: 1,
  secretsAllowed: true,
  sourceAllowed: true,
  dedicatedOwner: undefined,
  allowlist: [],
};

/** The demand an execution routed to a pool is pinned with where its project allows no personal pool and it has no owner, so no fallback is taken: the registered trust, and secrets and source both, since a task is handed credentials and a clone. */
export const workerPoolDemandRouted: WorkerPoolDemand = {
  personalRunnerAllowed: false,
  trustMin: 1,
  secretsRequired: true,
  sourceRequired: true,
  dedicatedOwnerRequired: undefined,
  ownerOf: undefined,
  ownerFallback: "Preferred",
};

/** The demand one execution was pinned with: the routed demand, its owner, and the fallback its project named, which is what allows a personal pool. */
export function workerPoolDemandOf(
  execution: Pick<LogicalExecution, "owner" | "ownerFallback">,
): WorkerPoolDemand {
  return {
    ...workerPoolDemandRouted,
    personalRunnerAllowed: execution.ownerFallback !== undefined,
    ownerOf: execution.owner,
    ownerFallback:
      execution.ownerFallback ?? workerPoolDemandRouted.ownerFallback,
  };
}

/** A registered pool as the model's `Runner`: its partition and name are the runner's identity, and its principal the session generation. */
export interface WorkerPoolRunner extends WorkerPoolPolicy {
  readonly partition: Partition;
  readonly pool: string;
  readonly principal: Principal;
  readonly enabled: boolean;
  readonly revoked: boolean;
  readonly capabilities: readonly string[];
}

/** One poll as the model's `RunnerSession`: the pool it resolved to, the principal it authenticated as, whether its token is live, and its slots. */
export interface WorkerPoolSession {
  readonly partition: Partition;
  readonly pool: string;
  readonly principal: Principal;
  readonly leaseOpen: boolean;
  readonly held: number;
  readonly heldMax: number;
}

/** An execution as the guard reads it: its logical status, the phase of its placement, and the requirement, route and demand it was pinned with. */
export interface WorkerPoolPlacement {
  readonly partition: Partition;
  readonly status: ExecutionStatus;
  readonly phase: WorkerPoolPlacementPhase;
  readonly requirement: ExecutionRequirement;
  readonly route: ExecutionRoute;
  readonly demand: WorkerPoolDemand;
}

/** A registered pool beside the poll it is making, if it is making one. */
export interface WorkerPoolEnrolment {
  readonly pool: WorkerPoolRunner;
  readonly session: WorkerPoolSession | undefined;
}

/** The capability token a pool declares a platform with. */
export function workerPoolPlatformToken(platform: Platform): string {
  return `Platform:${platform.operatingSystem}:${platform.architecture}`;
}

function workerPoolSamePartition(left: Partition, right: Partition): boolean {
  return left.tenant === right.tenant && left.project === right.project;
}

/** Whether a pool's registration declares what the requirement runs on, which is the model's `inventoryMatches`. */
export function workerPoolInventoryMatches(
  requirement: ExecutionRequirement,
  pool: WorkerPoolRunner,
): boolean {
  switch (requirement.mode) {
    case "Container":
      return pool.capabilities.includes(workerPoolPlatformToken(requirement));
    case "Capability":
      return (
        pool.capabilities.includes(workerPoolPlatformToken(requirement)) &&
        requirement.capabilities.every((capability) =>
          pool.capabilities.includes(capability),
        )
      );
  }
}

/**
 * Whether the route and the pool's standing configure it for this execution,
 * which is the model's `policyConfigures`: drain aside, since drain is posture
 * and not incompatibility. A personal pool serves its owner's executions in
 * the partitions it allowlists; every other pool serves its own partition.
 */
export function workerPoolPolicyConfigures(
  pool: WorkerPoolRunner,
  placement: WorkerPoolPlacement,
): boolean {
  const demand = placement.demand;
  const personal = pool.class === "Personal";
  return (
    placement.route === "Pool" &&
    (personal ||
      workerPoolSamePartition(pool.partition, placement.partition)) &&
    pool.enabled &&
    !pool.revoked &&
    (!personal || demand.personalRunnerAllowed) &&
    (!personal || demand.ownerOf !== undefined) &&
    (!personal || pool.dedicatedOwner === demand.ownerOf) &&
    (!personal ||
      pool.allowlist.some((allowed) =>
        workerPoolSamePartition(allowed, placement.partition),
      )) &&
    pool.trust >= demand.trustMin &&
    (!demand.secretsRequired || pool.secretsAllowed) &&
    (!demand.sourceRequired || pool.sourceAllowed) &&
    (demand.dedicatedOwnerRequired === undefined ||
      pool.dedicatedOwner === demand.dedicatedOwnerRequired)
  );
}

/** Whether the pool may be assigned this execution now, which is the model's `policyAllows`: its `policyConfigures` and not draining. */
export function workerPoolPolicyAllows(
  pool: WorkerPoolRunner,
  placement: WorkerPoolPlacement,
): boolean {
  return !pool.draining && workerPoolPolicyConfigures(pool, placement);
}

/** Whether this poll is the pool's current session, which is the model's `sessionIsCurrent`. */
export function workerPoolSessionIsCurrent(
  pool: WorkerPoolRunner,
  session: WorkerPoolSession,
): boolean {
  return (
    workerPoolSamePartition(session.partition, pool.partition) &&
    session.pool === pool.pool &&
    session.principal === pool.principal &&
    session.leaseOpen
  );
}

/** Whether the poll holds fewer than the plane's bound, which is the model's `sessionHasSlot`. */
export function workerPoolSessionHasSlot(session: WorkerPoolSession): boolean {
  if (!Number.isSafeInteger(session.held) || session.held < 0)
    throw new RangeError("worker pool held must be a non-negative integer");
  if (!Number.isSafeInteger(session.heldMax) || session.heldMax <= 0)
    throw new RangeError("worker pool heldMax must be a positive integer");
  return session.held < session.heldMax;
}

/** The owner's personal pools configured for the execution, which is the model's `ownerRunners`: configured as `workerPoolPlacementOutcome` configures a pool, so able to run its requirement. */
export function workerPoolOwnerPools(
  placement: WorkerPoolPlacement,
  registry: readonly WorkerPoolEnrolment[],
): readonly WorkerPoolEnrolment[] {
  return registry.filter(
    ({ pool }) =>
      pool.class === "Personal" &&
      workerPoolPolicyConfigures(pool, placement) &&
      workerPoolInventoryMatches(placement.requirement, pool),
  );
}

/** Whether the pool takes new work under its current registration, which is the model's `runnerIsLive`: a draining pool is not live. */
export function workerPoolIsLive({
  pool,
  session,
}: WorkerPoolEnrolment): boolean {
  return (
    !pool.draining &&
    session !== undefined &&
    workerPoolSessionIsCurrent(pool, session)
  );
}

/**
 * Whether the owner's fallback lets the pool take the execution now, which is
 * the model's `ownerFallbackAllows`: under a Strict fallback no owner's
 * personal pool, and under either none of them live. An outcome configures a
 * pool without it, since it refuses one only for an owner's pool that is
 * itself configured.
 */
export function workerPoolOwnerFallbackAllows(
  pool: WorkerPoolRunner,
  placement: WorkerPoolPlacement,
  registry: readonly WorkerPoolEnrolment[],
): boolean {
  if (pool.class === "Personal") return true;
  const owners = workerPoolOwnerPools(placement, registry);
  return (
    (placement.demand.ownerFallback === "Preferred" || owners.length === 0) &&
    !owners.some(workerPoolIsLive)
  );
}

/**
 * Whether the pool may bind this assignment to the execution, which is the
 * model's `canAssign`, asked beside every registered pool. A pool making no
 * poll has no session and is assigned nothing.
 */
export function workerPoolCanAssign(
  placement: WorkerPoolPlacement,
  enrolment: WorkerPoolEnrolment,
  registry: readonly WorkerPoolEnrolment[],
  assignment: string,
  assignmentsBound: ReadonlySet<string>,
): boolean {
  const { pool, session } = enrolment;
  if (session === undefined) return false;
  return (
    placement.status === "Launching" &&
    placement.phase === "Waiting" &&
    !assignmentsBound.has(assignment) &&
    workerPoolPolicyAllows(pool, placement) &&
    workerPoolOwnerFallbackAllows(pool, placement, registry) &&
    workerPoolSessionIsCurrent(pool, session) &&
    workerPoolSessionHasSlot(session) &&
    workerPoolInventoryMatches(placement.requirement, pool)
  );
}

/**
 * What can be said of the execution against every registered pool, which is
 * the model's `placementOutcome`. A pool that is configured for it and not
 * taking it now leaves it unavailable, and only a registry with no configured
 * pool at all makes it definitively incompatible.
 */
export function workerPoolPlacementOutcome(
  placement: WorkerPoolPlacement,
  enrolments: readonly WorkerPoolEnrolment[],
): WorkerPoolPlacementOutcome {
  if (placement.route !== "Pool") return "NotApplicable";
  const configured = enrolments.filter(
    ({ pool }) =>
      workerPoolPolicyConfigures(pool, placement) &&
      workerPoolInventoryMatches(placement.requirement, pool),
  );
  if (
    configured.some(
      ({ pool, session }) =>
        session !== undefined &&
        workerPoolPolicyAllows(pool, placement) &&
        workerPoolOwnerFallbackAllows(pool, placement, enrolments) &&
        workerPoolSessionIsCurrent(pool, session) &&
        workerPoolSessionHasSlot(session),
    )
  )
    return "Placeable";
  return configured.length > 0 ? "Unavailable" : "DefinitiveIncompatibility";
}

/** A registered pool as the registry and the authority answer it: the runner's identity, inventory, class, owner and allowlist, and whether it is revoked. */
export type WorkerPoolAnswered = Pick<
  WorkerPoolRunner,
  | "partition"
  | "pool"
  | "principal"
  | "capabilities"
  | "class"
  | "dedicatedOwner"
  | "allowlist"
  | "revoked"
>;

/** A registered pool as the scheduler reads it: the class, owner and allowlist it registered, the registered policy otherwise, enabled, and revoked as the authority answered. */
function workerPoolOutcomeRegisteredRunner(
  registered: WorkerPoolAnswered,
): WorkerPoolRunner {
  return {
    ...workerPoolPolicyRegistered,
    class: registered.class,
    dedicatedOwner: registered.dedicatedOwner,
    allowlist: registered.allowlist,
    partition: registered.partition,
    pool: registered.pool,
    principal: registered.principal,
    enabled: true,
    revoked: registered.revoked,
    capabilities: registered.capabilities,
  };
}

/** What `workerPoolPlacementOutcome` says of an execution no pool has taken, asked of its project's registered pools and its owner's personal pool. */
export function workerPoolOutcomeRegistered(
  execution: LogicalExecution,
  registered: readonly WorkerPoolAnswered[],
): WorkerPoolPlacementOutcome {
  return workerPoolPlacementOutcome(
    {
      partition: execution.partition,
      status: execution.status,
      phase: "Waiting",
      requirement: execution.requirement,
      route: execution.route,
      demand: workerPoolDemandOf(execution),
    },
    registered.map((pool) => ({
      pool: workerPoolOutcomeRegisteredRunner(pool),
      session: undefined,
    })),
  );
}
