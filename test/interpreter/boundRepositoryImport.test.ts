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
  importBoundRepositoryConfigurations,
  repositoryBindingsPerImportMax,
  type BoundRepositoryImportPorts,
  type RepositoryBindingListed,
  type RepositoryConfigurationSnapshotRead,
  type RepositoryDefaultBranchRead,
} from "../../src/interpreter/repositoryConfiguration.ts";

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
  readonly maxima: number[];
}

function fixture(input: {
  readonly bindings: readonly RepositoryBindingListed[];
  readonly heads?: (repository: RepositoryId) => RepositoryDefaultBranchRead;
  readonly snapshots?: (
    repository: RepositoryId,
  ) => RepositoryConfigurationSnapshotRead;
  readonly unbound?: readonly RepositoryId[];
}): Fixture {
  const asked: string[] = [];
  const maxima: number[] = [];
  return {
    asked,
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
    },
  };
}

test("every binding is imported at its own head, in the order listed", async () => {
  const bindings = [listed("atlas", "atlas"), listed("beacon", "beacon")];
  const { ports, asked, maxima } = fixture({ bindings });

  const imports = await importBoundRepositoryConfigurations({
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

  const imports = await importBoundRepositoryConfigurations({
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

  const imports = await importBoundRepositoryConfigurations({
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

  const imports = await importBoundRepositoryConfigurations({
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

  const imports = await importBoundRepositoryConfigurations({
    authority,
    ports,
  });

  assert.deepEqual(imports[0]?.result, { result: "Skipped", why: "Unbound" });
  assert.deepEqual(asked, [], "a binding that is gone is asked nothing at all");
});

test("the run asks the listing for no more than the bound it was given", async () => {
  const { ports, maxima } = fixture({ bindings: [] });

  const imports = await importBoundRepositoryConfigurations({
    authority,
    ports,
    bindingsMax: 3,
  });

  assert.deepEqual(imports, []);
  assert.deepEqual(maxima, [3]);
});
