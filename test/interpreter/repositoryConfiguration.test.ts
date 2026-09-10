import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  importRepositoryConfigurationPartitions,
  repositoryConfigurationDeclarationsMax,
  repositoryConfigurationImportReadiness,
  repositoryConfigurationRoot,
  type ProjectRepositoryBindingRead,
  type RepositoryConfigurationFile,
  type RepositoryConfigurationImportOutcome,
  type RepositoryConfigurationImportPorts,
} from "../../src/interpreter/repositoryConfiguration.ts";
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
};

function declaration(
  name: string,
  path = `${repositoryConfigurationRoot}${name}.json`,
): RepositoryConfigurationFile {
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
            '{"brief":{"acceptanceCriteria":["The declaration is imported."],"constraints":[],"motivation":["The repository declares its configuration."]},"image":"worker:v1","practices":[],"review":{"instructions":[]},"version":1,"work":{"instructions":[]}}',
          configuration,
        },
      ],
    },
  );
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
    { length: repositoryConfigurationDeclarationsMax + 1 },
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
    [{ result: "RepositoryAbsent" }, { result: "Imported" }],
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
    { result: "Imported" },
    { result: "Imported" },
    { result: "RepositoryAbsent" },
  ]);
  assert.deepEqual(asked, [repository, other, unbound]);
  assert.deepEqual(imported, [`${repository}:epoch-one`, `${other}:epoch-two`]);
});
