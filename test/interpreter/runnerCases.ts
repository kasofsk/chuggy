/**
 * The cases a worker pool's assignment guard is held to, restated from
 * `model/tests/runner_test.qnt` for a pool: every run there that exercises
 * `canAssign`, `placementOutcome`, `inventoryMatches` or `policyAllows`, and
 * for each term those guards conjoin a case in which that term refuses the
 * assignment.
 *
 * ONE TABLE FOR EVERY STATEMENT OF THE GUARD. It is a module of its own rather
 * than part of `test/interpreter/runner.test.ts` so that any statement of the
 * guard — the decider, or the claim a pool makes against PostgreSQL — can be
 * driven over the same rows, and a term one of them drops is a case that
 * statement gets wrong.
 *
 * EVERY CASE NAMES THE TERMS IT MAKES FALSE, in the model's own words, so a
 * statement with no column for some term — the policy the registry does not
 * carry — can select the cases it can express rather than skip the table.
 *
 * A CASE IS ONE POOL BESIDE THE OTHERS REGISTERED WITH IT, since an owner's
 * fallback reads the owner's personal pools; the guard is asked of the case's
 * pool, and the outcome of all of them.
 *
 * TWO REQUIREMENTS MATCH A CAPABILITY SUBSET VACUOUSLY: a container carries no
 * capabilities, and neither does a native one. So the table refuses a
 * container to a pool that declares nothing, and a native requirement to every
 * pool.
 */

import {
  workerPoolDemandRouted,
  workerPoolPolicyRegistered,
  type WorkerPoolDemand,
  type WorkerPoolEnrolment,
  type WorkerPoolPlacement,
  type WorkerPoolPlacementOutcome,
  type WorkerPoolRunner,
  type WorkerPoolSession,
} from "../../src/interpreter/workerPoolAssignment.ts";
import type { ContainerExecutionRequirement } from "../../src/interpreter/executionRequirement.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";

/** One case: a pool, the poll it is making if any, the pools registered beside it, an execution routed to pools, and what the model says of them. */
export interface RunnerCase {
  readonly name: string;
  /** The run of `model/tests/runner_test.qnt` this restates, where it restates one. */
  readonly model?: string;
  readonly falsifies: readonly string[];
  readonly placement: WorkerPoolPlacement;
  readonly pool: WorkerPoolRunner;
  readonly session: WorkerPoolSession | undefined;
  readonly others: readonly WorkerPoolEnrolment[];
  readonly assignmentsBound: readonly string[];
  readonly canAssign: boolean;
  readonly placementOutcome: WorkerPoolPlacementOutcome;
}

/** The assignment identity every case asks to bind. */
export const runnerCaseAssignment = "assignment-one";

/** Each term the model's guards conjoin, as `model/runner.qnt` writes it, qualified by its arm where it sits in one. */
export const runnerTerm = {
  session: "s.sessions.keys().contains(rid)",
  launching: "e.status == Launching",
  waiting: "p.phase == Waiting",
  fresh: "not(s.assignments.keys().contains(aid))",
  route: "p.route == RegisteredRunner",
  account: "r.class == Personal or r.account == e.account",
  enabled: "r.enabled",
  draining: "not(r.draining)",
  revoked: "not(r.revoked)",
  personal: "r.class != Personal or p.personalRunnerAllowed",
  ownerless: "r.class != Personal or p.ownerOf != 0",
  ownerOf: "r.class != Personal or r.dedicatedOwner == p.ownerOf",
  allowlist: "r.class != Personal or r.allowlist.contains(e.account)",
  trust: "r.trust >= p.minimumTrust",
  secrets: "not(p.secretsRequired) or r.secretsAllowed",
  source: "not(p.sourceRequired) or r.sourceAllowed",
  owner:
    "p.dedicatedOwnerRequired == 0 or r.dedicatedOwner == p.dedicatedOwnerRequired",
  runner: "s.runner == r.id",
  generation: "s.generation == r.sessionGeneration",
  lease: "s.leaseOpen",
  slot: "s.slotsUsed < s.slotsOffered",
  fallback:
    "r.class == Personal or p.profile.ownerFallback == Preferred or ownerRunners(s, e, p).size() == 0",
  live: "r.class == Personal or ownerRunners(s, e, p).forall(o => not(runnerIsLive(s, o)))",
  containerPlatform:
    "ContainerRequirement: i.containerPlatforms.contains({ operatingSystem: c.operatingSystem, architecture: c.architecture })",
  capabilityPlatform:
    "CapabilityRequirement: i.containerPlatforms.contains({ operatingSystem: c.operatingSystem, architecture: c.architecture })",
  capabilitySubset:
    "CapabilityRequirement: c.capabilities.subseteq(i.executionCapabilities)",
  nativePlatform:
    "NativeRequirement: i.nativePlatform == { operatingSystem: MacOS, architecture: n.architecture }",
  nativeDriver: "NativeRequirement: i.nativeDrivers.contains(n.driver)",
  nativeXcode: "NativeRequirement: i.xcodeVersion >= n.xcodeVersionMin",
  nativeSdk:
    "NativeRequirement: i.sdkVersions.exists(v => v >= n.sdkVersionMin)",
} as const;

const native = [
  runnerTerm.nativePlatform,
  runnerTerm.nativeDriver,
  runnerTerm.nativeXcode,
  runnerTerm.nativeSdk,
];

const partition: Partition = {
  tenant: asTenantId("tenant-one"),
  project: asProjectId("project-one"),
};

const elsewhere: Partition = {
  ...partition,
  project: asProjectId("project-two"),
};

const owner = asPrincipal("principal-owner");

const container: ContainerExecutionRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: `registry.invalid/worker@sha256:${"a".repeat(64)}`,
};

const placement: WorkerPoolPlacement = {
  partition,
  status: "Launching",
  phase: "Waiting",
  requirement: container,
  route: "Pool",
  demand: workerPoolDemandRouted,
};

const pool: WorkerPoolRunner = {
  partition,
  pool: "pool-one",
  principal: asPrincipal("principal-one"),
  enabled: true,
  revoked: false,
  ...workerPoolPolicyRegistered,
  capabilities: ["Platform:Linux:Amd64", "Agent:Claude", "Agent:Codex"],
};

const session: WorkerPoolSession = {
  partition,
  pool: "pool-one",
  principal: pool.principal,
  leaseOpen: true,
  held: 0,
  heldMax: 1,
};

/** What every case is a variation on: a registered pool polling with room, and a container on a platform it declares, pinned the way every routed execution is. */
const assignable: Omit<RunnerCase, "name"> = {
  falsifies: [],
  placement,
  pool,
  session,
  others: [],
  assignmentsBound: [],
  canAssign: true,
  placementOutcome: "Placeable",
};

function refused(
  name: string,
  falsifies: readonly string[],
  placementOutcome: WorkerPoolPlacementOutcome,
  varied: Partial<RunnerCase>,
): RunnerCase {
  return {
    ...assignable,
    ...varied,
    name,
    falsifies,
    canAssign: false,
    placementOutcome,
  };
}

function demanding(demand: Partial<WorkerPoolDemand>): WorkerPoolPlacement {
  return { ...placement, demand: { ...workerPoolDemandRouted, ...demand } };
}

/** A personal pool of `owner` allowlisting the case's partition. */
const personal: WorkerPoolRunner = {
  ...pool,
  class: "Personal",
  dedicatedOwner: owner,
  allowlist: [partition],
};

/** An execution of `owner` that allows a personal pool. */
const owned = demanding({ personalRunnerAllowed: true, ownerOf: owner });

/** An execution of `owner` that allows a personal pool under a Strict fallback. */
const ownedStrict = demanding({
  personalRunnerAllowed: true,
  ownerOf: owner,
  ownerFallback: "Strict",
});

const ownersPoolPrincipal = asPrincipal("principal-owner-pool");

const ownersPoolSession: WorkerPoolSession = {
  ...session,
  pool: "pool-owner",
  principal: ownersPoolPrincipal,
};

/** `owner`'s personal pool registered beside `pool`, polling with room. */
const ownersPool: WorkerPoolEnrolment = {
  pool: { ...personal, pool: "pool-owner", principal: ownersPoolPrincipal },
  session: ownersPoolSession,
};

/** `ownersPool` with its poll varied. */
function ownersPoolPolling(
  varied: Partial<WorkerPoolSession>,
): WorkerPoolEnrolment {
  return { ...ownersPool, session: { ...ownersPoolSession, ...varied } };
}

/** `ownersPool` with its policy or inventory varied. */
function ownersPoolRegistered(
  varied: Partial<WorkerPoolRunner>,
): WorkerPoolEnrolment {
  return { ...ownersPool, pool: { ...ownersPool.pool, ...varied } };
}

const assigned: readonly RunnerCase[] = [
  {
    ...assignable,
    name: "an ordinary container is assigned to a pool that declares its platform",
    model: "ordinaryContainerUsesRunnerModelTest",
  },
  {
    ...assignable,
    name: "a pool declaring several platforms runs a container on any of them",
    model: "macNativeHostMayAlsoOfferLinuxContainersTest",
    placement: {
      ...placement,
      requirement: { ...container, architecture: "Arm64" },
    },
    pool: {
      ...pool,
      capabilities: ["Platform:MacOS:Arm64", "Platform:Linux:Arm64"],
    },
  },
  {
    ...assignable,
    name: "a capability requirement is assigned to a pool that provides every capability it names",
    model: "capabilityRequirementMatchesOnlyAnInventoryThatProvidesItTest",
    placement: {
      ...placement,
      requirement: {
        mode: "ContainerCapability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Codex"],
      },
    },
  },
  {
    ...assignable,
    name: "a personal pool is assigned its owner's execution in a partition it allowlists",
    model: "personalRunnerTakesItsOwnersAllowlistedExecutionTest",
    pool: personal,
    placement: owned,
  },
  {
    ...assignable,
    name: "a personal pool registered in another partition is assigned its owner's execution in one it allowlists",
    model: "personalRunnerServesAllowlistedAccountNotItsOwnTest",
    pool: { ...personal, partition: elsewhere },
    session: { ...session, partition: elsewhere },
    placement: owned,
  },
  {
    ...assignable,
    name: "a shared pool is assigned what a dedicated one is",
    pool: { ...pool, class: "Shared" },
  },
  {
    ...assignable,
    name: "a pool dedicated to the owner an execution requires is assigned it",
    pool: { ...pool, dedicatedOwner: owner },
    placement: demanding({ dedicatedOwnerRequired: owner }),
  },
  {
    ...assignable,
    name: "a pool dedicated to an owner is assigned what requires none",
    pool: { ...pool, dedicatedOwner: owner },
  },
  {
    ...assignable,
    name: "a pool of trust above the minimum is assigned what one at it is",
    pool: { ...pool, trust: 2 },
  },
  {
    ...assignable,
    name: "a pool not allowed secrets is assigned what requires none",
    pool: { ...pool, secretsAllowed: false },
    placement: demanding({ secretsRequired: false }),
  },
  {
    ...assignable,
    name: "a pool not allowed source is assigned what requires none",
    pool: { ...pool, sourceAllowed: false },
    placement: demanding({ sourceRequired: false }),
  },
  {
    ...assignable,
    name: "a personal pool is assigned its owner's execution beside a dedicated pool that defers to it",
    model: "preferredFallbackWaitsForLiveOwnerRunnerTest",
    pool: ownersPool.pool,
    session: ownersPool.session,
    others: [{ pool, session }],
    placement: owned,
  },
  {
    ...assignable,
    name: "a dedicated pool is assigned an owner's execution while the owner's personal pool makes no live poll",
    model: "preferredFallbackTakesDedicatedWhileOwnerRunnerIsAbsentTest",
    others: [ownersPoolPolling({ leaseOpen: false })],
    placement: owned,
  },
  {
    ...assignable,
    name: "a dedicated pool is assigned a strict owner's execution while the owner has no personal pool allowlisting its partition",
    model: "ownerWithoutConfiguredRunnerFollowsDedicatedRouteTest",
    others: [ownersPoolRegistered({ allowlist: [elsewhere] })],
    placement: ownedStrict,
  },
  {
    ...assignable,
    name: "a dedicated pool is assigned a strict owner's execution that allows no personal pool",
    model: "ownerWithoutConfiguredRunnerFollowsDedicatedRouteTest",
    others: [ownersPool],
    placement: {
      ...ownedStrict,
      demand: { ...ownedStrict.demand, personalRunnerAllowed: false },
    },
  },
  {
    ...assignable,
    name: "a dedicated pool is assigned a strict execution owned by nobody beside a personal pool owning nothing",
    model: "ownerWithoutConfiguredRunnerFollowsDedicatedRouteTest",
    others: [ownersPoolRegistered({ dedicatedOwner: undefined })],
    placement: {
      ...ownedStrict,
      demand: { ...ownedStrict.demand, ownerOf: undefined },
    },
  },
  {
    ...assignable,
    name: "a dedicated pool is assigned a strict owner's execution that the owner's polling personal pool cannot run",
    model: "strictFallbackOwnerRunnerUnableLeavesDedicatedRouteTest",
    others: [ownersPoolRegistered({ capabilities: ["Platform:Linux:Arm64"] })],
    placement: ownedStrict,
  },
  {
    ...assignable,
    name: "a dedicated pool is assigned an owner's execution while the owner's personal pool polls draining",
    model: "preferredFallbackTakesDedicatedWhileOwnerRunnerDrainsTest",
    others: [ownersPoolRegistered({ draining: true })],
    placement: owned,
  },
  {
    ...assignable,
    name: "a dedicated pool is assigned a strict owner's execution while the owner's personal pool is revoked",
    others: [ownersPoolRegistered({ revoked: true })],
    placement: ownedStrict,
  },
];

const refusedByPlacement: readonly RunnerCase[] = [
  refused(
    "an execution routed in-cluster is no pool's",
    [runnerTerm.route],
    "NotApplicable",
    {
      model: "kubernetesRouteRemainsIndependentTest",
      placement: { ...placement, route: "InCluster" },
    },
  ),
  refused(
    "an execution not yet launching is assigned nothing",
    [runnerTerm.launching],
    "Placeable",
    { placement: { ...placement, status: "Admitted" } },
  ),
  refused(
    "an execution whose placement is already assigned is not assigned again",
    [runnerTerm.waiting],
    "Placeable",
    { placement: { ...placement, phase: "Assigned" } },
  ),
  refused(
    "an assignment identity already bound is refused",
    [runnerTerm.fresh],
    "Placeable",
    {
      model: "duplicateAssignmentIdentityIsRefusedTest",
      assignmentsBound: [runnerCaseAssignment],
    },
  ),
];

const refusedByPolicy: readonly RunnerCase[] = [
  refused(
    "a pool of another project is assigned nothing",
    [runnerTerm.account],
    "DefinitiveIncompatibility",
    { pool: { ...pool, partition: elsewhere } },
  ),
  refused(
    "a pool of another project allowlisting this one is assigned nothing, since only a personal pool reads its allowlist",
    [runnerTerm.account],
    "DefinitiveIncompatibility",
    {
      model: "dedicatedRunnerServesOnlyItsOwnAccountTest",
      pool: { ...pool, partition: elsewhere, allowlist: [partition] },
      session: { ...session, partition: elsewhere },
    },
  ),
  refused(
    "a pool of another tenant's project of the same name is assigned nothing",
    [runnerTerm.account],
    "DefinitiveIncompatibility",
    {
      pool: {
        ...pool,
        partition: { ...partition, tenant: asTenantId("tenant-two") },
      },
    },
  ),
  refused(
    "a deregistered pool is assigned nothing",
    [runnerTerm.enabled],
    "DefinitiveIncompatibility",
    { pool: { ...pool, enabled: false } },
  ),
  refused(
    "a draining pool is unavailable and not definitively incompatible",
    [runnerTerm.draining],
    "Unavailable",
    {
      model: "drainingCompatibleRunnerIsUnavailableNotDefinitiveTest",
      pool: { ...pool, draining: true },
    },
  ),
  refused(
    "a pool whose principal lost Execute is assigned nothing",
    [runnerTerm.revoked],
    "DefinitiveIncompatibility",
    { pool: { ...pool, revoked: true } },
  ),
  refused(
    "a personal pool registered as every pool is, owning nothing and allowlisting nothing, is assigned nothing",
    [runnerTerm.personal, runnerTerm.ownerless, runnerTerm.allowlist],
    "DefinitiveIncompatibility",
    { pool: { ...pool, class: "Personal" } },
  ),
  refused(
    "a personal pool is assigned nothing of its owner's that does not allow one",
    [runnerTerm.personal],
    "DefinitiveIncompatibility",
    { pool: personal, placement: demanding({ ownerOf: owner }) },
  ),
  refused(
    "a personal pool is assigned nothing of another owner's",
    [runnerTerm.ownerOf],
    "DefinitiveIncompatibility",
    {
      model: "personalRunnerRefusesAnotherOwnersExecutionTest",
      pool: personal,
      placement: demanding({
        personalRunnerAllowed: true,
        ownerOf: asPrincipal("principal-other"),
      }),
    },
  ),
  refused(
    "a personal pool owning nothing is assigned nothing owned by nobody",
    [runnerTerm.ownerless],
    "DefinitiveIncompatibility",
    {
      model: "personalRunnerRefusesOwnerlessExecutionTest",
      pool: { ...personal, dedicatedOwner: undefined },
      placement: demanding({ personalRunnerAllowed: true }),
    },
  ),
  refused(
    "a personal pool is assigned nothing of its owner's in a partition it does not allowlist",
    [runnerTerm.allowlist],
    "DefinitiveIncompatibility",
    {
      model: "personalRunnerRefusesAccountItDoesNotAllowlistTest",
      pool: { ...personal, allowlist: [elsewhere] },
      placement: owned,
    },
  ),
  refused(
    "a pool below the trust an execution demands is assigned nothing",
    [runnerTerm.trust],
    "DefinitiveIncompatibility",
    { pool: { ...pool, trust: 0 } },
  ),
  refused(
    "a pool is assigned nothing demanding more trust than it holds",
    [runnerTerm.trust],
    "DefinitiveIncompatibility",
    { placement: demanding({ trustMin: 2 }) },
  ),
  refused(
    "a pool not allowed secrets is assigned nothing that requires them",
    [runnerTerm.secrets],
    "DefinitiveIncompatibility",
    {
      model: "advertisedFactsCannotGrantSecretAuthorityTest",
      pool: { ...pool, secretsAllowed: false },
    },
  ),
  refused(
    "a pool not allowed source is assigned nothing that requires it",
    [runnerTerm.source],
    "DefinitiveIncompatibility",
    { pool: { ...pool, sourceAllowed: false } },
  ),
  refused(
    "a pool dedicated to nobody is assigned nothing that requires an owner",
    [runnerTerm.owner],
    "DefinitiveIncompatibility",
    { placement: demanding({ dedicatedOwnerRequired: owner }) },
  ),
];

const refusedByFallback: readonly RunnerCase[] = [
  refused(
    "a dedicated pool is assigned nothing of an owner's whose personal pool is polling",
    [runnerTerm.live],
    "Placeable",
    {
      model: "preferredFallbackWaitsForLiveOwnerRunnerTest",
      others: [ownersPool],
      placement: owned,
    },
  ),
  refused(
    "a dedicated pool waiting on an owner's personal pool that is polling without room leaves the execution unavailable",
    [runnerTerm.live],
    "Unavailable",
    {
      model: "preferredFallbackBusyOwnerRunnerIsUnavailableTest",
      others: [ownersPoolPolling({ held: 1 })],
      placement: owned,
    },
  ),
  refused(
    "a dedicated pool is assigned nothing of a strict owner's beside the owner's polling personal pool",
    [runnerTerm.fallback, runnerTerm.live],
    "Placeable",
    {
      model: "strictFallbackRefusesDedicatedWhileOwnerHasRunnerTest",
      others: [ownersPool],
      placement: ownedStrict,
    },
  ),
  refused(
    "a dedicated pool is assigned nothing of a strict owner's whose personal pool makes no live poll, which is unavailable",
    [runnerTerm.fallback],
    "Unavailable",
    {
      model: "strictFallbackRefusesDedicatedWhileOwnerHasRunnerTest",
      others: [ownersPoolPolling({ leaseOpen: false })],
      placement: ownedStrict,
    },
  ),
];

const refusedBySession: readonly RunnerCase[] = [
  refused(
    "a registered pool making no poll is unavailable",
    [runnerTerm.session],
    "Unavailable",
    {
      model: "enrolledCompatibleRunnerWithoutSessionIsUnavailableTest",
      session: undefined,
    },
  ),
  refused(
    "a poll whose token lapsed is transiently absent",
    [runnerTerm.lease],
    "Unavailable",
    {
      model: "transientAbsenceIsUnavailableTest",
      session: { ...session, leaseOpen: false },
    },
  ),
  refused(
    "a poll resolved to another pool is not this pool's session",
    [runnerTerm.runner],
    "Unavailable",
    { session: { ...session, pool: "pool-two" } },
  ),
  refused(
    "a poll resolved to a same-named pool in another project is not this pool's session",
    [runnerTerm.runner],
    "Unavailable",
    {
      session: {
        ...session,
        partition: { ...partition, project: asProjectId("project-two") },
      },
    },
  ),
  refused(
    "a poll under a principal registered over is stale",
    [runnerTerm.generation],
    "Unavailable",
    { session: { ...session, principal: asPrincipal("principal-zero") } },
  ),
  refused(
    "a poll holding the plane's bound has no slot",
    [runnerTerm.slot],
    "Unavailable",
    { session: { ...session, held: 1 } },
  ),
  refused(
    "a personal pool's poll under a principal registered over is stale",
    [runnerTerm.generation],
    "Unavailable",
    {
      pool: personal,
      placement: owned,
      session: { ...session, principal: asPrincipal("principal-zero") },
    },
  ),
  refused(
    "a personal pool polling with the plane's bound held has no slot",
    [runnerTerm.slot],
    "Unavailable",
    { pool: personal, placement: owned, session: { ...session, held: 1 } },
  ),
];

const refusedByInventory: readonly RunnerCase[] = [
  refused(
    "a pool registered again without the platform is definitively incompatible",
    [runnerTerm.containerPlatform],
    "DefinitiveIncompatibility",
    {
      model: "takeoverPublishesChangedInventoryAtomicallyTest",
      pool: {
        ...pool,
        principal: asPrincipal("principal-two"),
        capabilities: ["Platform:Linux:Arm64", "Agent:Claude", "Agent:Codex"],
      },
      session: { ...session, principal: asPrincipal("principal-two") },
    },
  ),
  refused(
    "a pool declaring nothing runs no container",
    [runnerTerm.containerPlatform],
    "DefinitiveIncompatibility",
    { pool: { ...pool, capabilities: [] } },
  ),
  refused(
    "a capability requirement is refused a pool lacking one it names",
    [runnerTerm.capabilitySubset],
    "DefinitiveIncompatibility",
    {
      model: "capabilityRequirementMatchesOnlyAnInventoryThatProvidesItTest",
      placement: {
        ...placement,
        requirement: {
          mode: "ContainerCapability",
          operatingSystem: "Linux",
          architecture: "Amd64",
          capabilities: ["Agent:Codex"],
        },
      },
      pool: { ...pool, capabilities: ["Platform:Linux:Amd64", "Agent:Claude"] },
    },
  ),
  refused(
    "a capability requirement is refused a pool lacking its platform",
    [runnerTerm.capabilityPlatform],
    "DefinitiveIncompatibility",
    {
      placement: {
        ...placement,
        requirement: {
          mode: "ContainerCapability",
          operatingSystem: "MacOS",
          architecture: "Arm64",
          capabilities: ["Agent:Claude"],
        },
      },
    },
  ),
  refused(
    "a native requirement is definitively incompatible with every pool",
    native,
    "DefinitiveIncompatibility",
    {
      model: "definitiveIncompatibilityTest",
      placement: {
        ...placement,
        requirement: {
          mode: "Native",
          architecture: "Arm64",
          driver: "XcodeBuild",
          xcodeVersionMin: 17,
          sdkVersionMin: 18,
        },
      },
    },
  ),
  refused(
    "no pool has a native driver installed",
    native,
    "DefinitiveIncompatibility",
    {
      model: "boundedNativeDriverMustBeInstalledTest",
      placement: {
        ...placement,
        requirement: {
          mode: "Native",
          architecture: "Arm64",
          driver: "XcodeTesting",
          xcodeVersionMin: 16,
          sdkVersionMin: 18,
        },
      },
      pool: { ...pool, capabilities: ["Platform:MacOS:Arm64"] },
    },
  ),
];

/** Every case, the assigned ones first. */
export const runnerCases: readonly RunnerCase[] = [
  ...assigned,
  ...refusedByPlacement,
  ...refusedByPolicy,
  ...refusedByFallback,
  ...refusedBySession,
  ...refusedByInventory,
];
