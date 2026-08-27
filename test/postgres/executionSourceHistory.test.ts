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
const oldBase = "a".repeat(40);
const latestBase = "b".repeat(40);
const produced = "c".repeat(40);
const alsoProduced = "d".repeat(40);

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
    tenant text, project text, request text, input_bundle text,
    ticket bigint, kind text, authorizing_seq bigint)`);
  await pool.query(`CREATE TEMP TABLE input_bundle_reference (
    tenant text, project text, bundle text, reference_kind text, reference_id text)`);
  await pool.query(`CREATE TEMP TABLE execution (
    tenant text, project text, ticket bigint, task bigint,
    source_request text, result_manifest text)`);
  await pool.query(`CREATE TEMP TABLE execution_result_source (
    tenant text, project text, manifest text, commit text)`);
  await pool.query(`INSERT INTO execution_request VALUES
    ('tenant','project','old','old-bundle',1,'SpawnWork',1),
    ('tenant','project','latest','latest-bundle',1,'SpawnWork',2),
    ('tenant','project','artifacts','artifacts-bundle',2,'SpawnWork',3),
    ('tenant','project','fanned','fanned-bundle',3,'SpawnWork',4)`);
  await pool.query(`INSERT INTO input_bundle_reference VALUES
    ('tenant','project','old-bundle','Repository','old-repository'),
    ('tenant','project','old-bundle','TargetCommit','${oldBase}'),
    ('tenant','project','latest-bundle','Repository','latest-repository'),
    ('tenant','project','latest-bundle','TargetCommit','${latestBase}'),
    ('tenant','project','artifacts-bundle','Repository','artifact-repository'),
    ('tenant','project','artifacts-bundle','TargetCommit','${latestBase}'),
    ('tenant','project','fanned-bundle','Repository','fanned-repository'),
    ('tenant','project','fanned-bundle','TargetCommit','${latestBase}')`);
  await pool.query(`INSERT INTO execution VALUES
    ('tenant','project',1,1,'old','manifest-old'),
    ('tenant','project',1,2,'latest','manifest-latest'),
    ('tenant','project',2,3,'artifacts','manifest-artifacts'),
    ('tenant','project',3,4,'fanned','manifest-fanned-one'),
    ('tenant','project',3,5,'fanned','manifest-fanned-two')`);
  await pool.query(`INSERT INTO execution_result_source VALUES
    ('tenant','project','manifest-old','${oldBase}'),
    ('tenant','project','manifest-latest','${produced}'),
    ('tenant','project','manifest-fanned-one','${produced}'),
    ('tenant','project','manifest-fanned-two','${alsoProduced}')`);
});

after(async () => {
  await ticketServicePool.end();
  await pool.end();
});

test("evaluation reads the commit the latest work generation produced", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workSource(partition, 1),
    {
      repository: "latest-repository",
      base: latestBase,
      declared: [produced],
      manifests: ["manifest-latest"],
    },
  );
});

test("work that handed off artifacts declares no commit and keeps its base", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workSource(partition, 2),
    {
      repository: "artifact-repository",
      base: latestBase,
      declared: [],
      manifests: ["manifest-artifacts"],
    },
  );
});

test("a spawn whose executions declared two commits is gathered as two", async () => {
  const work = await postgresExecutionSourceHistory(pool).workSource(
    partition,
    3,
  );
  assert.deepEqual(work?.declared, [produced, alsoProduced]);
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
