/**
 * The configuration a repository declaring none starts on: that it is a
 * configuration at all, that a release would take it, and that the file it is
 * seeded as is one an import reads back.
 *
 * THE GENERATOR IS CHECKED THROUGH THE DOORS THAT WOULD TAKE IT rather than
 * against a remembered document. What matters about it is that the authoring
 * door accepts the bytes and that release does not refuse them; a suite
 * asserting the text would pass while the shape release wants moved under it.
 *
 * IT COMMANDS NO CHECK ON PURPOSE, so the case that a ticket carrying check
 * lines is unreleasable against it is asserted here rather than left to be
 * discovered on a repository nobody has configured yet.
 *
 * WHAT ITS BRIEF SAYS IS READ WHERE A ROLE READS IT, in the briefing a worker
 * and a reviewer are each handed for a request that ends in a limit, and by the
 * terms a reading turns on and not by whole sentences. A suite cannot settle
 * how either role reads a sentence, only that each is handed it.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  configurationDocumentJsonSchema,
  configurationImageGlibcVersionMin,
} from "../../src/contract/configurationDocument.ts";
import { nativeHttpRoutes } from "../../src/contract/http.ts";
import { workerRuntimeDirectory } from "../../src/contract/workerEnvironment.ts";
import {
  asCanonicalConfiguration,
  releaseConfigurationReadiness,
  type DeclaredConfiguration,
} from "../../src/interpreter/authoring.ts";
import {
  bootstrapConfiguration,
  bootstrapConfigurationFile,
  bootstrapConfigurationName,
  bootstrapConfigurationPath,
  bootstrapImageCharsMax,
  bootstrapImageFault,
  bootstrapPublicOriginCharsMax,
  bootstrapPublicOriginFault,
} from "../../src/interpreter/bootstrapConfiguration.ts";
import type { BriefingSectionId } from "../../src/interpreter/briefingTemplate.ts";
import { repositoryDeclarationRoot } from "../../src/interpreter/repositoryDeclaration.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  finalizerIdentityCharsMax,
  gitRefNameCharsMax,
  gitRefNamePrefix,
} from "../../src/interpreter/finalizer.ts";
import {
  repositoryConfigurationImportReadiness,
  repositoryConfigurationRoot,
  type RepositoryConfigurationReferenced,
} from "../../src/interpreter/repositoryConfiguration.ts";
import {
  blessedPracticeCatalog,
  composeTaskInvocation,
} from "../../src/interpreter/taskBriefing.ts";
import {
  asBriefCheckLine,
  asDraftBrief,
} from "../../src/interpreter/ticketBrief.ts";
import type {
  AgentWorkload,
  WorkloadConfiguration,
} from "../../src/interpreter/workloadConfiguration.ts";
import { pinnedWorkloadTask } from "../../src/interpreter/workloadTask.ts";

const repository = asRepositoryId("https://github.com/kasofsk/chuggy.git");
const defaultBranch = asGitRefName("refs/heads/main");
const commit = asGitObjectId("a".repeat(40));
const image = "ghcr.io/kasofsk/chuggy-worker@sha256:".concat("b".repeat(64));

test("the generated configuration is canonical and releasable as it stands", () => {
  const canonical = bootstrapConfiguration({
    repository,
    defaultBranch,
    image,
  });
  assert.equal(asCanonicalConfiguration(canonical), canonical);
  const readiness = releaseConfigurationReadiness(canonical);
  assert.equal(readiness.readiness, "Ready");
});

test("it names the repository it configures and the branch it stands at", () => {
  const document: unknown = JSON.parse(
    bootstrapConfiguration({ repository, defaultBranch, image }),
  );
  const encoded = JSON.stringify(document);
  assert.ok(encoded.includes(repository));
  assert.ok(encoded.includes(defaultBranch));
  assert.ok(encoded.includes(image));
  assert.ok(encoded.includes(repositoryConfigurationRoot));
});

test("it is a catalog whose one plan runs one reviewer, with no practices and nothing commanded", () => {
  const catalog = bootstrapCatalog();
  assert.deepEqual(catalog.plans, {
    review: [{ name: "review", evaluators: ["review"] }],
  });
  assert.deepEqual(catalog.defaults, { work: "work", evaluation: "review" });
  assert.deepEqual(Object.keys(catalog.workloads).sort(), ["review", "work"]);
  assert.equal(bootstrapWorkload("review").purpose, "Review");
  for (const name of ["work", "review"]) {
    assert.equal(bootstrapWorkload(name).practices, undefined, name);
    assert.equal(bootstrapWorkload(name).framing, "Chuggy", name);
  }
});

test("its workloads run as one Claude agent, with no arguments, no setup and no files", () => {
  for (const name of ["work", "review"])
    assert.deepEqual(bootstrapWorkload(name).worker, {
      mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
      setup: [],
      files: [],
    });
});

test("neither the configuration nor the one it tells its worker to declare lists allowed tools, which restrict nothing where a job's agent bypasses permissions", () => {
  const document = bootstrapConfiguration({ repository, defaultBranch, image });
  assert.doesNotMatch(document, /allowedTools/u);
  for (const line of toldLines()) assert.doesNotMatch(line, /allowedTools/u);
});

test("the seeded file is a declaration an import reads back under its name", () => {
  const readiness = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      {
        path: bootstrapConfigurationPath,
        kind: "File",
        content: bootstrapConfigurationFile({
          repository,
          defaultBranch,
          image,
        }),
      },
    ],
  });
  assert.equal(readiness.readiness, "Ready");
  if (readiness.readiness !== "Ready") return;
  const [declaration] = readiness.declarations;
  assert.equal(declaration?.name, bootstrapConfigurationName);
  assert.equal(
    declaration?.canonical,
    bootstrapConfiguration({ repository, defaultBranch, image }),
  );
});

test("the seeded file lives under the directory an import reads", () => {
  assert.ok(bootstrapConfigurationPath.startsWith(repositoryConfigurationRoot));
});

test("a ticket carrying check lines is not releasable against it", () => {
  const readiness = releaseConfigurationReadiness(
    bootstrapConfiguration({ repository, defaultBranch, image }),
    { checks: [asBriefCheckLine("npm test")] },
  );
  assert.deepEqual(readiness, {
    readiness: "Incomplete",
    fault: "BriefChecksUncommanded",
  });
});

/**
 * The JSON skeletons one line spells out, each a balanced `{…}` span, with its
 * placeholder letters left bare. A `${…}` span is a shell expansion the line
 * names, and no skeleton.
 */
function skeletons(line: string): string[] {
  const found: string[] = [];
  const characters = [...line];
  let depth = 0;
  let start = 0;
  let shell = 0;
  for (const [index, character] of characters.entries()) {
    if (character === "{" && characters[index - 1] === "$") shell++;
    else if (character === "}" && shell > 0) shell--;
    else if (character === "{" && depth++ === 0) start = index;
    else if (character === "}" && --depth === 0)
      found.push(characters.slice(start, index + 1).join(""));
  }
  return found;
}

/** A skeleton with each bare placeholder letter replaced by a JSON value. */
function filled(skeleton: string, values: Record<string, string>): string {
  return skeleton.replace(
    /(?<=[[:,])([A-Z])(?=[\],}])/gu,
    (letter) => values[letter] ?? letter,
  );
}

/** What the shape's command lines are filled with: how many, each how long. */
interface Filling {
  readonly lines: number;
  readonly lineChars: number;
}

/** The catalog a configuration is, failing the case where it is a version 1 document. */
function catalogOf(
  configuration: DeclaredConfiguration,
): WorkloadConfiguration {
  if (configuration.version !== 2) assert.fail("not a catalog");
  return configuration;
}

/** The bootstrap configuration, as a release reads it. */
function bootstrapCatalog(): WorkloadConfiguration {
  const readiness = releaseConfigurationReadiness(
    bootstrapConfiguration({ repository, defaultBranch, image }),
  );
  if (readiness.readiness !== "Ready") assert.fail(readiness.fault);
  return catalogOf(readiness.configuration);
}

/** One agent workload of a catalog, the bootstrap's where none is named. */
function bootstrapWorkload(
  name: string,
  catalog: WorkloadConfiguration = bootstrapCatalog(),
): AgentWorkload {
  const workload = catalog.workloads[name];
  if (workload?.runner !== "Agent") assert.fail(`no agent workload ${name}`);
  return workload;
}

/** The paragraphs of one prompt, each the line it was written as. */
function promptLines(prompt: string): readonly string[] {
  return prompt.split(/\n+/u);
}

/** The lines a catalog's work is prompted with, the bootstrap's where none is named. */
function toldLines(
  catalog: WorkloadConfiguration = bootstrapCatalog(),
): readonly string[] {
  return promptLines(bootstrapWorkload("work", catalog).prompt.text);
}

/** The one number the told lines put where `pattern`'s group is. */
function toldBound(pattern: RegExp): number {
  const found = toldLines().flatMap((line) => {
    const match = pattern.exec(line);
    return match?.[1] === undefined ? [] : [Number(match[1])];
  });
  assert.equal(found.length, 1, String(pattern));
  return found[0] ?? Number.NaN;
}

/** Where the prompts of the file a worker writes are, as an import reads each. */
const declaredPrompts: ReadonlyMap<string, RepositoryConfigurationReferenced> =
  new Map(
    [
      `${repositoryDeclarationRoot}prompts/work.md`,
      `${repositoryDeclarationRoot}prompts/review.md`,
    ].map((path) => [
      path,
      { path, found: "File", content: `The prompt at ${path}.\n` },
    ]),
  );

/** The file a worker writes from the skeletons it is told, filled to `filling`. */
function declaredFile(filling: Filling): string {
  const told = toldLines();
  const [envelope, configuration, work, review, checks, ...more] =
    told.flatMap(skeletons);
  assert.ok(
    envelope !== undefined &&
      configuration !== undefined &&
      work !== undefined &&
      review !== undefined &&
      checks !== undefined,
  );
  assert.deepEqual(more, []);
  assert.ok(told.some((line) => line.includes(image)));
  const lines = Array.from({ length: filling.lines }, () =>
    JSON.stringify("true #".concat("l".repeat(filling.lineChars - 6))),
  ).join(",");
  const [workPrompt, reviewPrompt] = [...declaredPrompts.keys()];
  return filled(envelope, {
    N: JSON.stringify("default"),
    C: filled(configuration, {
      I: JSON.stringify(image),
      W: filled(work, { P: JSON.stringify(workPrompt), L: lines }),
      R: filled(review, { Q: JSON.stringify(reviewPrompt), L: lines }),
      K: filled(checks, { L: lines }),
    }),
  });
}

/** Where that file is written, which is directly in the directory an import reads. */
const declaredPath = `${repositoryConfigurationRoot}default.json`;

/** That file, put to an import as the one declaration its repository makes, beside the prompts it names. */
function declaredTo(filling: Filling) {
  return repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      { path: declaredPath, kind: "File", content: declaredFile(filling) },
    ],
    referenced: declaredPrompts,
  });
}

/** The sentence telling the bound on a line, whole, opening its line. */
const toldLineChars =
  /^Each line L is one line of 1 to (\d+) characters, with no tab or line break in it\.(?: |$)/u;

/** Each list and line filled to the most its worker is told it may hold. */
const atEveryBound: Filling = {
  lines: toldBound(/runs from 1 to (\d+) shell lines/u),
  lineChars: toldBound(toldLineChars),
};

test("a declaration written to the shape its worker is told, at every bound it is told, imports and commands its checks", () => {
  const imported = declaredTo(atEveryBound);
  assert.equal(imported.readiness, "Ready");
  if (imported.readiness !== "Ready") return;
  const [declaration] = imported.declarations;
  assert.ok(declaration !== undefined);
  assert.equal(
    releaseConfigurationReadiness(declaration.canonical, {
      checks: [asBriefCheckLine("npm test")],
    }).readiness,
    "Ready",
  );
  const declared = catalogOf(declaration.configuration);
  for (const name of ["work", "review"]) {
    const { worker } = bootstrapWorkload(name, declared);
    assert.equal(worker.setup.length, atEveryBound.lines);
    assert.deepEqual(
      { ...worker, setup: [] },
      bootstrapWorkload(name).worker,
      "the worker it declares runs as the agent the bootstrap ran as",
    );
  }
  assert.equal(
    bootstrapWorkload("work", declared).prompt.text,
    `The prompt at ${repositoryDeclarationRoot}prompts/work.md.\n`,
    "its prompt is the file it names",
  );
});

test("one past any bound its worker is told is refused for that bound", () => {
  for (const [past, fault] of [
    [{ ...atEveryBound, lines: atEveryBound.lines + 1 }, "ReleaseShapeInvalid"],
    [{ ...atEveryBound, lines: 0 }, "ReleaseShapeInvalid"],
    [
      { ...atEveryBound, lineChars: atEveryBound.lineChars + 1 },
      "ReleaseShapeInvalid",
    ],
  ] as const) {
    const imported = declaredTo(past);
    assert.equal(imported.readiness, "Refused", JSON.stringify(past));
    if (imported.readiness !== "Refused") continue;
    assert.deepEqual(
      imported.faults.map((refusal) => refusal.configurationFault),
      [fault],
      JSON.stringify(past),
    );
  }
});

test("an image as long as the bound composes, and one longer does not", () => {
  const longest = "r/".concat("i".repeat(bootstrapImageCharsMax - 2));
  assert.equal(
    releaseConfigurationReadiness(
      bootstrapConfiguration({ repository, defaultBranch, image: longest }),
    ).readiness,
    "Ready",
  );
  assert.throws(
    () =>
      bootstrapConfiguration({
        repository,
        defaultBranch,
        image: longest.concat("i"),
      }),
    RangeError,
  );
});

test("an image a briefing line cannot carry is a fault before it is a configuration", () => {
  assert.equal(bootstrapImageFault(image), undefined);
  assert.equal(
    bootstrapImageFault("r/".concat("i".repeat(bootstrapImageCharsMax - 1))),
    "TextTooLong",
  );
  assert.equal(bootstrapImageFault(image.concat("\n")), "TextUnreadable");
  assert.throws(
    () =>
      bootstrapConfiguration({
        repository,
        defaultBranch,
        image: image.concat("\n"),
      }),
    RangeError,
  );
});

test("an image a briefing line carries that is no image reference is a fault too", () => {
  for (const malformed of [
    "Worker:v1",
    "worker:",
    "registry.invalid//worker",
    `worker@sha256:${"b".repeat(63)}`,
  ])
    assert.equal(
      bootstrapImageFault(malformed),
      "ImageReferenceInvalid",
      malformed,
    );
});

test("a repository and a branch as long as each is branded compose beside the longest image", () => {
  const longest = bootstrapConfiguration({
    repository: asRepositoryId("r".repeat(finalizerIdentityCharsMax)),
    defaultBranch: asGitRefName(
      gitRefNamePrefix.concat(
        "b".repeat(gitRefNameCharsMax - gitRefNamePrefix.length),
      ),
    ),
    image: "r/".concat("i".repeat(bootstrapImageCharsMax - 2)),
  });
  assert.equal(releaseConfigurationReadiness(longest).readiness, "Ready");
});

/** A request that ends in a limit on what may change, as an ordinary first ticket's does. */
const limitedRequest = asDraftBrief({
  intent:
    "Say in README.md that this repository is a rehearsal. Change nothing else.",
  links: [],
  repository,
});

/**
 * The lines one role is handed under the bootstrap for that request, in one
 * section of its briefing, its prompt a line to each paragraph.
 */
function briefed(
  purpose: "Work" | "Review",
  section: BriefingSectionId,
  publicOrigin?: string,
): readonly string[] {
  const pin = {
    configurationRevision: bootstrapConfigurationName,
    configurationDigest: "sha256:bootstrap",
  };
  const document: unknown = JSON.parse(
    bootstrapConfiguration({
      repository,
      defaultBranch,
      image,
      ...(publicOrigin === undefined ? {} : { publicOrigin }),
    }),
  );
  const configuration = pinnedWorkloadTask(
    document,
    pin,
    undefined,
    purpose === "Work"
      ? { taskKind: "Work" }
      : { taskKind: "Evaluation", stage: 0, evaluator: 1 },
  );
  assert.ok(configuration !== undefined);
  const outcome = composeTaskInvocation(blessedPracticeCatalog, {
    purpose,
    ...(purpose === "Review" ? { stage: 0 } : {}),
    pin,
    configuration,
    runtime: { changedFiles: [], handoff: [] },
    readOnlyRepositories: [],
    dependencyDeliveries: [],
    priorWorkReports: { reports: [] },
    priorEvaluationReports: { reports: [] },
    brief: limitedRequest,
    grant: {
      tools: [],
      credentials: [],
      network: false,
      filesystem: "WriteWorkspace",
      mayCompleteTask: false,
    },
  });
  if (outcome.composed !== "Composed") assert.fail(outcome.fault);
  const rendered = outcome.invocation.briefing.sections.find(
    (held) => held.section === section,
  );
  return (rendered?.lines ?? []).flatMap(promptLines);
}

/** The brief the bootstrap's workloads share, failing the case where they differ. */
function bootstrapBrief() {
  const { brief } = bootstrapWorkload("work");
  assert.ok(brief !== undefined);
  assert.deepEqual(bootstrapWorkload("review").brief, brief);
  return brief;
}

/** How the brief names what a ticket's author wrote, apart from what the brief itself asks. */
const request = "what this ticket asks for";

/** How the brief names the tickets after this one, which is how it speaks of what follows a landing. */
const laterTickets = "later tickets";

/** A line that speaks of them, or of what a ticket runs on, neither of which a change can show. */
const beyondTheChange = /later tickets|\bruns? on\b/u;

test("every acceptance criterion is settled by reading the change, and what follows a landing is motivation and no criterion", () => {
  const { motivation, acceptanceCriteria, constraints } = bootstrapBrief();
  for (const criterion of acceptanceCriteria)
    assert.match(criterion, /\bchange\b/u);
  for (const line of [...acceptanceCriteria, ...constraints])
    assert.doesNotMatch(line, beyondTheChange);
  assert.ok(motivation.some((line) => line.includes(laterTickets)));
  assert.ok(
    briefed("Review", "Prompt").some(
      (line) => line.includes(laterTickets) && line.includes("no criterion"),
    ),
    "the reviewer is told it is none",
  );
});

test("what the ticket asks for is a criterion of its own, and the worker is told to make it and the configuration in one change", () => {
  assert.ok(
    bootstrapBrief().acceptanceCriteria.some((line) => line.includes(request)),
  );
  assert.ok(
    toldLines().some(
      (line) =>
        line.includes(request) && line.includes(repositoryConfigurationRoot),
    ),
  );
});

/**
 * Which lockfile the limit does not reach. A setup line that installs from a
 * lockfile and writes none, as `npm ci` does, leaves a worker to make the file
 * by another command, and that file is the one its setup needs.
 */
const neededOrWritten = "needs or writes";

test("each role is told that a limit the request puts on what may change does not reach what the configuration asks for", () => {
  assert.ok(
    toldLines().some((line) => line.includes("lockfile")),
    "the worker is asked for a file outside the configuration directory",
  );
  for (const purpose of ["Work", "Review"] as const) {
    const held = briefed(purpose, "AcceptanceAndConstraints");
    assert.ok(
      held.some(
        (line) =>
          /\blimit\b/u.test(line) &&
          line.includes(request) &&
          line.includes(repositoryConfigurationRoot) &&
          line.includes("does not reach"),
      ),
      purpose,
    );
    assert.ok(
      held.some(
        (line) => line.includes("lockfile") && line.includes(neededOrWritten),
      ),
      purpose,
    );
  }
  assert.ok(
    briefed("Work", "Prompt").some(
      (line) =>
        /\blimit\b/u.test(line) && line.includes(repositoryConfigurationRoot),
    ),
  );
  const focus = briefed("Review", "Prompt");
  const unfailed = focus.filter((line) => /\bdo not fail\b/iu.test(line));
  assert.ok(
    unfailed.some((line) => line.includes(repositoryConfigurationRoot)),
    "a reviewer does not fail the change for the configuration",
  );
  assert.ok(
    unfailed.some(
      (line) =>
        line.includes("more than the request allowed") &&
        line.includes("lockfile") &&
        line.includes(neededOrWritten),
    ),
    "nor for being wider than the request's limit",
  );
});

/** The told line naming where every key chuggy reads is published. */
function schemaLine(told: readonly string[]): string {
  const found = told.filter((line) => line.startsWith("The JSON Schema at "));
  assert.equal(found.length, 1);
  return found[0] ?? "";
}

/** A deployment's public origin, with a port, so that a line naming only its host is visible. */
const publicOrigin = "https://chuggy.example:8443";

test("where the deployment names its public origin, the worker is told the schema's whole URL", () => {
  const line = schemaLine(briefed("Work", "Prompt", publicOrigin));
  assert.ok(
    line.startsWith(
      `The JSON Schema at ${publicOrigin}${nativeHttpRoutes.configurationSchema} names every key chuggy reads`,
    ),
    line,
  );
  assert.doesNotMatch(line, /\bGET\b/u);
});

test("where it names none, the worker is told the schema's route on the chuggy API, and nothing else in the line moves", () => {
  const unnamed = schemaLine(briefed("Work", "Prompt"));
  const where = `GET ${nativeHttpRoutes.configurationSchema} on the chuggy API`;
  assert.ok(
    unnamed.startsWith(`The JSON Schema at ${where} names every key`),
    unnamed,
  );
  assert.equal(
    unnamed.replace(where, "W"),
    schemaLine(briefed("Work", "Prompt", publicOrigin)).replace(
      `${publicOrigin}${nativeHttpRoutes.configurationSchema}`,
      "W",
    ),
  );
});

/** An https origin of exactly `chars` code points. */
function originOf(chars: number): string {
  return `https://${"o".repeat(chars - "https://.test".length)}.test`;
}

test("an origin as long as the bound composes, and one longer does not", () => {
  const longest = originOf(bootstrapPublicOriginCharsMax);
  assert.equal([...longest].length, bootstrapPublicOriginCharsMax);
  assert.equal(bootstrapPublicOriginFault(longest), undefined);
  const composed = bootstrapConfiguration({
    repository: asRepositoryId("r".repeat(finalizerIdentityCharsMax)),
    defaultBranch,
    image: "r/".concat("i".repeat(bootstrapImageCharsMax - 2)),
    publicOrigin: longest,
  });
  assert.equal(releaseConfigurationReadiness(composed).readiness, "Ready");
  assert.ok(composed.includes(longest));
  const longer = originOf(bootstrapPublicOriginCharsMax + 1);
  assert.equal(bootstrapPublicOriginFault(longer), "TextTooLong");
  assert.throws(
    () =>
      bootstrapConfiguration({
        repository,
        defaultBranch,
        image,
        publicOrigin: longer,
      }),
    RangeError,
  );
});

test("an origin is one only as a URL writes it, with nothing after it", () => {
  for (const named of [
    "https://chuggy.example",
    "https://chuggy.example:8443",
    "http://127.0.0.1:3000",
  ])
    assert.equal(bootstrapPublicOriginFault(named), undefined, named);
  for (const malformed of [
    "chuggy.example",
    "https://chuggy.example/",
    "https://chuggy.example/api",
    "https://chuggy.example?x",
    "https://chuggy.example#x",
    "https://op@chuggy.example",
    "https://chuggy.example:443",
    "HTTPS://Chuggy.example",
    "ftp://chuggy.example",
    "",
  ])
    assert.equal(
      bootstrapPublicOriginFault(malformed),
      "OriginInvalid",
      malformed,
    );
});

test("the worker is told that evaluations run in order and stop at a failure", () => {
  const told = briefed("Work", "Prompt");
  assert.ok(
    told.some(
      (line) =>
        line.includes("in the order listed") &&
        line.includes("a failed stage ends evaluation") &&
        line.includes("checks stage goes before the review"),
    ),
  );
});

test("the worker is told any image may stand for the one named, what chuggy's runtime needs of it, and whose a service is", () => {
  const told = briefed("Work", "Prompt");
  assert.ok(
    told.some(
      (line) =>
        line.includes("I may instead be any image the repository builds") &&
        line.includes("one it already builds for its CI") &&
        line.includes(`read-only at ${workerRuntimeDirectory}`) &&
        line.includes("ENTRYPOINT and CMD") &&
        line.includes("/bin/sh, git on PATH") &&
        line.includes(
          `glibc ${configurationImageGlibcVersionMin} or later with libstdc++`,
        ) &&
        line.includes("not Alpine or musl") &&
        line.includes("temporary directory uid 1000 can write") &&
        line.includes("stops with a reason naming it"),
    ),
  );
  assert.ok(
    told.some(
      (line) =>
        line.includes("such as a database, is the image's own") &&
        line.includes("the runner owner's") &&
        line.includes("never chuggy's"),
    ),
  );
});

/** The one expansion of the change base that a line under `sh -eu` survives when it is unset. */
const guardedChangeBase = "$" + "{CHUG_CHANGE_BASE-}";

test("the worker is told its shell lines carry the commit the change started from, and how to read it unset under sh -eu", () => {
  const told = briefed("Work", "Prompt");
  assert.ok(
    told.some(
      (line) =>
        line.includes("Each L runs under sh -eu with CHUG_CHANGE_BASE") &&
        line.includes(
          `${guardedChangeBase} and runs everything where that is empty`,
        ),
    ),
  );
  const published = JSON.stringify(configurationDocumentJsonSchema());
  assert.ok(published.includes("/bin/sh -eu"));
  assert.ok(published.includes(`reads it as ${guardedChangeBase}`));
});

/** A published schema's object, as far as these fields are read from it. */
interface PublishedObject {
  readonly properties?: Readonly<
    Record<string, PublishedObject & { readonly const?: unknown }>
  >;
  readonly additionalProperties?: PublishedObject;
  readonly anyOf?: readonly PublishedObject[];
  readonly oneOf?: readonly PublishedObject[];
}

/**
 * The fields the published schema names in a catalog, which is the version the
 * bootstrap is and tells its worker to write, and in each workload it holds.
 */
function publishedConfigurationFields(): readonly string[] {
  const published = configurationDocumentJsonSchema() as PublishedObject;
  const variant = published.properties?.["configuration"]?.oneOf?.find(
    (each) => each.properties?.["version"]?.const === 2,
  );
  const workloads = (
    variant?.properties?.["workloads"]?.additionalProperties?.anyOf ?? []
  ).flatMap((each) => each.oneOf ?? []);
  assert.equal(workloads.length, 2);
  return [variant, ...workloads].flatMap((each) =>
    Object.keys(each?.properties ?? {}),
  );
}

test("the worker is told of every field the published schema names in a configuration, and what becomes of one it does not", () => {
  const told = toldLines().join("\n");
  const fields = publishedConfigurationFields();
  assert.ok(fields.includes("outputs") && fields.includes("framing"));
  for (const field of fields) assert.ok(told.includes(field), field);
  assert.ok(
    toldLines().some(
      (line) =>
        line.includes("does not name") && line.includes("kept and ignored"),
    ),
  );
});

/** The names an import reads out of one tree of declaration files, beside the prompts they name. */
function declaredNames(
  files: Parameters<typeof repositoryConfigurationImportReadiness>[0]["files"],
): readonly string[] {
  const imported = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files,
    referenced: declaredPrompts,
  });
  if (imported.readiness !== "Ready")
    assert.fail(JSON.stringify(imported.faults));
  return imported.declarations.map((declaration) => declaration.name);
}

test("no file may be left declaring the bootstrap's own name, which a seeded repository that kept its file would still declare, so the change is told to delete it", () => {
  assert.ok(
    bootstrapBrief().acceptanceCriteria.some(
      (line) =>
        line.includes(`"${bootstrapConfigurationName}"`) &&
        line.includes(bootstrapConfigurationPath) &&
        line.includes("the change deletes that file"),
    ),
  );
  const seeded = {
    path: bootstrapConfigurationPath,
    kind: "File" as const,
    content: bootstrapConfigurationFile({ repository, defaultBranch, image }),
  };
  const own = {
    path: declaredPath,
    kind: "File" as const,
    content: declaredFile(atEveryBound),
  };
  assert.deepEqual(declaredNames([seeded, own]), [
    bootstrapConfigurationName,
    "default",
  ]);
  assert.deepEqual(declaredNames([own]), ["default"]);
});

/** A configuration asking its ticket for the repository's configuration, in a criterion's words or a work line's. */
const writesConfiguration = /\bwrite the repository's\b.*\bconfiguration\b/u;

test("the seeded document left under another name is one an import takes, so a criterion rules it out by what it asks of a ticket", () => {
  assert.ok(
    bootstrapBrief().acceptanceCriteria.some(
      (line) =>
        line.includes("under another name") && writesConfiguration.test(line),
    ),
  );
  const seeded: unknown = JSON.parse(
    bootstrapConfigurationFile({ repository, defaultBranch, image }),
  );
  assert.ok(typeof seeded === "object" && seeded !== null);
  const imported = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      {
        path: declaredPath,
        kind: "File",
        content: JSON.stringify({ ...seeded, name: "default" }),
      },
    ],
  });
  if (imported.readiness !== "Ready")
    assert.fail(JSON.stringify(imported.faults));
  assert.deepEqual(
    imported.declarations.map((declaration) => declaration.name),
    ["default"],
    "an import takes it as the repository's own",
  );
  assert.ok(
    imported.declarations.every((declaration) =>
      toldLines(catalogOf(declaration.configuration)).some((line) =>
        writesConfiguration.test(line),
      ),
    ),
    "and it asks its ticket what the criterion says no file left may",
  );
});

/** The faults an import refuses a tree for whose one file is `content` at `path`. */
function refusalOf(path: string, content: string): readonly string[] {
  const imported = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [{ path, kind: "File", content }],
  });
  return imported.readiness === "Refused"
    ? imported.faults.map((held) => held.fault)
    : [];
}

test("the criterion on a declaration's file names where an import looks for one and the keys it takes one by", () => {
  const envelope: unknown = JSON.parse(
    bootstrapConfigurationFile({ repository, defaultBranch, image }),
  );
  assert.ok(typeof envelope === "object" && envelope !== null);
  const keys = Object.keys(envelope).map((key) => `"${key}"`);
  const listed = `exactly the keys ${keys.slice(0, -1).join(", ")} and ${keys.at(-1) ?? ""}`;
  assert.ok(
    bootstrapBrief().acceptanceCriteria.some(
      (line) =>
        line.includes(repositoryConfigurationRoot) &&
        line.includes(".json") &&
        line.includes("directly") &&
        line.includes(listed),
    ),
  );
  assert.deepEqual(
    refusalOf(
      `${repositoryConfigurationRoot}nested/default.json`,
      declaredFile(atEveryBound),
    ),
    ["PathInvalid"],
    "a declaration below the directory refuses the tree it is in",
  );
});

test("the criterion on a declaration's file says the version an import takes, and an import refuses a file of another", () => {
  assert.ok(
    bootstrapBrief().acceptanceCriteria.some(
      (line) =>
        line.includes(".json") && line.includes('"version" is the number 1'),
    ),
  );
  const own: unknown = JSON.parse(declaredFile(atEveryBound));
  assert.ok(typeof own === "object" && own !== null);
  assert.deepEqual(
    refusalOf(declaredPath, JSON.stringify({ ...own, version: 2 })),
    ["EnvelopeInvalid"],
  );
});
