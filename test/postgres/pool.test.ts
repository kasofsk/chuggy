/**
 * The pool's bounds and its idle-failure path.
 *
 * A POOLED CONNECTION STAYS ATTACHED TO A LIVE BACKEND, so terminating that
 * backend raises an error on a client nobody is using. With no listener on the
 * pool `pg` turns that into an uncaught exception; the assertion here is that
 * the failure arrives at a handler instead, and that the suite is still
 * running afterwards to make it.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import {
  postgresLimitsDefault,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import { postgresHarnessUrl } from "./harness.ts";

let admin: pg.Pool;

before(() => {
  admin = postgresPool(postgresHarnessUrl());
});

after(async () => {
  await admin.end();
});

test("an idle client's failure reaches the handler instead of ending the process", async () => {
  let report: (failure: Error) => void = () => undefined;
  const failed = new Promise<Error>((seen) => {
    report = seen;
  });
  const subject = postgresPool(
    postgresHarnessUrl(),
    postgresLimitsDefault,
    report,
  );

  const client = await subject.connect();
  const pid = (
    await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
  ).rows[0]?.pid;
  client.release();
  assert.ok(pid !== undefined);

  await admin.query("SELECT pg_terminate_backend($1)", [pid]);

  assert.ok((await failed) instanceof Error);
  await subject.end();
});

test("the pool bounds the wait for a connection as well as the wait for an answer", async () => {
  const oneConnection = postgresPool(postgresHarnessUrl(), {
    connectionsMax: 1,
    connectionWaitMs: 250,
    statementTimeoutMs: postgresLimitsDefault.statementTimeoutMs,
  });
  const held = await oneConnection.connect();
  try {
    await assert.rejects(() => oneConnection.connect(), /timeout/i);
  } finally {
    held.release();
    await oneConnection.end();
  }
});
