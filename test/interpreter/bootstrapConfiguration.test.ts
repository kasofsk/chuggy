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
} from "../../src/interpreter/authoring.ts";
import {
  bootstrapConfiguration,
  bootstrapConfigurationFile,
  bootstrapConfigurationName,
  bootstrapConfigurationPath,
  bootstrapImageCharsMax,
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

test("a declaration written to the shape its worker is told imports, and commands its checks", () => {
  const canonical = bootstrapConfiguration({
    repository,
    defaultBranch,
    image,
  });
  const readiness = releaseConfigurationReadiness(canonical);
  assert.equal(readiness.readiness, "Ready");
  if (readiness.readiness !== "Ready") return;
  const work = readiness.configuration.work;
  const told = ("instructions" in work ? work.instructions : undefined) ?? [];
  const [envelope, configuration, ...stages] = told.flatMap(skeletons);
  assert.ok(envelope !== undefined && configuration !== undefined);
  assert.equal(stages.length, 2);
  assert.ok(told.some((line) => line.includes(image)));
  const sentences = JSON.stringify(["One sentence."]);
  const stage = (skeleton: string | undefined): string =>
    filled(skeleton ?? "", { S: sentences, L: JSON.stringify("true") });
  const file = filled(envelope, {
    N: JSON.stringify("default"),
    C: filled(configuration, {
      I: JSON.stringify(image),
      S: sentences,
      E: stages.map(stage).join(","),
    }),
  });
  const imported = repositoryConfigurationImportReadiness({
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
