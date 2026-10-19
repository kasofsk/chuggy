/** The read of one directory of a bound repository's tree, over doubled bindings, heads and trees. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  repositoryTreeDirectoryCharsMax,
  repositoryTreeEntriesAnsweredMax,
} from "../../src/contract/http.ts";
import {
  asGitObjectId,
  asGitRefName,
  asRepositoryId,
  type RepositoryBinding,
  type RepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asRecoveryEpoch,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  asRepositoryLanding,
  type ProjectRepositoryBound,
} from "../../src/interpreter/repositoryBinding.ts";
import type { RepositoryDefaultBranchRead } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  asRepositoryTreeDirectory,
  repositoryTreeReads,
  repositoryTreeRoot,
  type RepositoryTreeQuery,
  type RepositoryTreeRead,
  type RepositoryTreeSource,
} from "../../src/interpreter/repositoryTree.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const partition: Partition = {
  tenant: asTenantId("acme"),
  project: asProjectId("atlas"),
};
const caller = asPrincipal("issuer reader");
const bound = asRepositoryId("https://forge.example/acme/atlas.git");
const unbound = asRepositoryId("https://forge.example/other/secret.git");
const head = asGitObjectId("a".repeat(40));
const named = asGitObjectId("b".repeat(40));
const listed: RepositoryTreeRead = {
  read: "Listed",
  entries: [
    { name: "src", kind: "Directory" },
    { name: "run.sh", kind: "File", executable: true },
  ],
  truncated: false,
};

function binding(repository: RepositoryId): RepositoryBinding {
  return { partition, repository, recoveryEpoch: asRecoveryEpoch("epoch") };
}

function landed(
  repository: RepositoryId,
  retired: boolean,
): ProjectRepositoryBound {
  return {
    repository,
    boundAt: "2026-10-01T00:00:00.000000Z",
    landing: asRepositoryLanding("Push"),
    ...(retired ? { retiredAt: "2026-10-02T00:00:00.000000Z" } : {}),
  };
}

interface Doubled {
  readonly asked: string[];
  readonly reads: ReturnType<typeof repositoryTreeReads>;
}

/** The read over a project binding `bound` alone, heads and trees answering as given, and every ask of them written down. */
function doubled(
  access: readonly ProjectAccessKind[],
  answers: {
    readonly head?: RepositoryDefaultBranchRead;
    readonly tree?: RepositoryTreeRead;
    readonly source?: "Unconfigured";
    readonly bindingFor?: (repository: RepositoryId) => RepositoryBinding;
    readonly retired?: RepositoryId;
  } = {},
): Doubled {
  const asked: string[] = [];
  const project = memoryProjectAccess();
  project.grant({ partition, principal: caller, access: new Set(access) });
  const source: RepositoryTreeSource =
    answers.source === "Unconfigured"
      ? { readable: "Unconfigured" }
      : {
          readable: "Scratch",
          heads: {
            defaultBranch: (repository) => {
              asked.push(`head ${repository.repository}`);
              return Promise.resolve(
                answers.head ?? {
                  read: "Branch",
                  branch: asGitRefName("refs/heads/main"),
                  commit: head,
                },
              );
            },
          },
          trees: {
            list: (request) => {
              asked.push(
                `tree ${request.repository.repository} ${request.commit} ${request.directory}`,
              );
              return Promise.resolve(answers.tree ?? listed);
            },
          },
        };
  const reads = repositoryTreeReads({
    access: project,
    landing: {
      landing: (_partition, repository) => {
        asked.push(`landing ${repository}`);
        if (repository !== bound && answers.bindingFor === undefined)
          return Promise.resolve(undefined);
        return Promise.resolve(
          landed(repository, repository === answers.retired),
        );
      },
    },
    bindings: {
      binding: (_partition, repository) => {
        asked.push(`binding ${String(repository)}`);
        if (repository === undefined) return Promise.resolve(binding(bound));
        if (answers.bindingFor !== undefined)
          return Promise.resolve(answers.bindingFor(repository));
        return Promise.resolve(
          repository === bound ? binding(bound) : undefined,
        );
      },
    },
    source,
  });
  return { asked, reads };
}

function query(
  repository: RepositoryId,
  directory = repositoryTreeRoot,
  commit?: typeof named,
): RepositoryTreeQuery {
  return { repository, directory, ...(commit === undefined ? {} : { commit }) };
}

test("a reader lists the root at the default branch's head, and is told the commit it was read at", async () => {
  const { asked, reads } = doubled(["Read"]);
  assert.deepEqual(await reads.read(caller, partition, query(bound)), {
    result: "Authorized",
    value: { ...listed, commit: head, directory: "" },
  });
  assert.deepEqual(asked, [
    `landing ${bound}`,
    `binding ${bound}`,
    `head ${bound}`,
    `tree ${bound} ${head} `,
  ]);
});

test("a subdirectory at a commit the reader names is read there, and the head is not asked", async () => {
  const { asked, reads } = doubled(["Read"]);
  const directory = asRepositoryTreeDirectory("shelf/lib");
  assert.deepEqual(
    await reads.read(caller, partition, query(bound, directory, named)),
    {
      result: "Authorized",
      value: { ...listed, commit: named, directory },
    },
  );
  assert.deepEqual(asked, [
    `landing ${bound}`,
    `binding ${bound}`,
    `tree ${bound} ${named} shelf/lib`,
  ]);
});

test("a repository the project does not bind is not found, and nothing is asked of git for it", async () => {
  for (const commit of [undefined, named]) {
    const { asked, reads } = doubled(["Read"]);
    assert.deepEqual(
      await reads.read(
        caller,
        partition,
        query(unbound, repositoryTreeRoot, commit),
      ),
      { result: "NotFound" },
    );
    assert.deepEqual(asked, [`landing ${unbound}`]);
  }
});

test("a repository the project retired is not found, though its binding row stands, and nothing is asked of git for it", async () => {
  for (const commit of [undefined, named]) {
    const { asked, reads } = doubled(["Read"], { retired: bound });
    assert.deepEqual(
      await reads.read(
        caller,
        partition,
        query(bound, repositoryTreeRoot, commit),
      ),
      { result: "NotFound" },
    );
    assert.deepEqual(asked, [`landing ${bound}`]);
  }
});

test("a binding answered for another repository or another project is not taken for the one named", async () => {
  for (const bindingFor of [
    () => binding(bound),
    (repository: RepositoryId) => ({
      ...binding(repository),
      partition: { ...partition, project: asProjectId("other") },
    }),
  ]) {
    const { asked, reads } = doubled(["Read"], { bindingFor });
    assert.deepEqual(await reads.read(caller, partition, query(unbound)), {
      result: "NotFound",
    });
    assert.deepEqual(asked, [`landing ${unbound}`, `binding ${unbound}`]);
  }
});

test("a caller who may not read the project is not found, before any binding is read", async () => {
  for (const access of [[], ["Mutate"], ["Administer", "Execute"]] as const) {
    const { asked, reads } = doubled(access);
    assert.deepEqual(await reads.read(caller, partition, query(bound)), {
      result: "NotFound",
    });
    assert.deepEqual(asked, [], access.join());
  }
});

test("a deployment with no scratch says it cannot read a bound repository, and still refuses an unbound one", async () => {
  const { reads } = doubled(["Read"], { source: "Unconfigured" });
  assert.deepEqual(await reads.read(caller, partition, query(bound)), {
    result: "Authorized",
    value: { read: "Unavailable", unavailable: "Scratch" },
  });
  assert.deepEqual(await reads.read(caller, partition, query(unbound)), {
    result: "NotFound",
  });
});

test("a head that is absent or unavailable is answered as such, and no tree is asked", async () => {
  for (const [answer, value] of [
    [{ read: "Absent" }, { read: "Absent", absent: "Commit" }],
    [
      { read: "Unavailable" },
      { read: "Unavailable", unavailable: "Repository" },
    ],
  ] as const) {
    const { asked, reads } = doubled(["Read"], { head: answer });
    assert.deepEqual(await reads.read(caller, partition, query(bound)), {
      result: "Authorized",
      value,
    });
    assert.deepEqual(asked, [
      `landing ${bound}`,
      `binding ${bound}`,
      `head ${bound}`,
    ]);
  }
});

test("a tree read with no answer is answered which way", async () => {
  for (const [tree, value] of [
    [
      { read: "Absent", absent: "Commit" },
      { read: "Absent", absent: "Commit" },
    ],
    [
      { read: "Absent", absent: "Directory" },
      { read: "Absent", absent: "Directory" },
    ],
    [
      { read: "Unavailable" },
      { read: "Unavailable", unavailable: "Repository" },
    ],
  ] as const) {
    const { reads } = doubled(["Read"], { tree });
    assert.deepEqual(
      await reads.read(
        caller,
        partition,
        query(bound, repositoryTreeRoot, named),
      ),
      { result: "Authorized", value },
    );
  }
});

test("a port answering more entries than one read answers is refused rather than passed on", async () => {
  const entries = Array.from(
    { length: repositoryTreeEntriesAnsweredMax + 1 },
    (_, each) => ({ name: String(each), kind: "Directory" as const }),
  );
  const { reads } = doubled(["Read"], {
    tree: { read: "Listed", entries, truncated: true },
  });
  await assert.rejects(reads.read(caller, partition, query(bound)), RangeError);
});

test("a directory path is the root when empty, and refused where git would read it as anything but one directory", () => {
  assert.equal(asRepositoryTreeDirectory(""), repositoryTreeRoot);
  assert.equal(asRepositoryTreeDirectory("a/b c/d:e"), "a/b c/d:e");
  for (const refused of [
    "/a",
    "a/",
    "a//b",
    ".",
    "a/./b",
    "..",
    "a/../b",
    "a\nb",
    "a\0b",
    "\ud800",
    "a".repeat(repositoryTreeDirectoryCharsMax + 1),
  ])
    assert.throws(
      () => asRepositoryTreeDirectory(refused),
      RangeError,
      JSON.stringify(refused),
    );
});
