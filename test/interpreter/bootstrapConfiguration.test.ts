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
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  repositoryConfigurationImportReadiness,
  repositoryConfigurationRoot,
} from "../../src/interpreter/repositoryConfiguration.ts";
import { asBriefCheckLine } from "../../src/interpreter/ticketBrief.ts";

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

/** The instruction lines the bootstrap configuration's worker is told. */
function toldLines(): readonly string[] {
  const work = bootstrapReady().work;
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

/** The skeletons the worker is told, filled to `filling` and put to an import. */
function declaredTo(filling: Filling) {
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
  const file = filled(envelope, {
    N: JSON.stringify("default"),
    C: filled(configuration, {
      I: JSON.stringify(image),
      S: sentences,
      L: lines,
      E: stages.map(stage).join(","),
    }),
  });
  return repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      {
        path: `${repositoryConfigurationRoot}default.json`,
        kind: "File",
        content: file,
      },
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
