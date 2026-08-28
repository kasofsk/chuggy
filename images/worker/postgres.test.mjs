import assert from "node:assert/strict";
import test from "node:test";

import { scopedDatabase } from "./postgres.mjs";

/** One recorded psql call as its statement and the connection it was made on. */
function statements(calls) {
  return calls.map(([, args]) => args[args.indexOf("--command") + 1]);
}

function recording(calls, stdout = "") {
  return async (...args) => {
    calls.push(args);
    return { stdout };
  };
}

test("an attempt gets a role that owns one database on the shared server", async () => {
  const calls = [];
  const url =
    "postgres://chuggy_worker:admin-secret@postgres.invalid:5432/postgres?sslmode=require";
  const environment = {
    CHUG_WORKER_DATABASE_URL: url,
    CHUG_WORKER_DATABASE_SCOPE: "chug_a1b2",
  };
  await scopedDatabase(
    environment.CHUG_WORKER_DATABASE_URL,
    environment.CHUG_WORKER_DATABASE_SCOPE,
    {
      executeFile: recording(calls),
      environment,
      secret: () => "attempt-secret",
    },
  );

  assert.deepEqual(statements(calls), [
    "CREATE ROLE chug_a1b2 LOGIN PASSWORD 'attempt-secret'" +
      " CREATEDB NOSUPERUSER NOCREATEROLE NOREPLICATION NOBYPASSRLS",
    "GRANT chug_a1b2 TO CURRENT_USER WITH SET TRUE",
    "CREATE DATABASE chug_a1b2 OWNER chug_a1b2",
    "REVOKE CONNECT ON DATABASE chug_a1b2 FROM PUBLIC",
  ]);
  assert.deepEqual(calls[0]?.[2]?.env, {
    CHUG_WORKER_DATABASE_URL: url,
    CHUG_WORKER_DATABASE_SCOPE: "chug_a1b2",
    PGHOST: "postgres.invalid",
    PGPORT: "5432",
    PGUSER: "chuggy_worker",
    PGPASSWORD: "admin-secret",
    PGDATABASE: "postgres",
    PGSSLMODE: "require",
  });
  assert.equal(
    environment.CHUG_PG_URL,
    "postgres://chug_a1b2:attempt-secret@postgres.invalid:5432/chug_a1b2?sslmode=require",
  );
  assert.equal(environment.CHUG_PG_WORKERS, "1");
});

test("the shared server's own credential is not left for the agent to read", async () => {
  const environment = {
    CHUG_WORKER_DATABASE_URL:
      "postgres://admin:admin-secret@db.invalid/postgres",
    CHUG_PG_WORKERS: "4",
  };
  await scopedDatabase(environment.CHUG_WORKER_DATABASE_URL, "chug_a1b2", {
    executeFile: recording([]),
    environment,
    secret: () => "attempt-secret",
  });

  assert.equal(environment.CHUG_WORKER_DATABASE_URL, undefined);
  assert.equal(environment.CHUG_PG_WORKERS, "4");
});

test("teardown drops every database the attempt's role owns, and drops it once", async () => {
  const calls = [];
  const drop = await scopedDatabase(
    "postgres://admin:admin-secret@db.invalid/postgres",
    "chug_a1b2",
    {
      executeFile: recording(calls, "chug_a1b2\nchug_a1b2_w1\n"),
      environment: {},
      secret: () => "attempt-secret",
    },
  );
  calls.length = 0;

  await drop();
  await drop();

  assert.deepEqual(statements(calls), [
    "SELECT datname FROM pg_database WHERE pg_get_userbyid(datdba) = 'chug_a1b2'",
    'DROP DATABASE IF EXISTS "chug_a1b2" WITH (FORCE)',
    'DROP DATABASE IF EXISTS "chug_a1b2_w1" WITH (FORCE)',
    "DROP ROLE IF EXISTS chug_a1b2",
  ]);
});

test("a scope that cannot be spelled without quoting is refused rather than escaped", async () => {
  await assert.rejects(
    scopedDatabase("postgres://admin@db.invalid/postgres", 'chug"; DROP', {
      executeFile: recording([]),
      environment: {},
      secret: () => "attempt-secret",
    }),
    /worker database scope/u,
  );
});
