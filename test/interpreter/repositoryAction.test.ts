/**
 * Importing a commit's `.chug/actions/` through the ports the import is
 * written against: the documents a tree carries, held to the project's live
 * bindings and to one document per identity, stored under the partition they
 * were imported into.
 */

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
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  importRepositoryActions,
  repositoryActionRoot,
  type RepositoryActionDeclaration,
  type RepositoryActionImportPorts,
} from "../../src/interpreter/repositoryAction.ts";
import { asRepositoryLanding } from "../../src/interpreter/repositoryBinding.ts";
import type { RepositoryConfigurationFile } from "../../src/interpreter/repositoryConfiguration.ts";

const service = asRepositoryId("github.com/example/service");
const infrastructure = asRepositoryId("github.com/example/infrastructure");
const retired = asRepositoryId("github.com/example/retired");
const commit = asGitObjectId("a".repeat(40));
const partition: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const elsewhere: Partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("elsewhere"),
};
const authority = {
  kind: asAuthorityKind("Service"),
  subject: asAuthoritySubject("action-import"),
};

function actionFile(
  file: string,
  action: string,
  repository: string,
): RepositoryConfigurationFile {
  return {
    path: `${repositoryActionRoot}${file}.json`,
    kind: "File",
    content: JSON.stringify({
      repository,
      name: `The ${action} action`,
      action,
      version: 1,
    }),
  };
}

function actionPorts(files: readonly RepositoryConfigurationFile[]): {
  readonly ports: RepositoryActionImportPorts;
  readonly stored: Map<string, readonly RepositoryActionDeclaration[]>;
} {
  const stored = new Map<string, readonly RepositoryActionDeclaration[]>();
  const key = (each: Partition): string => `${each.tenant}/${each.project}`;
  const landing = asRepositoryLanding("Push");
  return {
    stored,
    ports: {
      binding: {
        binding: (bound, repository) =>
          Promise.resolve(
            repository === service || repository === infrastructure
              ? {
                  partition: bound,
                  repository,
                  recoveryEpoch: asRecoveryEpoch("epoch"),
                }
              : undefined,
          ),
      },
      bindings: {
        bindings: () =>
          Promise.resolve([
            { repository: service, boundAt: "2026-01-01", landing },
            { repository: infrastructure, boundAt: "2026-01-02", landing },
            {
              repository: retired,
              boundAt: "2026-01-03",
              landing,
              retiredAt: "2026-02-01",
            },
          ]),
      },
      snapshots: {
        actions: () => Promise.resolve({ read: "Snapshot", files }),
      },
      store: {
        importRepositoryActions: (input) => {
          stored.set(key(input.partition), input.declarations);
          return Promise.resolve({ imported: "Imported" });
        },
        actions: (each) => Promise.resolve(stored.get(key(each)) ?? []),
      },
    },
  };
}

function importFrom(
  ports: RepositoryActionImportPorts,
  repository: RepositoryId = service,
): ReturnType<typeof importRepositoryActions> {
  return importRepositoryActions({
    partition,
    repository,
    commit,
    authority,
    ports,
  });
}

test("a tree carrying two actions imports both, under the partition it was imported into", async () => {
  const { ports } = actionPorts([
    actionFile("build", "build", service),
    actionFile("deploy-production", "deploy-production", infrastructure),
  ]);
  assert.deepEqual(await importFrom(ports), {
    result: "Imported",
    declarations: 2,
  });
  const actions = await ports.store.actions(partition);
  assert.deepEqual(
    actions.map((each) => [
      each.action,
      each.repository,
      each.declaredIn,
      each.path,
    ]),
    [
      ["build", service, service, `${repositoryActionRoot}build.json`],
      [
        "deploy-production",
        infrastructure,
        service,
        `${repositoryActionRoot}deploy-production.json`,
      ],
    ],
  );
  assert.equal(
    actions[0]?.canonical,
    `{"action":"build","name":"The build action","repository":"${service}","version":1}`,
  );
  assert.match(actions[0]?.digest ?? "", /^[0-9a-f]{64}$/u);
  assert.deepEqual(await ports.store.actions(elsewhere), []);
});

test("two imports of one commit agree on every document and its address", async () => {
  const files = [
    actionFile("build", "build", service),
    actionFile("deploy", "deploy", infrastructure),
  ];
  const first = actionPorts(files);
  const second = actionPorts(files);
  await importFrom(first.ports);
  await importFrom(second.ports);
  assert.deepEqual(
    await first.ports.store.actions(partition),
    await second.ports.store.actions(partition),
  );
});

test("a document naming a repository the project does not bind is refused at import and nothing is stored", async () => {
  const { ports, stored } = actionPorts([
    actionFile("build", "build", service),
    actionFile("publish", "publish", "github.com/example/unbound"),
    actionFile("deploy-retired", "deploy-retired", retired),
  ]);
  assert.deepEqual(await importFrom(ports), {
    result: "DeclarationsRefused",
    faults: [
      {
        path: `${repositoryActionRoot}publish.json`,
        fault: "RepositoryUnbound",
      },
      {
        path: `${repositoryActionRoot}deploy-retired.json`,
        fault: "RepositoryUnbound",
      },
    ],
  });
  assert.equal(stored.size, 0);
});

test("two documents of one identity refuse the tree and nothing is stored", async () => {
  const { ports, stored } = actionPorts([
    actionFile("deploy", "deploy", service),
    actionFile("deploy-again", "deploy", infrastructure),
  ]);
  assert.deepEqual(await importFrom(ports), {
    result: "DeclarationsRefused",
    faults: [
      {
        path: `${repositoryActionRoot}deploy-again.json`,
        fault: "DuplicateAction",
      },
    ],
  });
  assert.equal(stored.size, 0);
});

test("a document the schema refuses, a nested path and a symlink are refused by path", async () => {
  const { ports } = actionPorts([
    {
      ...actionFile("build", "build", service),
      content: JSON.stringify({
        version: 1,
        action: "build",
        name: "Build",
        repository: service,
        command: "make",
      }),
    },
    {
      ...actionFile("nested", "nested", service),
      path: `${repositoryActionRoot}deeper/nested.json`,
    },
    { ...actionFile("linked", "linked", service), kind: "Symlink" },
    { ...actionFile("broken", "broken", service), content: "{" },
  ]);
  const outcome = await importFrom(ports);
  assert.equal(outcome.result, "DeclarationsRefused");
  if (outcome.result !== "DeclarationsRefused") return;
  assert.deepEqual(
    outcome.faults.map((each) => each.fault),
    ["DocumentInvalid", "PathInvalid", "SymlinkRefused", "DocumentUnreadable"],
  );
});

test("an import from a repository the project does not bind reads nothing", async () => {
  const { ports, stored } = actionPorts([
    actionFile("build", "build", service),
  ]);
  assert.deepEqual(
    await importFrom(ports, asRepositoryId("github.com/example/unbound")),
    { result: "RepositoryAbsent" },
  );
  assert.equal(stored.size, 0);
});
