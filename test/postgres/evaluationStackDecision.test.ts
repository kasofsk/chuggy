/**
 * The record of the stack an evaluation runs over is written in the very
 * transaction of the decision that spawns the evaluation, by the ticket
 * service: the spawn's bundle names the stack commit and its tree, a spawn
 * asked again leaves the first record alone, and a spawn that stacks nothing
 * writes none.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { reportTaskTerminalCommand } from "../../src/actor/command.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { EvaluationStack } from "../../src/interpreter/evaluationStack.ts";
import type { ExecutionSourceObservationPort } from "../../src/interpreter/executionSource.ts";
import {
  asGitObjectId,
  asGitRefName,
} from "../../src/interpreter/finalizer.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { id } from "../domain/fixtures.ts";
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

const stackCommit = asGitObjectId("5".repeat(40));
const stackTree = asGitObjectId("6".repeat(40));
const stackRef = asGitRefName("refs/heads/chuggy/stack/1/1");

/** The harness's spawn source, made to stack an evaluation the way the real port does. */
function stackingSources(
  stacks: (cycle: number) => EvaluationStack,
  fresh: boolean,
): ExecutionSourceObservationPort {
  const base = postgresHarnessWriter(harness).executionSources;
  return {
    observe: (request) => base.observe(request),
    spawnSource: async (request) => {
      const source = await base.spawnSource(request);
      if (
        source === undefined ||
        request.kind !== "Evaluation" ||
        request.cycle === undefined
      )
        return source;
      return {
        ...source,
        target: { commit: stackCommit, ref: stackRef },
        expectedTree: stackTree,
        stack: { record: stacks(request.cycle), fresh },
      };
    },
  };
}

/** A Stacked ticket's work cycle 1, passed, and the evaluation its pass spawns decided with `sources`. */
async function spawned(
  partition: Partition,
  label: string,
  sources: ExecutionSourceObservationPort | undefined,
): Promise<ProjectMemory> {
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    label,
    postgresHarnessJournal().length,
  );
  await postgresHarnessCompletion(
    harness,
    partition,
    `operation-stack-${randomUUID()}`,
    reportTaskTerminalCommand(
      postgresHarnessReport(memory.graph, workTaskIdentity(1, 1), "Pass"),
    ),
  );
  const writer = {
    ...postgresHarnessWriter(harness),
    ...(sources === undefined ? {} : { executionSources: sources }),
  };
  let carried = memory;
  for (;;) {
    const input = await harness.discovery.next(partition, 300);
    if (input === undefined) return carried;
    const step = await projectWriterDecide(writer, carried, input);
    assert.equal(step.decided.decided, "Committed");
    carried = step.memory;
  }
}

function stackFor(repository: string) {
  return (cycle: number): EvaluationStack => ({
    ticket: asTicketId(id(1)),
    cycle,
    repository,
    target: "refs/heads/main",
    tip: asGitObjectId("4".repeat(40)),
    beneath: [{ ticket: asTicketId(7), commit: asGitObjectId("3".repeat(40)) }],
    stackCommit,
    stackTree,
  });
}

async function recorded(partition: Partition) {
  return harness.query(
    `SELECT s.work_cycle::text AS work_cycle, s.stack_commit, s.stack_tree,
            (SELECT count(*) FROM evaluation_stack_beneath b
              WHERE b.tenant = s.tenant AND b.project = s.project
                AND b.ticket = s.ticket AND b.work_cycle = s.work_cycle)::text AS beneath
       FROM evaluation_stack s WHERE s.tenant=$1 AND s.project=$2`,
    [partition.tenant, partition.project],
  );
}

async function bundle(partition: Partition) {
  return harness.query(
    `SELECT r.reference_kind, r.reference_id
       FROM execution_request q
       JOIN input_bundle_reference r
         ON r.tenant = q.tenant AND r.project = q.project AND r.bundle = q.input_bundle
      WHERE q.tenant=$1 AND q.project=$2 AND q.kind='SpawnEvaluation'
        AND r.reference_kind IN ('TargetCommit','ExpectedTree')
      ORDER BY r.reference_kind`,
    [partition.tenant, partition.project],
  );
}

test("the stack is recorded with the spawn that starts the evaluation, and the bundle names its commit and tree", async () => {
  const partition = await postgresHarnessProject(harness.store, "stack-atomic");
  await spawned(
    partition,
    "stack-atomic",
    stackingSources(stackFor("repository"), true),
  );
  assert.deepEqual(await recorded(partition), [
    {
      work_cycle: "1",
      stack_commit: stackCommit,
      stack_tree: stackTree,
      beneath: "1",
    },
  ]);
  assert.deepEqual(await bundle(partition), [
    { reference_kind: "ExpectedTree", reference_id: stackTree },
    { reference_kind: "TargetCommit", reference_id: stackCommit },
  ]);
});

test("a spawn that stacks nothing writes no record", async () => {
  const partition = await postgresHarnessProject(harness.store, "stack-none");
  await spawned(partition, "stack-none", undefined);
  assert.deepEqual(await recorded(partition), []);
  assert.deepEqual(
    (await bundle(partition)).filter(
      (row) => row["reference_id"] === stackCommit,
    ),
    [],
  );
});

test("a spawn asked again for a stack the cycle already holds leaves the first record alone", async () => {
  const partition = await postgresHarnessProject(harness.store, "stack-reask");
  await harness.query(
    `INSERT INTO evaluation_stack
       (tenant, project, ticket, work_cycle, repository, target_ref, tip, stack_commit, stack_tree)
     VALUES ($1,$2,1,1,'earlier','refs/heads/main',$3,$4,$5)`,
    [
      partition.tenant,
      partition.project,
      "1".repeat(40),
      "2".repeat(40),
      "7".repeat(40),
    ],
  );
  await spawned(
    partition,
    "stack-reask",
    stackingSources(stackFor("later"), true),
  );
  const rows = await recorded(partition);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.["stack_commit"], "2".repeat(40));
});
