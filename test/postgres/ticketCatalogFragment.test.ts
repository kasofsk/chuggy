import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";
import { postgresTicketCatalogFragments } from "../../src/adapters/postgres/ticketCatalogFragment.ts";
import {
  apiRole,
  ticketServiceRole,
} from "../../src/adapters/postgres/schema/shared.ts";
import { ticketCatalogDocumentBytesMax } from "../../src/interpreter/ticketCatalog.ts";
import {
  postgresHarnessDenial,
  postgresHarnessOpen,
  postgresHarnessProject,
  postgresHarnessRolePool,
  type PostgresHarness,
} from "./harness.ts";

let harness: PostgresHarness;
let writerPool: pg.Pool;
before(async () => {
  harness = await postgresHarnessOpen();
  writerPool = postgresHarnessRolePool(apiRole);
});
after(async () => {
  await writerPool.end();
  await harness.close();
});

function fragments() {
  return postgresTicketCatalogFragments(writerPool);
}

test("a fragment is written, read back, listed and removed by reference", async () => {
  const partition = await postgresHarnessProject(harness.store, "fragment");
  const store = fragments();
  await store.write(partition, "workloads/work.yaml", "prompt: one\n");
  await store.write(partition, "evaluators/ci.yaml", "prompt: two\n");
  assert.deepEqual(await store.paths(partition), [
    "evaluators/ci.yaml",
    "workloads/work.yaml",
  ]);
  assert.equal(
    await store.read(partition, "workloads/work.yaml"),
    "prompt: one\n",
  );
  assert.equal(await store.read(partition, "workloads/absent.yaml"), undefined);
  assert.equal(await store.remove(partition, "workloads/work.yaml"), true);
  assert.equal(await store.remove(partition, "workloads/work.yaml"), false);
  assert.deepEqual(await store.paths(partition), ["evaluators/ci.yaml"]);
});

test("writing the same reference twice replaces its content", async () => {
  const partition = await postgresHarnessProject(harness.store, "replace");
  const store = fragments();
  await store.write(partition, "workloads/work.yaml", "prompt: one\n");
  await store.write(partition, "workloads/work.yaml", "prompt: two\n");
  assert.deepEqual(await store.paths(partition), ["workloads/work.yaml"]);
  assert.equal(
    await store.read(partition, "workloads/work.yaml"),
    "prompt: two\n",
  );
});

test("one project's fragments are invisible to another", async () => {
  const mine = await postgresHarnessProject(harness.store, "mine");
  const theirs = await postgresHarnessProject(harness.store, "theirs");
  const store = fragments();
  await store.write(mine, "workloads/work.yaml", "prompt: mine\n");
  assert.deepEqual(await store.paths(theirs), []);
  assert.equal(await store.read(theirs, "workloads/work.yaml"), undefined);
});

test("the server bounds the content the merged view will serve", async () => {
  const partition = await postgresHarnessProject(harness.store, "bounded");
  await assert.rejects(
    () =>
      harness.query(
        "INSERT INTO ticket_machine_catalog_fragment(tenant,project,path,content) VALUES($1,$2,$3,$4)",
        [
          partition.tenant,
          partition.project,
          "workloads/work.yaml",
          "y".repeat(ticketCatalogDocumentBytesMax + 1),
        ],
      ),
    /check constraint/u,
  );
});

test("a fragment names a project that exists, and the ticket service only reads", async () => {
  const partition = await postgresHarnessProject(harness.store, "bound");
  await assert.rejects(
    () =>
      harness.query(
        "INSERT INTO ticket_machine_catalog_fragment(tenant,project,path,content) VALUES($1,$2,$3,$4)",
        [partition.tenant, "no-such-project", "workloads/work.yaml", "a: b\n"],
      ),
    /foreign key constraint/u,
  );
  const reader = postgresHarnessRolePool(ticketServiceRole);
  try {
    await reader.query(
      "SELECT path FROM ticket_machine_catalog_fragment WHERE tenant=$1",
      [partition.tenant],
    );
    await assert.rejects(
      () =>
        reader.query(
          "INSERT INTO ticket_machine_catalog_fragment(tenant,project,path,content) VALUES($1,$2,$3,$4)",
          [
            partition.tenant,
            partition.project,
            "workloads/work.yaml",
            "a: b\n",
          ],
        ),
      postgresHarnessDenial("ticket_machine_catalog_fragment"),
    );
  } finally {
    await reader.end();
  }
});

test("a reference no catalog serves never reaches the server", async () => {
  const partition = await postgresHarnessProject(harness.store, "denied");
  const store = fragments();
  await assert.rejects(
    () => store.write(partition, "secrets/deploy.yaml", "token: leaked\n"),
    /never served/u,
  );
  await assert.rejects(
    () => store.read(partition, "../escape.yaml"),
    /normalized/u,
  );
});
