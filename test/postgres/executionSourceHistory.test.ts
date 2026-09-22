import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresExecutionSourceHistory } from "../../src/adapters/postgres/executionSourceHistory.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessUrl } from "./harness.ts";
import { ticketServiceRole } from "../../src/adapters/postgres/schema.ts";

let pool: pg.Pool;
let ticketServicePool: pg.Pool;

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const latestBase = "b".repeat(40);
const produced = "c".repeat(40);
/** The two references the fixture's rows are keyed by: a dispatch's, and a pass's. */
const dispatched = 9;
const accepted = 11;

before(async () => {
  pool = postgresPool(postgresHarnessUrl(), {
    connectionsMax: 1,
    connectionWaitMs: 5_000,
    statementTimeoutMs: 5_000,
  });
  const ticketServiceUrl = new URL(postgresHarnessUrl());
  ticketServiceUrl.searchParams.set("options", `-c role=${ticketServiceRole}`);
  ticketServicePool = postgresPool(ticketServiceUrl.toString());
  await pool.query(`CREATE TEMP TABLE execution_request (
    tenant text, project text, request text,
    ticket bigint, kind text, authorizing_seq bigint)`);
  await pool.query(`CREATE TEMP TABLE execution (
    tenant text, project text, ticket bigint, task bigint,
    source_request text, result_manifest text)`);
  await pool.query(`CREATE TEMP TABLE ticket_source (
    tenant text, project text, ticket bigint, source bigint,
    repository text, commit text, ref text)`);
  await pool.query(`INSERT INTO execution_request VALUES
    ('tenant','project','old',1,'SpawnWork',1),
    ('tenant','project','latest',1,'SpawnWork',2),
    ('tenant','project','artifacts',2,'SpawnWork',3),
    ('tenant','project','fanned',3,'SpawnWork',4)`);
  await pool.query(`INSERT INTO execution VALUES
    ('tenant','project',1,1,'old','manifest-old'),
    ('tenant','project',1,2,'latest','manifest-latest'),
    ('tenant','project',2,3,'artifacts',NULL),
    ('tenant','project',3,4,'fanned','manifest-fanned-one'),
    ('tenant','project',3,5,'fanned','manifest-fanned-two')`);
  await pool.query(`INSERT INTO ticket_source VALUES
    ('tenant','project',1,${dispatched},'latest-repository','${latestBase}','refs/heads/one'),
    ('tenant','project',1,${accepted},'latest-repository','${produced}',NULL),
    ('tenant','project',2,${dispatched},NULL,NULL,NULL)`);
});

after(async () => {
  await ticketServicePool.end();
  await pool.end();
});

test("evaluation reads the manifests the latest work generation terminalized", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workSource(partition, 1),
    { manifests: ["manifest-latest"] },
  );
});

test("work that terminalized no manifest gathers none", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workSource(partition, 2),
    { manifests: [] },
  );
});

test("a spawn whose executions each reported a manifest is gathered as both", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workSource(partition, 3),
    { manifests: ["manifest-fanned-one", "manifest-fanned-two"] },
  );
});

test("a source is read at the reference the ticket currently carries", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).ticketSource(
      partition,
      1,
      accepted,
    ),
    { repository: "latest-repository", commit: produced },
  );
});

test("a ticket dispatched at no repository keeps a source row and names nothing", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).ticketSource(
      partition,
      2,
      dispatched,
    ),
    {},
  );
});

test("a reference no row of the ticket carries is read as no source at all", async () => {
  assert.equal(
    await postgresExecutionSourceHistory(pool).ticketSource(partition, 1, 7),
    undefined,
  );
});

test("the ticket service can observe completed work source through its own role", async () => {
  assert.equal(
    await postgresExecutionSourceHistory(ticketServicePool).workSource(
      { tenant: asTenantId("absent"), project: asProjectId("absent") },
      1,
    ),
    undefined,
  );
});
