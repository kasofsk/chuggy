/**
 * The spawn of a Stacked ticket's first evaluation reads what the finalizer
 * prepared and writes nothing of the stack: a record names the stack commit and
 * tree in the spawn's bundle, a decision to evaluate unstacked spawns unstacked,
 * a cycle with neither defers the spawn until the bound, and after the bound
 * the evaluation runs unstacked and no record is written for the cycle.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { reportTaskTerminalCommand } from "../../src/actor/command.ts";
import { postgresEvaluationStack } from "../../src/adapters/postgres/evaluationStack.ts";
import { workTaskIdentity } from "../../src/domain/task.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import type { EvaluationStack } from "../../src/interpreter/evaluationStack.ts";
import { evaluationStackSpawn } from "../../src/interpreter/evaluationStackSpawn.ts";
import type { ExecutionSourceObservationPort } from "../../src/interpreter/executionSource.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  projectWriterDecide,
  type ProjectMemory,
} from "../../src/interpreter/projectWriter.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";
import { stackDeferralPassesMax } from "../../src/interpreter/ticketService.ts";
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

/** The harness's spawn source, applying what the ticket service reads of the cycle's stack. */
function readingSources(): ExecutionSourceObservationPort {
  const base = postgresHarnessWriter(harness).executionSources;
  const stacks = evaluationStackSpawn({
    store: postgresEvaluationStack(harness.pool),
    briefs: {
      brief: () =>
        Promise.resolve(
          asDraftBrief({
            intent: "intent",
            links: [],
            repository: asRepositoryId("repository"),
            finalization: { mode: "Push" },
            landing: "Stacked",
          }),
        ),
    },
  });
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
      const read = await stacks.spawned({
        partition: request.partition,
        ticket: asTicketId(request.ticket),
        cycle: request.cycle,
        deferredPasses: request.deferredPasses ?? 0,
      });
      if (read.stack === "Pending") return { ...source, stackPending: true };
      if (read.stack === "Unstacked") return source;
      return {
        ...source,
        target: {
          commit: read.record.stackCommit,
          ref: asGitRefName("refs/heads/chuggy/stack/1/1"),
        },
        expectedTree: read.record.stackTree,
        stack: { record: read.record },
      };
    },
  };
}

/** A Stacked ticket's work cycle 1, passed, and the carried memory its pass starts from. */
async function workPassed(
  partition: Partition,
  label: string,
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
  return memory;
}

/** Decides every pending input, reporting how many passes were deferred. */
async function decided(
  partition: Partition,
  memory: ProjectMemory,
  passes: number,
): Promise<{ memory: ProjectMemory; deferred: number }> {
  const writer = {
    ...postgresHarnessWriter(harness),
    executionSources: readingSources(),
  };
  let carried = memory;
  let deferred = 0;
  for (let pass = 0; pass < passes; pass += 1) {
    const input = await harness.discovery.next(partition, 300);
    if (input === undefined) break;
    const step = await projectWriterDecide(writer, carried, input);
    if (step.decided.decided === "Deferred") {
      deferred += 1;
      continue;
    }
    assert.equal(step.decided.decided, "Committed");
    carried = step.memory;
  }
  return { memory: carried, deferred };
}

function stackOf(repository: string): EvaluationStack {
  return {
    ticket: asTicketId(id(1)),
    cycle: 1,
    repository,
    target: "refs/heads/main",
    tip: asGitObjectId("4".repeat(40)),
    beneath: [{ ticket: asTicketId(7), commit: asGitObjectId("3".repeat(40)) }],
    stackCommit,
    stackTree,
  };
}

async function stackWritten(partition: Partition, stack: EvaluationStack) {
  await harness.query(
    `INSERT INTO evaluation_stack
       (tenant, project, ticket, work_cycle, repository, target_ref, tip, stack_commit, stack_tree)
     VALUES ($1,$2,1,1,$3,$4,$5,$6,$7)`,
    [
      partition.tenant,
      partition.project,
      stack.repository,
      stack.target,
      stack.tip,
      stack.stackCommit,
      stack.stackTree,
    ],
  );
  await harness.query(
    `INSERT INTO evaluation_stack_beneath
       (tenant, project, ticket, work_cycle, depth, beneath_ticket, beneath_commit)
     VALUES ($1,$2,1,1,1,7,$3)`,
    [partition.tenant, partition.project, "3".repeat(40)],
  );
}

async function unstackedDecided(partition: Partition) {
  await harness.query(
    `INSERT INTO evaluation_stack_none (tenant, project, ticket, work_cycle, reason)
     VALUES ($1,$2,1,1,'Conflicted')`,
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

async function evaluationSpawned(partition: Partition) {
  const found = await harness.query(
    `SELECT count(*)::int AS spawned FROM execution_request
      WHERE tenant=$1 AND project=$2 AND kind='SpawnEvaluation'`,
    [partition.tenant, partition.project],
  );
  return found[0]?.["spawned"];
}

async function recordsOf(partition: Partition) {
  const found = await harness.query(
    `SELECT count(*)::int AS held FROM evaluation_stack
      WHERE tenant=$1 AND project=$2`,
    [partition.tenant, partition.project],
  );
  return found[0]?.["held"];
}

test("a prepared stack is read by the spawn, and the bundle names its commit and tree", async () => {
  const partition = await postgresHarnessProject(harness.store, "stack-read");
  const memory = await workPassed(partition, "stack-read");
  await stackWritten(partition, stackOf("repository"));
  const ran = await decided(partition, memory, 20);
  assert.equal(ran.deferred, 0);
  assert.deepEqual(await bundle(partition), [
    { reference_kind: "ExpectedTree", reference_id: stackTree },
    { reference_kind: "TargetCommit", reference_id: stackCommit },
  ]);
});

test("a cycle decided unstacked spawns unstacked at once", async () => {
  const partition = await postgresHarnessProject(harness.store, "stack-none");
  const memory = await workPassed(partition, "stack-none");
  await unstackedDecided(partition);
  const ran = await decided(partition, memory, 20);
  assert.equal(ran.deferred, 0);
  assert.equal(await evaluationSpawned(partition), 1);
  assert.deepEqual(
    (await bundle(partition)).filter(
      (row) => row["reference_id"] === stackCommit,
    ),
    [],
  );
});

test("a cycle the finalizer has not prepared defers the spawn up to the bound and then evaluates unstacked", async () => {
  const partition = await postgresHarnessProject(
    harness.store,
    "stack-deferred",
  );
  const memory = await workPassed(partition, "stack-deferred");
  const ran = await decided(partition, memory, stackDeferralPassesMax + 6);
  assert.equal(ran.deferred, stackDeferralPassesMax);
  assert.equal(await evaluationSpawned(partition), 1);
  assert.deepEqual(
    (await bundle(partition)).filter(
      (row) => row["reference_id"] === stackCommit,
    ),
    [],
  );
});

test("a record written after the bound is refused for a cycle that already evaluates", async () => {
  const partition = await postgresHarnessProject(harness.store, "stack-late");
  const memory = await workPassed(partition, "stack-late");
  await decided(partition, memory, stackDeferralPassesMax + 6);
  const prepared = await postgresEvaluationStack(harness.pool).prepare(
    partition,
    { prepared: "Stack", stack: stackOf("repository") },
  );
  assert.equal(prepared, "Evaluated");
  assert.equal(await recordsOf(partition), 0);
});
