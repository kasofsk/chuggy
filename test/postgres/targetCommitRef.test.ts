/**
 * An evaluation's bundle stores the ref its source names its commit on as a
 * `TargetCommitRef` reference, and a work bundle stores none.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { reportTaskTerminalCommand } from "../../src/actor/command.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import type { ExecutionSourceObservationPort } from "../../src/interpreter/executionSource.ts";
import { asGitRefName } from "../../src/interpreter/finalizer.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { projectWriterDecide } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessCompletion,
  postgresHarnessHistory,
  postgresHarnessJournal,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessReport,
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

/** Passes the ticket's first work cycle and decides every input that follows. */
async function evaluationSpawned(label: string): Promise<Partition> {
  const partition = await postgresHarnessProject(harness.store, label);
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  await postgresHarnessCompletion(
    harness,
    partition,
    `operation-ref-${randomUUID()}`,
    reportTaskTerminalCommand(
      postgresHarnessReport(memory.graph, workTaskIdentity(1, 1), "Pass"),
    ),
  );
  const writer = {
    ...postgresHarnessWriter(harness),
    executionSources: namingSources(),
  };
  let carried = memory;
  for (let pass = 0; pass < 20; pass += 1) {
    const input = await harness.discovery.next(partition, 300);
    if (input === undefined) break;
    const step = await projectWriterDecide(writer, carried, input);
    assert.equal(step.decided.decided, "Committed");
    carried = step.memory;
  }
  return partition;
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
  const partition = await evaluationSpawned("target-commit-ref");
  assert.deepEqual(await refsStored(partition, "SpawnEvaluation"), [
    { reference_id: ref },
  ]);
});

test("a work bundle stores no ref its commit is on", async () => {
  const partition = await evaluationSpawned("target-commit-ref-work");
  assert.deepEqual(await refsStored(partition, "SpawnWork"), []);
});
