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

const pinned = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: "registry.invalid/worker@sha256:842a",
};

function rowOf(configuration: unknown): ExecutionRow {
  return {
    tenant: "tenant",
    project: "project",
    execution: "execution-one",
    ticket: "22",
    task: "1",
    task_kind: "Work",
    stage: null,
    source_request: "1:0:SpawnWork",
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

test("a registration under a worker that names no agent asks for none", () => {
  assert.equal(
    executionRowLogical(
      rowOf({ version: 1, image: "registry.invalid/worker@sha256:842a" }),
    ).agentCapability,
    undefined,
  );
});
