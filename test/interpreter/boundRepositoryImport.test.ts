/**
 * The importer's run over every binding there is.
 *
 * THE LISTING IS THE LIST AND ITS ORDER IS THE RUN'S. A binding is what says a
 * project takes its declarations from a repository, so a run that had to be
 * told its repositories would hold a second copy of that list; the outcomes
 * come back in the order the listing answered in, which is what makes a
 * truncated run readable as a prefix.
 *
 * A SKIP IS NOT A FAILURE AND A FAILURE IS NOT THE RUN'S END. A repository
 * holding no commit, and one holding no configuration directory at its head,
 * are passed over — seeding one belongs to the bind. Everything else is that
 * binding's failure alone, and every binding after it is still attempted.
 *
 * A RUN THAT FILLED ITS BOUND IS NOT A RUN THAT IMPORTED THE ESTATE, and says
 * so in what it leaves with. A clean exit from one would be the only thing
 * telling anyone the newest bindings were never reached.
 *
 * A BINDING'S ACTIONS ARE IMPORTED AT THE HEAD ITS CONFIGURATIONS ARE, AND FOR
 * THEMSELVES. The head is read once, and what either import is refused for or
 * raised with is that import's result and never the other's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asAuthorityKind,
  asAuthoritySubject,
} from "../../src/interpreter/operationInbox.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type RepositoryBinding,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  repositoryActionRoot,
  type RepositoryActionsImported,
} from "../../src/interpreter/repositoryAction.ts";
import {
  boundRepositoryActionImportLine,
  boundRepositoryImportLine,
  boundRepositoryImportRefusal,
  boundRepositoryImportReport,
  importBoundRepositories,
  repositoryBindingsPerImportMax,
  type BoundRepositoryActionImportResult,
  type BoundRepositoryImport,
  type BoundRepositoryImportPorts,
  type BoundRepositoryImportResult,
  type RepositoryBindingListed,
  type RepositoryConfigurationSnapshotRead,
  type RepositoryDefaultBranchRead,
} from "../../src/interpreter/repositoryConfiguration.ts";
import type { RepositoryDeclarationSnapshotRead } from "../../src/interpreter/repositoryDeclarationSnapshot.ts";

const authority = {
  kind: asAuthorityKind("Service"),
  subject: asAuthoritySubject("configuration-mirror-importer"),
};

const head = asGitObjectId("a".repeat(40));

function partitionOf(project: string): Partition {
  return { tenant: asTenantId("acme"), project: asProjectId(project) };
}

function listed(project: string, name: string): RepositoryBindingListed {
  return {
    partition: partitionOf(project),
    repository: asRepositoryId(`https://github.com/acme/${name}.git`),
    boundAt: "2026-09-11T00:00:00Z",
  };
}

interface Fixture {
  readonly ports: BoundRepositoryImportPorts;
  readonly asked: string[];
  readonly actionsAsked: string[];
  readonly maxima: number[];
}

interface FixtureActions {
  readonly actionSnapshots?: (
    repository: RepositoryId,
  ) => RepositoryDeclarationSnapshotRead;
  readonly actionStore?: (
    repository: RepositoryId,
  ) => RepositoryActionsImported["imported"];
}

/** The action ports of a fixture, which record what they were asked apart from the configuration ports. */
function fixtureActionPorts(
  input: FixtureActions,
  actionsAsked: string[],
): Pick<BoundRepositoryImportPorts, "actionSnapshots" | "actionStore"> {
  return {
    actionSnapshots: {
      actionSnapshot: (request) => {
        const { repository } = request.repository;
        actionsAsked.push(`snapshot ${repository} ${request.commit}`);
        return Promise.resolve(
          input.actionSnapshots?.(repository) ?? {
            read: "Snapshot",
            files: [],
          },
        );
      },
    },
    actionStore: {
      importRepositoryActions: (stored) => {
        const { repository } = stored.binding;
        actionsAsked.push(
          `store ${repository} ${stored.commit} ${stored.declarations.map((declared) => declared.action).join(",")}`,
        );
        return Promise.resolve({
          imported: input.actionStore?.(repository) ?? "Imported",
        });
      },
    },
  };
}

interface FixtureInput extends FixtureActions {
  readonly bindings: readonly RepositoryBindingListed[];
  readonly heads?: (
    repository: RepositoryId,
  ) => RepositoryDefaultBranchRead | Promise<RepositoryDefaultBranchRead>;
  readonly snapshots?: (
    repository: RepositoryId,
  ) => RepositoryConfigurationSnapshotRead;
  readonly unbound?: readonly RepositoryId[];
}

function fixture(input: FixtureInput): Fixture {
  const asked: string[] = [];
  const actionsAsked: string[] = [];
  const maxima: number[] = [];
  return {
    asked,
    actionsAsked,
    maxima,
    ports: {
      listing: {
        bindings: (max) => {
          maxima.push(max);
          return Promise.resolve(input.bindings);
        },
      },
      bindings: {
        binding: (
          partition,
          repository,
        ): Promise<RepositoryBinding | undefined> =>
          Promise.resolve(
            repository === undefined ||
              (input.unbound ?? []).includes(repository)
              ? undefined
              : {
                  partition,
                  repository,
                  recoveryEpoch: asRecoveryEpoch("epoch-1"),
                },
          ),
      },
      heads: {
        defaultBranch: (binding) => {
          asked.push(`head ${binding.repository}`);
          return Promise.resolve(
            input.heads?.(binding.repository) ?? {
              read: "Branch",
              branch: asGitRefName("refs/heads/main"),
              commit: head,
            },
          );
        },
      },
      snapshots: {
        snapshot: (request) => {
          asked.push(`snapshot ${request.repository.repository}`);
          return Promise.resolve(
            input.snapshots?.(request.repository.repository) ?? {
              read: "Snapshot",
              files: [],
            },
          );
        },
      },
      store: {
        importRepositoryConfigurations: (stored) => {
          asked.push(`store ${stored.binding.repository}`);
          return Promise.resolve({ imported: "Imported" as const });
        },
      },
      ...fixtureActionPorts(input, actionsAsked),
    },
  };
}

test("every binding is imported at its own head, in the order listed", async () => {
  const bindings = [listed("atlas", "atlas"), listed("beacon", "beacon")];
  const { ports, asked, maxima } = fixture({ bindings });

  const { imports } = await importBoundRepositories({
    authority,
    ports,
  });

  assert.deepEqual(
    imports.map((bound) => [bound.partition.project, bound.result.result]),
    [
      ["atlas", "Imported"],
      ["beacon", "Imported"],
    ],
  );
  assert.deepEqual(
    imports.map((bound) =>
      bound.result.result === "Imported" ? bound.result.commit : undefined,
    ),
    [head, head],
  );
  assert.deepEqual(asked, [
    "head https://github.com/acme/atlas.git",
    "snapshot https://github.com/acme/atlas.git",
    "store https://github.com/acme/atlas.git",
    "head https://github.com/acme/beacon.git",
    "snapshot https://github.com/acme/beacon.git",
    "store https://github.com/acme/beacon.git",
  ]);
  assert.deepEqual(maxima, [repositoryBindingsPerImportMax]);
});

test("a repository with nothing at its head is skipped and not failed", async () => {
  const atlas = listed("atlas", "atlas");
  const beacon = listed("beacon", "beacon");
  const { ports } = fixture({
    bindings: [atlas, beacon],
    heads: (repository) =>
      repository === atlas.repository
        ? { read: "Absent" }
        : {
            read: "Branch",
            branch: asGitRefName("refs/heads/main"),
            commit: head,
          },
    snapshots: (repository) =>
      repository === beacon.repository
        ? { read: "Absent", absent: "ConfigurationDirectory" }
        : { read: "Snapshot", files: [] },
  });

  const { imports } = await importBoundRepositories({
    authority,
    ports,
  });

  assert.deepEqual(
    imports.map((bound) => bound.result),
    [
      { result: "Skipped", why: "RepositoryEmpty" },
      { result: "Skipped", why: "ConfigurationDirectoryAbsent" },
    ],
  );
});

test("one binding's failure leaves every other binding imported", async () => {
  const atlas = listed("atlas", "atlas");
  const bindings = [atlas, listed("beacon", "beacon")];
  const { ports } = fixture({
    bindings,
    snapshots: (repository) =>
      repository === atlas.repository
        ? { read: "Unavailable", unavailable: "Repository" }
        : { read: "Snapshot", files: [] },
  });

  const { imports } = await importBoundRepositories({
    authority,
    ports,
  });

  assert.deepEqual(imports[0]?.result, {
    result: "Failed",
    failure: {
      failure: "Import",
      outcome: { result: "Unavailable", unavailable: "Repository" },
    },
  });
  assert.equal(imports[1]?.result.result, "Imported");
});

test("a forge that could not be reached for a head is that binding's failure", async () => {
  const { ports } = fixture({
    bindings: [listed("atlas", "atlas")],
    heads: () => ({ read: "Unavailable" }),
  });

  const { imports } = await importBoundRepositories({
    authority,
    ports,
  });

  assert.deepEqual(imports[0]?.result, {
    result: "Failed",
    failure: { failure: "HeadUnavailable" },
  });
});

test("a binding unbound between the listing and the read is skipped", async () => {
  const atlas = listed("atlas", "atlas");
  const { ports, asked } = fixture({
    bindings: [atlas],
    unbound: [atlas.repository],
  });

  const { imports } = await importBoundRepositories({
    authority,
    ports,
  });

  assert.deepEqual(imports[0]?.result, { result: "Skipped", why: "Unbound" });
  assert.deepEqual(asked, [], "a binding that is gone is asked nothing at all");
});

test("the run asks the listing for no more than the bound it was given", async () => {
  const { ports, maxima } = fixture({ bindings: [] });

  const { imports } = await importBoundRepositories({
    authority,
    ports,
    bindingsMax: 3,
  });

  assert.deepEqual(imports, []);
  assert.deepEqual(maxima, [3]);
});

test("a port that raised is that binding's failure and not the run's", async () => {
  const atlas = listed("atlas", "atlas");
  const { ports } = fixture({
    bindings: [atlas, listed("beacon", "beacon")],
    heads: (repository) =>
      repository === atlas.repository
        ? Promise.reject(new Error("the forge is down"))
        : {
            read: "Branch",
            branch: asGitRefName("refs/heads/main"),
            commit: head,
          },
  });

  const { imports } = await importBoundRepositories({
    authority,
    ports,
  });

  assert.deepEqual(imports[0]?.result, {
    result: "Failed",
    failure: { failure: "Raised" },
  });
  assert.equal(imports[1]?.result.result, "Imported");
});

test("a listing that came back at the bound is a run that did not read the estate", async () => {
  const bindings = [listed("atlas", "atlas"), listed("beacon", "beacon")];

  const filled = await importBoundRepositories({
    authority,
    ports: fixture({ bindings }).ports,
    bindingsMax: 2,
  });
  const short = await importBoundRepositories({
    authority,
    ports: fixture({ bindings }).ports,
    bindingsMax: 3,
  });

  assert.equal(filled.truncated, true);
  assert.equal(short.truncated, false);
});

/** One binding's outcome, which is what a run reports and leaves on. */
function reported(
  result: BoundRepositoryImportResult,
  actions: BoundRepositoryActionImportResult = {
    result: "Imported",
    commit: head,
    declarations: 0,
  },
): BoundRepositoryImport {
  return {
    partition: partitionOf("atlas"),
    repository: asRepositoryId("https://github.com/acme/atlas.git"),
    result,
    actions,
  };
}

const importedAtHead = reported({
  result: "Imported",
  commit: head,
  declarations: 1,
});

test("a run that filled its listing's bound leaves non-zero naming the bound", () => {
  assert.equal(
    boundRepositoryImportRefusal(
      { imports: [importedAtHead], truncated: false },
      1000,
    ),
    undefined,
    "a listing that came back short of the bound read the whole estate",
  );
  assert.match(
    String(
      boundRepositoryImportRefusal(
        { imports: [importedAtHead], truncated: true },
        1000,
      ),
    ),
    /filled its bound of 1000 bindings/u,
  );
});

test("a binding that failed leaves non-zero beside a bound that filled", () => {
  const failed = reported({ result: "Failed", failure: { failure: "Raised" } });
  assert.equal(
    boundRepositoryImportRefusal(
      { imports: [failed, importedAtHead], truncated: false },
      1000,
    ),
    "1 of 2 bindings",
  );
  assert.match(
    String(
      boundRepositoryImportRefusal(
        { imports: [failed], truncated: true },
        1000,
      ),
    ),
    /^1 of 1 bindings; the listing filled/u,
  );
});

test("a refused declaration's path reaches its line escaped and not raw", () => {
  const line = boundRepositoryImportLine(
    reported({
      result: "Failed",
      failure: {
        failure: "Import",
        outcome: {
          result: "DeclarationsRefused",
          faults: [
            {
              path: ".chuggy/configurations/one\nfailed: acme/atlas",
              fault: "PathInvalid",
            },
          ],
        },
      },
    }),
  );

  assert.equal(line.includes("\n"), false);
  assert.match(line, /one\\nfailed/u);
});

function actionFile(action: string) {
  return {
    path: `${repositoryActionRoot}${action}.json`,
    kind: "File" as const,
    content: JSON.stringify({ version: 1, action, name: action }),
  };
}

const atlasRepository = "https://github.com/acme/atlas.git";

test("a binding's actions are imported at the head its configurations are, read once", async () => {
  const { ports, asked, actionsAsked } = fixture({
    bindings: [listed("atlas", "atlas")],
    actionSnapshots: () => ({
      read: "Snapshot",
      files: [actionFile("build"), actionFile("deploy")],
    }),
  });

  const { imports } = await importBoundRepositories({ authority, ports });

  assert.deepEqual(imports[0]?.actions, {
    result: "Imported",
    commit: head,
    declarations: 2,
  });
  assert.deepEqual(actionsAsked, [
    `snapshot ${atlasRepository} ${head}`,
    `store ${atlasRepository} ${head} build,deploy`,
  ]);
  assert.deepEqual(
    asked.filter((port) => port.startsWith("head")),
    [`head ${atlasRepository}`],
  );
});

test("a head holding no action document declares none, whatever became of its configurations", async () => {
  const { ports, actionsAsked } = fixture({
    bindings: [listed("atlas", "atlas")],
    snapshots: () => ({ read: "Absent", absent: "ConfigurationDirectory" }),
  });

  const { imports } = await importBoundRepositories({ authority, ports });

  assert.deepEqual(imports[0]?.result, {
    result: "Skipped",
    why: "ConfigurationDirectoryAbsent",
  });
  assert.deepEqual(imports[0]?.actions, {
    result: "Imported",
    commit: head,
    declarations: 0,
  });
  assert.equal(actionsAsked[1], `store ${atlasRepository} ${head} `);
});

test("what a binding's actions are refused for or raise with leaves its configurations imported", async () => {
  const refusedDocument = {
    ...actionFile("build"),
    kind: "Symlink" as const,
  };
  const failures: readonly [FixtureInput, BoundRepositoryActionImportResult][] =
    [
      [
        {
          bindings: [],
          actionSnapshots: () => ({
            read: "Snapshot",
            files: [refusedDocument],
          }),
        },
        {
          result: "Failed",
          failure: {
            failure: "Import",
            outcome: {
              result: "DeclarationsRefused",
              faults: [{ path: refusedDocument.path, fault: "SymlinkRefused" }],
            },
          },
        },
      ],
      [
        { bindings: [], actionStore: () => "IdentityConflict" },
        {
          result: "Failed",
          failure: {
            failure: "Import",
            outcome: { result: "IdentityConflict" },
          },
        },
      ],
      [
        {
          bindings: [],
          actionSnapshots: () => {
            throw new Error("the forge is down");
          },
        },
        { result: "Failed", failure: { failure: "Raised" } },
      ],
    ];
  for (const [ports, actions] of failures) {
    const { imports } = await importBoundRepositories({
      authority,
      ports: fixture({ ...ports, bindings: [listed("atlas", "atlas")] }).ports,
    });

    assert.deepEqual(imports[0]?.actions, actions);
    assert.deepEqual(imports[0]?.result, {
      result: "Imported",
      commit: head,
      declarations: 0,
    });
  }
});

test("what a binding's configurations are refused for or raise with leaves its actions imported", async () => {
  const failures: readonly [
    () => RepositoryConfigurationSnapshotRead,
    BoundRepositoryImportResult,
  ][] = [
    [
      () => ({ read: "Unavailable", unavailable: "Repository" }),
      {
        result: "Failed",
        failure: {
          failure: "Import",
          outcome: { result: "Unavailable", unavailable: "Repository" },
        },
      },
    ],
    [
      () => {
        throw new Error("the forge is down");
      },
      { result: "Failed", failure: { failure: "Raised" } },
    ],
  ];
  for (const [snapshots, result] of failures) {
    const { ports } = fixture({
      bindings: [listed("atlas", "atlas")],
      snapshots,
      actionSnapshots: () => ({
        read: "Snapshot",
        files: [actionFile("build")],
      }),
    });

    const { imports } = await importBoundRepositories({ authority, ports });

    assert.deepEqual(imports[0]?.result, result);
    assert.deepEqual(imports[0]?.actions, {
      result: "Imported",
      commit: head,
      declarations: 1,
    });
  }
});

test("a binding with no head to import at reports that of its actions too, and asks their ports nothing", async () => {
  const atlas = listed("atlas", "atlas");
  const headless: readonly [
    Pick<FixtureInput, "heads" | "unbound">,
    BoundRepositoryActionImportResult,
  ][] = [
    [{ unbound: [atlas.repository] }, { result: "Skipped", why: "Unbound" }],
    [
      { heads: () => ({ read: "Absent" }) },
      { result: "Skipped", why: "RepositoryEmpty" },
    ],
    [
      { heads: () => ({ read: "Unavailable" }) },
      { result: "Failed", failure: { failure: "HeadUnavailable" } },
    ],
    [
      { heads: () => Promise.reject(new Error("the forge is down")) },
      { result: "Failed", failure: { failure: "Raised" } },
    ],
  ];
  for (const [ports, result] of headless) {
    const { ports: given, actionsAsked } = fixture({
      bindings: [atlas],
      ...ports,
    });

    const { imports } = await importBoundRepositories({
      authority,
      ports: given,
    });

    assert.deepEqual(imports[0]?.actions, result);
    assert.deepEqual(imports[0]?.result, result);
    assert.deepEqual(actionsAsked, []);
  }
});

test("a head the repository no longer holds when its actions are read is skipped", async () => {
  const { ports } = fixture({
    bindings: [listed("atlas", "atlas")],
    actionSnapshots: () => ({ read: "Absent" }),
  });

  const { imports } = await importBoundRepositories({ authority, ports });

  assert.deepEqual(imports[0]?.actions, {
    result: "Skipped",
    why: "CommitAbsent",
  });
});

const actionsRefused: BoundRepositoryActionImportResult = {
  result: "Failed",
  failure: {
    failure: "Import",
    outcome: {
      result: "DeclarationsRefused",
      faults: [
        {
          path: `${repositoryActionRoot}one\nfailed: acme/atlas`,
          fault: "PathInvalid",
        },
      ],
    },
  },
};

test("a binding whose actions alone failed leaves non-zero, and one failing twice is one binding", () => {
  const raised = { result: "Failed", failure: { failure: "Raised" } } as const;
  assert.equal(
    boundRepositoryImportRefusal(
      {
        imports: [
          reported(importedAtHead.result, actionsRefused),
          importedAtHead,
        ],
        truncated: false,
      },
      1000,
    ),
    "1 of 2 bindings",
  );
  assert.equal(
    boundRepositoryImportRefusal(
      { imports: [reported(raised, raised), importedAtHead], truncated: false },
      1000,
    ),
    "1 of 2 bindings",
  );
});

test("a binding's actions are a line of their own, told from its configurations' by one word", () => {
  const where = `acme/atlas ${atlasRepository}`;
  assert.equal(
    boundRepositoryActionImportLine(importedAtHead),
    `${where} actions imported at ${head}`,
  );
  assert.equal(
    boundRepositoryImportLine(importedAtHead),
    `${where} imported at ${head}`,
  );
  assert.equal(
    boundRepositoryActionImportLine(
      reported(importedAtHead.result, { result: "Skipped", why: "Unbound" }),
    ),
    `${where} actions skipped: Unbound`,
  );
  assert.equal(
    boundRepositoryActionImportLine(
      reported(importedAtHead.result, {
        result: "Failed",
        failure: { failure: "Import", outcome: { result: "IdentityConflict" } },
      }),
    ),
    `${where} actions failed: {"failure":"Import","outcome":{"result":"IdentityConflict"}}`,
  );
});

test("a refused action document's path reaches its line escaped and not raw", () => {
  const line = boundRepositoryActionImportLine(
    reported(importedAtHead.result, actionsRefused),
  );

  assert.equal(line.includes("\n"), false);
  assert.match(line, /one\\nfailed/u);
});

test("a binding is reported on two lines, its configurations' and then its actions', each a failure's by its own result", () => {
  const raised = { result: "Failed", failure: { failure: "Raised" } } as const;
  const actionsFailed = reported(importedAtHead.result, actionsRefused);
  const configurationsFailed = reported(raised);

  assert.deepEqual(boundRepositoryImportReport(actionsFailed), [
    { line: boundRepositoryImportLine(actionsFailed), failed: false },
    { line: boundRepositoryActionImportLine(actionsFailed), failed: true },
  ]);
  assert.deepEqual(boundRepositoryImportReport(configurationsFailed), [
    { line: boundRepositoryImportLine(configurationsFailed), failed: true },
    {
      line: boundRepositoryActionImportLine(configurationsFailed),
      failed: false,
    },
  ]);
});
