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
  asCanonicalConfiguration,
  releaseConfigurationReadiness,
  type ReleaseConfiguration,
} from "../../src/interpreter/authoring.ts";
import {
  bootstrapConfiguration,
  bootstrapConfigurationFile,
  bootstrapConfigurationName,
  bootstrapConfigurationPath,
  bootstrapImageCharsMax,
  bootstrapImageFault,
} from "../../src/interpreter/bootstrapConfiguration.ts";
import type { BriefingSectionId } from "../../src/interpreter/briefingTemplate.ts";
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
} from "../../src/interpreter/repositoryConfiguration.ts";
import {
  blessedPracticeCatalog,
  composeTaskInvocation,
  pinnedTaskConfigurationReadiness,
} from "../../src/interpreter/taskBriefing.ts";
import {
  asBriefCheckLine,
  asDraftBrief,
} from "../../src/interpreter/ticketBrief.ts";

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

test("it commands one review evaluation and no practices", () => {
  const readiness = releaseConfigurationReadiness(
    bootstrapConfiguration({ repository, defaultBranch, image }),
  );
  assert.equal(readiness.readiness, "Ready");
  if (readiness.readiness !== "Ready") return;
  assert.deepEqual(readiness.configuration.practices, []);
  const evaluations = readiness.configuration.evaluations ?? [];
  assert.equal(evaluations.length, 1);
  assert.equal(evaluations[0]?.purpose, "Review");
});

test("its briefed stages run as one Claude agent, with no setup and no files", () => {
  assert.deepEqual(bootstrapReady().worker, {
    mode: {
      type: "SingleAgent",
      agent: "Claude",
      arguments: ["--allowedTools=Bash,Edit,Read,Write,Glob,Grep"],
    },
    setup: [],
    files: [],
  });
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
 * placeholder letters left bare.
 */
function skeletons(line: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let start = 0;
  for (const [index, character] of [...line].entries()) {
    if (character === "{" && depth++ === 0) start = index;
    if (character === "}" && --depth === 0)
      found.push([...line].slice(start, index + 1).join(""));
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

/** What the shape's lists are filled with: how many entries, each how long. */
interface Filling {
  readonly sentences: number;
  readonly sentenceChars: number;
  readonly lines: number;
  readonly lineChars: number;
}

/** The bootstrap configuration, as a release reads it. */
function bootstrapReady(): ReleaseConfiguration {
  const readiness = releaseConfigurationReadiness(
    bootstrapConfiguration({ repository, defaultBranch, image }),
  );
  assert.equal(readiness.readiness, "Ready");
  if (readiness.readiness !== "Ready") throw new Error("unreleasable");
  return readiness.configuration;
}

/** The instruction lines a configuration's worker is told, the bootstrap's where none is named. */
function toldLines(
  configuration: ReleaseConfiguration = bootstrapReady(),
): readonly string[] {
  const work = configuration.work;
  return ("instructions" in work ? work.instructions : undefined) ?? [];
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

/** The file a worker writes from the skeletons it is told, filled to `filling`. */
function declaredFile(filling: Filling): string {
  const told = toldLines();
  const [envelope, configuration, ...stages] = told.flatMap(skeletons);
  assert.ok(envelope !== undefined && configuration !== undefined);
  assert.equal(stages.length, 2);
  assert.ok(told.some((line) => line.includes(image)));
  const sentences = JSON.stringify(
    Array.from({ length: filling.sentences }, () =>
      "s".repeat(filling.sentenceChars),
    ),
  );
  const lines = Array.from({ length: filling.lines }, () =>
    JSON.stringify("true #".concat("l".repeat(filling.lineChars - 6))),
  ).join(",");
  const stage = (skeleton: string): string =>
    filled(skeleton, { S: sentences, L: lines });
  return filled(envelope, {
    N: JSON.stringify("default"),
    C: filled(configuration, {
      I: JSON.stringify(image),
      S: sentences,
      L: lines,
      E: stages.map(stage).join(","),
    }),
  });
}

/** Where that file is written, which is directly in the directory an import reads. */
const declaredPath = `${repositoryConfigurationRoot}default.json`;

/** That file, put to an import as the one declaration its repository makes. */
function declaredTo(filling: Filling) {
  return repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      { path: declaredPath, kind: "File", content: declaredFile(filling) },
    ],
  });
}

/** The sentence telling one bound to a sentence and a check line alike, whole. */
const toldLineChars =
  /^Each sentence and each line L is one line of 1 to (\d+) characters, with no tab or line break in it\.$/u;

/** Each list and line filled to the most its worker is told it may hold. */
const atEveryBound: Filling = {
  sentences: toldBound(/each S a list of at most (\d+) sentences/u),
  sentenceChars: toldBound(toldLineChars),
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
  const declared = declaration.configuration.worker;
  assert.equal(declared?.setup.length, atEveryBound.lines);
  assert.deepEqual(
    { ...declared, setup: [] },
    bootstrapReady().worker,
    "the worker it declares runs as the agent the bootstrap ran as",
  );
});

test("one past any bound its worker is told is refused for that bound", () => {
  for (const [past, fault] of [
    [
      { ...atEveryBound, sentences: atEveryBound.sentences + 1 },
      "TooManyLines",
    ],
    [
      { ...atEveryBound, sentenceChars: atEveryBound.sentenceChars + 1 },
      "TextTooLong",
    ],
    [{ ...atEveryBound, sentenceChars: 0 }, "EmptyLine"],
    [{ ...atEveryBound, lines: atEveryBound.lines + 1 }, "ChecksInvalid"],
    [{ ...atEveryBound, lines: 0 }, "ChecksInvalid"],
    [{ ...atEveryBound, lineChars: atEveryBound.lineChars + 1 }, "TextTooLong"],
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

/** The lines one role is handed under the bootstrap for that request, in one section of its briefing. */
function briefed(
  purpose: "Work" | "Review",
  section: BriefingSectionId,
): readonly string[] {
  const pin = {
    configurationRevision: bootstrapConfigurationName,
    configurationDigest: "sha256:bootstrap",
  };
  const document: unknown = JSON.parse(
    bootstrapConfiguration({ repository, defaultBranch, image }),
  );
  const read = pinnedTaskConfigurationReadiness(document, pin);
  if (read.readiness !== "Ready") assert.fail(read.fault);
  const outcome = composeTaskInvocation(blessedPracticeCatalog, {
    purpose,
    ...(purpose === "Review" ? { stage: 0 } : {}),
    pin,
    configuration: read.configuration,
    runtime: { changedFiles: [], handoff: [] },
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
  return rendered?.lines ?? [];
}

/** How the brief names what a ticket's author wrote, apart from what the brief itself asks. */
const request = "what this ticket asks for";

/** How the brief names the tickets after this one, which is how it speaks of what follows a landing. */
const laterTickets = "later tickets";

/** A line that speaks of them, or of what a ticket runs on, neither of which a change can show. */
const beyondTheChange = /later tickets|\bruns? on\b/u;

test("every acceptance criterion is settled by reading the change, and what follows a landing is motivation and no criterion", () => {
  const { motivation, acceptanceCriteria, constraints } =
    bootstrapReady().brief;
  for (const criterion of acceptanceCriteria)
    assert.match(criterion, /\bchange\b/u);
  for (const line of [...acceptanceCriteria, ...constraints])
    assert.doesNotMatch(line, beyondTheChange);
  assert.ok(motivation.some((line) => line.includes(laterTickets)));
  assert.ok(
    briefed("Review", "PurposeInstructions").some(
      (line) => line.includes(laterTickets) && line.includes("no criterion"),
    ),
    "the reviewer is told it is none",
  );
});

test("what the ticket asks for is a criterion of its own, and the worker is told to make it and the configuration in one change", () => {
  assert.ok(
    bootstrapReady().brief.acceptanceCriteria.some((line) =>
      line.includes(request),
    ),
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
    briefed("Work", "PurposeInstructions").some(
      (line) =>
        /\blimit\b/u.test(line) && line.includes(repositoryConfigurationRoot),
    ),
  );
  const focus = briefed("Review", "PurposeInstructions");
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

/** The names an import reads out of one tree of declaration files. */
function declaredNames(
  files: Parameters<typeof repositoryConfigurationImportReadiness>[0]["files"],
): readonly string[] {
  const imported = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files,
  });
  if (imported.readiness !== "Ready")
    assert.fail(JSON.stringify(imported.faults));
  return imported.declarations.map((declaration) => declaration.name);
}

test("no file may be left declaring the bootstrap's own name, which a seeded repository that kept its file would still declare, so the change is told to delete it", () => {
  assert.ok(
    bootstrapReady().brief.acceptanceCriteria.some(
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
    bootstrapReady().brief.acceptanceCriteria.some(
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
      toldLines(declaration.configuration).some((line) =>
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
    bootstrapReady().brief.acceptanceCriteria.some(
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
    bootstrapReady().brief.acceptanceCriteria.some(
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
