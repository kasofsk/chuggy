import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { repositoryConfigurationIgnoredAnsweredMax } from "../../src/contract/http.ts";
import {
  importRepositoryConfigurationPartitions,
  importRepositoryConfigurations,
  repositoryConfigurationIgnored,
  repositoryConfigurationImportReadiness,
  repositoryConfigurationRoot,
  type ProjectRepositoryBindingRead,
  type RepositoryConfigurationIgnored,
  type RepositoryConfigurationImportOutcome,
  type RepositoryConfigurationReferenced,
  type RepositoryConfigurationImportPorts,
  type RepositoryConfigurationSnapshotRead,
} from "../../src/interpreter/repositoryConfiguration.ts";
import {
  repositoryDeclarationPathCharsMax,
  repositoryDeclarationRoot,
  repositoryDeclarationsMax,
  type RepositoryDeclarationFile,
} from "../../src/interpreter/repositoryDeclaration.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";

const repository = asRepositoryId("repository-one");
const commit = asGitObjectId("a".repeat(40));
const configuration = {
  version: 1,
  image: "worker:v1",
  brief: {
    motivation: ["The repository declares its configuration."],
    acceptanceCriteria: ["The declaration is imported."],
    constraints: [],
  },
  practices: [],
  work: { instructions: [] },
  review: { instructions: [] },
  worker: {
    mode: { type: "SingleAgent", agent: "Claude", arguments: [] },
    setup: [],
    files: [],
  },
};

function declaration(
  name: string,
  path = `${repositoryConfigurationRoot}${name}.json`,
): RepositoryDeclarationFile {
  return {
    path,
    kind: "File",
    content: JSON.stringify({ version: 1, name, configuration }),
  };
}

test("a repository declaration becomes a ready immutable revision", () => {
  assert.deepEqual(
    repositoryConfigurationImportReadiness({
      repository,
      commit,
      files: [declaration("review")],
    }),
    {
      readiness: "Ready",
      declarations: [
        {
          repository,
          commit,
          name: "review",
          path: `${repositoryConfigurationRoot}review.json`,
          revision: `repository:${commit}:review`,
          canonical:
            '{"brief":{"acceptanceCriteria":["The declaration is imported."],"constraints":[],"motivation":["The repository declares its configuration."]},"image":"worker:v1","practices":[],"review":{"instructions":[]},"version":1,"work":{"instructions":[]},"worker":{"files":[],"mode":{"agent":"Claude","arguments":[],"type":"SingleAgent"},"setup":[]}}',
          configuration,
        },
      ],
    },
  );
});

test("every declaration this tree makes imports, each one releasable", () => {
  const names = readdirSync(repositoryConfigurationRoot).filter((name) =>
    name.endsWith(".json"),
  );
  assert.ok(names.includes("basic-coding.json"));
  const referenced = new Map<string, RepositoryConfigurationReferenced>(
    readdirSync(repositoryDeclarationRoot, {
      recursive: true,
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = join(entry.parentPath, entry.name);
        return [
          path,
          { path, found: "File", content: readFileSync(path, "utf8") },
        ];
      }),
  );
  const found = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: names.map((name) => ({
      path: `${repositoryConfigurationRoot}${name}`,
      kind: "File",
      content: readFileSync(`${repositoryConfigurationRoot}${name}`, "utf8"),
    })),
    referenced,
  });
  assert.equal(found.readiness, "Ready", JSON.stringify(found));
  if (found.readiness !== "Ready") return;
  assert.equal(found.declarations.length, names.length);
});

test("one bad declaration refuses the snapshot without partial output", () => {
  const found = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      declaration("work"),
      {
        ...declaration("review"),
        content: JSON.stringify({
          version: 1,
          name: "review",
          configuration: { version: 1, image: "worker:v1" },
        }),
      },
    ],
  });
  assert.deepEqual(found, {
    readiness: "Refused",
    faults: [
      {
        path: `${repositoryConfigurationRoot}review.json`,
        fault: "ConfigurationInvalid",
        configurationFault: "BriefingShapeMissing",
      },
    ],
  });
});

test("paths, symlinks, names, envelopes, and duplicates are refused", () => {
  const duplicateName = declaration(
    "same",
    `${repositoryConfigurationRoot}second.json`,
  );
  const found = repositoryConfigurationImportReadiness({
    repository,
    commit,
    files: [
      declaration("nested", `${repositoryConfigurationRoot}nested/value.json`),
      { ...declaration("link"), kind: "Symlink" },
      declaration("bad name"),
      {
        ...declaration("extra"),
        content: JSON.stringify({
          version: 1,
          name: "extra",
          configuration,
          extra: true,
        }),
      },
      declaration("same", `${repositoryConfigurationRoot}first.json`),
      duplicateName,
      duplicateName,
    ],
  });
  assert.equal(found.readiness, "Refused");
  assert.deepEqual(
    found.faults.map(({ fault }) => fault),
    [
      "PathInvalid",
      "SymlinkRefused",
      "NameInvalid",
      "EnvelopeInvalid",
      "DuplicateName",
      "DuplicatePath",
    ],
  );
});

test("the declaration collection is explicitly bounded", () => {
  const files = Array.from(
    { length: repositoryDeclarationsMax + 1 },
    (_, index) => declaration(`configuration-${String(index)}`),
  );
  assert.deepEqual(
    repositoryConfigurationImportReadiness({ repository, commit, files }),
    {
      readiness: "Refused",
      faults: [
        {
          path: repositoryConfigurationRoot,
          fault: "TooManyDeclarations",
        },
      ],
    },
  );
});

test("partition imports continue after one partition is refused", async () => {
  const first = { tenant: asTenantId("tenant"), project: asProjectId("first") };
  const second = {
    tenant: asTenantId("tenant"),
    project: asProjectId("second"),
  };
  const calls: string[] = [];
  const imports = await importRepositoryConfigurationPartitions({
    partitions: [first, second],
    repository,
    commit,
    authority: {
      kind: asAuthorityKind("Service"),
      subject: asAuthoritySubject("configuration-mirror-importer"),
    },
    ports: {
      bindings: {
        binding: (partition) => {
          calls.push(`binding:${partition.project}`);
          return Promise.resolve(
            partition.project === first.project
              ? undefined
              : {
                  partition,
                  repository,
                  recoveryEpoch: asRecoveryEpoch("epoch"),
                },
          );
        },
      },
      snapshots: {
        referenced: () => Promise.resolve({ read: "Referenced", files: [] }),

        snapshot: () => {
          calls.push("snapshot");
          return Promise.resolve({ read: "Snapshot", files: [] });
        },
      },
      store: {
        importRepositoryConfigurations: () => {
          calls.push("store");
          return Promise.resolve({ imported: "Imported" });
        },
      },
    },
  });
  assert.deepEqual(
    imports.map(({ outcome }) => outcome),
    [{ result: "RepositoryAbsent" }, { result: "Imported", declarations: 0 }],
  );
  assert.deepEqual(calls, [
    "binding:first",
    "binding:second",
    "snapshot",
    "store",
  ]);
});

/**
 * A binding read over a fixed set of bound repositories, recording every
 * repository it was asked for so a caller's election is visible.
 */
function boundRepositories(
  bound: ReadonlyMap<string, string>,
  asked: string[],
): ProjectRepositoryBindingRead {
  return {
    binding: (partition, forRepository) => {
      asked.push(String(forRepository));
      const epoch =
        forRepository === undefined ? undefined : bound.get(forRepository);
      return Promise.resolve(
        forRepository === undefined || epoch === undefined
          ? undefined
          : {
              partition,
              repository: forRepository,
              recoveryEpoch: asRecoveryEpoch(epoch),
            },
      );
    },
  };
}

test("each of one project's repositories imports against its own binding", async () => {
  const partition = {
    tenant: asTenantId("tenant"),
    project: asProjectId("one"),
  };
  const other = asRepositoryId("repository-two");
  const unbound = asRepositoryId("repository-unbound");
  const asked: string[] = [];
  const imported: string[] = [];
  const ports: RepositoryConfigurationImportPorts = {
    bindings: boundRepositories(
      new Map([
        [repository, "epoch-one"],
        [other, "epoch-two"],
      ]),
      asked,
    ),
    snapshots: {
      referenced: () => Promise.resolve({ read: "Referenced", files: [] }),

      snapshot: () => Promise.resolve({ read: "Snapshot", files: [] }),
    },
    store: {
      importRepositoryConfigurations: ({ binding }) => {
        imported.push(`${binding.repository}:${binding.recoveryEpoch}`);
        return Promise.resolve({ imported: "Imported" });
      },
    },
  };
  const outcomes: RepositoryConfigurationImportOutcome[] = [];
  for (const named of [repository, other, unbound])
    outcomes.push(
      ...(
        await importRepositoryConfigurationPartitions({
          partitions: [partition],
          repository: named,
          commit,
          authority: {
            kind: asAuthorityKind("Service"),
            subject: asAuthoritySubject("configuration-mirror-importer"),
          },
          ports,
        })
      ).map(({ outcome }) => outcome),
    );
  assert.deepEqual(outcomes, [
    { result: "Imported", declarations: 0 },
    { result: "Imported", declarations: 0 },
    { result: "RepositoryAbsent" },
  ]);
  assert.deepEqual(asked, [repository, other, unbound]);
  assert.deepEqual(imported, [`${repository}:epoch-one`, `${other}:epoch-two`]);
});

const chug = repositoryDeclarationRoot;

test("what an import reads none of is every entry under `.chug/` but the configuration directory, and each file in it that is not JSON", () => {
  assert.deepEqual(
    repositoryConfigurationIgnored({
      listing: {
        listed: "Entries",
        entries: [
          { path: `${chug}workloads`, directory: true },
          { path: repositoryConfigurationRoot.slice(0, -1), directory: true },
          { path: `${chug}project.yaml`, directory: false },
        ],
      },
      skipped: [`${repositoryConfigurationRoot}README.md`],
    }),
    {
      paths: [
        `${repositoryConfigurationRoot}README.md`,
        `${chug}project.yaml`,
        `${chug}workloads/`,
      ],
      truncated: false,
    },
  );
  assert.deepEqual(
    repositoryConfigurationIgnored({
      listing: {
        listed: "Entries",
        entries: [
          { path: repositoryConfigurationRoot.slice(0, -1), directory: false },
        ],
      },
      skipped: [],
    }),
    { paths: [repositoryConfigurationRoot.slice(0, -1)], truncated: false },
  );
});

test("an import that read everything under `.chug/`, or could not list it, names nothing", () => {
  const configurations = {
    path: repositoryConfigurationRoot.slice(0, -1),
    directory: true,
  };
  assert.equal(
    repositoryConfigurationIgnored({
      listing: { listed: "Entries", entries: [configurations] },
      skipped: [],
    }),
    undefined,
  );
  assert.equal(
    repositoryConfigurationIgnored({
      listing: { listed: "Entries", entries: [] },
      skipped: [],
    }),
    undefined,
  );
  assert.equal(
    repositoryConfigurationIgnored({
      listing: { listed: "Unlisted" },
      skipped: [`${repositoryConfigurationRoot}README.md`],
    }),
    undefined,
  );
});

test("what an import reads none of is bounded, and says where it names less than there is", () => {
  const many = Array.from(
    { length: repositoryConfigurationIgnoredAnsweredMax + 1 },
    (_, index) => ({
      path: `${chug}${String(index).padStart(3, "0")}.yaml`,
      directory: false,
    }),
  );
  const bounded = repositoryConfigurationIgnored({
    listing: { listed: "Entries", entries: many },
    skipped: [],
  });
  assert.deepEqual(bounded, {
    paths: many
      .slice(0, repositoryConfigurationIgnoredAnsweredMax)
      .map(({ path }) => path),
    truncated: true,
  });
  const exact = repositoryConfigurationIgnored({
    listing: { listed: "Entries", entries: many.slice(1) },
    skipped: [],
  });
  assert.equal(exact?.truncated, false);
  assert.equal(exact.paths.length, repositoryConfigurationIgnoredAnsweredMax);

  const long = `${chug}${"x".repeat(repositoryDeclarationPathCharsMax)}`;
  assert.deepEqual(
    repositoryConfigurationIgnored({
      listing: {
        listed: "Entries",
        entries: [
          { path: long, directory: false },
          { path: `${chug}project.yaml`, directory: false },
        ],
      },
      skipped: [],
    }),
    { paths: [`${chug}project.yaml`], truncated: true },
  );
  assert.deepEqual(
    repositoryConfigurationIgnored({
      listing: { listed: "Overflowed" },
      skipped: [`${repositoryConfigurationRoot}README.md`],
    }),
    { paths: [`${repositoryConfigurationRoot}README.md`], truncated: true },
  );
  assert.deepEqual(
    repositoryConfigurationIgnored({
      listing: { listed: "Overflowed" },
      skipped: [],
    }),
    { paths: [], truncated: true },
  );
});

/** One import of `repository` at `commit` against a snapshot that answers `read`. */
function importAgainst(
  read: RepositoryConfigurationSnapshotRead,
): Promise<RepositoryConfigurationImportOutcome> {
  const partition = {
    tenant: asTenantId("tenant"),
    project: asProjectId("one"),
  };
  return importRepositoryConfigurations({
    partition,
    repository,
    commit,
    authority: {
      kind: asAuthorityKind("Service"),
      subject: asAuthoritySubject("configuration-mirror-importer"),
    },
    ports: {
      bindings: boundRepositories(new Map([[repository, "epoch"]]), []),
      snapshots: {
        snapshot: () => Promise.resolve(read),
        referenced: () => Promise.resolve({ read: "Referenced", files: [] }),
      },
      store: {
        importRepositoryConfigurations: () =>
          Promise.resolve({ imported: "Imported" }),
      },
    },
  });
}

test("an import of a commit declaring none says what its `.chug/` holds instead", async () => {
  const ignored: RepositoryConfigurationIgnored = {
    paths: [`${chug}project.yaml`],
    truncated: false,
  };
  assert.deepEqual(
    await importAgainst({
      read: "Absent",
      absent: "ConfigurationDirectory",
      ignored,
    }),
    { result: "SnapshotAbsent", absent: "ConfigurationDirectory", ignored },
  );
  assert.deepEqual(
    await importAgainst({ read: "Absent", absent: "ConfigurationDirectory" }),
    { result: "SnapshotAbsent", absent: "ConfigurationDirectory" },
  );
  assert.deepEqual(await importAgainst({ read: "Snapshot", files: [] }), {
    result: "Imported",
    declarations: 0,
  });
});
