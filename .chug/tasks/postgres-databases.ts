import pg from "pg";

import {
  postgresMigrate,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";

function databaseName(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error(`unsafe database name: ${value}`);
  }
  return value;
}

function databaseUrl(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

async function createDatabase(
  base: string,
  database: string,
  template?: string,
): Promise<void> {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  try {
    const suffix =
      template === undefined ? "" : ` TEMPLATE ${databaseName(template)}`;
    await admin.query(`CREATE DATABASE ${databaseName(database)}${suffix}`);
  } finally {
    await admin.end();
  }
}

async function prepare(base: string, template: string): Promise<void> {
  await createDatabase(base, template);
  const pool = postgresPool(databaseUrl(base, template));
  try {
    await postgresMigrate(pool);
  } finally {
    await pool.end();
  }
}

async function dropDatabases(
  base: string,
  databases: readonly string[],
): Promise<void> {
  const admin = new pg.Client({ connectionString: base });
  await admin.connect();
  const failures: string[] = [];
  try {
    for (const database of databases) {
      try {
        await admin.query(
          `DROP DATABASE IF EXISTS ${databaseName(database)} WITH (FORCE)`,
        );
      } catch (failure) {
        failures.push(
          `${database}: ${failure instanceof Error ? failure.message : String(failure)}`,
        );
      }
    }
  } finally {
    await admin.end();
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
}

async function main(): Promise<void> {
  const [command, base, ...names] = process.argv.slice(2);
  if (base === undefined) throw new Error("a base PostgreSQL URL is required");
  if (command === "prepare" && names.length === 1) {
    await prepare(base, databaseName(names[0] ?? ""));
    return;
  }
  if (command === "clone" && names.length === 2) {
    await createDatabase(
      base,
      databaseName(names[0] ?? ""),
      databaseName(names[1] ?? ""),
    );
    return;
  }
  if (command === "drop" && names.length > 0) {
    await dropDatabases(base, names.map(databaseName));
    return;
  }
  throw new Error(
    "usage: postgres-databases.ts prepare BASE TEMPLATE | clone BASE DATABASE TEMPLATE | drop BASE DATABASE...",
  );
}

main().catch((failure: unknown) => {
  process.stderr.write(
    `postgres databases: ${failure instanceof Error ? failure.message : String(failure)}\n`,
  );
  process.exitCode = 1;
});
