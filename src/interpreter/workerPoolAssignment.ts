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
 * `r.account == e.account`. Registering a pool
 * enables it, withholding `Execute` from its principal revokes it, and
 * registering it again mints a new principal, which is the generation a
 * session is current under. A poll is the session: it resolves to one pool,
 * authenticates as a principal whose token is its lease, and holds its slots
 * against the plane's bound.
 *
 * ONE INVENTORY, BECAUSE A POLL ADVERTISES NONE. What a pool runs is what its
 * registration declares among its capability tokens: platforms and agent
 * capabilities. The model matches a session's observed inventory in
 * `canAssign` and a retained one in `placementOutcome`, and here both are the
 * registration's, which is `inventoryObservationSafe` holding by there being
 * one copy. So a configured pool's inventory is already its poll's, and
 * `placementOutcome` does not match it again for a pool it would place.
 *
 * NO POOL OFFERS A NATIVE SURFACE. The native arm asks for a macOS platform,
 * an installed driver and toolchain minima that no pool declares, so it is
 * false for every pool, and a native requirement is definitively incompatible
 * with all of them.
 *
 * THE POLICY THE REGISTRY HAS NO COLUMN FOR IS DATA, NOT AN OMISSION. Class,
 * drain, trust, the allowance of secrets and source, and a dedicated owner are
 * the model's administrator-owned authority, and the route and a demand on
 * each of them are the model's `ExecutionProfile`. Every pool holds
 * `workerPoolPolicyRegistered` and every execution routed to one is pinned
 * with `workerPoolDemandRouted`; the guard reads both as it reads any other
 * field, so a registry that carries them per pool changes values and not
 * terms.
 *
 * THE SCHEDULER ASKS THE OUTCOME OF THE REGISTRY ALONE. A poll is not durable,
 * so the scheduler sees no session and no pool is placeable to it; and
 * revocation is `Execute` withheld at the authority, which the registry does
 * not record, so a registered pool is enabled and not revoked as the scheduler
 * reads it. A revoked pool still registered therefore leaves an execution
 * unavailable, which holds it, rather than incompatible, which blocks it.
 */

import type {
  ExecutionRoute,
  ExecutionStatus,
  LogicalExecution,
} from "./executionScheduler.ts";
import type { ExecutionRequirement, Platform } from "./executionRequirement.ts";
import type { Principal } from "./principal.ts";
import type { Partition } from "./projectStore.ts";
import type { WorkerPoolRegistered } from "./workerPool.ts";

/** The model's `RunnerClass`, and the roster the type derives from. */
export const allWorkerPoolClasses = [
  "Personal",
  "Dedicated",
  "Shared",
] as const;
export type WorkerPoolClass = (typeof allWorkerPoolClasses)[number];

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

/** The administrator-owned policy of the model's `Runner`; `dedicatedOwner` is 0 for none, as the model writes it. */
export interface WorkerPoolPolicy {
  readonly class: WorkerPoolClass;
  readonly draining: boolean;
  readonly trust: number;
  readonly secretsAllowed: boolean;
  readonly sourceAllowed: boolean;
  readonly dedicatedOwner: number;
}

/** What the model's `ExecutionProfile` demands of a runner beside the route; `dedicatedOwnerRequired` is 0 when it requires none. */
export interface WorkerPoolDemand {
  readonly personalRunnerAllowed: boolean;
  readonly trustMin: number;
  readonly secretsRequired: boolean;
  readonly sourceRequired: boolean;
  readonly dedicatedOwnerRequired: number;
}

/** The policy every registered pool holds, since the registry carries none of it per pool. */
export const workerPoolPolicyRegistered: WorkerPoolPolicy = {
  class: "Dedicated",
  draining: false,
  trust: 1,
  secretsAllowed: true,
  sourceAllowed: true,
  dedicatedOwner: 0,
};

/** The demand every execution routed to a pool is pinned with: no personal pool, the registered trust, and secrets and source both, since a task is handed credentials and a clone. */
export const workerPoolDemandRouted: WorkerPoolDemand = {
  personalRunnerAllowed: false,
  trustMin: 1,
  secretsRequired: true,
  sourceRequired: true,
  dedicatedOwnerRequired: 0,
};

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
    case "ContainerCapability":
      return (
        pool.capabilities.includes(workerPoolPlatformToken(requirement)) &&
        requirement.capabilities.every((capability) =>
          pool.capabilities.includes(capability),
        )
      );
    case "Native":
      return false;
  }
}

/** Whether the route and the pool's standing configure it for this execution, which is the model's `policyConfigures`: drain aside, since drain is posture and not incompatibility. */
export function workerPoolPolicyConfigures(
  pool: WorkerPoolRunner,
  placement: WorkerPoolPlacement,
): boolean {
  const demand = placement.demand;
  return (
    placement.route === "Pool" &&
    workerPoolSamePartition(pool.partition, placement.partition) &&
    pool.enabled &&
    !pool.revoked &&
    (pool.class !== "Personal" || demand.personalRunnerAllowed) &&
    pool.trust >= demand.trustMin &&
    (!demand.secretsRequired || pool.secretsAllowed) &&
    (!demand.sourceRequired || pool.sourceAllowed) &&
    (demand.dedicatedOwnerRequired === 0 ||
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

/**
 * Whether the pool may bind this assignment to the execution, which is the
 * model's `canAssign`. A pool making no poll has no session and is assigned
 * nothing.
 */
export function workerPoolCanAssign(
  placement: WorkerPoolPlacement,
  enrolment: WorkerPoolEnrolment,
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
        workerPoolSessionIsCurrent(pool, session) &&
        workerPoolSessionHasSlot(session),
    )
  )
    return "Placeable";
  return configured.length > 0 ? "Unavailable" : "DefinitiveIncompatibility";
}

/** A registered pool as the scheduler reads it: the registered policy, enabled, and not revoked. */
function workerPoolOutcomeRegisteredRunner(
  registered: WorkerPoolRegistered,
): WorkerPoolRunner {
  return {
    ...workerPoolPolicyRegistered,
    partition: registered.partition,
    pool: registered.pool,
    principal: registered.principal,
    enabled: true,
    revoked: false,
    capabilities: registered.capabilities,
  };
}

/** What `workerPoolPlacementOutcome` says of an execution no pool has taken, asked of its project's registered pools. */
export function workerPoolOutcomeRegistered(
  execution: LogicalExecution,
  registered: readonly WorkerPoolRegistered[],
): WorkerPoolPlacementOutcome {
  return workerPoolPlacementOutcome(
    {
      partition: execution.partition,
      status: execution.status,
      phase: "Waiting",
      requirement: execution.requirement,
      route: execution.route,
      demand: workerPoolDemandRouted,
    },
    registered.map((pool) => ({
      pool: workerPoolOutcomeRegisteredRunner(pool),
      session: undefined,
    })),
  );
}
