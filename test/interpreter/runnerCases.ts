/**
 * The cases a worker pool's assignment guard is held to, restated from
 * `model/tests/runner_test.qnt` for a pool: every run there that exercises
 * `canAssign`, `placementOutcome`, `inventoryMatches`, `sizeFits`,
 * `agentOffered` or `policyAllows`, and
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
 * AN EXECUTION'S AGENT IS CLAUDE unless a case names another or none, as an
 * execution's attempt runs one; no pool advertises its agents unless a case
 * says so.
 *
 * A CONTAINER MATCHES A CAPABILITY SUBSET VACUOUSLY, since it carries no
 * capabilities. So the table refuses a container to a pool that declares
 * nothing.
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
import type { ContainerExecutionRequirement } from "../../src/contract/executionRequirement.ts";
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
  enabled: "r.enabled",
  draining: "not(r.draining)",
  revoked: "not(r.revoked)",
  ownerless: "p.ownerOf != 0",
  ownerOf: "r.owner == p.ownerOf",
  allowlist: "r.allowlist.contains(e.account)",
  trust: "r.trust >= p.minimumTrust",
  secrets: "not(p.secretsRequired) or r.secretsAllowed",
  source: "not(p.sourceRequired) or r.sourceAllowed",
  runner: "s.runner == r.id",
  generation: "s.generation == r.sessionGeneration",
  lease: "s.leaseOpen",
  slot: "s.slotsUsed < s.slotsOffered",
  containerPlatform:
    "ContainerRequirement: i.platforms.contains({ operatingSystem: c.operatingSystem, architecture: c.architecture })",
  capabilityPlatform:
    "CapabilityRequirement: i.platforms.contains({ operatingSystem: c.operatingSystem, architecture: c.architecture })",
  capabilitySubset:
    "CapabilityRequirement: c.capabilities.subseteq(i.executionCapabilities)",
  size: "CeilingMib: p.memoryMib <= m",
  agent:
    "AgentNamed: not(i.agentsAdvertised) or i.executionCapabilities.contains(a)",
} as const;

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

/** `owner`'s container, pinned the way every routed execution is. */
const placement: WorkerPoolPlacement = {
  partition,
  status: "Launching",
  phase: "Waiting",
  requirement: container,
  route: "Pool",
  demand: { ...workerPoolDemandRouted, ownerOf: owner },
  memoryMib: 4_096,
  agent: "Claude",
};

/** `owner`'s pool, registered allowlisting the case's partition. */
const pool: WorkerPoolRunner = {
  partition,
  pool: "pool-one",
  principal: asPrincipal("principal-one"),
  enabled: true,
  revoked: false,
  ...workerPoolPolicyRegistered,
  owner,
  allowlist: [partition],
  capabilities: ["Platform:Linux:Amd64", "Agent:Claude", "Agent:Codex"],
  memoryCeilingMib: undefined,
  agentsAdvertised: false,
};

const session: WorkerPoolSession = {
  partition,
  pool: "pool-one",
  principal: pool.principal,
  leaseOpen: true,
  held: 0,
  heldMax: 1,
};

/** What every case is a variation on: the owner's pool polling with room, and the owner's container on a platform it declares. */
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
  return { ...placement, demand: { ...placement.demand, ...demand } };
}

/** `owner`'s pool advertising `agents` as the ones it takes, beside its platform. */
function advertising(agents: readonly string[]): WorkerPoolRunner {
  return {
    ...pool,
    capabilities: ["Platform:Linux:Amd64", ...agents],
    agentsAdvertised: true,
  };
}

const assignedByAgent: readonly RunnerCase[] = [
  {
    ...assignable,
    name: "a pool advertising Codex alone is assigned its owner's Codex execution",
    model: "advertisingRunnerTakesOnlyTheAgentsItNamesTest",
    pool: advertising(["Agent:Codex"]),
    placement: { ...placement, agent: "Codex" },
  },
  {
    ...assignable,
    name: "a pool advertising no agent is assigned its owner's execution running commands",
    model: "advertisingRunnerTakesOnlyTheAgentsItNamesTest",
    pool: advertising([]),
    placement: { ...placement, agent: undefined },
  },
  {
    ...assignable,
    name: "a pool advertising both agents is assigned its owner's Claude execution",
    model: "advertisingRunnerTakesOnlyTheAgentsItNamesTest",
    pool: advertising(["Agent:Claude", "Agent:Codex"]),
  },
  {
    ...assignable,
    name: "a pool advertising both agents is assigned its owner's Codex execution",
    model: "advertisingRunnerTakesOnlyTheAgentsItNamesTest",
    pool: advertising(["Agent:Claude", "Agent:Codex"]),
    placement: { ...placement, agent: "Codex" },
  },
  {
    ...assignable,
    name: "a pool not advertising its agents is assigned its owner's Claude execution while it names Codex alone",
    model: "runnerNotAdvertisingAgentsTakesAnyAgentTest",
    pool: { ...pool, capabilities: ["Platform:Linux:Amd64", "Agent:Codex"] },
  },
];

const assigned: readonly RunnerCase[] = [
  {
    ...assignable,
    name: "an ordinary container is assigned to a pool that declares its platform",
    model: "ordinaryContainerUsesRunnerModelTest",
  },
  {
    ...assignable,
    name: "a pool declaring several platforms runs a container on any of them",
    model: "macHostMayAlsoOfferLinuxContainersTest",
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
        mode: "Capability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Codex"],
      },
    },
  },
  {
    ...assignable,
    name: "an execution at a pool's memory ceiling is assigned to it",
    model: "executionAboveTheCeilingIsDefinitivelyIncompatibleTest",
    pool: { ...pool, memoryCeilingMib: placement.memoryMib },
  },
  {
    ...assignable,
    name: "a pool naming no memory ceiling is assigned an execution of any size",
    model: "runnerNamingNoCeilingTakesAnySizeTest",
    placement: { ...placement, memoryMib: 262_144 },
  },
  {
    ...assignable,
    name: "a pool is assigned its owner's execution in one of the partitions it allowlists",
    model: "personalRunnerTakesItsOwnersAllowlistedExecutionTest",
    pool: { ...pool, allowlist: [elsewhere, partition] },
  },
  {
    ...assignable,
    name: "a pool registered in another partition is assigned its owner's execution in one it allowlists",
    pool: { ...pool, partition: elsewhere },
    session: { ...session, partition: elsewhere },
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
    "a deregistered runner is assigned nothing",
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
    "a pool registered as every pool is, owning nothing and allowlisting nothing, is assigned nothing",
    [runnerTerm.ownerOf, runnerTerm.allowlist],
    "DefinitiveIncompatibility",
    { pool: { ...pool, ...workerPoolPolicyRegistered } },
  ),
  refused(
    "a pool is assigned nothing of another owner's",
    [runnerTerm.ownerOf],
    "DefinitiveIncompatibility",
    {
      model: "personalRunnerRefusesAnotherOwnersExecutionTest",
      placement: demanding({ ownerOf: asPrincipal("principal-other") }),
    },
  ),
  refused(
    "a pool owning nothing is assigned nothing owned by nobody",
    [runnerTerm.ownerless],
    "DefinitiveIncompatibility",
    {
      model: "personalRunnerRefusesOwnerlessExecutionTest",
      pool: { ...pool, owner: undefined },
      placement: demanding({ ownerOf: undefined }),
    },
  ),
  refused(
    "a pool is assigned nothing owned by nobody",
    [runnerTerm.ownerless, runnerTerm.ownerOf],
    "DefinitiveIncompatibility",
    { placement: demanding({ ownerOf: undefined }) },
  ),
  refused(
    "a pool is assigned nothing of its owner's in a partition it does not allowlist",
    [runnerTerm.allowlist],
    "DefinitiveIncompatibility",
    {
      model: "personalRunnerRefusesAccountItDoesNotAllowlistTest",
      pool: { ...pool, allowlist: [elsewhere] },
    },
  ),
  refused(
    "a pool allowlisting another tenant's project of the same name is assigned nothing",
    [runnerTerm.allowlist],
    "DefinitiveIncompatibility",
    {
      pool: {
        ...pool,
        allowlist: [{ ...partition, tenant: asTenantId("tenant-two") }],
      },
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
];

const refusedByAgent: readonly RunnerCase[] = [
  refused(
    "a pool advertising Codex alone is assigned nothing of its owner's Claude execution, which is unavailable",
    [runnerTerm.agent],
    "Unavailable",
    {
      model: "advertisingRunnerTakesOnlyTheAgentsItNamesTest",
      pool: advertising(["Agent:Codex"]),
    },
  ),
  refused(
    "a pool advertising no agent is assigned nothing of its owner's Codex execution",
    [runnerTerm.agent],
    "Unavailable",
    {
      model: "advertisingRunnerTakesOnlyTheAgentsItNamesTest",
      pool: advertising([]),
      placement: { ...placement, agent: "Codex" },
    },
  ),
];

const refusedBySession: readonly RunnerCase[] = [
  refused(
    "a registered runner making no poll is unavailable",
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
          mode: "Capability",
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
          mode: "Capability",
          operatingSystem: "MacOS",
          architecture: "Arm64",
          capabilities: ["Agent:Claude"],
        },
      },
    },
  ),
  refused(
    "a capability no pool declares is definitively incompatible with every pool",
    [runnerTerm.capabilitySubset],
    "DefinitiveIncompatibility",
    {
      model: "definitiveIncompatibilityTest",
      placement: {
        ...placement,
        requirement: {
          mode: "Capability",
          operatingSystem: "MacOS",
          architecture: "Arm64",
          capabilities: ["Tool:AndroidStudio"],
        },
      },
      pool: {
        ...pool,
        capabilities: ["Platform:MacOS:Arm64", "Tool:Xcode"],
      },
    },
  ),
  refused(
    "an execution above every pool's memory ceiling is definitively incompatible",
    [runnerTerm.size],
    "DefinitiveIncompatibility",
    {
      model: "executionAboveTheCeilingIsDefinitivelyIncompatibleTest",
      pool: { ...pool, memoryCeilingMib: placement.memoryMib - 1 },
    },
  ),
  refused(
    "a pool must declare every capability a requirement names",
    [runnerTerm.capabilitySubset],
    "DefinitiveIncompatibility",
    {
      model: "everyRequiredCapabilityMustBeDeclaredTest",
      placement: {
        ...placement,
        requirement: {
          mode: "Capability",
          operatingSystem: "MacOS",
          architecture: "Arm64",
          capabilities: ["Tool:Xcode", "Simulator:iOS"],
        },
      },
      pool: {
        ...pool,
        capabilities: ["Platform:MacOS:Arm64", "Tool:Xcode"],
      },
    },
  ),
];

/** Every case, the assigned ones first. */
export const runnerCases: readonly RunnerCase[] = [
  ...assigned,
  ...assignedByAgent,
  ...refusedByPlacement,
  ...refusedByPolicy,
  ...refusedBySession,
  ...refusedByInventory,
  ...refusedByAgent,
];
