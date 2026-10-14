/**
 * A retired binding against a real server: the column, the widened
 * immutability trigger, the one-way door, the two elections that stop seeing
 * a retired row while every read that names one still answers it, the
 * repository a retirement releases to any other project, and the member mint
 * and member import that stop answering it.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresProjectRepositoryBindings,
  postgresProjectRepositoryLanding,
  postgresProjectRepositoryRetirement,
  postgresRepositoryBindingListing,
} from "../../src/adapters/postgres/repositoryBinding.ts";
import { postgresProjectRepositoryBinding } from "../../src/adapters/postgres/repositoryConfiguration.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import {
  composeForgeCredentialMinting,
  composeNativeWeb,
} from "../../src/compose.ts";
import {
  asGitObjectId,
  asRepositoryId,
} from "../../src/interpreter/finalizer.ts";
import { asForgeInstallationToken } from "../../src/interpreter/forgeInstallation.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
} from "../../src/interpreter/projectAccess.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { repositoryBindingsPerImportMax } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  fixtureBindRepository,
  fixtureBoundRepository,
} from "./repositoryBindingFixture.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";
import {
  postgresHarnessConfiguration,
  postgresHarnessEpoch,
  postgresHarnessKeying,
  postgresHarnessOpen,
  postgresHarnessPartition,
  postgresHarnessRolePool,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let pool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  pool = postgresPool(postgresHarnessUrl());
});
after(async () => {
  await pool.end();
  await harness.close();
});

/** A project, made once, that a case binds into. */
async function fixtureProject(
  label: string,
  partition = postgresHarnessPartition(label),
): Promise<Partition> {
  await harness.store.createProject(partition);
  return partition;
}

/** Every project's binding of one repository, oldest first, as its project and whether it is retired. */
async function fixtureHolders(
  repository: string,
): Promise<readonly (readonly [string, boolean])[]> {
  return (
    await harness.query(
      `SELECT project, retired_at IS NOT NULL AS retired FROM project_repository
        WHERE repository=$1 ORDER BY bound_at, tenant, project`,
      [repository],
    )
  ).map((row) => [String(row["project"]), row["retired"] === true] as const);
}

async function bindAt(partition: Partition, label: string): Promise<string> {
  return fixtureBoundRepository(harness, pool, partition, label);
}

function retirementStore() {
  return postgresProjectRepositoryRetirement(pool);
}

async function rebind(partition: Partition, repository: string) {
  return fixtureBindRepository(harness, pool, partition, repository);
}

async function retire(partition: Partition, repository: string) {
  return retirementStore().retire({
    partition,
    repository: asRepositoryId(repository),
  });
}

/**
 * The election session placement makes. The older binding is the one a caller
 * naming no repository is answered with until it is retired, and naming it
 * still answers it afterwards, because a released ticket's brief names a
 * repository by identity and does not stop being able to resolve it.
 */
test("a caller naming no repository is answered the oldest LIVE binding", async () => {
  const partition = await fixtureProject("retire-election");
  const older = await bindAt(partition, "retire-election-older");
  const newer = await bindAt(partition, "retire-election-newer");
  const bindings = postgresProjectRepositoryBinding(pool);
  assert.equal((await bindings.binding(partition))?.repository, older);

  assert.equal((await retire(partition, older)).outcome, "Retired");

  assert.equal((await bindings.binding(partition))?.repository, newer);
  assert.equal(
    (await bindings.binding(partition, asRepositoryId(older)))?.repository,
    older,
  );
});

test("a project whose every binding is retired elects none", async () => {
  const partition = await fixtureProject("retire-election-empty");
  const only = await bindAt(partition, "retire-election-only");
  assert.equal((await retire(partition, only)).outcome, "Retired");
  assert.equal(
    await postgresProjectRepositoryBinding(pool).binding(partition),
    undefined,
  );
});

/**
 * The importer's estate listing, which is the other read that names no
 * repository. A retired binding names a remote nobody serves, so a run that
 * kept asking it would fail on that binding every pass.
 */
test("the estate listing the importer runs over passes a retired binding over", async () => {
  const partition = await fixtureProject("retire-estate");
  const retired = await bindAt(partition, "retire-estate-retired");
  const live = await bindAt(partition, "retire-estate-live");
  assert.equal((await retire(partition, retired)).outcome, "Retired");
  const listed = await postgresRepositoryBindingListing(pool).bindings(
    repositoryBindingsPerImportMax,
  );
  const named = listed.map((bound) => String(bound.repository));
  assert.equal(named.includes(live), true);
  assert.equal(named.includes(retired), false);
});

test("a repeat of a retirement keeps the instant the first one wrote", async () => {
  const partition = await fixtureProject("retire-idempotent");
  const repository = await bindAt(partition, "retire-idempotent");
  const first = await retire(partition, repository);
  const again = await retire(partition, repository);
  assert.equal(first.outcome, "Retired");
  assert.equal(again.outcome, "Retired");
  assert.equal(
    again.outcome === "Retired" ? again.binding.retiredAt : undefined,
    first.outcome === "Retired" ? first.binding.retiredAt : "absent",
  );
});

test("the doors that answer a whole binding answer its retirement", async () => {
  const partition = await fixtureProject("retire-answered");
  const repository = await bindAt(partition, "retire-answered");
  assert.equal(
    (
      await postgresProjectRepositoryLanding(pool).landing(
        partition,
        asRepositoryId(repository),
      )
    )?.retiredAt,
    undefined,
  );
  const retired = await retire(partition, repository);
  const at = retired.outcome === "Retired" ? retired.binding.retiredAt : "none";
  assert.equal(typeof at, "string");
  assert.equal(
    (
      await postgresProjectRepositoryLanding(pool).landing(
        partition,
        asRepositoryId(repository),
      )
    )?.retiredAt,
    at,
  );
  assert.deepEqual(
    (await postgresProjectRepositoryBindings(pool).bindings(partition)).map(
      (bound) => [String(bound.repository), bound.retiredAt],
    ),
    [[repository, at]],
  );
});

test("retiring one binding leaves the project's others live", async () => {
  const partition = await fixtureProject("retire-sibling");
  const retired = await bindAt(partition, "retire-sibling-retired");
  const stands = await bindAt(partition, "retire-sibling-stands");
  assert.equal((await retire(partition, retired)).outcome, "Retired");
  assert.equal(
    (
      await postgresProjectRepositoryLanding(pool).landing(
        partition,
        asRepositoryId(stands),
      )
    )?.retiredAt,
    undefined,
  );
});

test("a repository this project does not bind is not this project's to retire", async () => {
  const mine = await fixtureProject("retire-absent");
  const theirs = await fixtureProject("retire-absent-peer");
  const held = await bindAt(theirs, "retire-absent-peer");
  assert.deepEqual(await retire(mine, `repository-absent-${randomUUID()}`), {
    outcome: "NotBound",
  });
  assert.deepEqual(await retire(mine, held), { outcome: "NotBound" });
});

/**
 * The trigger 090 narrowed to one column now stands at two, retirement being a
 * column an administrator owns like the landing, with a door each way: the
 * retirement door sets it and a re-bind clears it. Every other column is still
 * nobody's, and the row is still nobody's to delete.
 */
test("a retirement is the second column an update may move, and nothing else is", async () => {
  const partition = await fixtureProject("retire-trigger");
  const repository = await bindAt(partition, "retire-trigger");
  const where = [partition.tenant, partition.project, repository];
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE project_repository SET repository=repository||'-moved'
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        where,
      ),
    /repository bindings are immutable/u,
  );
  await assert.rejects(
    () =>
      harness.query(
        `DELETE FROM project_repository
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        where,
      ),
    /repository bindings are immutable/u,
  );
  await harness.query(
    `UPDATE project_repository SET retired_at=now()
      WHERE tenant=$1 AND project=$2 AND repository=$3`,
    where,
  );
  assert.notEqual(
    (
      await postgresProjectRepositoryLanding(pool).landing(
        partition,
        asRepositoryId(repository),
      )
    )?.retiredAt,
    undefined,
  );
  await harness.query(
    `UPDATE project_repository SET retired_at=NULL
      WHERE tenant=$1 AND project=$2 AND repository=$3`,
    where,
  );
  assert.equal(
    (
      await postgresProjectRepositoryLanding(pool).landing(
        partition,
        asRepositoryId(repository),
      )
    )?.retiredAt,
    undefined,
  );
});

/**
 * Reinstatement, which is what makes a mistyped retirement recoverable: a bind
 * of a live binding has nothing to do and says so, and a bind of a retired one
 * clears the retirement and answers as the fresh bind it is, leaving the row
 * that stood — same identity, same instant.
 */
test("binding a retired repository again reinstates it and answers as a bind", async () => {
  const partition = await fixtureProject("retire-reinstate");
  const repository = await bindAt(partition, "retire-reinstate");
  const named = asRepositoryId(repository);
  const landing = postgresProjectRepositoryLanding(pool);
  const boundAt = (await landing.landing(partition, named))?.boundAt;
  assert.equal(await rebind(partition, repository), "AlreadyBound");

  assert.equal((await retire(partition, repository)).outcome, "Retired");
  assert.equal(
    await postgresProjectRepositoryBinding(pool).binding(partition),
    undefined,
  );

  assert.equal(await rebind(partition, repository), "Bound");
  assert.equal((await landing.landing(partition, named))?.retiredAt, undefined);
  assert.equal((await landing.landing(partition, named))?.boundAt, boundAt);
  assert.equal(
    (await postgresProjectRepositoryBinding(pool).binding(partition))
      ?.repository,
    repository,
  );
  assert.equal(await rebind(partition, repository), "AlreadyBound");
});

/**
 * The route's role reaches the retirement through the door, which is what every
 * other write against this table already goes through. The repository named is
 * one nothing binds, so the call proves the grant without retiring anything.
 */
test("the API's own role holds the retirement door", async () => {
  const partition = await fixtureProject("retire-privilege");
  assert.equal(
    await harness.attemptAs(
      apiRole,
      `SELECT outcome FROM retire_project_repository(
         '${partition.tenant}','${partition.project}',
         'repository-retire-privilege-unbound')`,
    ),
    undefined,
  );
});

/**
 * Retirement releases the repository: a project binding it while another holds
 * it live is refused, and once that one retires it the bind is a fresh one.
 * Both kinds of other project are walked, a sibling in the tenant and a
 * stranger outside it, and the importer's listing names the live one alone.
 */
test("a repository one project retired is bound by another, in its tenant or another", async () => {
  const tenant = asTenantId(`tenant-release-${randomUUID()}`);
  const first = await fixtureProject("release-first", {
    tenant,
    project: asProjectId(`project-release-first-${randomUUID()}`),
  });
  const sibling = await fixtureProject("release-sibling", {
    tenant,
    project: asProjectId(`project-release-sibling-${randomUUID()}`),
  });
  const stranger = await fixtureProject("release-stranger");
  const repository = await bindAt(first, "release");
  assert.equal(await rebind(sibling, repository), "RepositoryBoundElsewhere");

  assert.equal((await retire(first, repository)).outcome, "Retired");
  assert.equal(await rebind(sibling, repository), "Bound");
  assert.equal(await rebind(stranger, repository), "RepositoryBoundElsewhere");

  assert.equal((await retire(sibling, repository)).outcome, "Retired");
  assert.equal(await rebind(stranger, repository), "Bound");
  assert.deepEqual(await fixtureHolders(repository), [
    [first.project, true],
    [sibling.project, true],
    [stranger.project, false],
  ]);
  const listed = await postgresRepositoryBindingListing(pool).bindings(
    repositoryBindingsPerImportMax,
  );
  assert.deepEqual(
    listed
      .filter((bound) => String(bound.repository) === repository)
      .map((bound) => bound.partition),
    [stranger],
  );
});

test("a project that retired a repository another project now holds is refused it and stays retired", async () => {
  const mine = await fixtureProject("release-reclaim-mine");
  const theirs = await fixtureProject("release-reclaim-theirs");
  const repository = await bindAt(mine, "release-reclaim");
  assert.equal((await retire(mine, repository)).outcome, "Retired");
  assert.equal(await rebind(theirs, repository), "Bound");

  assert.equal(await rebind(mine, repository), "RepositoryBoundElsewhere");
  assert.deepEqual(await fixtureHolders(repository), [
    [mine.project, true],
    [theirs.project, false],
  ]);
});

test("a project reinstates its retired binding once the project that bound the repository since has retired it", async () => {
  const mine = await fixtureProject("release-return-mine");
  const theirs = await fixtureProject("release-return-theirs");
  const repository = await bindAt(mine, "release-return");
  const named = asRepositoryId(repository);
  const landing = postgresProjectRepositoryLanding(pool);
  const boundAt = (await landing.landing(mine, named))?.boundAt;
  assert.equal((await retire(mine, repository)).outcome, "Retired");
  assert.equal(await rebind(theirs, repository), "Bound");
  assert.equal((await retire(theirs, repository)).outcome, "Retired");

  assert.equal(await rebind(mine, repository), "Bound");
  assert.equal((await landing.landing(mine, named))?.boundAt, boundAt);
  assert.deepEqual(await fixtureHolders(repository), [
    [mine.project, false],
    [theirs.project, true],
  ]);
  assert.equal(await rebind(theirs, repository), "RepositoryBoundElsewhere");
});

/** A member every question of standing is answered for, so a case turns on the binding alone. */
const fixtureMember: ProjectAccess = {
  authorize: (principal) => Promise.resolve(memberAuthority(principal)),
  authorizeTenant: () => Promise.resolve(undefined),
  authorizeSite: projectAccessSiteRefused,
};

/**
 * The member mint as the API composes it, under the API's own role: a project
 * that retired a repository is answered as one that never bound it, and stays
 * so once another project binds it, which mints for that project alone.
 */
test("the member mint refuses a repository its project retired, and after another binds it", async () => {
  const mine = await fixtureProject("release-mint-mine");
  const theirs = await fixtureProject("release-mint-theirs");
  const repository = await bindAt(mine, "release-mint");
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    const minting = composeForgeCredentialMinting(asApi, fixtureMember, {
      token: () =>
        Promise.resolve({
          minted: "Token",
          token: asForgeInstallationToken("ghs-release-mint"),
          expiresAtMs: 1_000,
        }),
    });
    const minted = async (partition: Partition) =>
      (
        await minting.mint(asPrincipal("release-mint"), partition, {
          repository: asRepositoryId(repository),
          permissions: "write",
        })
      ).result;
    assert.equal(await minted(mine), "Authorized");
    assert.equal((await retire(mine, repository)).outcome, "Retired");
    assert.equal(await minted(mine), "NotFound");
    assert.equal(await rebind(theirs, repository), "Bound");
    assert.deepEqual(
      [await minted(mine), await minted(theirs)],
      ["NotFound", "Authorized"],
    );
  } finally {
    await asApi.end();
  }
});

/**
 * The member import as the API composes it, under the API's own role and over a
 * repository holding one declaration: a project that retired the repository is
 * answered as one that never bound it, and stays so once another project binds
 * it, which imports from it.
 */
test("the member import refuses a repository its project retired, and after another binds it", async () => {
  const mine = await fixtureProject("release-import-mine");
  const theirs = await fixtureProject("release-import-theirs");
  const repository = await bindAt(mine, "release-import");
  const asApi = postgresHarnessRolePool(apiRole);
  try {
    const web = composeNativeWeb(
      asApi,
      postgresHarnessKeying(),
      fixtureMember,
      postgresExecutionBacklogGuard(asApi),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        snapshot: () =>
          Promise.resolve({
            read: "Snapshot",
            files: [
              {
                path: [".chug", "configurations", "work.json"].join("/"),
                kind: "File",
                content: JSON.stringify({
                  version: 1,
                  name: "work",
                  configuration: JSON.parse(
                    postgresHarnessConfiguration,
                  ) as unknown,
                }),
              },
            ],
          }),
      },
    );
    const imported = async (partition: Partition) =>
      (
        await web.importRepositoryConfigurations(
          asPrincipal("release-import"),
          partition,
          {
            repository: asRepositoryId(repository),
            commit: asGitObjectId("c".repeat(40)),
          },
        )
      ).result;
    assert.equal(await imported(mine), "Imported");
    assert.equal((await retire(mine, repository)).outcome, "Retired");
    assert.equal(await imported(mine), "RepositoryAbsent");
    assert.equal(await rebind(theirs, repository), "Bound");
    assert.deepEqual(
      [await imported(mine), await imported(theirs)],
      ["RepositoryAbsent", "Imported"],
    );
  } finally {
    await asApi.end();
  }
});

/**
 * The rule the door asks is the schema's own, so a writer that skips the door
 * meets it too. A second live binding, and a retired one cleared beside a live
 * one, are refused only while the index stands; a live binding beside retired
 * ones is admitted only while it is partial.
 */
test("the schema holds one live binding of a repository beside any number of retired ones", async () => {
  const first = await fixtureProject("release-schema-first");
  const second = await fixtureProject("release-schema-second");
  const third = await fixtureProject("release-schema-third");
  const repository = `repository-release-schema-${randomUUID()}`;
  const epoch = await postgresHarnessEpoch(harness.store);
  const bound = (partition: Partition, retired: boolean) =>
    harness.query(
      `INSERT INTO project_repository
         (tenant,project,repository,recovery_epoch,retired_at)
       VALUES ($1,$2,$3,$4,CASE WHEN $5::boolean THEN now() END)`,
      [partition.tenant, partition.project, repository, epoch, retired],
    );
  const where = (partition: Partition) => [
    partition.tenant,
    partition.project,
    repository,
  ];

  await bound(first, false);
  await assert.rejects(
    () => bound(second, false),
    /project_repository_one_live/u,
  );
  await bound(second, true);
  await harness.query(
    `UPDATE project_repository SET retired_at=now()
      WHERE tenant=$1 AND project=$2 AND repository=$3`,
    where(first),
  );
  await bound(third, false);
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE project_repository SET retired_at=NULL
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        where(second),
      ),
    /project_repository_one_live/u,
  );
  assert.deepEqual(await fixtureHolders(repository), [
    [first.project, true],
    [second.project, true],
    [third.project, false],
  ]);
});
