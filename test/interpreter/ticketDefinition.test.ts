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
  configurationOverridesSchema,
  parkedTicketOverrideFields,
  type ConfigurationOverrides,
} from "../../src/contract/configurationOverrides.ts";
import { parkedOverridesVerdict } from "../../src/interpreter/parkedOverrides.ts";
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

/** One override of each field the contract offers a parked ticket, unlike what the configuration says. */
function parkedOverrideOf(
  field: (typeof parkedTicketOverrideFields)[number],
  pinned: Readonly<Record<string, unknown>>,
): ConfigurationOverrides {
  const worker = pinned["worker"] as {
    readonly mode: Readonly<Record<string, unknown>> & {
      readonly arguments: readonly string[];
    };
  };
  switch (field) {
    case "worker.mode":
      return {
        worker: {
          mode: {
            ...worker.mode,
            arguments: [...worker.mode.arguments, "--model=another"],
          } as NonNullable<
            NonNullable<ConfigurationOverrides["worker"]>["mode"]
          >,
        },
      };
    case "worker.setup":
      return { worker: { setup: ["make prepare"] } };
    case "worker.files":
      return { worker: { files: [{ path: "notes.md", content: "Read." }] } };
    case "practices":
      return { practices: [] };
    case "brief.motivation":
      return { brief: { motivation: ["Another reason."] } };
    case "brief.acceptanceCriteria":
      return { brief: { acceptanceCriteria: ["Another criterion."] } };
    case "brief.constraints":
      return { brief: { constraints: ["Another constraint."] } };
  }
}

/** Every field an override may name, by path, read off the contract's schema. */
const overridableFields = Object.entries(
  configurationOverridesSchema.shape,
).flatMap(([key, optional]) => {
  const inner = optional.unwrap();
  return "shape" in inner
    ? Object.keys(inner.shape).map((field) => `${key}.${field}`)
    : [key];
});

test("what the contract offers a parked ticket leaves every repository configuration's definition where it was", () => {
  assert.deepEqual(
    [...parkedTicketOverrideFields, "work.instructions"].sort(),
    [...overridableFields].sort(),
  );
  const directory = new URL("../../.chug/configurations/", import.meta.url);
  const names = readdirSync(directory).filter((name) => name.endsWith(".json"));
  assert.ok(names.length > 0);
  const brief = asDraftBrief({
    intent: "Do the one thing.",
    links: [],
    checks: [],
    repository: "repository-one",
  });
  for (const name of names) {
    const pinned = (
      JSON.parse(readFileSync(new URL(name, directory), "utf8")) as {
        readonly configuration: Readonly<Record<string, unknown>>;
      }
    ).configuration;
    const ticket = {
      configuration: canonicalConfigurationOf(pinned),
      configurationRepository: undefined,
      authoring,
      brief,
    };
    for (const field of parkedTicketOverrideFields)
      assert.deepEqual(
        parkedOverridesVerdict(
          ticket,
          undefined,
          parkedOverrideOf(field, pinned),
        ),
        { verdict: "Admitted" },
        `${name}: ${field}`,
      );
    assert.deepEqual(
      parkedOverridesVerdict(ticket, undefined, {
        work: { instructions: ["Do the other work."] },
      }),
      { verdict: "Refused", code: "OverridesMoveDefinition" },
      name,
    );
  }
});

test("a parked ticket's overrides are held to the ones it holds, not to the configuration alone", () => {
  const ticket = {
    configuration: canonicalConfigurationOf(document),
    configurationRepository: undefined,
    authoring,
    brief: asDraftBrief({ ...briefBeforeImages, repository: "repository-one" }),
  };
  const instructions = { work: { instructions: ["Do the other work."] } };
  assert.deepEqual(
    parkedOverridesVerdict(ticket, instructions, {
      ...instructions,
      practices: [],
    }),
    { verdict: "Admitted" },
  );
  assert.deepEqual(parkedOverridesVerdict(ticket, instructions, {}), {
    verdict: "Refused",
    code: "OverridesMoveDefinition",
  });
  assert.deepEqual(
    parkedOverridesVerdict(ticket, undefined, {
      practices: ["NoSuchPractice"],
    }),
    { verdict: "Refused", code: "ConfigurationInvalid" },
  );
});

test("an agent named where the requirement is a container capability moves the definition, though the contract offers the mode", () => {
  const ticket = {
    configuration: canonicalConfigurationOf({
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
    }),
    configurationRepository: undefined,
    authoring,
    brief: asDraftBrief({ ...briefBeforeImages, repository: "repository-one" }),
  };
  assert.deepEqual(
    parkedOverridesVerdict(ticket, undefined, {
      worker: {
        mode: { type: "SingleAgent", agent: "Claude", arguments: ["--two"] },
      },
    }),
    { verdict: "Admitted" },
  );
  assert.deepEqual(
    parkedOverridesVerdict(ticket, undefined, {
      worker: {
        mode: {
          type: "SingleAgent",
          agent: "Codex",
          arguments: [],
          model: "another",
        },
      },
    }),
    { verdict: "Refused", code: "OverridesMoveDefinition" },
  );
});
