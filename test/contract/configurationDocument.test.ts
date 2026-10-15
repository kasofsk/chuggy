/**
 * The JSON Schema a configuration file is published as takes every file an
 * import takes, and refuses every file whose shape an import refuses.
 *
 * EACH VERDICT IS ASKED OF THE IMPORT, never restated here: a case is one file
 * put both to the importer and to the published schema, and the two answers are
 * compared. The files are this tree's own declarations, the file a bootstrap
 * seeds, a file of each shape the format admits, and seeded mutations of them.
 *
 * A RULE THE SCHEMA CANNOT STATE IS THE ONE DISAGREEMENT ALLOWED: the schema
 * takes a file the import refuses, and only for a fault naming such a rule.
 * Each of those faults has a case of its own here, and where one also names a
 * shape the schema does state, that shape has a case among the refusals.
 *
 * THE VALIDATOR IS STRICT, so a keyword the schema carries that it does not
 * know fails the compile rather than constraining nothing.
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { Ajv2020 } from "ajv/dist/2020.js";

import { configurationDocumentJsonSchema } from "../../src/contract/configurationDocument.ts";
import { canonicalConfigurationOf } from "../../src/interpreter/authoring.ts";
import { bootstrapConfigurationFile } from "../../src/interpreter/bootstrapConfiguration.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { configuredOutputs } from "../../src/interpreter/operationsView.ts";
import {
  repositoryConfigurationImportReadiness,
  repositoryConfigurationRoot,
} from "../../src/interpreter/repositoryConfiguration.ts";
import { pickFrom, randomOf, type Random } from "../random/random.ts";

const schemaTakes = new Ajv2020({ strict: true, allErrors: true }).compile(
  configurationDocumentJsonSchema(),
);

const repository = asRepositoryId("https://github.com/kasofsk/chuggy.git");
const commit = asGitObjectId("a".repeat(40));

/** What an import answers for one file: Ready, or its fault and the configuration's. */
function imported(content: string): string {
  const readiness = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      {
        path: `${repositoryConfigurationRoot}declared.json`,
        kind: "File",
        content,
      },
    ],
  });
  if (readiness.readiness === "Ready") return "Ready";
  const [refusal] = readiness.faults;
  return [refusal?.fault, refusal?.configurationFault]
    .filter((part) => part !== undefined)
    .join(":");
}

/** Whether the published schema takes one file, its errors read from `schemaTakes` after. */
function published(content: string): boolean {
  return schemaTakes(JSON.parse(content));
}

/** The import's answers for a rule the schema says it cannot state. */
const heldFaults = [
  "ConfigurationInvalid",
  "ConfigurationInvalid:EmptyBrief",
  "ConfigurationInvalid:DuplicatePractice",
  "ConfigurationInvalid:WorkerInvalid",
  "ConfigurationInvalid:WorkerUndeclared",
  "ConfigurationInvalid:ReleaseShapeInvalid",
];

/** Asserts the schema takes a file the import takes, and refuses one the import refuses but for a held fault. */
function assertAnsweredAlike(document: unknown, context: string): void {
  const content = JSON.stringify(document);
  const verdict = imported(content);
  const taken = published(content);
  if (verdict === "Ready")
    assert.ok(
      taken,
      `${context}: the schema refuses a file the import takes: ${JSON.stringify(schemaTakes.errors)} in ${content}`,
    );
  else if (taken)
    assert.ok(
      heldFaults.includes(verdict),
      `${context}: the schema takes a file the import refuses as ${verdict}: ${content}`,
    );
}

const brief = {
  motivation: ["The repository declares its configuration."],
  acceptanceCriteria: ["The declaration is imported."],
  constraints: [],
};
const claude = { type: "SingleAgent", agent: "Claude", arguments: [] };
const codex = {
  type: "SingleAgent",
  agent: "Codex",
  arguments: ["--sandbox"],
  model: "gpt-5",
};
const capabilityRequirement = {
  mode: "ContainerCapability",
  operatingSystem: "Linux",
  architecture: "Amd64",
  capabilities: ["Agent:Codex"],
};
const containerRequirement = {
  mode: "Container",
  operatingSystem: "Linux",
  architecture: "Amd64",
  image: "worker:v1",
};

/** The least configuration an import takes, which each case below changes one part of. */
const configuration = {
  version: 1,
  image: "worker:v1",
  brief,
  practices: [],
  work: { instructions: ["Make the change."] },
  review: { instructions: [] },
  worker: { mode: claude, setup: [], files: [] },
};

/** One file declaring a configuration under a name. */
function declared(declaredConfiguration: unknown, name = "declared"): unknown {
  return { version: 1, name, configuration: declaredConfiguration };
}

/** A configuration of each shape the format admits beyond the least one. */
const shapes: readonly unknown[] = [
  configuration,
  {
    ...configuration,
    practices: ["RegressionCoverage", "AcceptanceCriteria"],
    work: { commands: ["./build.sh"] },
    review: { instructions: ["Review it."], authority: { network: false } },
    evaluations: [
      { purpose: "Check", checks: ["npm test", "npm run lint"] },
      { purpose: "Check", practices: [], instructions: ["Run the suite."] },
      {
        purpose: "Review",
        practices: ["ChangedCallPaths"],
        instructions: ["Review it."],
        authority: { filesystem: "ReadWorkspace", mayCompleteTask: true },
      },
      { practices: [], instructions: ["Review it again."] },
    ],
    authority: { tools: ["Read"], credentials: ["forge"], network: true },
    worker: {
      mode: codex,
      setup: ["npm ci"],
      files: [{ path: "AGENTS.md", content: "Be brief." }],
    },
    executionRequirements: {
      platformDefault: capabilityRequirement,
      platformDefaultVersion: 2,
      ticketDefault: {
        ...capabilityRequirement,
        capabilities: ["Agent:Codex", "Agent:Claude"],
      },
      taskKindDefaults: {
        Work: capabilityRequirement,
        Evaluation: capabilityRequirement,
        "Evaluation:2": capabilityRequirement,
      },
    },
    outputs: [
      {
        name: "coverage",
        path: "reports/coverage.json",
        mediaType: "application/json",
        renderer: "Json",
        schema: { type: "object" },
      },
      {
        name: "spike",
        path: "outputs/spike.png",
        mediaType: "image/png",
        renderer: "Image",
      },
    ],
    finalizationApprovalRequired: true,
  },
  {
    ...configuration,
    worker: { arguments: ["--model", "opus"], setup: [], files: [] },
    executionRequirements: {
      platformDefault: containerRequirement,
      platformDefaultVersion: 1,
      ticketDefault: { ...containerRequirement, image: "worker:v2" },
    },
  },
  {
    ...configuration,
    work: { commands: ["true"] },
    evaluations: [{ purpose: "Check", checks: ["true"] }],
    worker: undefined,
  },
  {
    ...configuration,
    worker: { mode: claude, arguments: "beside a mode", setup: [], files: [] },
  },
  {
    ...configuration,
    outputs: [{ name: "unreadable", renderer: "Image" }],
    finalizationApprovalRequired: "yes",
    evaluation: [{ purpose: "Check", checks: ["true"] }],
  },
  { ...configuration, outputs: "not a list", finalizationApprovalRequired: 1 },
];

const defaultBranch = asGitRefName("refs/heads/main");

/** This tree's own declaration files, as an import reads them. */
const treeFiles = readdirSync(repositoryConfigurationRoot)
  .filter((name) => name.endsWith(".json"))
  .map((name) => readFileSync(`${repositoryConfigurationRoot}${name}`, "utf8"));

/** The file a bootstrap seeds a repository with. */
const bootstrapFile = bootstrapConfigurationFile({
  repository,
  defaultBranch,
  image: "worker:v1",
});

test("the published schema is one a strict validator compiles", () => {
  assert.equal(typeof schemaTakes, "function");
  assert.equal(schemaTakes.errors ?? null, null);
});

test("every declaration this tree makes, and the file a bootstrap seeds, the import and the schema both take", () => {
  assert.ok(treeFiles.length > 0);
  for (const content of [...treeFiles, bootstrapFile]) {
    assert.equal(imported(content), "Ready", content);
    assert.ok(published(content), JSON.stringify(schemaTakes.errors));
  }
});

test("a file of each shape the format admits the import and the schema both take", () => {
  for (const shape of shapes) {
    const content = JSON.stringify(declared(shape));
    assert.equal(imported(content), "Ready", content);
    assert.ok(published(content), JSON.stringify(schemaTakes.errors));
  }
});

/** A file whose shape the import refuses, and the fault it refuses it for. */
const refusedShapes: readonly (readonly [unknown, string])[] = [
  [{ ...(declared(configuration) as object), extra: true }, "EnvelopeInvalid"],
  [{ version: 2, name: "declared", configuration }, "EnvelopeInvalid"],
  [declared(configuration, "-declared"), "NameInvalid"],
  [declared(configuration, "d".repeat(129)), "NameInvalid"],
  [
    declared({ ...configuration, version: 2 }),
    "ConfigurationInvalid:ReleaseShapeInvalid",
  ],
  [
    declared({ ...configuration, image: "" }),
    "ConfigurationInvalid:ReleaseShapeInvalid",
  ],
  [
    declared({
      ...configuration,
      executionRequirements: {
        platformDefault: containerRequirement,
        platformDefaultVersion: 1,
        taskKindDefaults: { "Evaluation:0": containerRequirement },
      },
    }),
    "ConfigurationInvalid:ReleaseShapeInvalid",
  ],
  [
    declared({
      ...configuration,
      executionRequirements: {
        platformDefault: { ...capabilityRequirement, capabilities: [] },
        platformDefaultVersion: 1,
      },
    }),
    "ConfigurationInvalid:ReleaseShapeInvalid",
  ],
  [
    declared({ ...configuration, brief: { ...brief, constraints: [""] } }),
    "ConfigurationInvalid:EmptyLine",
  ],
  [
    declared({ ...configuration, brief: { ...brief, constraints: ["a\tb"] } }),
    "ConfigurationInvalid:TextUnreadable",
  ],
  [
    declared({
      ...configuration,
      brief: { ...brief, constraints: ["\u{1F600}".repeat(513)] },
    }),
    "ConfigurationInvalid:TextTooLong",
  ],
  [
    declared({
      ...configuration,
      brief: { ...brief, constraints: Array.from({ length: 9 }, () => "c") },
    }),
    "ConfigurationInvalid:TooManyLines",
  ],
  [
    declared({ ...configuration, practices: ["NotAPractice"] }),
    "ConfigurationInvalid:UnknownPractice",
  ],
  [
    declared({
      ...configuration,
      work: { instructions: [], commands: ["true"] },
    }),
    "ConfigurationInvalid:WorkKindAmbiguous",
  ],
  [
    declared({ ...configuration, work: { commands: ["true"], extra: 1 } }),
    "ConfigurationInvalid:WorkFieldUnknown",
  ],
  [
    declared({ ...configuration, evaluations: [] }),
    "ConfigurationInvalid:EvaluationsInvalid",
  ],
  [
    declared({
      ...configuration,
      evaluations: [{ purpose: "Check", checks: [] }],
    }),
    "ConfigurationInvalid:ChecksInvalid",
  ],
  [
    declared({
      ...configuration,
      worker: { mode: { ...claude, model: "opus" }, setup: [], files: [] },
    }),
    "ConfigurationInvalid:WorkerInvalid",
  ],
  [
    declared({
      ...configuration,
      worker: { mode: { ...codex, model: undefined }, setup: [], files: [] },
    }),
    "ConfigurationInvalid:WorkerInvalid",
  ],
  [
    declared({ ...configuration, worker: { mode: claude, setup: [] } }),
    "ConfigurationInvalid:WorkerInvalid",
  ],
  [
    declared({ ...configuration, authority: { network: "yes" } }),
    "ConfigurationInvalid:AuthorityInvalid",
  ],
  [
    declared({ ...configuration, review: undefined }),
    "ConfigurationInvalid:ReviewInvalid",
  ],
];

test("a file whose shape the import refuses the schema refuses", () => {
  for (const [document, fault] of refusedShapes) {
    const content = JSON.stringify(document);
    assert.equal(imported(content), fault, content);
    assert.ok(!published(content), content);
  }
});

/** A file the import refuses for a rule the schema says it cannot state, and the fault it refuses it for. */
const heldRules: readonly (readonly [unknown, string])[] = [
  [
    declared({ ...configuration, review: { instructions: [], token: "t" } }),
    "ConfigurationInvalid",
  ],
  [
    declared({
      ...configuration,
      brief: { ...brief, motivation: [], acceptanceCriteria: [] },
    }),
    "ConfigurationInvalid:EmptyBrief",
  ],
  [
    declared({
      ...configuration,
      practices: ["RegressionCoverage", "RegressionCoverage"],
    }),
    "ConfigurationInvalid:DuplicatePractice",
  ],
  [
    declared({
      ...configuration,
      worker: {
        mode: { ...codex, model: "\u{1F600}".repeat(65) },
        setup: [],
        files: [],
      },
    }),
    "ConfigurationInvalid:WorkerInvalid",
  ],
  [
    declared({
      ...configuration,
      worker: { mode: claude, arguments: [], setup: [], files: [] },
    }),
    "ConfigurationInvalid:WorkerInvalid",
  ],
  [
    declared({ ...configuration, worker: undefined }),
    "ConfigurationInvalid:WorkerUndeclared",
  ],
  [
    declared({
      ...configuration,
      executionRequirements: {
        platformDefault: { ...containerRequirement, image: "worker:v2" },
        platformDefaultVersion: 1,
      },
    }),
    "ConfigurationInvalid:ReleaseShapeInvalid",
  ],
  [
    declared({
      ...configuration,
      executionRequirements: {
        platformDefault: containerRequirement,
        platformDefaultVersion: 1,
        ticketDefault: { ...containerRequirement, operatingSystem: "MacOS" },
      },
    }),
    "ConfigurationInvalid:ReleaseShapeInvalid",
  ],
  [
    declared({
      ...configuration,
      worker: { mode: codex, setup: [], files: [] },
      executionRequirements: {
        platformDefault: {
          ...capabilityRequirement,
          capabilities: ["Agent:Codex", "Agent:Codex"],
        },
        platformDefaultVersion: 1,
      },
    }),
    "ConfigurationInvalid:ReleaseShapeInvalid",
  ],
];

test("a file refused for a rule the schema cannot state the schema takes, and every such rule has one", () => {
  for (const [document, fault] of heldRules) {
    const content = JSON.stringify(document);
    assert.equal(imported(content), fault, content);
    assert.ok(published(content), JSON.stringify(schemaTakes.errors));
  }
  assert.deepEqual(
    [...new Set(heldRules.map(([, fault]) => fault))].sort(),
    [...heldFaults].sort(),
  );
});

/** The leaves a mutation writes, each at or one past a bound or a roster's edge. */
const mutationLeaves: readonly unknown[] = [
  null,
  true,
  0,
  1,
  2,
  1.5,
  -1,
  "",
  "x",
  "a\u0001",
  "a\u009f",
  "a\ud800",
  "\u{1F600}".repeat(512),
  "\u{1F600}".repeat(513),
  "m".repeat(128),
  "m".repeat(129),
  "\u{1F600}".repeat(65),
  "Check",
  "Review",
  "Claude",
  "Codex",
  "RegressionCoverage",
  "NotAPractice",
  "Container",
  "ContainerCapability",
  "Native",
  "MacOS",
  "Arm64",
  "Agent:Claude",
  "ReadWorkspace",
  [],
  ["x"],
  {},
  containerRequirement,
  capabilityRequirement,
  { purpose: "Check", checks: ["true"] },
  { purpose: "Check", practices: [], instructions: ["x"] },
  { commands: ["true"] },
  claude,
  codex,
];

/** The keys a mutation adds, each one the format names somewhere or none does. */
const mutationKeys = [
  "checks",
  "commands",
  "instructions",
  "practices",
  "purpose",
  "authority",
  "mode",
  "arguments",
  "model",
  "network",
  "platformDefault",
  "ticketDefault",
  "taskKindDefaults",
  "Evaluation:1",
  "Evaluation:0",
  "evaluations",
  "worker",
  "capabilities",
  "extra",
  "apiToken",
  "outputs",
  "finalizationApprovalRequired",
  "renderer",
  "mediaType",
];

/** Every object and list in a document, the document included. */
function mutationContainers(root: unknown): (object | unknown[])[] {
  if (typeof root !== "object" || root === null) return [];
  return [root, ...Object.values(root).flatMap(mutationContainers)];
}

/** A copy of a document with one part removed, added, repeated or replaced. */
function mutated(random: Random, root: unknown): unknown {
  const copy: unknown = structuredClone(root);
  const node = pickFrom(random, mutationContainers(copy));
  const leaf = structuredClone(pickFrom(random, mutationLeaves));
  if (Array.isArray(node)) {
    const index = random.below(node.length + 1);
    const operation = random.below(3);
    if (operation === 0) node.splice(index, 1);
    else if (operation === 1 && node.length > 0)
      node.push(...Array.from({ length: 8 }, () => node[0] as unknown));
    else node[index] = leaf;
    return copy;
  }
  const record = node as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length > 0 && random.coin()) {
    const key = pickFrom(random, keys);
    if (random.coin()) Reflect.deleteProperty(record, key);
    else record[key] = leaf;
  } else record[pickFrom(random, mutationKeys)] = leaf;
  return copy;
}

/** How many mutated files one run puts to both, and the seed of their draws. */
const mutationSamples = 2_000;
const mutationSeed = 1;

test("a mutated file the import takes the schema takes, and one it refuses the schema refuses but for a held rule", () => {
  const random = randomOf(mutationSeed);
  const roots: readonly unknown[] = [
    ...[...treeFiles, bootstrapFile].map((content): unknown =>
      JSON.parse(content),
    ),
    ...shapes.map((shape) => declared(shape)),
  ];
  const verdicts = new Set<string>();
  for (let sample = 0; sample < mutationSamples; sample++) {
    let document = pickFrom(random, roots);
    for (let round = 1 + random.below(3); round > 0; round--)
      document = mutated(random, document);
    assertAnsweredAlike(
      document,
      `seed ${String(mutationSeed)} sample ${String(sample)}`,
    );
    verdicts.add(imported(JSON.stringify(document)));
  }
  assert.ok(verdicts.has("Ready"));
  assert.ok(verdicts.size > heldFaults.length);
});

/** The node of the published schema at `keys`, which the suite asserts is there. */
function publishedAt(...keys: readonly (string | number)[]): object {
  let node: unknown = configurationDocumentJsonSchema();
  for (const key of keys) {
    assert.ok(typeof node === "object" && node !== null, keys.join("."));
    node = (node as Record<string | number, unknown>)[key];
  }
  assert.ok(typeof node === "object" && node !== null, keys.join("."));
  return node;
}

/** The node the published schema states a configuration's field in. */
function publishedField(field: string, ...keys: readonly (string | number)[]) {
  return publishedAt(
    "properties",
    "configuration",
    "properties",
    field,
    ...keys,
  );
}

const outputShapeTakes = new Ajv2020({ strict: true, allErrors: true }).compile(
  publishedField("outputs", "anyOf", 0, "items"),
);

/** Whether the reader of a configuration's outputs takes one entry as an output. */
function outputRead(entry: unknown): boolean {
  const read = (outputs: unknown) =>
    configuredOutputs(
      canonicalConfigurationOf({ ...configuration, ...(outputs as object) }),
    ).length;
  return read({ outputs: [entry] }) > read({});
}

const outputEntry = {
  name: "coverage",
  path: "reports/coverage.json",
  mediaType: "application/json",
  renderer: "Json",
};

/** Entries the reader skips and the shape refuses, and entries it skips for a rule the shape cannot state. */
const outputsSkipped: readonly (readonly [unknown, "Refused" | "Held"])[] = [
  [
    { ...outputEntry, renderer: "Image", mediaType: "image/svg+xml" },
    "Refused",
  ],
  [{ ...outputEntry, renderer: "Image", mediaType: "text/plain" }, "Refused"],
  [{ ...outputEntry, renderer: "Html" }, "Refused"],
  [{ ...outputEntry, name: "" }, "Refused"],
  [{ name: "coverage", path: "notes.md", renderer: "Markdown" }, "Refused"],
  [{ ...outputEntry, schema: [] }, "Refused"],
  [{ ...outputEntry, path: "" }, "Refused"],
  [{ ...outputEntry, path: "../coverage.json" }, "Held"],
  [{ ...outputEntry, name: "\u{1F600}".repeat(33) }, "Held"],
];

test("the outputs shape the schema shows is the one their reader takes, and approval is shown as a boolean", () => {
  for (const renderer of ["UnifiedDiff", "Markdown", "Json", "Text"]) {
    const entry = { ...outputEntry, renderer };
    assert.ok(outputRead(entry) && outputShapeTakes(entry), renderer);
  }
  const image = { ...outputEntry, renderer: "Image", mediaType: "image/webp" };
  assert.ok(outputRead(image) && outputShapeTakes(image));
  for (const [entry, skipped] of outputsSkipped) {
    const context = JSON.stringify(entry);
    assert.ok(!outputRead(entry), context);
    assert.equal(outputShapeTakes(entry), skipped === "Held", context);
  }
  assert.deepEqual(publishedField("finalizationApprovalRequired", "anyOf", 0), {
    type: "boolean",
  });
});
