/**
 * What each declared action was reported to have done, against a real server
 * and as the roles that hold the doors: the importer declares, and the API
 * binds, retires and records. The API is granted no read of what it records,
 * so whoever migrated is asked what the relation holds as well as what the
 * catalog says of the door.
 *
 * A REPORT IS RECORDED THROUGH THE STORE. Only the cases about what the door
 * itself refuses, and those that hold a report or an import open, call a door
 * with statements of their own.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresActionObservations } from "../../src/adapters/postgres/actionObservation.ts";
import { postgresProjectRepositoryRetirement } from "../../src/adapters/postgres/repositoryBinding.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import {
  actionObservationRecordFunction,
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
  actionReportDetailCharsMax,
  actionReportLinkCharsMax,
  allActionReportOutcomes,
  isActionReportLink,
} from "../../src/contract/actionReport.ts";
import {
  actionReporterNameCharsMax,
  actionReporterRoster,
  type ActionObservationRecorded,
  type ActionObservationStore,
  type ActionReport,
} from "../../src/interpreter/actionReport.ts";
import {
  asGitObjectId,
  asRepositoryId,
  type RepositoryBinding,
} from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import {
  linkCredentialRead,
  linksWrittenEveryWay,
} from "../contract/actionReportLinkCases.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  postgresHarnessStalled,
  type PostgresHarness,
} from "./harness.ts";
import {
  fixtureBindRepository,
  fixtureBoundRepository,
} from "./repositoryBindingFixture.ts";

let harness: PostgresHarness;
let importerPool: pg.Pool;
let apiPool: pg.Pool;
let observations: ActionObservationStore;
before(async () => {
  harness = await postgresHarnessOpen();
  importerPool = postgresHarnessRolePool(configurationImporterRole);
  apiPool = postgresHarnessRolePool(apiRole);
  observations = postgresActionObservations(apiPool);
});
after(async () => {
  await apiPool.end();
  await importerPool.end();
  await harness.close();
});

const first = asGitObjectId("a".repeat(40));
const second = asGitObjectId("b".repeat(40));
const wide = asGitObjectId("c".repeat(64));
const reporter = "rig-build";

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

/** One call of the import door as the importer, on the connection a case chooses. */
function declaring(
  connection: Pick<pg.Pool, "query">,
  binding: RepositoryBinding,
  actions: readonly string[],
): Promise<pg.QueryResult<{ imported: string }>> {
  return connection.query<{ imported: string }>(
    `SELECT ${repositoryActionImportFunction}($1,$2,$3,$4,$5,$6::text[],$6::text[]) AS imported`,
    [
      binding.partition.tenant,
      binding.partition.project,
      binding.repository,
      binding.recoveryEpoch,
      first,
      [...actions],
    ],
  );
}

/** Replaces what a repository declares with the actions named, and answers the import's outcome. */
async function declared(
  binding: RepositoryBinding,
  actions: readonly string[],
): Promise<string | undefined> {
  return (await declaring(importerPool, binding, actions)).rows[0]?.imported;
}

/** One project with one repository declaring the actions named. */
async function declaringProject(
  label: string,
  actions: readonly string[],
): Promise<RepositoryBinding> {
  const partition = await postgresHarnessProject(harness.store, label);
  const binding = await bound(partition, label);
  assert.equal(await declared(binding, actions), "Imported");
  return binding;
}

/** Another project of the tenant and a project of the same name in another tenant, each with a repository declaring `build`. */
async function namesakes(
  partition: Partition,
  label: string,
): Promise<readonly [Partition, Partition]> {
  const sibling = {
    tenant: partition.tenant,
    project: asProjectId(`${partition.project}-sibling`),
  };
  const namesake = {
    tenant: asTenantId(`${partition.tenant}-namesake`),
    project: partition.project,
  };
  for (const [where, repository] of [
    [sibling, `${label}-sibling`],
    [namesake, `${label}-namesake`],
  ] as const) {
    await harness.store.createProject(where);
    assert.equal(
      await declared(await bound(where, repository), ["build"]),
      "Imported",
    );
  }
  return [sibling, namesake];
}

/** Records one report through a store, the API's unless a case names another, as the reporter a roster names for that action. */
function reported(
  partition: Partition,
  action: string,
  report: ActionReport,
  store: ActionObservationStore = observations,
): Promise<ActionObservationRecorded> {
  const roster = actionReporterRoster(
    JSON.stringify([
      {
        reporter,
        scheme: "BearerSecret",
        secretFile: "/a/file/no/case/reads",
        tenant: partition.tenant,
        project: partition.project,
        actions: [action],
      },
    ]),
  );
  assert.equal(roster.read, "Roster");
  const [claims] = roster.reporters.map((named) => named.claims);
  const [named] = claims?.actions ?? [];
  assert.ok(claims !== undefined && named !== undefined);
  return store.record({
    partition: claims.partition,
    action: named,
    reporter: claims.reporter,
    report,
  });
}

/** What an action's log holds, as whoever migrated reads it: one line per row, in the order recorded. */
async function logged(
  partition: Partition,
  action: string,
): Promise<readonly string[]> {
  const found = await harness.pool.query<{ logged: string }>(
    `SELECT ordinal::text || ' ' || repository_commit || ' ' || outcome AS logged
       FROM action_observation
      WHERE tenant=$1 AND project=$2 AND action=$3 ORDER BY ordinal`,
    [partition.tenant, partition.project, action],
  );
  return found.rows.map((row) => row.logged);
}

test("a report of a declared action is a row holding what was said, and one saying less holds less", async () => {
  const { partition } = await declaringProject("row", ["build"]);
  const began = await harness.pool.query<{ at: Date }>("SELECT now() AS at");

  assert.equal(
    await reported(partition, "build", {
      commit: first,
      outcome: "Succeeded",
      observedAtMs: Date.parse("2026-10-05T22:45:50.250Z"),
      detail: "run chuggy-release-x7k2p",
      link: "https://grafana.example.test/d/release?var-run=x7k2p",
    }),
    "Recorded",
  );
  assert.equal(
    await reported(partition, "build", { commit: wide, outcome: "Failed" }),
    "Recorded",
  );
  const rows = await harness.pool.query(
    `SELECT ordinal::text AS ordinal,repository_commit,outcome,reporter,detail,link,
            to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS') AS observed,
            received_at BETWEEN $3 AND now() AS received
       FROM action_observation
      WHERE tenant=$1 AND project=$2 AND action='build' ORDER BY ordinal`,
    [partition.tenant, partition.project, began.rows[0]?.at],
  );
  assert.deepEqual(rows.rows, [
    {
      ordinal: "1",
      repository_commit: first,
      outcome: "Succeeded",
      reporter,
      detail: "run chuggy-release-x7k2p",
      link: "https://grafana.example.test/d/release?var-run=x7k2p",
      observed: "2026-10-05T22:45:50.250",
      received: true,
    },
    {
      ordinal: "2",
      repository_commit: wide,
      outcome: "Failed",
      reporter,
      detail: null,
      link: null,
      observed: null,
      received: true,
    },
  ]);
});

test("a report repeating the commit and outcome of the action's newest stores nothing, whatever else it says", async () => {
  const { partition } = await declaringProject("repeat", ["build"]);
  assert.equal(
    await reported(partition, "build", { commit: first, outcome: "Succeeded" }),
    "Recorded",
  );

  assert.equal(
    await reported(partition, "build", { commit: first, outcome: "Succeeded" }),
    "Repeated",
  );
  assert.equal(
    await reported(partition, "build", {
      commit: first,
      outcome: "Succeeded",
      observedAtMs: 0,
      detail: "said again",
      link: "https://example.test/again",
    }),
    "Repeated",
  );
  assert.deepEqual(await logged(partition, "build"), [`1 ${first} Succeeded`]);
});

test("a report differing from the newest in its commit or its outcome is a row, and only the newest is weighed", async () => {
  const { partition } = await declaringProject("newest", ["build"]);
  for (const [commit, outcome, recorded] of [
    [first, "Failed", "Recorded"],
    [first, "Succeeded", "Recorded"],
    [first, "Succeeded", "Repeated"],
    [second, "Succeeded", "Recorded"],
    [first, "Failed", "Recorded"],
    [first, "Failed", "Repeated"],
  ] as const)
    assert.equal(
      await reported(partition, "build", { commit, outcome }),
      recorded,
      `${commit} ${outcome}`,
    );
  assert.deepEqual(await logged(partition, "build"), [
    `1 ${first} Failed`,
    `2 ${first} Succeeded`,
    `3 ${second} Succeeded`,
    `4 ${first} Failed`,
  ]);
});

test("each action of a project keeps its own log, numbered from one", async () => {
  const { partition } = await declaringProject("each", ["build", "deploy"]);
  await reported(partition, "build", { commit: first, outcome: "Succeeded" });
  await reported(partition, "build", { commit: second, outcome: "Succeeded" });

  assert.equal(
    await reported(partition, "deploy", {
      commit: second,
      outcome: "Succeeded",
    }),
    "Recorded",
    "the newest of another action is not this one's",
  );
  assert.deepEqual(await logged(partition, "deploy"), [
    `1 ${second} Succeeded`,
  ]);
  assert.deepEqual(await logged(partition, "build"), [
    `1 ${first} Succeeded`,
    `2 ${second} Succeeded`,
  ]);
});

test("an action's log is its project's: its namesake in another project or another tenant repeats nothing of it", async () => {
  const { partition } = await declaringProject("namesake", ["build"]);
  const report = { commit: first, outcome: "Succeeded" } as const;
  assert.equal(await reported(partition, "build", report), "Recorded");

  for (const where of await namesakes(partition, "namesake")) {
    assert.equal(
      await reported(where, "build", report),
      "Recorded",
      `${where.tenant}/${where.project}`,
    );
    assert.deepEqual(await logged(where, "build"), [`1 ${first} Succeeded`]);
  }
  assert.equal(await reported(partition, "build", report), "Repeated");
});

test("an action no repository of the project declares records nothing", async () => {
  const { partition } = await declaringProject("undeclared", ["build"]);
  const sibling = {
    tenant: partition.tenant,
    project: asProjectId(`${partition.project}-sibling`),
  };
  const namesake = {
    tenant: asTenantId(`${partition.tenant}-namesake`),
    project: partition.project,
  };
  await harness.store.createProject(sibling);
  await harness.store.createProject(namesake);
  const nowhere = {
    tenant: partition.tenant,
    project: asProjectId(`${partition.project}-nowhere`),
  };

  for (const [where, action] of [
    [partition, "deploy"],
    [partition, "Build"],
    [sibling, "build"],
    [namesake, "build"],
    [nowhere, "build"],
  ] as const) {
    assert.equal(
      await reported(where, action, { commit: first, outcome: "Succeeded" }),
      "Undeclared",
      `${where.tenant}/${where.project} ${action}`,
    );
    assert.deepEqual(await logged(where, action), []);
  }
  assert.equal(
    await reported(partition, "build", { commit: first, outcome: "Succeeded" }),
    "Recorded",
  );
});

test("a retired binding's actions are no longer declared, and binding the repository again declares them", async () => {
  const partition = await postgresHarnessProject(harness.store, "retired");
  const retired = await bound(partition, "retired-old");
  const live = await bound(partition, "retired-live");
  assert.equal(await declared(retired, ["build"]), "Imported");
  assert.equal(await declared(live, ["test"]), "Imported");
  await reported(partition, "build", { commit: first, outcome: "Succeeded" });

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
    await reported(partition, "build", {
      commit: second,
      outcome: "Succeeded",
    }),
    "Undeclared",
    "the project still binds a repository, and it is not the one that declared this",
  );
  assert.equal(
    await reported(partition, "test", { commit: second, outcome: "Succeeded" }),
    "Recorded",
  );
  assert.deepEqual(
    await logged(partition, "build"),
    [`1 ${first} Succeeded`],
    "what was reported before the retirement stands",
  );

  assert.equal(
    await fixtureBindRepository(
      harness,
      apiPool,
      partition,
      retired.repository,
    ),
    "Bound",
  );
  assert.equal(
    await reported(partition, "build", {
      commit: second,
      outcome: "Succeeded",
    }),
    "Recorded",
  );
  assert.deepEqual(await logged(partition, "build"), [
    `1 ${first} Succeeded`,
    `2 ${second} Succeeded`,
  ]);
});

test("an import replaces what a repository declares over the rows its actions were reported under", async () => {
  const binding = await declaringProject("reimport", ["build", "test"]);
  const { partition } = binding;
  await reported(partition, "build", { commit: first, outcome: "Succeeded" });
  await reported(partition, "test", { commit: first, outcome: "Failed" });

  assert.equal(await declared(binding, ["build", "deploy"]), "Imported");
  assert.equal(
    await reported(partition, "build", {
      commit: second,
      outcome: "Succeeded",
    }),
    "Recorded",
  );
  assert.equal(
    await reported(partition, "test", { commit: second, outcome: "Succeeded" }),
    "Undeclared",
  );
  assert.equal(await declared(binding, []), "Imported");
  assert.equal(
    await reported(partition, "build", { commit: first, outcome: "Failed" }),
    "Undeclared",
  );
  assert.deepEqual(await logged(partition, "build"), [
    `1 ${first} Succeeded`,
    `2 ${second} Succeeded`,
  ]);
  assert.deepEqual(await logged(partition, "test"), [`1 ${first} Failed`]);
});

/** One call of the record door as the API, on the connection a case chooses and with the values it chooses. */
function recording(
  connection: Pick<pg.Pool, "query">,
  partition: Partition,
  action: string | null,
  said: {
    readonly commit?: string | null;
    readonly outcome?: string | null;
    readonly reporter?: string | null;
    readonly detail?: string | null;
    readonly link?: string | null;
  } = {},
): Promise<pg.QueryResult<{ recorded: string }>> {
  return connection.query<{ recorded: string }>(
    `SELECT ${actionObservationRecordFunction}($1,$2,$3,$4,$5,NULL,$6,$7,$8) AS recorded`,
    [
      partition.tenant,
      partition.project,
      action,
      said.commit === undefined ? first : said.commit,
      said.outcome === undefined ? "Succeeded" : said.outcome,
      said.reporter === undefined ? reporter : said.reporter,
      said.detail ?? null,
      said.link ?? null,
    ],
  );
}

/** A transaction left open on a connection of its own once `opened` has run in it, which is what another call waits behind. */
async function heldOpen(
  pool: pg.Pool,
  opened: (client: pg.PoolClient) => Promise<unknown>,
): Promise<() => Promise<void>> {
  const client = await pool.connect();
  const ended = async (statement: "COMMIT" | "ROLLBACK"): Promise<void> => {
    try {
      await client.query(statement);
    } finally {
      client.release();
    }
  };
  try {
    await client.query("BEGIN");
    await opened(client);
  } catch (failure) {
    await ended("ROLLBACK");
    throw failure;
  }
  return () => ended("COMMIT");
}

/** One report recorded by a connection that waits on no lock for longer than a moment, and fails if it would. */
async function recordedUnheld(
  partition: Partition,
  action: string,
  commit: string,
): Promise<string | undefined> {
  const client = await apiPool.connect();
  try {
    await client.query("SET lock_timeout TO '1s'");
    return (await recording(client, partition, action, { commit })).rows[0]
      ?.recorded;
  } finally {
    await client.query("RESET lock_timeout").catch(() => undefined);
    client.release();
  }
}

test("two reports of one action are weighed one after the other, so the second is a repeat and not a second row", async () => {
  const { partition } = await declaringProject("turn", ["build"]);
  const commit = await heldOpen(apiPool, (client) =>
    recording(client, partition, "build"),
  );
  let later: Promise<ActionObservationRecorded>;
  try {
    later = reported(partition, "build", {
      commit: first,
      outcome: "Succeeded",
    });
    await postgresHarnessStalled(harness.pool, 1);
  } finally {
    await commit();
  }

  assert.equal(await later, "Repeated");
  assert.deepEqual(await logged(partition, "build"), [`1 ${first} Succeeded`]);
});

test("two reports of one action that differ are both rows, numbered in the order they were weighed", async () => {
  const { partition } = await declaringProject("order", ["build"]);
  const commit = await heldOpen(apiPool, (client) =>
    recording(client, partition, "build"),
  );
  let later: Promise<ActionObservationRecorded>;
  try {
    later = reported(partition, "build", {
      commit: second,
      outcome: "Succeeded",
    });
    await postgresHarnessStalled(harness.pool, 1);
  } finally {
    await commit();
  }

  assert.equal(await later, "Recorded");
  assert.deepEqual(await logged(partition, "build"), [
    `1 ${first} Succeeded`,
    `2 ${second} Succeeded`,
  ]);
});

test("a report waits behind no report of another action, of another project or of another tenant", async () => {
  const { partition } = await declaringProject("apart", ["build", "deploy"]);
  const [sibling, namesake] = await namesakes(partition, "apart");
  const commit = await heldOpen(apiPool, (client) =>
    recording(client, partition, "build"),
  );
  try {
    assert.equal(await recordedUnheld(partition, "deploy", first), "Recorded");
    assert.equal(await recordedUnheld(sibling, "build", first), "Recorded");
    assert.equal(await recordedUnheld(namesake, "build", first), "Recorded");
  } finally {
    await commit();
  }
});

test("a report arriving while an import replaces the set is weighed against the set as it stood, and waits for nothing", async () => {
  const binding = await declaringProject("replacing", ["build"]);
  const { partition } = binding;
  const commit = await heldOpen(importerPool, (client) =>
    declaring(client, binding, ["build", "deploy"]),
  );
  try {
    assert.equal(await recordedUnheld(partition, "build", first), "Recorded");
    assert.equal(
      await recordedUnheld(partition, "deploy", first),
      "Undeclared",
      "an import that has not committed has declared nothing",
    );
  } finally {
    await commit();
  }
  assert.equal(await recordedUnheld(partition, "deploy", first), "Recorded");
});

test("the door records a row at each bound a report is read under", async () => {
  const { partition } = await declaringProject("at-bound", ["build"]);
  const astral = "\u{1F680}";
  const link = `https://example.test/${"x".repeat(actionReportLinkCharsMax)}`;
  const accepted = [
    { commit: first },
    { commit: wide },
    ...allActionReportOutcomes.map((outcome) => ({ commit: second, outcome })),
    { commit: first, reporter: astral.repeat(actionReporterNameCharsMax) },
    { commit: second, detail: astral.repeat(actionReportDetailCharsMax) },
    { commit: first, link: link.slice(0, actionReportLinkCharsMax) },
    { commit: second, link: "https://example.test/@run?at=@#@" },
    { commit: first, link: "https://x" },
    { commit: second, link: "https://example.test?at=@" },
    { commit: first, link: "https://example.test#@" },
  ];
  for (const said of accepted)
    assert.equal(
      (await recording(apiPool, partition, "build", said)).rows[0]?.recorded,
      "Recorded",
      JSON.stringify(said).slice(0, 80),
    );
  assert.equal((await logged(partition, "build")).length, accepted.length);
});

test("the door refuses each value a row may not hold, by the bound it breaks", async () => {
  const { partition } = await declaringProject("past-bound", ["build"]);
  const link = `https://example.test/${"x".repeat(actionReportLinkCharsMax)}`;
  for (const [said, refused] of [
    [{ commit: "a".repeat(39) }, "commit_is_git_object"],
    [{ commit: "a".repeat(41) }, "commit_is_git_object"],
    [{ commit: "a".repeat(63) }, "commit_is_git_object"],
    [{ commit: "a".repeat(65) }, "commit_is_git_object"],
    [{ commit: "A".repeat(40) }, "commit_is_git_object"],
    [{ commit: "g".repeat(40) }, "commit_is_git_object"],
    [{ commit: `${first}\n` }, "commit_is_git_object"],
    [{ outcome: "RolledBack" }, "outcome_is_known"],
    [{ outcome: "succeeded" }, "outcome_is_known"],
    [{ outcome: "" }, "outcome_is_known"],
    [{ reporter: "" }, "reporter_is_bounded"],
    [
      { reporter: "r".repeat(actionReporterNameCharsMax + 1) },
      "reporter_is_bounded",
    ],
    [{ detail: "" }, "detail_is_bounded"],
    [
      { detail: "d".repeat(actionReportDetailCharsMax + 1) },
      "detail_is_bounded",
    ],
    [{ link: link.slice(0, actionReportLinkCharsMax + 1) }, "link_is_https"],
    [{ link: "http://example.test/" }, "link_is_https"],
    [{ link: "example.test/run" }, "link_is_https"],
    [{ link: "see-https://example.test/" }, "link_is_https"],
    [{ link: "https://" }, "link_is_https"],
    [{ link: "https://example.test/a run" }, "link_is_https"],
    [{ link: "https://example.test/é" }, "link_is_https"],
    [{ link: "https://example.test/\n" }, "link_is_https"],
    [{ link: "https://user@example.test/" }, "link_is_https"],
    [{ link: "https://user:secret@example.test/" }, "link_is_https"],
    [{ link: "https://@example.test/" }, "link_is_https"],
    [{ link: "https:///example.test/" }, "link_is_https"],
    [{ link: "https:///user:secret@example.test/" }, "link_is_https"],
    [{ link: "https://\\/user:secret@example.test/" }, "link_is_https"],
    [{ link: "https://example.test\\run" }, "link_is_https"],
    [{ link: "https://?at=1" }, "link_is_https"],
    [{ link: "https://#top" }, "link_is_https"],
  ] as const)
    await assert.rejects(
      recording(apiPool, partition, "build", said),
      new RegExp(`action_observation_${refused}`, "u"),
      JSON.stringify(said).slice(0, 80),
    );
  for (const said of [{ commit: null }, { outcome: null }, { reporter: null }])
    await assert.rejects(
      recording(apiPool, partition, "build", said),
      /null value in column/u,
      JSON.stringify(said),
    );
  assert.equal(
    (await recording(apiPool, partition, null)).rows[0]?.recorded,
    "Undeclared",
  );
  assert.deepEqual(await logged(partition, "build"), []);
});

/** Which of the links given the relation holds, each tried as a row of its own in a transaction that is rolled back. */
async function linksHeld(
  partition: Partition,
  links: readonly string[],
): Promise<ReadonlySet<string>> {
  const client = await harness.pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `CREATE FUNCTION pg_temp.links_held(in_tenant text, in_project text, in_links text[])
       RETURNS SETOF text LANGUAGE plpgsql AS $$
       DECLARE tried text; at bigint := 0;
       BEGIN
         FOREACH tried IN ARRAY in_links LOOP
           at := at + 1;
           BEGIN
             INSERT INTO action_observation
               (tenant,project,action,ordinal,repository_commit,outcome,reporter,link)
             VALUES(in_tenant,in_project,'build',at,repeat('a',40),'Failed','rig-build',tried);
             RETURN NEXT tried;
           EXCEPTION WHEN check_violation THEN NULL;
           END;
         END LOOP;
       END $$`,
    );
    const held = await client.query<{ held: string }>(
      "SELECT pg_temp.links_held($1,$2,$3) AS held",
      [partition.tenant, partition.project, [...links]],
    );
    return new Set(held.rows.map((row) => row.held));
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    client.release();
  }
}

test("the relation holds every link a report may carry and none that reads as holding a credential, however its host is approached or spelled", async () => {
  const { partition } = await declaringProject("links", ["build"]);
  const held = await linksHeld(partition, linksWrittenEveryWay);
  const carried = linksWrittenEveryWay.filter(isActionReportLink);

  assert.ok(carried.length > 0, "some link written every way is carried");
  assert.deepEqual(
    carried.filter((link) => !held.has(link)),
    [],
    "a link the document admits is one a row holds",
  );
  assert.deepEqual(
    [...held].filter((link) => linkCredentialRead(link) === true),
    [],
    "no row holds a credential",
  );
  assert.deepEqual(await logged(partition, "build"), []);
});

test("behind its door the relation holds one row to an ordinal of an action, and none for a project that is not there", async () => {
  const { partition } = await declaringProject("key", ["build"]);
  await reported(partition, "build", { commit: first, outcome: "Succeeded" });
  const row = (project: string, ordinal: number) =>
    harness.pool.query(
      `INSERT INTO action_observation
         (tenant,project,action,ordinal,repository_commit,outcome,reporter)
       VALUES($1,$2,'build',$3,$4,'Failed',$5)`,
      [partition.tenant, project, ordinal, second, reporter],
    );

  await assert.rejects(row(partition.project, 1), /action_observation_pkey/u);
  await assert.rejects(
    row(`${partition.project}-nowhere`, 1),
    /action_observation_names_a_project/u,
  );
  assert.deepEqual(await logged(partition, "build"), [`1 ${first} Succeeded`]);
});

test("a row is written once: whoever owns the relation neither changes one nor removes one", async () => {
  const { partition } = await declaringProject("once", ["build"]);
  await reported(partition, "build", { commit: first, outcome: "Failed" });
  const row = [partition.tenant, partition.project];

  await assert.rejects(
    harness.pool.query(
      "UPDATE action_observation SET outcome='Succeeded' WHERE tenant=$1 AND project=$2",
      row,
    ),
    /action_observation is written once/u,
  );
  await assert.rejects(
    harness.pool.query(
      "DELETE FROM action_observation WHERE tenant=$1 AND project=$2",
      row,
    ),
    /action_observation is written once/u,
  );
  assert.deepEqual(await logged(partition, "build"), [`1 ${first} Failed`]);
});

test("the door runs as the boundary owner, on a search path it names", async () => {
  assert.deepEqual(
    await harness.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,
              array_to_string(p.proconfig,',') AS settings
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname=$1`,
      [actionObservationRecordFunction],
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

/** Every role a deployment runs as but the one this relation is written by. */
const bystanders = [
  configurationImporterRole,
  ticketServiceRole,
  selectorServiceRole,
  selectorControlRole,
  selectorReviewRole,
  schedulerRole,
  finalizerRole,
  workerPlaneRole,
  poolPlaneRole,
];

test("only the API records and only through the door, and no role reads or writes the relation itself", async () => {
  const { partition } = await declaringProject("privileges", ["build"]);
  const row = `'${partition.tenant}','${partition.project}','build'`;
  const call = `SELECT ${actionObservationRecordFunction}(${row},'${first}','Succeeded',NULL,'${reporter}',NULL,NULL)`;
  const statements = [
    "SELECT action FROM action_observation",
    `INSERT INTO action_observation(tenant,project,action,ordinal,repository_commit,outcome,reporter)
       VALUES(${row},1,'${first}','Succeeded','${reporter}')`,
    "UPDATE action_observation SET outcome='Failed'",
    "DELETE FROM action_observation",
  ];
  const refused = async (role: string, statement: string, object: string) => {
    assert.match(
      (await harness.attemptAs(role, statement)) ?? "",
      postgresHarnessDenial(object),
      `${role}: ${statement}`,
    );
  };

  assert.equal(await harness.attemptAs(apiRole, call), undefined);
  for (const role of bystanders)
    await refused(role, call, actionObservationRecordFunction);
  for (const role of [apiRole, ...bystanders])
    for (const statement of statements)
      await refused(role, statement, "action_observation");
});

test("an answer the door does not give is a failure of the store and never a result", async () => {
  const partition = {
    tenant: asTenantId("acme"),
    project: asProjectId("atlas"),
  };
  for (const rows of [
    [],
    [{ result: null }],
    [{ result: "" }],
    [{ result: "recorded" }],
    [{ result: "Stored" }],
  ])
    await assert.rejects(
      reported(
        partition,
        "build",
        { commit: first, outcome: "Succeeded" },
        postgresActionObservations({
          query: () => Promise.resolve({ rows }),
        } as unknown as pg.Pool),
      ),
      /action observation record returned/u,
      JSON.stringify(rows),
    );
});
