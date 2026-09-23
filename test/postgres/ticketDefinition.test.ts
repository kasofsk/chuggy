/**
 * What a release resolved, read back off the row it wrote. THE ROW IS THE
 * WHOLE OF IT: the journal carries references folded from this material and
 * folding gives nothing back, so a ticket whose definition row is wrong runs
 * the wrong image at a requirement nobody authored, and no later read can
 * tell.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  asCanonicalConfiguration,
  canonicalConfigurationOf,
  type CanonicalConfiguration,
} from "../../src/interpreter/authoring.ts";
import { digestFold } from "../../src/interpreter/resultManifest.ts";
import { materialDigest } from "../../src/interpreter/ticketDefinition.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import type { ProjectMemory } from "../../src/interpreter/projectWriter.ts";
import {
  postgresHarnessCommitted,
  postgresHarnessConfiguration,
  postgresHarnessHistory,
  postgresHarnessOpen,
  postgresHarnessProject,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/** The harness configuration with another image, which is another release's material. */
function imaged(image: string): ReturnType<typeof asCanonicalConfiguration> {
  return asCanonicalConfiguration(
    JSON.stringify({
      ...(JSON.parse(String(postgresHarnessConfiguration)) as Record<
        string,
        unknown
      >),
      image,
    }),
  );
}

/** The one definition row a released ticket has, as its own material and digest. */
async function definitionOf(
  partition: Partition,
  ticket: number,
): Promise<{ definition: Record<string, unknown>; digest: string }> {
  const rows = (await harness.query(
    `SELECT definition, digest FROM ticket_definition
      WHERE tenant=$1 AND project=$2 AND ticket=$3`,
    [partition.tenant, partition.project, ticket],
  )) as readonly { definition: Record<string, unknown>; digest: string }[];
  const row = rows[0];
  if (row === undefined)
    throw new Error(`ticket ${String(ticket)} stored no definition`);
  return row;
}

/** Releases this project's one fixture ticket under the configuration given. */
async function released(
  label: string,
  canonical: CanonicalConfiguration,
): Promise<{
  partition: Partition;
  ticket: number;
  memory: ProjectMemory;
}> {
  const partition = await postgresHarnessProject(harness.store, label);
  const memory = await postgresHarnessHistory(
    harness,
    partition,
    label,
    1,
    undefined,
    canonical,
  );
  return { partition, ticket: 1, memory };
}

/**
 * The two blocks this fixture's stages brief from, which differ: a release
 * resolves one definition per stage key, and a stage given the work task's
 * material or its neighbour's would read the same everywhere if every block
 * were the fixture's one empty roster.
 */
const workBlock = { instructions: ["Do the work."] };
const evaluationBlock = { instructions: ["Review it."], practices: [] };

/** The harness configuration briefing its one evaluation stage from its own block. */
const staged: CanonicalConfiguration = canonicalConfigurationOf({
  ...(JSON.parse(String(postgresHarnessConfiguration)) as Record<
    string,
    unknown
  >),
  evaluations: [evaluationBlock],
  work: workBlock,
});

test("a release stores the material its references were folded from", async () => {
  const { partition, ticket } = await released(
    "definition-one",
    imaged("worker:v1"),
  );
  const stored = await definitionOf(partition, ticket);
  assert.equal(stored.digest, materialDigest(stored.definition));
  const tasks = stored.definition["tasks"] as readonly Record<
    string,
    unknown
  >[];
  assert.deepEqual(
    tasks.map((task) => task["key"]),
    ["Work", "Evaluation:1"],
    "one definition for work and one per stage the plan names",
  );
  for (const task of tasks) {
    assert.deepEqual(task["workload"], {
      image: "worker:v1",
      digest: materialDigest("worker:v1"),
    });
    const requirement = task["executionRequirements"] as Record<
      string,
      unknown
    >;
    assert.equal(requirement["source"], "PlatformDefault");
    assert.equal(requirement["digest"], materialDigest(requirement["value"]));
  }
});

test("a release under another revision stores another definition", async () => {
  const first = await released("definition-first", imaged("worker:v1"));
  const second = await released("definition-second", imaged("worker:v2"));
  const one = await definitionOf(first.partition, first.ticket);
  const two = await definitionOf(second.partition, second.ticket);
  assert.notEqual(one.digest, two.digest);
  assert.deepEqual(
    (two.definition["tasks"] as readonly Record<string, unknown>[])[0]?.[
      "workload"
    ],
    { image: "worker:v2", digest: materialDigest("worker:v2") },
  );
});

/**
 * ONE DEFINITION PER STAGE KEY, EACH FROM ITS OWN BLOCK. The stored row is
 * what a dispatch reads the material from and the journal's released record is
 * what carries the references folded from it, so both are read back here: a
 * stage resolved from the work task's block, or from the block beside it,
 * stores a digest no reader could tell from the right one.
 */
test("a release resolves each task's material from the block its own key names", async () => {
  const { partition, ticket, memory } = await released(
    "definition-staged",
    staged,
  );
  const stored = await definitionOf(partition, ticket);
  const tasks = stored.definition["tasks"] as readonly Record<
    string,
    unknown
  >[];
  assert.deepEqual(
    tasks.map((task) => task["key"]),
    ["Work", "Evaluation:1"],
  );
  assert.deepEqual(tasks[0]?.["inputs"], {
    digest: materialDigest(workBlock),
  });
  assert.deepEqual(tasks[1]?.["inputs"], {
    digest: materialDigest(evaluationBlock),
  });
  const release = (await postgresHarnessCommitted(harness, memory))[0]?.event;
  assert.equal(release?.type, "TicketCreated");
  if (release?.type !== "TicketCreated") return;
  assert.equal(
    release.value.workConfiguration.inputs,
    digestFold(materialDigest(workBlock)),
  );
  assert.deepEqual(
    release.value.evaluationPlan.stages[0]?.evaluators.map(
      (entry) => entry.task.inputs,
    ),
    [digestFold(materialDigest(evaluationBlock))],
    "and every evaluator of the stage runs the definition that stage resolved",
  );
});
