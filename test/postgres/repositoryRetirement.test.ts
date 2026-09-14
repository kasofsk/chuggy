/**
 * A retired binding against a real server: the column, the widened
 * immutability trigger, the one-way door, and the two elections that stop
 * seeing a retired row while every read that names one still answers it.
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
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { repositoryBindingsPerImportMax } from "../../src/interpreter/repositoryConfiguration.ts";
import {
  fixtureBindRepository,
  fixtureBoundRepository,
} from "./repositoryBindingFixture.ts";
import {
  postgresHarnessOpen,
  postgresHarnessPartition,
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
async function fixtureProject(label: string): Promise<Partition> {
  const partition = postgresHarnessPartition(label);
  await harness.store.createProject(partition);
  return partition;
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
 * The route's role reaches the retirement through the door and not the
 * relation, which is what every other write against this table already holds
 * to. The repository named is one nothing binds, so the call proves the grant
 * without retiring anything.
 */
test("the API retires through the door and still cannot reach the relation", async () => {
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
