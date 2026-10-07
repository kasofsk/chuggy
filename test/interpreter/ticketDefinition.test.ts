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
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

import {
  parkedOverrideFields,
  type ConfigurationOverrides,
  type ParkedOverrideField,
} from "../../src/contract/configurationOverrides.ts";
import type { ReleasedTicket } from "../../src/domain/generated/modelTypes.ts";
import {
  canonicalConfigurationOf,
  draftReleaseReadiness,
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
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  parkedOverridesVerdict,
  type ParkedTicketRelease,
} from "../../src/interpreter/parkedOverrides.ts";

/** The document of a configuration briefing its two evaluation stages from blocks that differ. */
const document = {
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
  worker: {
    files: [],
    mode: { agent: "Claude", arguments: [], type: "SingleAgent" },
    setup: [],
  },
};

/** The same configuration, ready. */
const configuration: ReleaseConfiguration = (() => {
  const readiness = releaseConfigurationReadiness(
    canonicalConfigurationOf(document),
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

/** What a release stored for a brief before a brief could name an image. */
const briefBeforeImages = {
  intent: "Do the one thing.",
  links: [],
  checks: [],
};

/** The content digest the release of `briefBeforeImages` stored then. */
const digestBeforeImages =
  "8f351dc47e8a518256a965b2a205ed789eeb1da4e1a036717370a46f5c2aa2e9";

test("a brief released before a brief could name an image is still the one its content names", () => {
  assert.deepEqual(
    releasedTicketBrief(briefBeforeImages, digestBeforeImages),
    asDraftBrief(briefBeforeImages),
  );
  assert.equal(
    ticketDefinitionMaterial({
      authoring,
      configuration,
      brief: asDraftBrief(briefBeforeImages),
    }).content.digest,
    digestBeforeImages,
  );
});

test("the images a brief names are part of the content its release names", () => {
  const brief = asDraftBrief({
    ...briefBeforeImages,
    images: ["image/png:one"],
  });
  const released = ticketDefinitionMaterial({
    authoring,
    configuration,
    brief,
  });
  assert.notEqual(released.content.digest, digestBeforeImages);
  assert.deepEqual(
    releasedTicketBrief(
      JSON.parse(JSON.stringify(brief)) as unknown,
      released.content.digest,
    ),
    brief,
  );
  for (const images of [[], ["image/png:another"]])
    assert.throws(
      () => releasedTicketBrief({ ...brief, images }, released.content.digest),
      /not the one the released content names/,
    );
});

/** The definition one draft releases under a configuration and its overrides. */
function draftDefinition(
  pinned: unknown,
  overrides: ConfigurationOverrides | undefined,
): ReleasedTicket {
  const readiness = draftReleaseReadiness(
    canonicalConfigurationOf(pinned),
    { checks: [], repository: asRepositoryId("repository-one") },
    undefined,
    overrides,
  );
  if (readiness.readiness !== "Ready")
    throw new Error(`the draft's configuration is ${readiness.fault}`);
  return releasedTicketDefinition(
    asTicketId(1),
    authoring,
    ticketDefinitionMaterial({
      authoring,
      configuration: readiness.configuration,
    }),
  );
}

test("a draft naming no overrides is defined exactly as its configuration is", () => {
  assert.deepEqual(
    draftDefinition(document, undefined),
    releasedTicketDefinition(
      asTicketId(1),
      authoring,
      ticketDefinitionMaterial({ authoring, configuration }),
    ),
  );
});

test("an override of the work instructions defines the ticket as a configuration saying them would", () => {
  const instructions = ["Do the other work."];
  const overridden = draftDefinition(document, { work: { instructions } });
  assert.notDeepEqual(overridden, draftDefinition(document, undefined));
  assert.deepEqual(
    overridden,
    draftDefinition({ ...document, work: { instructions } }, undefined),
  );
});

/** Each configuration this repository runs, as its document. */
const repositoryConfigurations: readonly {
  readonly name: string;
  readonly document: Record<string, unknown>;
}[] = (() => {
  const directory = new URL("../../.chug/configurations/", import.meta.url);
  return readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      name: file,
      document: (
        JSON.parse(readFileSync(new URL(file, directory), "utf8")) as {
          readonly configuration: Record<string, unknown>;
        }
      ).configuration,
    }));
})();

/** One override of each field a parked ticket may change, saying something its configuration does not. */
const parkedOverrideOf: Readonly<
  Record<ParkedOverrideField, ConfigurationOverrides>
> = {
  "worker.mode": {
    worker: {
      mode: {
        type: "SingleAgent",
        agent: "Codex",
        arguments: [],
        model: "another-model",
      },
    },
  },
  "worker.setup": { worker: { setup: ["make another"] } },
  "worker.files": {
    worker: { files: [{ path: "another.txt", content: "another" }] },
  },
  practices: { practices: [] },
  "brief.motivation": { brief: { motivation: ["Another reason."] } },
  "brief.acceptanceCriteria": {
    brief: { acceptanceCriteria: ["Another criterion."] },
  },
  "brief.constraints": { brief: { constraints: ["Another constraint."] } },
};

/** A parked ticket released under one document, with a brief naming its repository and one stage. */
function parkedRelease(pinned: unknown): ParkedTicketRelease {
  return {
    configuration: canonicalConfigurationOf(pinned),
    configurationRepository: undefined,
    brief: asDraftBrief({
      intent: "Do the one thing.",
      links: [],
      repository: "repository-one",
    }),
    authoring: {
      deps: new Set<number>(),
      prog: [{ key: 1, evaluators: [{ key: 1 }] }],
    },
  };
}

test("each field a parked ticket may change leaves every repository configuration's definition as it was", () => {
  assert.ok(repositoryConfigurations.length > 0);
  for (const { name, document: pinned } of repositoryConfigurations)
    for (const field of parkedOverrideFields)
      assert.equal(
        parkedOverridesVerdict(
          parkedRelease(pinned),
          undefined,
          parkedOverrideOf[field],
        ),
        "Admitted",
        `${name}: ${field}`,
      );
});

test("an override of the work instructions moves every repository configuration's definition", () => {
  for (const { name, document: pinned } of repositoryConfigurations)
    assert.equal(
      parkedOverridesVerdict(parkedRelease(pinned), undefined, {
        work: { instructions: ["Do the other work."] },
      }),
      "DefinitionLocked",
      name,
    );
});

test("a change keeping the work instructions a parked ticket already overrides is admitted", () => {
  const held = { work: { instructions: ["Do the other work."] } };
  assert.equal(
    parkedOverridesVerdict(parkedRelease(document), held, {
      ...held,
      ...parkedOverrideOf["worker.setup"],
    }),
    "Admitted",
  );
  assert.equal(
    parkedOverridesVerdict(parkedRelease(document), held, {}),
    "DefinitionLocked",
  );
});

test("an agent folded into a capability requirement moves the definition though its field may change", () => {
  const capable = {
    ...document,
    executionRequirements: {
      platformDefault: {
        mode: "ContainerCapability",
        operatingSystem: "Linux",
        architecture: "Amd64",
        capabilities: ["Agent:Claude"],
      },
      platformDefaultVersion: 1,
    },
  };
  assert.equal(
    parkedOverridesVerdict(
      parkedRelease(capable),
      undefined,
      parkedOverrideOf["worker.mode"],
    ),
    "DefinitionLocked",
  );
  assert.equal(
    parkedOverridesVerdict(parkedRelease(capable), undefined, {
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Claude",
          arguments: ["--model=another"],
        },
      },
    }),
    "Admitted",
  );
});

test("overrides that leave the configuration unready are refused as a release refuses them", () => {
  assert.equal(
    parkedOverridesVerdict(parkedRelease(document), undefined, {
      practices: ["NotAPractice"],
    }),
    "ConfigurationInvalid",
  );
});
