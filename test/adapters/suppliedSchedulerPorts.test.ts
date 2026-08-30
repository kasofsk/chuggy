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
} from "../../src/adapters/supplied/schedulerPorts.ts";
import { asTaskId, asTicketId } from "../../src/domain/ids.ts";
import {
  asCapacityAccountId,
  asClusterId,
  asExecutionId,
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

function executionOf(taskKind: ExecutionTaskKind): LogicalExecution {
  return {
    partition,
    execution: asExecutionId("execution-one"),
    ticket: asTicketId(1),
    task: asTaskId(1),
    taskKind,
    sourceRequest: "1:0:SpawnWork",
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

const admitted = ["registry.invalid/worker:v1"];

test("a task kind the deployment states resolves to its profile and grant", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    imagesAdmitted: admitted,
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
    imagesAdmitted: admitted,
  });
  assert.deepEqual(await policy.profileFor(executionOf("Evaluation")), {
    resolved: "Denied",
    reason: "ExecutionProfileUnavailable",
  });
});

test("an image the site does not admit is a definitive policy denial", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    imagesAdmitted: ["registry.invalid/other:v1"],
  });
  assert.deepEqual(await policy.profileFor(executionOf("Work")), {
    resolved: "Denied",
    reason: "ExecutionPolicyDenied",
  });
});

test("an agent capability resolves to an admitted runtime that provides it", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    imagesAdmitted: [
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
        mode: "ContainerCapability",
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

test("an agent capability does not resolve to a runtime on the wrong platform", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    imagesAdmitted: [
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
        mode: "ContainerCapability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Codex"],
      },
    }),
    { resolved: "Denied", reason: "RequiredCapabilityUnavailable" },
  );
});

test("a legacy admitted image provides the legacy Claude capability", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    imagesAdmitted: admitted,
  });
  const execution = executionOf("Work");
  const capability = {
    ...execution,
    requirement: {
      mode: "ContainerCapability" as const,
      operatingSystem: "Linux" as const,
      architecture: "Amd64" as const,
      capabilities: ["Agent:Claude" as const],
    },
  };
  assert.deepEqual(await policy.profileFor(capability), {
    resolved: "Profile",
    profile: work.profile,
    image: admitted[0],
    grant,
  });
});

test("a native requirement is refused by capability and never by the image list", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
    imagesAdmitted: admitted,
  });
  const native = executionOf("Work");
  assert.deepEqual(
    await policy.profileFor({
      ...native,
      requirement: {
        mode: "Native",
        architecture: "Arm64",
        driver: "XcodeBuild",
        xcodeVersionMin: 1,
        sdkVersionMin: 1,
      },
    }),
    { resolved: "Denied", reason: "RequiredCapabilityUnavailable" },
  );
});

test("a policy admitting no image at all is refused where it is composed", () => {
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([["Work", work]]),
        imagesAdmitted: [],
      }),
    Error,
  );
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([["Work", work]]),
        imagesAdmitted: [""],
      }),
    Error,
  );
});

test("a policy that grants nothing, or grants a reach nothing names, is refused", () => {
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map(),
        imagesAdmitted: admitted,
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
        imagesAdmitted: admitted,
      }),
    Error,
  );
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([
          ["Work", { ...work, profile: { profile: "", runtimeVersion: "1" } }],
        ]),
        imagesAdmitted: admitted,
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
