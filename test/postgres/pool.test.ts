/**
 * The pool's bounds, its idle-failure path, and what it plans with.
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
import {
  ticketRunStepFailureFunction,
  ticketRunnerLossFunction,
  ticketUpdatedDependenciesFunction,
} from "../../src/adapters/postgres/schema/shared.ts";
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

test("a pooled connection plans with JIT off", async () => {
  const jit = await admin.query<{ jit: string }>("SHOW jit");
  assert.equal(jit.rows[0]?.jit, "off");
});

test("the functions a ticket read joins per ticket are planned at one row each", async () => {
  const names = [
    ticketRunStepFailureFunction,
    ticketRunnerLossFunction,
    ticketUpdatedDependenciesFunction,
  ];
  const declared = await admin.query<{ name: string; rows: number }>(
    `SELECT proname AS name, prorows::int AS rows FROM pg_proc
      WHERE pronamespace = 'public'::regnamespace AND proname = ANY($1::text[])
      ORDER BY proname`,
    [names],
  );
  assert.deepEqual(
    declared.rows,
    names.map((name) => ({ name, rows: 1 })),
  );
});
