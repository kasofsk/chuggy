import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asGitObjectId,
  asRepositoryId,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
} from "../../src/interpreter/projectStore.ts";
import { asRepositoryLanding } from "../../src/interpreter/repositoryBinding.ts";
import {
  importRepositoryActions,
  repositoryActionRoot,
  type RepositoryActionDeclaration,
  type RepositoryActionImportPorts,
} from "../../src/interpreter/repositoryAction.ts";
import type { RepositoryConfigurationFile } from "../../src/interpreter/repositoryConfiguration.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("web") };
const source = asRepositoryId("acme/engine");
const commit = asGitObjectId("a".repeat(40));
const authority = {
  kind: asAuthorityKind("Service"),
  subject: asAuthoritySubject("action-importer"),
};

function actionFile(
  file: string,
  document: Record<string, unknown>,
): RepositoryConfigurationFile {
  return {
    path: `${repositoryActionRoot}${file}.json`,
    kind: "File",
    content: JSON.stringify(document),
  };
}

function actionPorts(
  files: readonly RepositoryConfigurationFile[],
  stored: RepositoryActionDeclaration[][],
  bound: readonly RepositoryId[] = [source],
): RepositoryActionImportPorts {
  return {
    binding: {
      binding: (at, repository) =>
        Promise.resolve(
          repository === source
            ? {
                partition: at,
                repository: source,
                recoveryEpoch: asRecoveryEpoch("epoch"),
              }
            : undefined,
        ),
    },
    bindings: {
      bindings: () =>
        Promise.resolve(
          bound.map((repository) => ({
            repository,
            boundAt: "2026-01-01T00:00:00.000Z",
            landing: asRepositoryLanding("None"),
          })),
        ),
    },
    snapshots: {
      actionSnapshot: () => Promise.resolve({ read: "Snapshot", files }),
    },
    store: {
      importRepositoryActions: (input) => {
        stored.push([...input.declarations]);
        return Promise.resolve({ imported: "Imported" });
      },
      repositoryActions: () => Promise.resolve(stored.flat()),
    },
  };
}

const build = {
  version: 1,
  action: "build",
  name: "Build",
  repository: "acme/engine",
};
const deploy = {
  repository: "acme/site",
  name: "Deploy to staging",
  action: "deploy-staging",
  version: 1,
};

test("a tree carrying two actions imports both, at addresses every import of the commit agrees on", async () => {
  const site = asRepositoryId("acme/site");
  const stored: RepositoryActionDeclaration[][] = [];
  for (let run = 0; run < 2; run += 1)
    assert.deepEqual(
      await importRepositoryActions({
        partition,
        repository: source,
        commit,
        authority,
        ports: actionPorts(
          [actionFile("build", build), actionFile("deploy", deploy)],
          stored,
          [source, site],
        ),
      }),
      { result: "Imported", declarations: 2 },
    );
  assert.equal(stored.length, 2);
  assert.deepEqual(stored[0], stored[1]);
  assert.deepEqual(stored[0], [
    {
      source,
      commit,
      path: ".chug/actions/build.json",
      action: "build",
      name: "Build",
      repository: source,
      revision: `repository:${commit}:build`,
      canonical:
        '{"action":"build","name":"Build","repository":"acme/engine","version":1}',
    },
    {
      source,
      commit,
      path: ".chug/actions/deploy.json",
      action: "deploy-staging",
      name: "Deploy to staging",
      repository: site,
      revision: `repository:${commit}:deploy-staging`,
      canonical:
        '{"action":"deploy-staging","name":"Deploy to staging","repository":"acme/site","version":1}',
    },
  ]);
});

test("a document naming a repository the project does not bind is refused at import, by its path", async () => {
  const stored: RepositoryActionDeclaration[][] = [];
  assert.deepEqual(
    await importRepositoryActions({
      partition,
      repository: source,
      commit,
      authority,
      ports: actionPorts(
        [actionFile("build", build), actionFile("deploy", deploy)],
        stored,
      ),
    }),
    {
      result: "DeclarationsRefused",
      faults: [
        { path: ".chug/actions/deploy.json", fault: "RepositoryUnbound" },
      ],
    },
  );
  assert.deepEqual(stored, []);
});

test("two documents of one identity are refused, and nothing of the commit is stored", async () => {
  const stored: RepositoryActionDeclaration[][] = [];
  assert.deepEqual(
    await importRepositoryActions({
      partition,
      repository: source,
      commit,
      authority,
      ports: actionPorts(
        [
          actionFile("build", build),
          actionFile("build-again", { ...build, name: "Build again" }),
        ],
        stored,
      ),
    }),
    {
      result: "DeclarationsRefused",
      faults: [
        { path: ".chug/actions/build-again.json", fault: "DuplicateAction" },
      ],
    },
  );
  assert.deepEqual(stored, []);
});
