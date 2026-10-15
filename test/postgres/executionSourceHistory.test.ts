import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type pg from "pg";

import { postgresExecutionSourceHistory } from "../../src/adapters/postgres/executionSourceHistory.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { asGitObjectId } from "../../src/interpreter/finalizer.ts";
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
/** A commit two of one ticket's results claim, from these two bases. */
const claimed = "e".repeat(40);
const claimedFrom = ["1".repeat(40), "2".repeat(40)];
/** A commit two results of one set produced from one base, which then changed nothing. */
const repeated = "f".repeat(40);
const repeatedFrom = "3".repeat(40);

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
  await pool.query(`CREATE TEMP TABLE execution_result_source (
    tenant text, project text, manifest text, commit text, base text)`);
  await pool.query(`INSERT INTO execution_request VALUES
    ('tenant','project','old',1,'SpawnWork',1),
    ('tenant','project','latest',1,'SpawnWork',2),
    ('tenant','project','artifacts',2,'SpawnWork',3),
    ('tenant','project','fanned',3,'SpawnWork',4),
    ('tenant','project','repeated',4,'SpawnWork',5)`);
  await pool.query(`INSERT INTO execution VALUES
    ('tenant','project',1,1,'old','manifest-old'),
    ('tenant','project',1,2,'latest','manifest-latest'),
    ('tenant','project',2,3,'artifacts',NULL),
    ('tenant','project',3,4,'fanned','manifest-fanned-one'),
    ('tenant','project',3,5,'fanned','manifest-fanned-two'),
    ('tenant','project',4,6,'repeated','manifest-repeated-one'),
    ('tenant','project',4,7,'repeated','manifest-repeated-two'),
    ('tenant','project',4,8,'repeated','manifest-unchanged'),
    ('other','project',2,3,'artifacts','manifest-elsewhere')`);
  await pool.query(`INSERT INTO execution_result_source VALUES
    ('tenant','project','manifest-old','${latestBase}','${"a".repeat(40)}'),
    ('tenant','project','manifest-latest','${produced}','${latestBase}'),
    ('tenant','project','manifest-fanned-one','${claimed}','${claimedFrom[0]}'),
    ('tenant','project','manifest-fanned-two','${claimed}','${claimedFrom[1]}'),
    ('tenant','project','manifest-repeated-one','${repeated}','${repeatedFrom}'),
    ('tenant','project','manifest-repeated-two','${repeated}','${repeatedFrom}'),
    ('tenant','project','manifest-unchanged','${repeatedFrom}','${repeatedFrom}'),
    ('other','project','manifest-elsewhere','${produced}','${claimed}')`);
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

test("a commit the ticket's work produced answers the commit that work started from", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workResultBases(
      partition,
      1,
      asGitObjectId(produced),
      2,
    ),
    [latestBase],
  );
});

test("a commit two results produced from one base answers that base once", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workResultBases(
      partition,
      4,
      asGitObjectId(repeated),
      2,
    ),
    [repeatedFrom],
  );
});

test("a commit only another ticket's or another tenant's work produced answers nothing", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workResultBases(
      partition,
      2,
      asGitObjectId(produced),
      2,
    ),
    [],
  );
});

/** Catches an unchanged result read as producing its own base, which would walk back to it forever. */
test("a result that produced the commit it started at says nothing of it", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workResultBases(
      partition,
      4,
      asGitObjectId(repeatedFrom),
      2,
    ),
    [],
  );
});

test("a commit no work produced answers nothing", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(pool).workResultBases(
      partition,
      1,
      asGitObjectId("a".repeat(40)),
      2,
    ),
    [],
  );
});

test("a commit two results claim answers each base, as many as asked", async () => {
  const history = postgresExecutionSourceHistory(pool);
  assert.deepEqual(
    await history.workResultBases(partition, 3, asGitObjectId(claimed), 2),
    claimedFrom,
  );
  assert.deepEqual(
    await history.workResultBases(partition, 3, asGitObjectId(claimed), 1),
    claimedFrom.slice(0, 1),
  );
});

test("the ticket service can read where completed work started through its own role", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(ticketServicePool).workResultBases(
      { tenant: asTenantId("absent"), project: asProjectId("absent") },
      1,
      asGitObjectId(produced),
      2,
    ),
    [],
  );
});

test("the ticket service can read completed work source through its own role", async () => {
  assert.deepEqual(
    await postgresExecutionSourceHistory(ticketServicePool).workSource(
      { tenant: asTenantId("absent"), project: asProjectId("absent") },
      1,
    ),
    { manifests: [] },
  );
});
