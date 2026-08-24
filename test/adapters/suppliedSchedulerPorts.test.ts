/**
 * The three scheduler ports a deployment answers from supplied data: which
 * profile a task kind resolves to, which pinned revision is readable, and what
 * is observed of a workspace no worker has created yet.
 *
 * THE HOLD AND THE ABSENCE ARE THE CASES THAT MATTER. A revision this process
 * was never given must not read as a revision that is gone, because the second
 * retires a ticket; and a grant this tree's vocabulary does not name must fail
 * where the process is composed rather than at the first launch that reads it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  suppliedExecutionPolicy,
  suppliedRuntimeFacts,
  suppliedTaskConfigurations,
  type SuppliedExecutionProfile,
  type SuppliedTaskConfiguration,
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

const configuration: SuppliedTaskConfiguration = {
  tenant: "tenant",
  project: "project",
  configurationRevision: "revision",
  configurationDigest: "digest",
  brief: {
    motivation: ["The importer drops rows."],
    acceptanceCriteria: ["A dropped row is reported."],
    constraints: [],
  },
  practices: ["AcceptanceCriteria"],
  work: { instructions: ["Change the importer."] },
  review: { instructions: ["Walk the call paths."] },
};

test("a task kind the deployment states resolves to its profile and grant", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([["Work", work]]),
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
  });
  assert.deepEqual(await policy.profileFor(executionOf("Evaluation")), {
    resolved: "Denied",
    reason: "ExecutionProfileUnavailable",
  });
});

test("a policy that grants nothing, or grants a reach nothing names, is refused", () => {
  assert.throws(() => suppliedExecutionPolicy({ profiles: new Map() }), Error);
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
      }),
    Error,
  );
  assert.throws(
    () =>
      suppliedExecutionPolicy({
        profiles: new Map([
          ["Work", { ...work, profile: { profile: "", runtimeVersion: "1" } }],
        ]),
      }),
    Error,
  );
});

test("a supplied revision is read back for the partition that pinned it", async () => {
  const configurations = suppliedTaskConfigurations([configuration]);
  assert.deepEqual(
    await configurations.configuration(partition, {
      configurationRevision: "revision",
      configurationDigest: "digest",
    }),
    { read: "Configuration", configuration },
  );
});

test("a revision this deployment was not supplied is a hold and never an absence", async () => {
  const configurations = suppliedTaskConfigurations([configuration]);
  const unsupplied = await configurations.configuration(partition, {
    configurationRevision: "later",
    configurationDigest: "digest",
  });
  assert.deepEqual(unsupplied, { read: "Unavailable" });
  const foreign = await configurations.configuration(
    { tenant: asTenantId("tenant"), project: asProjectId("other") },
    { configurationRevision: "revision", configurationDigest: "digest" },
  );
  assert.deepEqual(foreign, { read: "Unavailable" });
});

test("a digest that contradicts the pin is not refused twice", async () => {
  const configurations = suppliedTaskConfigurations([configuration]);
  assert.deepEqual(
    await configurations.configuration(partition, {
      configurationRevision: "revision",
      configurationDigest: "rewritten",
    }),
    { read: "Configuration", configuration },
  );
});

test("the facts before a placement are the stated workspace and nothing observed", async () => {
  assert.deepEqual(
    await suppliedRuntimeFacts({ workspace: "/workspace" }).facts(
      partition,
      asExecutionId("execution-one"),
    ),
    {
      read: "Facts",
      facts: { workspace: "/workspace", changedFiles: [], handoff: [] },
    },
  );
  assert.deepEqual(
    await suppliedRuntimeFacts({}).facts(
      partition,
      asExecutionId("execution-one"),
    ),
    { read: "Facts", facts: { changedFiles: [], handoff: [] } },
  );
});
