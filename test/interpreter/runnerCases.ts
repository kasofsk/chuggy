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
 * carry — can select the cases it can express rather than skip the table. The
 * image term is the one the model has no words for, and it is named here.
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

/** One case: a pool, the poll it is making if any, an execution routed to pools, and what the model says of them. */
export interface RunnerCase {
  readonly name: string;
  /** The run of `model/tests/runner_test.qnt` this restates, where it restates one. */
  readonly model?: string;
  readonly falsifies: readonly string[];
  readonly placement: WorkerPoolPlacement;
  readonly pool: WorkerPoolRunner;
  readonly session: WorkerPoolSession | undefined;
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
  account: "r.account == e.account",
  enabled: "r.enabled",
  draining: "not(r.draining)",
  revoked: "not(r.revoked)",
  personal: "r.class != Personal or p.personalRunnerAllowed",
  trust: "r.trust >= p.minimumTrust",
  secrets: "not(p.secretsRequired) or r.secretsAllowed",
  source: "not(p.sourceRequired) or r.sourceAllowed",
  owner:
    "p.dedicatedOwnerRequired == 0 or r.dedicatedOwner == p.dedicatedOwnerRequired",
  runner: "s.runner == r.id",
  generation: "s.generation == r.sessionGeneration",
  lease: "s.leaseOpen",
  slot: "s.slotsUsed < s.slotsOffered",
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
  image: "ContainerRequirement: the pool declares the pinned image",
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

const image = `registry.invalid/worker@sha256:${"a".repeat(64)}`;

const container: ContainerExecutionRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image,
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
  images: [image],
};

const session: WorkerPoolSession = {
  partition,
  pool: "pool-one",
  principal: pool.principal,
  leaseOpen: true,
  held: 0,
  heldMax: 1,
};

/** What every case is a variation on: a registered pool polling with room, and a container it declares, pinned the way every routed execution is. */
const assignable: Omit<RunnerCase, "name"> = {
  falsifies: [],
  placement,
  pool,
  session,
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

const assigned: readonly RunnerCase[] = [
  {
    ...assignable,
    name: "an ordinary container is assigned to a pool that declares its platform and image",
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
    pool: { ...pool, images: [] },
  },
  {
    ...assignable,
    name: "a personal pool is assigned an execution whose demand allows one",
    pool: { ...pool, class: "Personal" },
    placement: demanding({ personalRunnerAllowed: true }),
  },
  {
    ...assignable,
    name: "a shared pool is assigned what a dedicated one is",
    pool: { ...pool, class: "Shared" },
  },
  {
    ...assignable,
    name: "a pool dedicated to the owner an execution requires is assigned it",
    pool: { ...pool, dedicatedOwner: 7 },
    placement: demanding({ dedicatedOwnerRequired: 7 }),
  },
  {
    ...assignable,
    name: "a pool dedicated to an owner is assigned what requires none",
    pool: { ...pool, dedicatedOwner: 7 },
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
    {
      pool: {
        ...pool,
        partition: { ...partition, project: asProjectId("project-two") },
      },
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
    "a personal pool is assigned nothing an execution does not allow one",
    [runnerTerm.personal],
    "DefinitiveIncompatibility",
    { pool: { ...pool, class: "Personal" } },
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
    { placement: demanding({ dedicatedOwnerRequired: 7 }) },
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
    [runnerTerm.containerPlatform, runnerTerm.image],
    "DefinitiveIncompatibility",
    { pool: { ...pool, capabilities: [], images: [] } },
  ),
  refused(
    "a pool that does not declare the pinned image does not run it",
    [runnerTerm.image],
    "DefinitiveIncompatibility",
    { pool: { ...pool, images: ["registry.invalid/worker:other"] } },
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
  ...refusedBySession,
  ...refusedByInventory,
];
