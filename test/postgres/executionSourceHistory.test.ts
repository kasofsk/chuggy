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
  await pool.query(`INSERT INTO execution_request VALUES
    ('tenant','project','old','old-bundle',1,'SpawnWork',1),
    ('tenant','project','latest','latest-bundle',1,'SpawnWork',2)`);
  await pool.query(`INSERT INTO input_bundle_reference VALUES
    ('tenant','project','old-bundle','Repository','old-repository'),
    ('tenant','project','old-bundle','TargetCommit','${"a".repeat(40)}'),
    ('tenant','project','latest-bundle','Repository','latest-repository'),
    ('tenant','project','latest-bundle','TargetCommit','${"b".repeat(40)}')`);
  await pool.query(`INSERT INTO execution VALUES
    ('tenant','project',1,1,'old','manifest-old'),
    ('tenant','project',1,2,'latest','manifest-latest')`);
});

after(async () => {
  await ticketServicePool.end();
  await pool.end();
});

test("evaluation reads only the latest work generation's source and manifests", async () => {
  const source = await postgresExecutionSourceHistory(pool).workSource(
    { tenant: asTenantId("tenant"), project: asProjectId("project") },
    1,
  );
  assert.deepEqual(source, {
    repository: "latest-repository",
    target: { commit: "b".repeat(40) },
    manifests: ["manifest-latest"],
  });
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
