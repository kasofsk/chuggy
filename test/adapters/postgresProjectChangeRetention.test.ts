import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresProjectChangeRetention } from "../../src/adapters/postgres/projectChangeRetention.ts";

test("the PostgreSQL adapter calls the bounded historical sweep", async () => {
  const calls: {
    readonly text: string;
    readonly values?: readonly unknown[];
  }[] = [];
  const pool = {
    query: (query: {
      readonly text: string;
      readonly values?: readonly unknown[];
    }) => {
      calls.push(query);
      return Promise.resolve({ rows: [{ removed: "17" }] });
    },
  } as unknown as pg.Pool;

  assert.equal(await postgresProjectChangeRetention(pool).sweep(23), 17);
  assert.match(calls[0]?.text ?? "", /sweep_project_change/u);
  assert.deepEqual(calls[0]?.values, [23]);
});

test("a sweep reporting no row count is an empty maintenance pass", async () => {
  const pool = {
    query: () => Promise.resolve({ rows: [{ removed: null }] }),
  } as unknown as pg.Pool;
  assert.equal(await postgresProjectChangeRetention(pool).sweep(1), 0);
});
