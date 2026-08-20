import type pg from "pg";
import { after, before } from "node:test";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  postgresHarnessOpen,
  postgresHarnessUrl,
  type PostgresHarness,
} from "./harness.ts";

export interface PostgresReadHarness {
  readonly harness: PostgresHarness;
  readonly pool: pg.Pool;
}

export function postgresReadHarness(): PostgresReadHarness {
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

  return {
    get harness() {
      return harness;
    },
    get pool() {
      return pool;
    },
  };
}
