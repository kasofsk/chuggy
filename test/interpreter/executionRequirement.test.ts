import assert from "node:assert/strict";
import { test } from "node:test";

import {
  executionRequirementConfigurationIsValid,
  materializeExecutionRequirement,
} from "../../src/interpreter/executionRequirement.ts";

const native = (xcodeVersionMin: number, sdkVersionMin: number) => ({
  mode: "Native" as const,
  architecture: "Arm64" as const,
  driver: "XcodeBuild" as const,
  xcodeVersionMin,
  sdkVersionMin,
});
const container = (
  image: string,
  operatingSystem: "Linux" | "MacOS" = "Linux",
) => ({
  mode: "Container" as const,
  operatingSystem,
  architecture: "Amd64" as const,
  image,
});
const codexWorker = {
  mode: {
    type: "SingleAgent" as const,
    agent: "Codex" as const,
    model: "gpt-5.3-codex",
    arguments: [],
  },
  setup: [],
  files: [],
};

test("legacy release image materializes the identical Linux container default", () => {
  assert.deepEqual(
    materializeExecutionRequirement(
      { version: 1, image: "worker:v1" },
      1,
      "Work",
    ),
    {
      value: {
        mode: "Container",
        operatingSystem: "Linux",
        architecture: "Amd64",
        image: "worker:v1",
      },
      source: "PlatformDefault",
      platformDefaultVersion: 1,
    },
  );
});

test("a single-agent mode materializes an agent capability instead of an image choice", () => {
  assert.deepEqual(
    materializeExecutionRequirement(
      {
        version: 1,
        image: "legacy-worker:v1",
        worker: codexWorker,
      },
      1,
      "Work",
    ).value,
    {
      mode: "ContainerCapability",
      operatingSystem: "Linux",
      architecture: "Amd64",
      capabilities: ["Agent:Codex"],
    },
  );
});

test("a single agent is added to an authored capability requirement", () => {
  const authoredCapability = {
    mode: "ContainerCapability" as const,
    operatingSystem: "Linux" as const,
    architecture: "Amd64" as const,
    capabilities: ["Agent:Claude" as const],
  };
  const configuration = {
    version: 1,
    image: "legacy-worker:v1",
    worker: codexWorker,
    executionRequirements: {
      platformDefault: authoredCapability,
      platformDefaultVersion: 1,
    },
  };
  assert.equal(executionRequirementConfigurationIsValid(configuration), true);
  assert.deepEqual(
    materializeExecutionRequirement(configuration, 1, "Work").value,
    {
      ...authoredCapability,
      capabilities: ["Agent:Claude", "Agent:Codex"],
    },
  );
});

test("a single-agent worker refuses a native execution requirement", () => {
  const configuration = {
    version: 1,
    image: "legacy-worker:v1",
    worker: codexWorker,
    executionRequirements: {
      platformDefault: native(16, 18),
      platformDefaultVersion: 1,
    },
  };
  assert.equal(executionRequirementConfigurationIsValid(configuration), false);
  assert.throws(
    () => materializeExecutionRequirement(configuration, 1, "Work"),
    /malformed or widening/u,
  );
});

test("task precedence allows two tasks in one ticket to pin different requirements", () => {
  const configuration = {
    version: 1,
    image: "platform",
    executionRequirements: {
      platformDefault: container("platform"),
      platformDefaultVersion: 4,
      ticketDefault: container("ticket"),
      taskKindDefaults: { Work: container("work") },
      taskDefaults: { "2": container("task") },
    },
  };
  assert.equal(
    materializeExecutionRequirement(configuration, 1, "Work").source,
    "TaskKindDefault",
  );
  assert.deepEqual(materializeExecutionRequirement(configuration, 2, "Work"), {
    value: container("task"),
    source: "ExplicitTask",
    platformDefaultVersion: 4,
  });
});

test("stage-qualified evaluation defaults are exact keys with no bare fallback", () => {
  const configuration = {
    version: 1,
    image: "platform",
    evaluations: [
      { instructions: ["Review."], practices: [] },
      { instructions: ["Test."], practices: [] },
    ],
    executionRequirements: {
      platformDefault: container("platform"),
      platformDefaultVersion: 1,
      taskKindDefaults: {
        Evaluation: container("bare"),
        "Evaluation:0": container("review"),
      },
    },
  };
  assert.deepEqual(
    materializeExecutionRequirement(configuration, 1, "Evaluation", 0).value,
    container("review"),
  );
  assert.deepEqual(
    materializeExecutionRequirement(configuration, 2, "Evaluation", 1),
    {
      value: container("platform"),
      source: "PlatformDefault",
      platformDefaultVersion: 1,
    },
  );
});

test("legacy evaluation configurations retain the bare kind default", () => {
  const configuration = {
    version: 1,
    image: "platform",
    executionRequirements: {
      platformDefault: container("platform"),
      platformDefaultVersion: 1,
      taskKindDefaults: { Evaluation: container("evaluation") },
    },
  };
  assert.deepEqual(
    materializeExecutionRequirement(configuration, 1, "Evaluation", 7).value,
    container("evaluation"),
  );
});

test("container task overrides retain the platform while selecting another image", () => {
  const configuration = {
    version: 1,
    image: "worker:v1",
    executionRequirements: {
      platformDefault: {
        mode: "Container",
        operatingSystem: "Linux",
        architecture: "Amd64",
        image: "worker:v1",
      },
      platformDefaultVersion: 2,
      taskDefaults: {
        "2": {
          mode: "Container",
          operatingSystem: "Linux",
          architecture: "Amd64",
          image: "worker:v2",
        },
      },
    },
  };
  const first = materializeExecutionRequirement(configuration, 1, "Work");
  const second = materializeExecutionRequirement(configuration, 2, "Work");
  assert.notDeepEqual(first.value, second.value);
  assert.equal(second.source, "ExplicitTask");
});

test("malformed and widening requirement configurations are refused", () => {
  assert.equal(
    executionRequirementConfigurationIsValid({ version: 1, image: "" }),
    false,
  );
  assert.equal(
    executionRequirementConfigurationIsValid({
      version: 1,
      image: "legacy",
      executionRequirements: {
        platformDefault: container("platform"),
        platformDefaultVersion: 1,
        taskDefaults: { "1": container("task", "MacOS") },
      },
    }),
    false,
  );
  assert.equal(
    executionRequirementConfigurationIsValid({
      version: 1,
      image: "legacy",
      surprise: true,
    }),
    true,
  );
  assert.equal(
    executionRequirementConfigurationIsValid({
      version: 1,
      image: "legacy",
      executionRequirements: {
        platformDefault: container("platform"),
        platformDefaultVersion: 1,
        surprise: true,
      },
    }),
    false,
  );
  assert.equal(
    executionRequirementConfigurationIsValid({
      version: 1,
      image: "legacy",
      executionRequirements: {
        platformDefault: { ...container("platform"), surprise: true },
        platformDefaultVersion: 1,
      },
    }),
    false,
  );
  assert.equal(
    executionRequirementConfigurationIsValid({
      version: 1,
      image: "legacy",
      executionRequirements: {
        platformDefault: native(16, 18),
        platformDefaultVersion: 1,
      },
    }),
    false,
  );
});

test("a newly changed default produces a new value without mutating the old materialization", () => {
  const oldPinned = materializeExecutionRequirement(
    { version: 1, image: "worker:v1" },
    1,
    "Work",
  );
  const newPinned = materializeExecutionRequirement(
    { version: 1, image: "worker:v2" },
    1,
    "Work",
  );
  assert.equal(
    oldPinned.value.mode === "Container" && oldPinned.value.image,
    "worker:v1",
  );
  assert.equal(
    newPinned.value.mode === "Container" && newPinned.value.image,
    "worker:v2",
  );
});
