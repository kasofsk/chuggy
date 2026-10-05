import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { actionNameCharsMax } from "../../src/contract/actionDocument.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  repositoryActionDeclarationsMax,
  repositoryActionFileCharsMax,
  repositoryActionImportReadiness,
  repositoryActionPathCharsMax,
  repositoryActionRoot,
  type RepositoryActionFault,
  type RepositoryActionImportReadiness,
} from "../../src/interpreter/repositoryAction.ts";
import type { RepositoryConfigurationFile } from "../../src/interpreter/repositoryConfiguration.ts";
import { asBriefTitle } from "../../src/interpreter/ticketBrief.ts";

const repository = asRepositoryId("https://forge.example/acme/engine.git");
const commit = asGitObjectId("a".repeat(40));
const build = { version: 1, action: "build", name: "Build" };
const deploy = {
  version: 1,
  action: "deploy-staging",
  name: "Deploy to staging",
};

/** A directory beside the action directory, of a name as long, so that nothing but the prefix tells a file in it from a declaration. */
const directoryBeside = repositoryActionRoot.replace("actions", "another");

function pathOf(file: string): string {
  return `${repositoryActionRoot}${file}.json`;
}

function actionFile(
  file: string,
  document: unknown,
): RepositoryConfigurationFile {
  return {
    path: pathOf(file),
    kind: "File",
    content: JSON.stringify(document),
  };
}

function read(
  files: readonly RepositoryConfigurationFile[],
): RepositoryActionImportReadiness {
  return repositoryActionImportReadiness({ repository, commit, files });
}

function refusal(
  file: string,
  fault: RepositoryActionFault,
): RepositoryActionImportReadiness {
  return { readiness: "Refused", faults: [{ path: pathOf(file), fault }] };
}

function named(name: string): RepositoryActionImportReadiness {
  return read([actionFile("build", { ...build, name })]);
}

function isTitle(value: string): boolean {
  try {
    asBriefTitle(value);
    return true;
  } catch {
    return false;
  }
}

test("each document is declared for the repository and the commit it was read at", () => {
  assert.deepEqual(
    read([actionFile("build", build), actionFile("deploy", deploy)]),
    {
      readiness: "Ready",
      declarations: [
        {
          repository,
          commit,
          path: pathOf("build"),
          action: "build",
          name: "Build",
        },
        {
          repository,
          commit,
          path: pathOf("deploy"),
          action: "deploy-staging",
          name: "Deploy to staging",
        },
      ],
    },
  );
});

test("a commit that declares nothing is ready with nothing", () => {
  assert.deepEqual(read([]), { readiness: "Ready", declarations: [] });
});

test("a name of nothing but blanks is a refused document", () => {
  for (const name of [" ", "   ", "\u00a0", " \u3000 "])
    assert.deepEqual(
      named(name),
      refusal("build", "DocumentInvalid"),
      JSON.stringify(name),
    );
});

test("a name of more than one line is a refused document", () => {
  for (const name of ["Build\nall of it", "Build\r\nall of it", "Build\n"])
    assert.deepEqual(
      named(name),
      refusal("build", "DocumentInvalid"),
      JSON.stringify(name),
    );
});

test("a name carrying a control character is a refused document", () => {
  for (const name of [
    "Build\tall",
    "Build\u001ball",
    "Build\u007f",
    "\u0085Build",
  ])
    assert.deepEqual(
      named(name),
      refusal("build", "DocumentInvalid"),
      JSON.stringify(name),
    );
});

test("the longest name is read whole", () => {
  const name = "n".repeat(actionNameCharsMax);
  assert.deepEqual(named(name), {
    readiness: "Ready",
    declarations: [
      { repository, commit, path: pathOf("build"), action: "build", name },
    ],
  });
});

test("a name is one printable line exactly where a ticket's title is one", () => {
  for (const name of [
    "Build",
    " Build ",
    "Build \u{1f680}",
    "Build\u00a0all",
    "Build\u2028all",
    "   ",
    "Build\nall",
    "Build\tall",
    "Build\u009f",
  ])
    assert.equal(
      named(name).readiness === "Ready",
      isTitle(name),
      JSON.stringify(name),
    );
});

test("one refused document refuses the commit, and nothing of it is declared", () => {
  assert.deepEqual(
    read([
      actionFile("build", build),
      actionFile("deploy", { ...deploy, command: "./deploy.sh" }),
    ]),
    refusal("deploy", "DocumentInvalid"),
  );
});

test("every refused document is named, in the order it was read", () => {
  const found = read([
    { ...actionFile("link", build), kind: "Symlink" },
    actionFile("build", build),
    { ...actionFile("broken", build), content: "{" },
    actionFile("deploy", { ...deploy, name: "" }),
  ]);
  assert.deepEqual(found, {
    readiness: "Refused",
    faults: [
      { path: pathOf("link"), fault: "SymlinkRefused" },
      { path: pathOf("broken"), fault: "DocumentUnreadable" },
      { path: pathOf("deploy"), fault: "DocumentInvalid" },
    ],
  });
});

test("only a JSON file directly in the action directory is a declaration", () => {
  for (const path of [
    `${repositoryActionRoot}nested/build.json`,
    `${directoryBeside}build.json`,
    `${repositoryActionRoot}build.yaml`,
    `${repositoryActionRoot}.json`,
    `${repositoryActionRoot}build\\.json`,
    `${repositoryActionRoot}build\0.json`,
    `${repositoryActionRoot}\uD800.json`,
  ])
    assert.deepEqual(
      read([{ ...actionFile("build", build), path }]),
      { readiness: "Refused", faults: [{ path, fault: "PathInvalid" }] },
      JSON.stringify(path),
    );
});

test("the longest path is read and one character more is refused", () => {
  const fileOf = (chars: number) => "a".repeat(chars - pathOf("").length);
  assert.equal(
    read([actionFile(fileOf(repositoryActionPathCharsMax), build)]).readiness,
    "Ready",
  );
  assert.deepEqual(
    read([actionFile(fileOf(repositoryActionPathCharsMax + 1), build)]),
    refusal(fileOf(repositoryActionPathCharsMax + 1), "PathInvalid"),
  );
});

test("a symlink is refused, whatever its content", () => {
  for (const content of [JSON.stringify(build), "{"])
    assert.deepEqual(
      read([{ path: pathOf("build"), kind: "Symlink", content }]),
      refusal("build", "SymlinkRefused"),
      content,
    );
});

test("the largest document is read and one character more is refused", () => {
  const padded = (chars: number) => JSON.stringify(build).padEnd(chars, " ");
  assert.equal(
    read([
      {
        ...actionFile("build", build),
        content: padded(repositoryActionFileCharsMax),
      },
    ]).readiness,
    "Ready",
  );
  assert.deepEqual(
    read([
      {
        ...actionFile("build", build),
        content: padded(repositoryActionFileCharsMax + 1),
      },
    ]),
    refusal("build", "ContentTooLarge"),
  );
});

test("a file that is not JSON is refused as unreadable", () => {
  assert.deepEqual(
    read([{ ...actionFile("build", build), content: "{" }]),
    refusal("build", "DocumentUnreadable"),
  );
});

test("JSON that is not an action document is refused as invalid", () => {
  for (const document of [[build], null, "build", { ...build, version: 2 }])
    assert.deepEqual(
      read([actionFile("build", document)]),
      refusal("build", "DocumentInvalid"),
      JSON.stringify(document),
    );
});

test("two documents of one identity are refused at the second", () => {
  assert.deepEqual(
    read([
      actionFile("build", build),
      actionFile("build-again", { ...build, name: "Build again" }),
    ]),
    refusal("build-again", "DuplicateAction"),
  );
});

test("one path read twice is refused", () => {
  assert.deepEqual(
    read([actionFile("build", build), actionFile("build", deploy)]),
    refusal("build", "DuplicatePath"),
  );
});

test("a commit declares as many actions as the bound and no more", () => {
  const filesOf = (count: number) =>
    Array.from({ length: count }, (_, index) =>
      actionFile(`action-${String(index)}`, {
        ...build,
        action: `action-${String(index)}`,
      }),
    );
  const atBound = read(filesOf(repositoryActionDeclarationsMax));
  assert.equal(atBound.readiness, "Ready");
  if (atBound.readiness !== "Ready") return;
  assert.equal(atBound.declarations.length, repositoryActionDeclarationsMax);
  assert.deepEqual(read(filesOf(repositoryActionDeclarationsMax + 1)), {
    readiness: "Refused",
    faults: [{ path: repositoryActionRoot, fault: "TooManyDeclarations" }],
  });
});

test("the example the directory's README gives is a document that is read", () => {
  const readme = readFileSync(`${repositoryActionRoot}README.md`, "utf8");
  const example = /```json\n(?<document>[^`]+)```/u.exec(readme)?.groups?.[
    "document"
  ];
  assert.ok(example !== undefined, "the README carries a JSON example");
  assert.equal(
    read([{ path: pathOf("example"), kind: "File", content: example }])
      .readiness,
    "Ready",
  );
});
