/**
 * A repository's landing default against a real server: the column, the
 * narrowed immutability trigger, the fenced write, and the listing that
 * answers what a project's bindings land by.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresProjectRepositoryBindings,
  postgresProjectRepositoryLanding,
  postgresRepositoryBinding,
} from "../../src/adapters/postgres/repositoryBinding.ts";
import { apiRole } from "../../src/adapters/postgres/schema/shared.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import { checkedRepositoryBindingCommand } from "../../src/interpreter/repositoryBinding.ts";
import {
  postgresHarnessEpoch,
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

/** Long enough for a second writer to reach the door and be held at the lock the first took. */
const contenderWaitMs = 500;

/** A pool whose every query runs on the one client a case is holding a transaction open on. */
function clientPool(client: pg.PoolClient): pg.Pool {
  return {
    query: (...parameters: readonly unknown[]) =>
      (
        client.query as unknown as (
          ...args: readonly unknown[]
        ) => Promise<unknown>
      )(...parameters),
  } as unknown as pg.Pool;
}

interface FixtureBinding {
  readonly partition: Partition;
  readonly repository: string;
}

/** A project holding one binding, made through the door every other case reads. */
async function fixture(label: string): Promise<FixtureBinding> {
  return fixtureAt(postgresHarnessPartition(label), label);
}

/** The same, at a partition the caller named, so a case can hold the tenant fixed. */
async function fixtureAt(
  partition: Partition,
  label: string,
): Promise<FixtureBinding> {
  await harness.store.createProject(partition);
  return bindAt(partition, label);
}

/** One more repository bound into a project that already exists. */
async function bindAt(
  partition: Partition,
  label: string,
): Promise<FixtureBinding> {
  const recoveryEpoch = await postgresHarnessEpoch(harness.store);
  const repository = `repository-${label}-${randomUUID()}`;
  assert.equal(
    await postgresRepositoryBinding(pool).bind(
      checkedRepositoryBindingCommand({
        tenant: partition.tenant,
        project: partition.project,
        repository,
        recoveryEpoch,
        operation: `operation-${randomUUID()}`,
        authorityKind: "Administrator",
        authoritySubject: "test-operator",
      }),
    ),
    "Bound",
  );
  return { partition, repository };
}

function landingStore() {
  return postgresProjectRepositoryLanding(pool);
}

test("a repository binds landing where its work happened until a write moves it", async () => {
  const bound = await fixture("landing-default");
  assert.deepEqual(
    (
      await landingStore().landing(
        bound.partition,
        asRepositoryId(bound.repository),
      )
    )?.landing,
    { mode: "Push" },
  );
});

test("a write against the landing that stands moves it and answers the row", async () => {
  const bound = await fixture("landing-written");
  const written = await landingStore().setLanding({
    partition: bound.partition,
    repository: asRepositoryId(bound.repository),
    expected: { mode: "Push" },
    landing: { mode: "PullRequest" },
  });
  assert.equal(written.outcome, "Written");
  assert.deepEqual(
    written.outcome === "Written" ? written.binding.landing : undefined,
    { mode: "PullRequest" },
  );
  assert.deepEqual(
    (
      await landingStore().landing(
        bound.partition,
        asRepositoryId(bound.repository),
      )
    )?.landing,
    { mode: "PullRequest" },
  );
});

test("a repeat of a write that already landed is not a crossing", async () => {
  const bound = await fixture("landing-idempotent");
  const command = {
    partition: bound.partition,
    repository: asRepositoryId(bound.repository),
    expected: { mode: "Push" } as const,
    landing: { mode: "PullRequest" } as const,
  };
  assert.equal((await landingStore().setLanding(command)).outcome, "Written");
  assert.equal((await landingStore().setLanding(command)).outcome, "Written");
});

test("a write against a landing that moved answers the row that stands", async () => {
  const bound = await fixture("landing-moved");
  assert.equal(
    (
      await landingStore().setLanding({
        partition: bound.partition,
        repository: asRepositoryId(bound.repository),
        expected: { mode: "Push" },
        landing: { mode: "PullRequest" },
      })
    ).outcome,
    "Written",
  );
  const crossed = await landingStore().setLanding({
    partition: bound.partition,
    repository: asRepositoryId(bound.repository),
    expected: { mode: "PullRequest" },
    landing: { mode: "Push" },
  });
  assert.equal(crossed.outcome, "Written");
  const stale = await landingStore().setLanding({
    partition: bound.partition,
    repository: asRepositoryId(bound.repository),
    expected: { mode: "PullRequest" },
    landing: { mode: "PullRequest" },
  });
  assert.equal(stale.outcome, "LandingMoved");
  assert.deepEqual(
    stale.outcome === "LandingMoved" ? stale.binding.landing : undefined,
    { mode: "Push" },
  );
});

test("a repository this project does not bind is not bound", async () => {
  const bound = await fixture("landing-not-bound");
  assert.deepEqual(
    await landingStore().setLanding({
      partition: bound.partition,
      repository: asRepositoryId(`repository-absent-${randomUUID()}`),
      expected: { mode: "Push" },
      landing: { mode: "PullRequest" },
    }),
    { outcome: "NotBound" },
  );
  assert.equal(
    await landingStore().landing(
      bound.partition,
      asRepositoryId(`repository-absent-${randomUUID()}`),
    ),
    undefined,
  );
});

/**
 * Two projects of one tenant. The tenant is held fixed on purpose: a door
 * fenced on the tenant alone would answer either project's binding to the
 * other, and a case whose projects were in different tenants would not see it.
 */
test("a binding another project holds is not this project's to move", async () => {
  const tenant = asTenantId(`tenant-landing-peers-${randomUUID()}`);
  const mine = await fixtureAt(
    { tenant, project: asProjectId(`project-mine-${randomUUID()}`) },
    "landing-partition-mine",
  );
  const theirs = await fixtureAt(
    { tenant, project: asProjectId(`project-theirs-${randomUUID()}`) },
    "landing-partition-theirs",
  );
  assert.deepEqual(
    await landingStore().setLanding({
      partition: mine.partition,
      repository: asRepositoryId(theirs.repository),
      expected: { mode: "Push" },
      landing: { mode: "PullRequest" },
    }),
    { outcome: "NotBound" },
  );
  assert.equal(
    await landingStore().landing(
      mine.partition,
      asRepositoryId(theirs.repository),
    ),
    undefined,
    "nor is it this project's to read",
  );
});

test("moving one binding's landing leaves the project's others where they were", async () => {
  const moved = await fixture("landing-sibling-moved");
  const stands = await bindAt(moved.partition, "landing-sibling-stands");
  assert.equal(
    (
      await landingStore().setLanding({
        partition: moved.partition,
        repository: asRepositoryId(moved.repository),
        expected: { mode: "Push" },
        landing: { mode: "PullRequest" },
      })
    ).outcome,
    "Written",
  );
  assert.deepEqual(
    (
      await landingStore().landing(
        moved.partition,
        asRepositoryId(stands.repository),
      )
    )?.landing,
    { mode: "Push" },
  );
});

test("the listing answers what each of a project's bindings lands by", async () => {
  const bound = await fixture("landing-listed");
  assert.equal(
    (
      await landingStore().setLanding({
        partition: bound.partition,
        repository: asRepositoryId(bound.repository),
        expected: { mode: "Push" },
        landing: { mode: "PullRequest" },
      })
    ).outcome,
    "Written",
  );
  const listed = await postgresProjectRepositoryBindings(pool).bindings(
    bound.partition,
  );
  assert.deepEqual(
    listed.map((row) => [String(row.repository), row.landing.mode]),
    [[bound.repository, "PullRequest"]],
  );
});

test("a binding's landing is the one column an update may move", async () => {
  const bound = await fixture("landing-trigger");
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE project_repository SET bound_at=bound_at+interval '1 second'
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        [bound.partition.tenant, bound.partition.project, bound.repository],
      ),
    /repository bindings are immutable/u,
  );
  await assert.rejects(
    () =>
      harness.query(
        `DELETE FROM project_repository
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        [bound.partition.tenant, bound.partition.project, bound.repository],
      ),
    /repository bindings are immutable/u,
  );
  await harness.query(
    `UPDATE project_repository SET landing_mode='PullRequest'
      WHERE tenant=$1 AND project=$2 AND repository=$3`,
    [bound.partition.tenant, bound.partition.project, bound.repository],
  );
  assert.deepEqual(
    (
      await landingStore().landing(
        bound.partition,
        asRepositoryId(bound.repository),
      )
    )?.landing,
    { mode: "PullRequest" },
  );
});

test("a landing no roster names is refused by the row's own constraint", async () => {
  const bound = await fixture("landing-roster");
  await assert.rejects(
    () =>
      harness.query(
        `UPDATE project_repository SET landing_mode='Merge'
          WHERE tenant=$1 AND project=$2 AND repository=$3`,
        [bound.partition.tenant, bound.partition.project, bound.repository],
      ),
    /project_repository_landing_mode_is_known/u,
  );
});

/**
 * Two writers reaching for one binding. The second is held at the row lock the
 * first took, so it decides against what the first wrote rather than against
 * what it read before the first ran.
 */
test("a second writer decides against the landing the first left, not the one it read", async () => {
  const bound = await fixture("landing-row-lock");
  const rolePool = postgresHarnessRolePool(apiRole);
  const holder = await rolePool.connect();
  try {
    await holder.query("BEGIN");
    assert.equal(
      (
        await postgresProjectRepositoryLanding(clientPool(holder)).setLanding({
          partition: bound.partition,
          repository: asRepositoryId(bound.repository),
          expected: { mode: "Push" },
          landing: { mode: "PullRequest" },
        })
      ).outcome,
      "Written",
    );
    let settled = false;
    const waiting = landingStore()
      .setLanding({
        partition: bound.partition,
        repository: asRepositoryId(bound.repository),
        expected: { mode: "Push" },
        landing: { mode: "Push" },
      })
      .then((outcome) => {
        settled = true;
        return outcome;
      });
    await delay(contenderWaitMs);
    assert.equal(settled, false);
    await holder.query("COMMIT");
    assert.equal((await waiting).outcome, "LandingMoved");
  } finally {
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await rolePool.end();
  }
});

test("a write that gives up waiting says so rather than reading as a fault", async () => {
  const bound = await fixture("landing-contended");
  const rolePool = postgresHarnessRolePool(apiRole);
  const holder = await rolePool.connect();
  const impatient = await rolePool.connect();
  try {
    await holder.query("BEGIN");
    await postgresProjectRepositoryLanding(clientPool(holder)).setLanding({
      partition: bound.partition,
      repository: asRepositoryId(bound.repository),
      expected: { mode: "Push" },
      landing: { mode: "PullRequest" },
    });
    await impatient.query("SET statement_timeout='200ms'");
    assert.deepEqual(
      await postgresProjectRepositoryLanding(clientPool(impatient)).setLanding({
        partition: bound.partition,
        repository: asRepositoryId(bound.repository),
        expected: { mode: "Push" },
        landing: { mode: "Push" },
      }),
      { outcome: "Unavailable" },
    );
  } finally {
    await impatient
      .query("SET statement_timeout=DEFAULT")
      .catch(() => undefined);
    impatient.release();
    await holder.query("ROLLBACK").catch(() => undefined);
    holder.release();
    await rolePool.end();
  }
});

test("a project with no binding at all lists nothing", async () => {
  const partition: Partition = {
    tenant: asTenantId(`tenant-landing-empty-${randomUUID()}`),
    project: asProjectId("project"),
  };
  await harness.store.createProject(partition);
  assert.deepEqual(
    await postgresProjectRepositoryBindings(pool).bindings(partition),
    [],
  );
});
