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

/**
 * What in a statement correlates a subquery or a function on an outer row's
 * partition rather than binding it from parameters: PostgreSQL runs such a
 * subquery again for each outer row, which the partition alone bounds. A
 * join's own condition is not one.
 */
export function postgresStatementCorrelated(text: string): readonly string[] {
  const unjoined = text.replace(
    /\bON\s+(\w+)\.tenant=(\w+)\.tenant\s+AND\s+\1\.project=\2\.project\b/gu,
    "",
  );
  return (
    unjoined.match(
      /\b\w+\.(?:tenant|project)\s*=\s*\w+\.(?:tenant|project)\b|\(\s*\w+\.tenant\s*,\s*\w+\.project\b/gu,
    ) ?? []
  );
}
