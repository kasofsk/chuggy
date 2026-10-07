/**
 * The execution row's translation, where a registration's pinned configuration
 * is read for the agent its worker needs.
 *
 * THE CAPABILITY IS NOT A COLUMN, so this is the only place a reader can get it
 * wrong: the row carries the configuration the requirement was materialized
 * out of, and a registration that names an agent has to arrive at placement
 * still asking for it while keeping the image it pins.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  executionRowLogical,
  type ExecutionRow,
} from "../../src/adapters/postgres/schedulerRows.ts";
import { suppliedExecutionPolicy } from "../../src/adapters/supplied/schedulerPorts.ts";

const pinned = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: "registry.invalid/worker@sha256:842a",
};

function rowOf(configuration: unknown, overrides?: unknown): ExecutionRow {
  return {
    tenant: "tenant",
    project: "project",
    execution: "execution-one",
    placement: "InCluster",
    ticket: "22",
    task: "1",
    task_kind: "Work",
    stage: null,
    source_request: "1:0:ExecuteTask",
    input_bundle: "1:0:InputBundle",
    input_bundle_digest: "b".repeat(64),
    source_seq: "1",
    source_effect: "0",
    ticket_version: "1",
    account: "project",
    cluster: "cluster",
    configuration_revision: "revision",
    configuration_digest: "configuration-digest",
    configuration_canonical: JSON.stringify(configuration),
    configuration_overrides:
      overrides === undefined ? null : JSON.stringify(overrides),
    requirement_identity: "execution-one",
    requirement_value: JSON.stringify(pinned),
    requirement_digest: "a".repeat(64),
    requirement_source: "PlatformDefault",
    platform_default_version: "1",
    status: "Admitted",
    outcome: null,
    result_manifest: null,
    completion_operation: null,
    attempts_opened: "0",
    retries_spent: "0",
  };
}

test("a registration under a single-agent worker asks for that agent", () => {
  const execution = executionRowLogical(
    rowOf({
      version: 1,
      image: "registry.invalid/worker@sha256:842a",
      worker: { mode: { type: "SingleAgent", agent: "Claude" } },
    }),
  );
  assert.equal(execution.agentCapability, "Agent:Claude");
  assert.deepEqual(execution.requirement, pinned);
});

test("a registration whose ticket overrides the worker's mode asks for the agent it will run", () => {
  const configuration = {
    version: 1,
    image: "registry.invalid/worker@sha256:842a",
    worker: { mode: { type: "SingleAgent", agent: "Claude" } },
  };
  const codex = {
    type: "SingleAgent",
    agent: "Codex",
    arguments: [],
    model: "gpt-5-codex",
  };
  assert.equal(
    executionRowLogical(rowOf(configuration, { worker: { mode: codex } }))
      .agentCapability,
    "Agent:Codex",
  );
  assert.equal(
    executionRowLogical(rowOf(configuration, { practices: [] }))
      .agentCapability,
    "Agent:Claude",
    "an override that names no mode leaves the configuration's agent",
  );
});

test("a registration under a worker that names no agent asks for none", () => {
  assert.equal(
    executionRowLogical(
      rowOf({ version: 1, image: "registry.invalid/worker@sha256:842a" }),
    ).agentCapability,
    undefined,
  );
});

test("an evaluation row's positive stage becomes the port's zero-based index", () => {
  const execution = executionRowLogical({
    ...rowOf({ version: 1 }),
    task_kind: "Evaluation",
    stage: "1",
  });
  assert.equal(execution.stage, 0);
});

test("the placement a row stores is the route its execution carries, and one no migration writes is refused", () => {
  const row = rowOf({ version: 1 });
  assert.equal(executionRowLogical(row).route, "InCluster");
  assert.equal(
    executionRowLogical({ ...row, placement: "Pool" }).route,
    "Pool",
  );
  assert.throws(
    () => executionRowLogical({ ...row, placement: "Spillover" }),
    /Spillover is not a route/,
  );
});

test("an attempt whose ticket overrides the worker's mode to an agent its image lacks is denied, as a configuration naming that agent is", async () => {
  const policy = suppliedExecutionPolicy({
    profiles: new Map([
      [
        "Work",
        {
          profile: { profile: "standard", runtimeVersion: "1" },
          grant: {
            tools: [],
            credentials: [],
            network: false,
            filesystem: "WriteWorkspace",
            mayCompleteTask: false,
          },
        },
      ],
    ]),
    routing: {
      routes: { Work: "InCluster", Evaluation: "InCluster" },
      projectRoutes: new Map(),
    },
    imagesAdmitted: [
      {
        image: pinned.image,
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Claude"],
      },
    ],
  });
  const claude = { type: "SingleAgent", agent: "Claude", arguments: [] };
  const codex = {
    type: "SingleAgent",
    agent: "Codex",
    arguments: [],
    model: "gpt-5-codex",
  };
  const configured = (mode: unknown) => ({
    version: 1,
    image: pinned.image,
    worker: { mode },
  });
  const overridden = await policy.profileFor(
    executionRowLogical(rowOf(configured(claude), { worker: { mode: codex } })),
  );
  assert.deepEqual(overridden, {
    resolved: "Denied",
    reason: "ExecutionPolicyDenied",
  });
  assert.deepEqual(
    overridden,
    await policy.profileFor(executionRowLogical(rowOf(configured(codex)))),
  );
  assert.equal(
    (await policy.profileFor(executionRowLogical(rowOf(configured(claude)))))
      .resolved,
    "Profile",
    "the configuration's own agent is admitted",
  );
});
