/**
 * The size one task of a configuration runs with, field by field: its kind's,
 * then the configuration's, then none, which a placement reads as its
 * deployment's own.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asTaskResources,
  materializeTaskResources,
} from "../../src/interpreter/taskResources.ts";

/** A configuration naming `resources`, with its evaluations listed where `listed`. */
function sized(resources: unknown, listed = false): unknown {
  return {
    version: 1,
    image: "worker:v1",
    resources,
    ...(listed ? { evaluations: [{}, {}] } : {}),
  };
}

test("a configuration that names no size gives no task one", () => {
  for (const configuration of [
    { version: 1, image: "worker:v1" },
    sized({}),
    sized({ taskKindDefaults: {} }),
  ]) {
    assert.equal(materializeTaskResources(configuration, "Work"), undefined);
    assert.equal(
      materializeTaskResources(configuration, "Evaluation", 1),
      undefined,
    );
  }
});

test("a configuration-wide size is every task's, its CPUs asked in millis", () => {
  const configuration = sized({ ticketDefault: { cpus: 4, memoryMib: 8_192 } });
  for (const [kind, stage] of [
    ["Work", undefined],
    ["Evaluation", 1],
    ["Evaluation", 2],
  ] as const)
    assert.deepEqual(materializeTaskResources(configuration, kind, stage), {
      cpuMillis: 4_000,
      memoryMib: 8_192,
    });
});

test("a task kind's size overrides the configuration's field by field, and only for that kind", () => {
  const configuration = sized({
    ticketDefault: { cpus: 2, memoryMib: 4_096 },
    taskKindDefaults: { Work: { memoryMib: 16_384 } },
  });
  assert.deepEqual(materializeTaskResources(configuration, "Work"), {
    cpuMillis: 2_000,
    memoryMib: 16_384,
  });
  assert.deepEqual(materializeTaskResources(configuration, "Evaluation", 1), {
    cpuMillis: 2_000,
    memoryMib: 4_096,
  });
  assert.deepEqual(
    materializeTaskResources(
      sized({ taskKindDefaults: { Work: { cpus: 8 } } }),
      "Work",
    ),
    { cpuMillis: 8_000 },
    "a field neither names is left to the deployment",
  );
});

test("an evaluation reads its stage's key where the evaluations are listed, and the kind's where they are not", () => {
  const resources = {
    taskKindDefaults: {
      Evaluation: { cpus: 3 },
      "Evaluation:2": { cpus: 6 },
    },
  };
  assert.deepEqual(
    materializeTaskResources(sized(resources, true), "Evaluation", 2),
    { cpuMillis: 6_000 },
  );
  assert.equal(
    materializeTaskResources(sized(resources, true), "Evaluation", 1),
    undefined,
    "Evaluation is unused where the evaluations are listed",
  );
  assert.deepEqual(
    materializeTaskResources(sized(resources), "Evaluation", 2),
    { cpuMillis: 3_000 },
    "and Evaluation:N is unused where they are not",
  );
});

test("a size the configuration cannot hold is a fault of the caller", () => {
  assert.throws(() =>
    materializeTaskResources(sized({ ticketDefault: { cpus: 0 } }), "Work"),
  );
  assert.throws(() => materializeTaskResources(sized({}), "Evaluation"));
});

test("a stored size is read back whole, and one no release writes is refused", () => {
  assert.deepEqual(asTaskResources({ cpuMillis: 4_000 }), {
    cpuMillis: 4_000,
  });
  assert.deepEqual(asTaskResources({ cpuMillis: 4_000, memoryMib: 8_192 }), {
    cpuMillis: 4_000,
    memoryMib: 8_192,
  });
  for (const stored of [
    {},
    { cpuMillis: 0 },
    { memoryMib: 1.5 },
    { cpus: 4 },
    null,
  ])
    assert.throws(
      () => asTaskResources(stored),
      TypeError,
      JSON.stringify(stored),
    );
});
