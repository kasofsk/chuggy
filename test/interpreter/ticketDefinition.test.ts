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
  asConfigurationRevisionId,
  canonicalConfigurationOf,
  configurationRepositoryOf,
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
  ticketTaskRequirement,
  ticketTaskResources,
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
  if (readiness.configuration.version !== 1)
    throw new Error("the fixture configuration is a catalog");
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
  const material = ticketDefinitionMaterial({
    authoring,
    ticket: { version: 1, configuration },
  });
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
  const material = ticketDefinitionMaterial({
    authoring,
    ticket: { version: 1, configuration },
  });
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
    ticket: { version: 1, configuration },
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
  const briefless = ticketDefinitionMaterial({
    authoring,
    ticket: { version: 1, configuration },
  });
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
      ticket: { version: 1, configuration },
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
    ticket: { version: 1, configuration },
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
      ticket: readiness.ticket,
    }),
  );
}

test("a draft naming no overrides is defined exactly as its configuration is", () => {
  assert.deepEqual(
    draftDefinition(document, undefined),
    releasedTicketDefinition(
      asTicketId(1),
      authoring,
      ticketDefinitionMaterial({
        authoring,
        ticket: { version: 1, configuration },
      }),
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
    [...parkedTicketOverrideFields, "work.instructions", "workloads"].sort(),
    [...overridableFields].sort(),
  );
  const directory = new URL("../fixtures/configurations/", import.meta.url);
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
    assert.deepEqual(
      parkedOverridesVerdict(ticket, undefined, {
        workloads: { build: { prompt: { text: "Do the other work." } } },
      }),
      { verdict: "Refused", code: "OverridesUnsupported" },
      name,
    );
  }
});

/** A catalog ticket whose work is one agent and whose one stage runs one command. */
const parkedCatalogTicket = {
  configuration: canonicalConfigurationOf({
    version: 2,
    image: "worker:v2",
    workloads: {
      build: {
        runner: "Agent",
        prompt: { text: "Do the work." },
        worker: { mode: document.worker.mode, setup: [], files: [] },
      },
      tests: { runner: "Commands", commands: ["npm test"] },
    },
    plans: { standard: [{ name: "checks", evaluators: ["tests"] }] },
    defaults: { work: "build", evaluation: "standard" },
  }),
  configurationRepository: undefined,
  authoring: {
    deps: new Set<number>(),
    prog: [{ key: 1, evaluators: [{ key: 1 }] }],
  },
  brief: asDraftBrief({ ...briefBeforeImages, repository: "repository-one" }),
};

test("an override of a workload a parked catalog ticket runs moves its definition, which is why the contract offers a parked ticket no workloads", () => {
  assert.deepEqual(parkedOverridesVerdict(parkedCatalogTicket, undefined, {}), {
    verdict: "Admitted",
  });
  const offers: readonly ConfigurationOverrides[] = [
    { workloads: { build: { prompt: { text: "Do the other work." } } } },
    {
      workloads: {
        build: {
          worker: {
            mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
            setup: ["make prepare"],
            files: [],
          },
        },
      },
    },
    { workloads: { tests: { commands: ["npm test", "npm run lint"] } } },
  ];
  for (const offered of offers) {
    assert.deepEqual(
      parkedOverridesVerdict(parkedCatalogTicket, undefined, offered),
      { verdict: "Refused", code: "OverridesMoveDefinition" },
      JSON.stringify(offered),
    );
    assert.deepEqual(
      parkedOverridesVerdict(parkedCatalogTicket, offered, offered),
      { verdict: "Admitted" },
      JSON.stringify(offered),
    );
  }
});

test("a parked override that moves a brief's checks onto an evaluator the program leaves out is refused ProgramSkipsBriefChecks", () => {
  const agent = (text: string) => ({
    runner: "Agent",
    prompt: { text },
    worker: { mode: document.worker.mode, setup: [], files: [] },
  });
  const ticket = {
    configuration: canonicalConfigurationOf({
      version: 2,
      image: "worker:v2",
      workloads: {
        build: agent("Do the work."),
        review: agent("Review the work."),
        tests: { runner: "Commands", commands: ["npm test"] },
      },
      plans: { gated: [{ name: "checks", evaluators: ["review", "tests"] }] },
      defaults: { work: "build", evaluation: "gated" },
    }),
    configurationRepository: undefined,
    authoring: {
      deps: new Set<number>(),
      prog: [{ key: 1, evaluators: [{ key: 2 }] }],
    },
    brief: asDraftBrief({
      ...briefBeforeImages,
      checks: ["npm run lint"],
      repository: "repository-one",
    }),
  };
  const commanded: ConfigurationOverrides = {
    workloads: { review: { runner: "Commands", commands: ["true"] } },
  };
  assert.deepEqual(parkedOverridesVerdict(ticket, undefined, commanded), {
    verdict: "Refused",
    code: "ProgramSkipsBriefChecks",
  });
  assert.deepEqual(
    parkedOverridesVerdict(
      {
        ...ticket,
        brief: asDraftBrief({
          ...briefBeforeImages,
          repository: "repository-one",
        }),
      },
      undefined,
      commanded,
    ),
    { verdict: "Admitted" },
  );
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

test("a parked ticket whose brief and configuration do not pair is refused under that fault, whatever is offered", () => {
  const paired = {
    configuration: canonicalConfigurationOf(document),
    configurationRepository: undefined,
    authoring,
    brief: asDraftBrief({ ...briefBeforeImages, repository: "repository-one" }),
  };
  const unpaired = [
    [
      {
        ...paired,
        brief: asDraftBrief({
          ...briefBeforeImages,
          checks: ["npm test"],
          repository: "repository-one",
        }),
      },
      "BriefChecksUncommanded",
    ],
    [
      { ...paired, brief: asDraftBrief(briefBeforeImages) },
      "BriefNamesNoRepository",
    ],
    [
      {
        ...paired,
        configurationRepository: {
          from: "Imported",
          repository: asRepositoryId("repository-two"),
        },
      },
      "ConfigurationFromAnotherRepository",
    ],
  ] as const;
  for (const [ticket, code] of unpaired)
    for (const offered of [{}, { practices: [] }])
      assert.deepEqual(
        parkedOverridesVerdict(ticket, undefined, offered),
        { verdict: "Refused", code },
        code,
      );
  assert.deepEqual(parkedOverridesVerdict(paired, undefined, {}), {
    verdict: "Admitted",
  });
});

test("a parked ticket released under the project's one bootstrap from before each repository had its own still takes overrides", () => {
  const ticket = {
    configuration: canonicalConfigurationOf(document),
    configurationRepository: configurationRepositoryOf(
      asConfigurationRevisionId("bootstrap"),
      undefined,
    ),
    authoring,
    brief: asDraftBrief({ ...briefBeforeImages, repository: "repository-one" }),
  };
  assert.deepEqual(parkedOverridesVerdict(ticket, undefined, {}), {
    verdict: "Admitted",
  });
  assert.deepEqual(
    parkedOverridesVerdict(ticket, undefined, {
      work: { instructions: ["Do the other work."] },
    }),
    { verdict: "Refused", code: "OverridesMoveDefinition" },
  );
});

test("an agent named where the requirement is a container capability moves the definition, though the contract offers the mode", () => {
  const ticket = {
    configuration: canonicalConfigurationOf({
      ...document,
      executionRequirements: {
        platformDefault: {
          mode: "Capability",
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

/** The fixture configuration naming a size for every task and a larger one for its work. */
function sizedConfiguration(resources: unknown): ReleaseConfiguration {
  const readiness = releaseConfigurationReadiness(
    canonicalConfigurationOf({ ...document, resources }),
  );
  if (readiness.readiness !== "Ready")
    throw new Error(`the sized configuration is ${readiness.fault}`);
  if (readiness.configuration.version !== 1)
    throw new Error("the sized configuration is a catalog");
  return readiness.configuration;
}

test("a configuration that names no size releases each workload as its image alone, as a release before sizes did", () => {
  const material = ticketDefinitionMaterial({
    authoring,
    ticket: { version: 1, configuration },
  });
  for (const task of material.tasks)
    assert.deepEqual(task.workload, {
      image: "worker:v1",
      digest: materialDigest("worker:v1"),
    });
  assert.equal(
    releasedTicketDefinition(asTicketId(1), authoring, material)
      .workConfiguration.workload,
    digestFold(materialDigest("worker:v1")),
  );
});

test("a release pins each task's size in its workload, a task kind's over the configuration's, and folds it into the reference", () => {
  const material = ticketDefinitionMaterial({
    authoring,
    ticket: {
      version: 1,
      configuration: sizedConfiguration({
        ticketDefault: { cpus: 2, memoryMib: 4_096 },
        taskKindDefaults: { Work: { cpus: 8, memoryMib: 16_384 } },
      }),
    },
  });
  const work = ticketTaskMaterialAt(material, "Work").workload;
  const review = ticketTaskMaterialAt(material, "Evaluation:1").workload;
  assert.deepEqual(work.resources, { cpuMillis: 8_000, memoryMib: 16_384 });
  assert.deepEqual(review.resources, { cpuMillis: 2_000, memoryMib: 4_096 });
  assert.equal(
    work.digest,
    materialDigest({ image: "worker:v1", resources: work.resources }),
  );
  assert.notEqual(work.digest, review.digest);
  assert.notEqual(work.digest, materialDigest("worker:v1"));
  const released = releasedTicketDefinition(asTicketId(1), authoring, material);
  assert.equal(released.workConfiguration.workload, digestFold(work.digest));
  assert.equal(
    released.evaluationPlan.stages[0]?.evaluators[0]?.task.workload,
    digestFold(review.digest),
  );
});

test("a stored task's size is read back as it was released, and a task released with none has none", () => {
  const sized = ticketDefinitionMaterial({
    authoring,
    ticket: {
      version: 1,
      configuration: sizedConfiguration({
        ticketDefault: { memoryMib: 8_192 },
      }),
    },
  });
  const stored: unknown = JSON.parse(JSON.stringify(sized));
  assert.deepEqual(ticketTaskResources(stored, "Work"), { memoryMib: 8_192 });
  assert.deepEqual(ticketTaskResources(stored, "Evaluation:2"), {
    memoryMib: 8_192,
  });
  const unsized: unknown = JSON.parse(
    JSON.stringify(
      ticketDefinitionMaterial({
        authoring,
        ticket: { version: 1, configuration },
      }),
    ),
  );
  assert.equal(ticketTaskResources(unsized, "Work"), undefined);
  assert.throws(
    () => ticketTaskResources(unsized, "Evaluation:3"),
    /resolves no workload/,
  );
});

test("a requirement released under its mode's former name is read as the current one, and handed on as it was stored, which its digest is of", () => {
  const value = {
    mode: "ContainerCapability",
    operatingSystem: "Linux",
    architecture: "Amd64",
    capabilities: ["Agent:Claude"],
  };
  const material = {
    tasks: [
      {
        key: "Work",
        executionRequirements: {
          value,
          source: "TicketDefault",
          platformDefaultVersion: 1,
          digest: "digest-of-the-stored-bytes",
        },
      },
    ],
  };
  const read = ticketTaskRequirement(material, "Work");
  assert.equal(read.value.mode, "Capability");
  assert.deepEqual(read.stored, value);
  assert.equal(JSON.stringify(read.stored), JSON.stringify(value));
  assert.equal(read.digest, "digest-of-the-stored-bytes");
});
