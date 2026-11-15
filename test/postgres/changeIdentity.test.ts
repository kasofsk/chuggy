/**
 * An evaluation's bundle stores the identity of the change its spawn observed
 * as a `ChangeIdentity` reference, and a spawn that observed none stores none.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type { ExecutionSourceObservationPort } from "../../src/interpreter/executionSource.ts";
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

const identity = "8".repeat(40);

/** The harness's spawn source, with `changeIdentity` on every evaluation's where one is given. */
function identifyingSources(
  changeIdentity: string | undefined,
): ExecutionSourceObservationPort {
  const base = postgresHarnessWriter(harness).executionSources;
  return {
    observe: (request) => base.observe(request),
    spawnSource: async (request) => {
      const source = await base.spawnSource(request);
      return source === undefined ||
        request.kind !== "Evaluation" ||
        changeIdentity === undefined
        ? source
        : { ...source, changeIdentity };
    },
  };
}

/** Passes the ticket's first work cycle and decides every input that follows. */
async function evaluationSpawned(
  label: string,
  changeIdentity: string | undefined,
): Promise<Partition> {
  return postgresHarnessEvaluationSpawned(
    harness,
    label,
    identifyingSources(changeIdentity),
  );
}

/** The change identities the project's evaluation bundles hold. */
async function identitiesStored(partition: Partition) {
  return harness.query(
    `SELECT r.reference_id
       FROM execution_request q
       JOIN input_bundle_reference r
         ON r.tenant = q.tenant AND r.project = q.project AND r.bundle = q.input_bundle
      WHERE q.tenant=$1 AND q.project=$2 AND q.kind='SpawnEvaluation'
        AND r.reference_kind='ChangeIdentity'`,
    [partition.tenant, partition.project],
  );
}

test("an evaluation's bundle stores the change identity its spawn observed", async () => {
  const partition = await evaluationSpawned("identity-pinned", identity);
  assert.deepEqual(await identitiesStored(partition), [
    { reference_id: identity },
  ]);
});

test("an evaluation whose spawn observed no change identity stores none", async () => {
  const partition = await evaluationSpawned("identity-absent", undefined);
  assert.deepEqual(await identitiesStored(partition), []);
});
