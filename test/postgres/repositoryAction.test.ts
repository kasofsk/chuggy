/**
 * What each bound repository's newest imported head declares, against a real
 * server and as the roles that hold the doors: the importer imports, and the
 * API binds, retires and reads. Whoever migrated is asked only what the
 * catalog says of the door and what the relation holds behind it.
 *
 * A SET IS READ BEFORE IT IS STORED. A case hands the import the files of a
 * tree, so a row asserted here is one the document reader let through. Only
 * the cases about what the door itself refuses, and the two that hold an
 * import open, call the door with arrays of their own.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresRepositoryActions } from "../../src/adapters/postgres/repositoryAction.ts";
import {
  postgresProjectRepositoryRetirement,
  postgresRepositoryBindingListing,
} from "../../src/adapters/postgres/repositoryBinding.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  apiRole,
  boundaryOwnerRole,
  configurationImporterRole,
  finalizerRole,
  poolPlaneRole,
  repositoryActionImportFunction,
  schedulerRole,
  selectorControlRole,
  selectorReviewRole,
  selectorServiceRole,
  ticketServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  actionIdentityCharsMax,
  actionNameCharsMax,
} from "../../src/contract/actionDocument.ts";
import {
  asGitObjectId,
  asRepositoryId,
  type GitObjectId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  importRepositoryActions,
  repositoryActionRoot,
  type RepositoryActionImportOutcome,
  type RepositoryActionStore,
} from "../../src/interpreter/repositoryAction.ts";
import { repositoryBindingsPerImportMax } from "../../src/interpreter/repositoryConfiguration.ts";
import { repositoryDeclarationsMax } from "../../src/interpreter/repositoryDeclaration.ts";
import {
  postgresHarnessDenial,
  postgresHarnessNewEpoch,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessStalled,
  type PostgresHarness,
} from "./harness.ts";
import { fixtureBoundRepository } from "./repositoryBindingFixture.ts";

let harness: PostgresHarness;
let importerPool: pg.Pool;
let apiPool: pg.Pool;
let store: RepositoryActionStore;
before(async () => {
  harness = await postgresHarnessOpen();
  importerPool = postgresHarnessRolePool(configurationImporterRole);
  apiPool = postgresHarnessRolePool(apiRole);
  store = postgresRepositoryActions(importerPool);
});
after(async () => {
  await apiPool.end();
  await importerPool.end();
  await harness.close();
});

const first = asGitObjectId("a".repeat(40));
const second = asGitObjectId("b".repeat(40));

/** One repository bound through the API's door and read back as the importer reads it. */
async function bound(
  partition: Partition,
  label: string,
): Promise<RepositoryBinding> {
  const repository = asRepositoryId(
    await fixtureBoundRepository(harness, apiPool, partition, label),
  );
  const binding = await postgresProjectRepositoryBinding(importerPool).binding(
    partition,
    repository,
  );
  assert.ok(binding !== undefined, "the importer reads the binding it imports");
  return binding;
}

/** A tree's action directory holding one document per identity, each named as given. */
function tree(actions: Readonly<Record<string, string>>) {
  return Object.entries(actions).map(([action, name]) => ({
    path: `${repositoryActionRoot}${action}.json`,
    kind: "File" as const,
    content: JSON.stringify({ version: 1, action, name }),
  }));
}

/** Imports what a tree holding those files declares at one commit, through the reader and the store. */
function imported(
  binding: RepositoryBinding,
  commit: GitObjectId,
  files: ReturnType<typeof tree>,
): Promise<RepositoryActionImportOutcome> {
  return importRepositoryActions({
    binding,
    commit,
    ports: {
      actionSnapshots: {
        actionSnapshot: () => Promise.resolve({ read: "Snapshot", files }),
      },
      actionStore: store,
    },
  });
}

/** What a project declares, as the API reads it: one line per action, in identity order. */
async function declared(partition: Partition): Promise<readonly string[]> {
  const found = await apiPool.query<{ declared: string }>(
    `SELECT action || ' "' || name || '" ' || repository || ' ' || repository_commit
              AS declared
       FROM repository_action
      WHERE tenant=$1 AND project=$2 ORDER BY action COLLATE "C"`,
    [partition.tenant, partition.project],
  );
  return found.rows.map((row) => row.declared);
}

function line(
  binding: RepositoryBinding,
  commit: GitObjectId,
  action: string,
  name: string,
): string {
  return `${action} "${name}" ${binding.repository} ${commit}`;
}

test("an import replaces what a repository declared, whole", async () => {
  const partition = await postgresHarnessProject(harness.store, "replace");
  const binding = await bound(partition, "replace");
  assert.deepEqual(
    await imported(
      binding,
      first,
      tree({ build: "Build", deploy: "Deploy to staging" }),
    ),
    { result: "Imported", declarations: 2 },
  );
  assert.deepEqual(await declared(partition), [
    line(binding, first, "build", "Build"),
    line(binding, first, "deploy", "Deploy to staging"),
  ]);

  assert.deepEqual(
    await imported(
      binding,
      second,
      tree({ build: "Build the image", publish: "Publish" }),
    ),
    { result: "Imported", declarations: 2 },
  );
  assert.deepEqual(await declared(partition), [
    line(binding, second, "build", "Build the image"),
    line(binding, second, "publish", "Publish"),
  ]);
});

test("a document a head no longer holds is no longer declared, down to none", async () => {
  const partition = await postgresHarnessProject(harness.store, "removal");
  const binding = await bound(partition, "removal");
  await imported(binding, first, tree({ build: "Build", deploy: "Deploy" }));

  await imported(binding, second, tree({ deploy: "Deploy" }));
  assert.deepEqual(await declared(partition), [
    line(binding, second, "deploy", "Deploy"),
  ]);

  assert.deepEqual(await imported(binding, first, tree({})), {
    result: "Imported",
    declarations: 0,
  });
  assert.deepEqual(await declared(partition), []);
});

test("an identity another repository of the project holds refuses the import whole, and the holder's rows stand", async () => {
  const partition = await postgresHarnessProject(harness.store, "conflict");
  const holder = await bound(partition, "conflict-holder");
  const other = await bound(partition, "conflict-other");
  await imported(other, first, tree({ lint: "Lint" }));
  await imported(holder, first, tree({ build: "Build", test: "Test" }));
  const standing = [
    line(holder, first, "build", "Build"),
    line(other, first, "lint", "Lint"),
    line(holder, first, "test", "Test"),
  ];

  assert.deepEqual(
    await imported(
      other,
      second,
      tree({ format: "Format", build: "Build elsewhere" }),
    ),
    { result: "IdentityConflict" },
  );
  assert.deepEqual(
    await declared(partition),
    standing,
    "the refused set stored none of its own and removed none it replaced",
  );
});

test("a commit with a refused document changes nothing", async () => {
  const partition = await postgresHarnessProject(harness.store, "not-ready");
  const binding = await bound(partition, "not-ready");
  await imported(binding, first, tree({ build: "Build" }));

  const outcome = await imported(binding, second, [
    ...tree({ deploy: "Deploy" }),
    {
      path: `${repositoryActionRoot}broken.json`,
      kind: "File" as const,
      content: "{",
    },
  ]);
  assert.deepEqual(outcome, {
    result: "DeclarationsRefused",
    faults: [
      {
        path: `${repositoryActionRoot}broken.json`,
        fault: "DocumentUnreadable",
      },
    ],
  });
  assert.deepEqual(await declared(partition), [
    line(binding, first, "build", "Build"),
  ]);
});

test("two repositories of one project each hold their own set", async () => {
  const partition = await postgresHarnessProject(harness.store, "siblings");
  const engine = await bound(partition, "siblings-engine");
  const console = await bound(partition, "siblings-console");
  await imported(engine, first, tree({ build: "Build the engine" }));
  await imported(console, first, tree({ deploy: "Deploy the console" }));

  await imported(engine, second, tree({ package: "Package the engine" }));
  assert.deepEqual(await declared(partition), [
    line(console, first, "deploy", "Deploy the console"),
    line(engine, second, "package", "Package the engine"),
  ]);
});

test("two projects of one tenant each declare one identity, and neither's import touches the other's", async () => {
  const atlas = await postgresHarnessProject(harness.store, "atlas");
  const beacon = { ...atlas, project: asProjectId(`${atlas.project}-beacon`) };
  await harness.store.createProject(beacon);
  const atlasBinding = await bound(atlas, "atlas");
  const beaconBinding = await bound(beacon, "beacon");

  assert.deepEqual(
    await imported(atlasBinding, first, tree({ build: "Build atlas" })),
    { result: "Imported", declarations: 1 },
  );
  assert.deepEqual(
    await imported(beaconBinding, second, tree({ build: "Build beacon" })),
    { result: "Imported", declarations: 1 },
  );
  assert.deepEqual(await declared(atlas), [
    line(atlasBinding, first, "build", "Build atlas"),
  ]);
  assert.deepEqual(await declared(beacon), [
    line(beaconBinding, second, "build", "Build beacon"),
  ]);

  await imported(atlasBinding, second, tree({}));
  assert.deepEqual(await declared(atlas), []);
  assert.deepEqual(await declared(beacon), [
    line(beaconBinding, second, "build", "Build beacon"),
  ]);
});

test("an identity is compared as written, so two that differ by case are two", async () => {
  const partition = await postgresHarnessProject(harness.store, "case");
  const lower = await bound(partition, "case-lower");
  const upper = await bound(partition, "case-upper");
  await imported(lower, first, tree({ build: "Build" }));

  assert.deepEqual(await imported(upper, first, tree({ Build: "Build" })), {
    result: "Imported",
    declarations: 1,
  });
  assert.deepEqual(await declared(partition), [
    line(upper, first, "Build", "Build"),
    line(lower, first, "build", "Build"),
  ]);
});

/** An import left open on a connection of its own, which is what another import of the project waits behind. */
async function importHeldOpen(
  binding: RepositoryBinding,
  commit: GitObjectId,
  actions: readonly string[],
): Promise<() => Promise<void>> {
  const client = await importerPool.connect();
  const ended = async (statement: "COMMIT" | "ROLLBACK"): Promise<void> => {
    try {
      await client.query(statement);
    } finally {
      client.release();
    }
  };
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT ${repositoryActionImportFunction}($1,$2,$3,$4,$5,$6::text[],$6::text[])`,
      [
        binding.partition.tenant,
        binding.partition.project,
        binding.repository,
        binding.recoveryEpoch,
        commit,
        [...actions],
      ],
    );
  } catch (failure) {
    await ended("ROLLBACK");
    throw failure;
  }
  return () => ended("COMMIT");
}

test("two imports of one repository leave the later one's set and never a union", async () => {
  const partition = await postgresHarnessProject(harness.store, "concurrent");
  const binding = await bound(partition, "concurrent");
  const commit = await importHeldOpen(binding, first, ["build", "test"]);
  let later: Promise<RepositoryActionImportOutcome>;
  try {
    later = imported(binding, second, tree({ deploy: "Deploy" }));
    await postgresHarnessStalled(harness.pool, 1);
  } finally {
    await commit();
  }

  assert.deepEqual(await later, { result: "Imported", declarations: 1 });
  assert.deepEqual(await declared(partition), [
    line(binding, second, "deploy", "Deploy"),
  ]);
});

test("two repositories racing for one identity are decided in turn: the second is refused, not failed", async () => {
  const partition = await postgresHarnessProject(harness.store, "race");
  const winner = await bound(partition, "race-winner");
  const loser = await bound(partition, "race-loser");
  const commit = await importHeldOpen(winner, first, ["build"]);
  let later: Promise<RepositoryActionImportOutcome>;
  try {
    later = imported(loser, first, tree({ build: "Build" }));
    await postgresHarnessStalled(harness.pool, 1);
  } finally {
    await commit();
  }

  assert.deepEqual(await later, { result: "IdentityConflict" });
  assert.deepEqual(await declared(partition), [
    line(winner, first, "build", "build"),
  ]);
});

test("a binding that is not the one that stands changes nothing", async () => {
  const partition = await postgresHarnessProject(harness.store, "stale");
  const elsewhere = await postgresHarnessProject(harness.store, "stale-else");
  const binding = await bound(partition, "stale");
  await imported(binding, first, tree({ build: "Build" }));

  for (const stale of [
    { ...binding, recoveryEpoch: postgresHarnessNewEpoch() },
    { ...binding, partition: elsewhere },
    { ...binding, repository: asRepositoryId("repository-nobody-bound") },
  ])
    assert.deepEqual(
      await imported(stale, second, tree({ deploy: "Deploy" })),
      { result: "StaleBinding" },
    );
  assert.deepEqual(await declared(partition), [
    line(binding, first, "build", "Build"),
  ]);
  assert.deepEqual(await declared(elsewhere), []);
});

test("a retired binding's identity is a live repository's to take, and the rest of what it declared stays", async () => {
  const partition = await postgresHarnessProject(harness.store, "retired");
  const retired = await bound(partition, "retired-old");
  const live = await bound(partition, "retired-new");
  await imported(retired, first, tree({ build: "Build", test: "Test" }));
  assert.deepEqual(await imported(live, first, tree({ build: "Build" })), {
    result: "IdentityConflict",
  });

  assert.equal(
    (
      await postgresProjectRepositoryRetirement(apiPool).retire({
        partition,
        repository: retired.repository,
      })
    ).outcome,
    "Retired",
  );
  assert.equal(
    (
      await postgresRepositoryBindingListing(importerPool).bindings(
        repositoryBindingsPerImportMax,
      )
    ).some((listed) => listed.repository === retired.repository),
    false,
    "the importer never reads the retired repository again to release it",
  );
  assert.deepEqual(await imported(live, second, tree({ build: "Build" })), {
    result: "Imported",
    declarations: 1,
  });
  assert.deepEqual(await declared(partition), [
    line(live, second, "build", "Build"),
    line(retired, first, "test", "Test"),
  ]);
});

/** One call of the door as the importer, with the arrays a case chooses. */
function door(
  binding: RepositoryBinding,
  commit: string,
  actions: readonly string[] | null,
  names: readonly string[] | null,
): Promise<unknown> {
  return importerPool.query(
    `SELECT ${repositoryActionImportFunction}($1,$2,$3,$4,$5,$6::text[],$7::text[])`,
    [
      binding.partition.tenant,
      binding.partition.project,
      binding.repository,
      binding.recoveryEpoch,
      commit,
      actions,
      names,
    ],
  );
}

test("the door takes as many declarations as one read does and no more, each with its name", async () => {
  const partition = await postgresHarnessProject(harness.store, "bound");
  const binding = await bound(partition, "bound");
  const actions = (count: number) =>
    Array.from({ length: count }, (_, index) => `action-${String(index)}`);

  const atBound = actions(repositoryDeclarationsMax);
  await door(binding, first, atBound, atBound);
  assert.equal((await declared(partition)).length, repositoryDeclarationsMax);

  const past = actions(repositoryDeclarationsMax + 1);
  await assert.rejects(door(binding, first, past, past), /an import names/u);
  await assert.rejects(
    door(binding, first, ["build", "deploy"], ["Build"]),
    /an import names/u,
  );
  assert.equal((await declared(partition)).length, repositoryDeclarationsMax);
});

test("a set that is no array is refused, and is not the set of none", async () => {
  const partition = await postgresHarnessProject(harness.store, "no-set");
  const binding = await bound(partition, "no-set");
  await imported(binding, first, tree({ build: "Build" }));

  await assert.rejects(door(binding, second, null, null), /an import names/u);
  assert.deepEqual(await declared(partition), [
    line(binding, first, "build", "Build"),
  ]);
});

test("a row holds an identity, a name and a commit to the bounds a document is read under", async () => {
  const partition = await postgresHarnessProject(harness.store, "row");
  const binding = await bound(partition, "row");
  const identity = "a".repeat(actionIdentityCharsMax);
  const name = "\u{1F680}".repeat(actionNameCharsMax);
  await door(binding, first, [identity], [name]);
  assert.deepEqual(await declared(partition), [
    line(binding, first, identity, name),
  ]);

  for (const [actions, names, commit, refused] of [
    [[`${identity}a`], ["Build"], first, "identity_is_bounded"],
    [["-build"], ["Build"], first, "identity_is_bounded"],
    [["build"], [`${name}\u{1F680}`], first, "name_is_bounded"],
    [["build"], [""], first, "name_is_bounded"],
    [["build"], ["Build"], "main", "commit_is_git_object"],
  ] as const)
    await assert.rejects(
      door(binding, commit, actions, names),
      new RegExp(`repository_action_${refused}`, "u"),
    );
  assert.deepEqual(await declared(partition), [
    line(binding, first, identity, name),
  ]);
});

/** Every role a deployment runs as but the two this relation is for. */
test("behind its door the relation holds one row to an identity within a project, and none for a repository not bound there", async () => {
  const partition = await postgresHarnessProject(harness.store, "key");
  const holder = await bound(partition, "key-holder");
  const other = await bound(partition, "key-other");
  await imported(holder, first, tree({ build: "Build" }));
  const row = (action: string, repository: string) =>
    harness.pool.query(
      `INSERT INTO repository_action(tenant,project,action,name,repository,repository_commit)
         VALUES($1,$2,$3,'Build',$4,$5)`,
      [partition.tenant, partition.project, action, repository, first],
    );

  await assert.rejects(
    row("build", other.repository),
    /repository_action_pkey/u,
  );
  await assert.rejects(
    row("deploy", "repository-nobody-bound"),
    /repository_action_repository_is_bound/u,
  );
  assert.deepEqual(await declared(partition), [
    line(holder, first, "build", "Build"),
  ]);
});

test("the door runs as the boundary owner, on a search path it names", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,
              array_to_string(p.proconfig,',') AS settings
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [repositoryActionImportFunction],
    ),
    [
      {
        owner: boundaryOwnerRole,
        definer: true,
        settings: "search_path=pg_catalog, public, pg_temp",
      },
    ],
  );
});

const bystanders = [
  ticketServiceRole,
  selectorServiceRole,
  selectorControlRole,
  selectorReviewRole,
  schedulerRole,
  finalizerRole,
  workerPlaneRole,
  poolPlaneRole,
];

test("only the importer imports and only through the door, and only the API reads what is declared", async () => {
  const partition = await postgresHarnessProject(harness.store, "privileges");
  const binding = await bound(partition, "privileges");
  const row = `'${partition.tenant}','${partition.project}','${binding.repository}'`;
  const call = `SELECT ${repositoryActionImportFunction}(${row},'${binding.recoveryEpoch}','${first}',ARRAY['build'],ARRAY['Build'])`;
  const read = "SELECT action FROM repository_action";
  const writes = [
    `INSERT INTO repository_action(tenant,project,repository,action,name,repository_commit)
       VALUES(${row},'build','Build','${first}')`,
    "UPDATE repository_action SET name='changed'",
    "DELETE FROM repository_action",
  ];
  const refused = async (role: string, statement: string, object: string) => {
    assert.match(
      (await harness.attemptAs(role, statement)) ?? "",
      postgresHarnessDenial(object),
      `${role}: ${statement}`,
    );
  };

  assert.equal(
    await harness.attemptAs(configurationImporterRole, call),
    undefined,
  );
  assert.equal(await harness.attemptAs(apiRole, read), undefined);
  for (const role of [apiRole, ...bystanders])
    await refused(role, call, repositoryActionImportFunction);
  for (const role of [configurationImporterRole, ...bystanders])
    await refused(role, read, "repository_action");
  for (const role of [apiRole, configurationImporterRole, ...bystanders])
    for (const write of writes) await refused(role, write, "repository_action");
});
