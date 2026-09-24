/**
 * What a release resolves for each stage of its plan.
 *
 * A DEPLOYMENT'S STAGE BOUND IS NOT THIS FUNCTION'S. The suites that drive a
 * real release run under the reference instance, whose stage bound is one, so
 * a plan of two stages is a shape none of them can reach and the per-stage
 * pick — which block a stage briefs from, which definition its evaluators run
 * — is unheld there. These two functions are pure and resolve the plan they
 * are handed, which is where a second stage can be asked for at all.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canonicalConfigurationOf,
  releaseConfigurationReadiness,
  type ReleaseAuthoring,
  type ReleaseConfiguration,
} from "../../src/interpreter/authoring.ts";
import { digestFold } from "../../src/interpreter/resultManifest.ts";
import {
  materialDigest,
  releasedTicketBrief,
  releasedTicketDefinition,
  ticketDefinitionMaterial,
  ticketTaskMaterialAt,
} from "../../src/interpreter/ticketDefinition.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import { asDraftBrief } from "../../src/interpreter/ticketBrief.ts";

/** A configuration briefing its two evaluation stages from blocks that differ. */
const configuration: ReleaseConfiguration = (() => {
  const readiness = releaseConfigurationReadiness(
    canonicalConfigurationOf({
      brief: {
        acceptanceCriteria: ["It works."],
        constraints: [],
        motivation: ["It matters."],
      },
      evaluations: [
        { instructions: ["Review."], practices: [] },
        { instructions: ["Test."], practices: [] },
      ],
      image: "worker:v1",
      practices: [],
      review: { instructions: [] },
      version: 1,
      work: { instructions: ["Do the work."] },
    }),
  );
  if (readiness.readiness !== "Ready")
    throw new Error(`the fixture configuration is ${readiness.fault}`);
  return readiness.configuration;
})();

/** Two stages, the first listing two evaluators, so both picks are visible. */
const authoring: ReleaseAuthoring = {
  deps: new Set<number>(),
  prog: [
    { key: 1, evaluators: [{ key: 1 }, { key: 2 }] },
    { key: 2, evaluators: [{ key: 1 }] },
  ],
};

/** The block a stage of this fixture briefs from, by its key. */
function block(stage: number): unknown {
  return (configuration.evaluations ?? [])[stage - 1];
}

test("a release resolves one task definition per stage, from that stage's own block", () => {
  const material = ticketDefinitionMaterial({ authoring, configuration });
  assert.deepEqual(
    material.tasks.map((task) => task.key),
    ["Work", "Evaluation:1", "Evaluation:2"],
  );
  assert.equal(
    ticketTaskMaterialAt(material, "Work").inputs.digest,
    materialDigest(configuration.work),
  );
  assert.equal(
    ticketTaskMaterialAt(material, "Evaluation:1").inputs.digest,
    materialDigest(block(1)),
  );
  assert.equal(
    ticketTaskMaterialAt(material, "Evaluation:2").inputs.digest,
    materialDigest(block(2)),
  );
});

test("every evaluator of a stage runs that stage's definition, and no other stage's", () => {
  const material = ticketDefinitionMaterial({ authoring, configuration });
  const released = releasedTicketDefinition(asTicketId(1), authoring, material);
  const [first, second] = released.evaluationPlan.stages;
  const [one, two] = first?.evaluators ?? [];
  const last = second?.evaluators[0];
  assert.equal(first?.evaluators.length, 2);
  assert.deepEqual(
    one?.task,
    two?.task,
    "a stage is what a configuration indexes, so its evaluators share one definition",
  );
  assert.equal(one?.task.inputs, digestFold(materialDigest(block(1))));
  assert.equal(last?.task.inputs, digestFold(materialDigest(block(2))));
  assert.notDeepEqual(
    one?.task,
    last?.task,
    "and two stages briefed from different blocks are two definitions",
  );
  assert.equal(
    released.workConfiguration.inputs,
    digestFold(materialDigest(configuration.work)),
  );
  assert.notDeepEqual(released.workConfiguration, one?.task);
});

test("a stored brief is read back only as the one its release's content digest names", () => {
  const brief = asDraftBrief({ intent: "Do the one thing.", links: [] });
  const released = ticketDefinitionMaterial({
    authoring,
    configuration,
    brief,
  });
  assert.deepEqual(
    releasedTicketBrief(
      JSON.parse(JSON.stringify(brief)) as unknown,
      released.content.digest,
    ),
    brief,
  );
  assert.throws(
    () =>
      releasedTicketBrief(
        { ...brief, intent: "Do another thing." },
        released.content.digest,
      ),
    /not the one the released content names/,
  );
  const briefless = ticketDefinitionMaterial({ authoring, configuration });
  assert.equal(
    releasedTicketBrief(undefined, briefless.content.digest),
    undefined,
  );
  assert.throws(() => releasedTicketBrief(undefined, released.content.digest));
});
