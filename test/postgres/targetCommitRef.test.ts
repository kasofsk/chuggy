/**
 * An evaluation's bundle stores the ref its source names its commit on as a
 * `TargetCommitRef` reference.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { ExecutionSourceObservationPort } from "../../src/interpreter/executionSource.ts";
import { asGitRefName } from "../../src/interpreter/finalizer.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  postgresHarnessEvaluationSpawned,
  postgresHarnessOpen,
  postgresHarnessWriter,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
before(async () => {
  harness = await postgresHarnessOpen();
});
after(async () => {
  await harness.close();
});

const ref = asGitRefName("refs/heads/chuggy/tickets/1/attempts/abc");

/** The harness's spawn source, with `ref` on every spawn's target. */
function namingSources(): ExecutionSourceObservationPort {
  const base = postgresHarnessWriter(harness).executionSources;
  return {
    observe: (request) => base.observe(request),
    spawnSource: async (request) => {
      const source = await base.spawnSource(request);
      return source === undefined
        ? undefined
        : { ...source, target: { ...source.target, ref } };
    },
  };
}

/** The refs the project's bundles of `kind` hold as the ref their commit is on. */
async function refsStored(partition: Partition, kind: string) {
  return harness.query(
    `SELECT r.reference_id
       FROM execution_request q
       JOIN input_bundle_reference r
         ON r.tenant = q.tenant AND r.project = q.project AND r.bundle = q.input_bundle
      WHERE q.tenant=$1 AND q.project=$2 AND q.kind=$3
        AND r.reference_kind='TargetCommitRef'`,
    [partition.tenant, partition.project, kind],
  );
}

test("an evaluation's bundle stores the ref its source names its commit on", async () => {
  const partition = await postgresHarnessEvaluationSpawned(
    harness,
    "target-commit-ref",
    namingSources(),
  );
  assert.deepEqual(await refsStored(partition, "SpawnEvaluation"), [
    { reference_id: ref },
  ]);
});
