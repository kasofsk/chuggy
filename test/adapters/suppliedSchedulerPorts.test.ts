/**
 * The scheduler ports a deployment still answers from supplied data: which
 * profile a task kind resolves to and what is observed before a worker exists.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  suppliedExecutionPolicy,
  suppliedRuntimeFacts,
  type SuppliedExecutionProfile,
  type SuppliedOfferedImage,
} from "../../src/adapters/supplied/schedulerPorts.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import type { ExecutionCapability } from "../../src/interpreter/executionRequirement.ts";
import {
  asCapacityAccountId,
  asClusterId,
  asExecutionId,
  type ExecutionRouting,
  type ExecutionTaskKind,
  type LogicalExecution,
} from "../../src/interpreter/executionScheduler.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type {
  FilesystemAccess,
  PolicyAuthorityGrant,
} from "../../src/interpreter/taskAuthority.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};

const grant: PolicyAuthorityGrant = {
  tools: ["editor"],
  credentials: [],
  network: false,
  filesystem: "WriteWorkspace",
  mayCompleteTask: false,
};

/** A reach outside the vocabulary, which is the one thing a policy answer can be. */
const unnamedReach = "Everything" as unknown as FilesystemAccess;

const work: SuppliedExecutionProfile = {
  profile: { profile: "standard", runtimeVersion: "1" },
  grant,
};

const routing: ExecutionRouting = {
  routes: { Work: "InCluster", Evaluation: "InCluster" },
  projectRoutes: new Map(),
};

function executionOf(taskKind: ExecutionTaskKind): LogicalExecution {
  return {
    partition,
    execution: asExecutionId("execution-one"),
    route: "InCluster",
    ticket: asTicketId(1),
    task: asTaskId(1),
    taskKind,
    sourceRequest: "1:0:ExecuteTask",
    inputBundle: "1:0:InputBundle",
    inputBundleDigest: "b".repeat(64),
    sourceSeq: 1,
    sourceEffect: 0,
    ticketVersion: 1,
    account: asCapacityAccountId("project"),
    cluster: asClusterId("cluster"),
    configurationRevision: "revision",
    configurationDigest: "digest",
    requirementIdentity: "requirement-one",
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "registry.invalid/worker:v1",
    },
    requirementDigest: "requirement-digest",
    requirementSource: "PlatformDefault",
    platformDefaultVersion: 1,
    status: "Admitted",
    attemptsOpened: 0,
    retriesSpent: 0,
  };
}

/** An entry as a deployment that published no capabilities offers it. */
function offeredUndeclared(image: string): SuppliedOfferedImage {
  return { image, operatingSystem: "Linux", architecture: "Amd64" };
}

const offered = [offeredUndeclared("registry.invalid/worker:v1")];

/** An agent outside the vocabulary, which is the one agent chuggy's runtime can lack. */
const unprovidedAgent = "Agent:Unprovided" as unknown as ExecutionCapability;

test("a task kind the deployment states resolves to its profile and grant", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: offered,
  });
  assert.deepEqual(await policy.profileFor(executionOf("Work")), {
    resolved: "Profile",
    profile: work.profile,
    grant,
  });
});

test("a task kind the deployment states nothing for is a definitive inability", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: offered,
  });
  assert.deepEqual(await policy.profileFor(executionOf("Evaluation")), {
    resolved: "Denied",
    reason: "ExecutionProfileUnavailable",
  });
});

test("a pinned image no entry offers runs, for each agent chuggy's runtime provides", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: [offeredUndeclared("registry.invalid/other:v1")],
  });
  for (const agentCapability of [
    undefined,
    "Agent:Claude" as const,
    "Agent:Codex" as const,
  ])
    assert.deepEqual(
      await policy.profileFor({
        ...executionOf("Work"),
        ...(agentCapability === undefined ? {} : { agentCapability }),
      }),
      { resolved: "Profile", profile: work.profile, grant },
      String(agentCapability),
    );
});

test("a pinned image for an agent chuggy's runtime does not provide is a policy denial", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: offered,
  });
  assert.deepEqual(
    await policy.profileFor({
      ...executionOf("Work"),
      agentCapability: unprovidedAgent,
    }),
    { resolved: "Denied", reason: "ExecutionPolicyDenied" },
  );
});

/**
 * The catalog a deployment grows one release at a time: older entries that
 * never published a capability, and the newest one that does.
 */
const catalogGrown: readonly SuppliedOfferedImage[] = [
  offeredUndeclared("registry.invalid/worker:v1"),
  {
    image: "registry.invalid/worker:v10",
    operatingSystem: "Linux" as const,
    architecture: "Amd64" as const,
    capabilities: ["Agent:Claude" as const, "Agent:Codex" as const],
  },
];

test("a pinned image is what runs when the configuration also names an agent", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: catalogGrown,
  });
  assert.deepEqual(
    await policy.profileFor({
      ...executionOf("Work"),
      requirement: {
        mode: "Container",
        operatingSystem: "Linux",
        architecture: "Amd64",
        image: "registry.invalid/worker:v10",
      },
      agentCapability: "Agent:Claude",
    }),
    { resolved: "Profile", profile: work.profile, grant },
  );
});

test("a pinned image whose entry does not provide the agent runs it on chuggy's runtime", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: [
      {
        image: "registry.invalid/claude-only:v1",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Claude"],
      },
    ],
  });
  assert.deepEqual(
    await policy.profileFor({
      ...executionOf("Work"),
      requirement: {
        mode: "Container",
        operatingSystem: "Linux",
        architecture: "Amd64",
        image: "registry.invalid/claude-only:v1",
      },
      agentCapability: "Agent:Codex",
    }),
    { resolved: "Profile", profile: work.profile, grant },
  );
});

test("a pinned image whose entry publishes no capability runs the agent anyway", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: offered,
  });
  assert.deepEqual(
    await policy.profileFor({
      ...executionOf("Work"),
      agentCapability: "Agent:Codex",
    }),
    { resolved: "Profile", profile: work.profile, grant },
  );
});

test("an agent capability resolves to the last offered image that provides it", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: catalogGrown,
  });
  assert.deepEqual(
    await policy.profileFor({
      ...executionOf("Work"),
      requirement: {
        mode: "Capability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Claude"],
      },
    }),
    {
      resolved: "Profile",
      profile: work.profile,
      image: "registry.invalid/worker:v10",
      grant,
    },
  );
});

test("an agent capability resolves to an offered image that provides it", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: [
      {
        image: "registry.invalid/agents:v1",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Claude", "Agent:Codex"],
      },
    ],
  });
  const execution = executionOf("Work");
  assert.deepEqual(
    await policy.profileFor({
      ...execution,
      requirement: {
        mode: "Capability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Codex"],
      },
    }),
    {
      resolved: "Profile",
      profile: work.profile,
      image: "registry.invalid/agents:v1",
      grant,
    },
  );
});

test("an agent capability does not resolve to an image on the wrong platform", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: [
      {
        image: "registry.invalid/agents-arm:v1",
        operatingSystem: "Linux",
        architecture: "Arm64",
        capabilities: ["Agent:Codex"],
      },
      {
        image: "registry.invalid/agents-macos:v1",
        operatingSystem: "MacOS",
        architecture: "Amd64",
        capabilities: ["Agent:Codex"],
      },
    ],
  });
  const execution = executionOf("Work");
  assert.deepEqual(
    await policy.profileFor({
      ...execution,
      requirement: {
        mode: "Capability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Codex"],
      },
    }),
    { resolved: "Denied", reason: "RequiredCapabilityUnavailable" },
  );
});

test("an offered image publishing no capability provides the legacy Claude capability", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: offered,
  });
  const execution = executionOf("Work");
  const capability = {
    ...execution,
    requirement: {
      mode: "Capability" as const,
      operatingSystem: "Linux" as const,
      architecture: "Amd64" as const,
      capabilities: ["Agent:Claude" as const],
    },
  };
  assert.deepEqual(await policy.profileFor(capability), {
    resolved: "Profile",
    profile: work.profile,
    image: offered[0]?.image,
    grant,
  });
});

test("a capability requirement offered to pools is admitted with no image, whatever this site offers", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    routing,
    imagesOffered: offered,
  });
  const requirement = {
    mode: "Capability",
    operatingSystem: "MacOS",
    architecture: "Arm64",
    capabilities: ["Tool:Xcode"],
  } as const;
  const execution = { ...executionOf("Work"), requirement };
  assert.deepEqual(await policy.profileFor({ ...execution, route: "Pool" }), {
    resolved: "Profile",
    profile: work.profile,
    grant,
  });
  assert.deepEqual(await policy.profileFor(execution), {
    resolved: "Denied",
    reason: "RequiredCapabilityUnavailable",
  });
});

test("a policy offering no image at all, or an empty one, is refused where it is composed", () => {
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([["Work", work]]),
        routing,
        imagesOffered: [],
      }),
    /offers no image/u,
  );
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([["Work", work]]),
        routing,
        imagesOffered: [offeredUndeclared("")],
      }),
    /offers an empty image/u,
  );
});

test("an entry publishing an empty capability list is refused where it is composed", () => {
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([["Work", work]]),
        routing,
        imagesOffered: [
          {
            image: "registry.invalid/worker:v1",
            operatingSystem: "Linux",
            architecture: "Amd64",
            capabilities: [],
          },
        ],
      }),
    /empty capability list/u,
  );
});

test("a policy that grants nothing, or grants a reach nothing names, is refused", () => {
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map(),
        routing,
        imagesOffered: offered,
      }),
    Error,
  );
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([
          [
            "Work",
            {
              ...work,
              grant: { ...grant, filesystem: unnamedReach },
            },
          ],
        ]),
        routing,
        imagesOffered: offered,
      }),
    Error,
  );
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([
          ["Work", { ...work, profile: { profile: "", runtimeVersion: "1" } }],
        ]),
        routing,
        imagesOffered: offered,
      }),
    Error,
  );
});

test("the facts before a placement are the stated workspace and nothing observed", async () => {
  assert.deepEqual(
    await suppliedRuntimeFacts({ workspace: "/workspace" }).facts(
      executionOf("Work").partition,
      asExecutionId("execution-one"),
    ),
    {
      read: "Facts",
      facts: { workspace: "/workspace", changedFiles: [], handoff: [] },
    },
  );
  assert.deepEqual(
    await suppliedRuntimeFacts({}).facts(
      executionOf("Work").partition,
      asExecutionId("execution-one"),
    ),
    { read: "Facts", facts: { changedFiles: [], handoff: [] } },
  );
});
