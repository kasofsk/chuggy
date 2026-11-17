/**
 * The query checker's verdict on a json or jsonb column, asked through the
 * tree's own `eslint.config.js` against the migrated schema this suite is
 * given, the way `.chug/tasks/check-queries.sh` asks it of the adapter.
 *
 * `ticket_definition.overrides` and `.selection` are nullable jsonb, which pg
 * hands back parsed. A row declaring either as text is a reader that parses an
 * object, so the checker has to refuse it, and has to accept the same column
 * cast to text, or declared `unknown`. A nullable jsonb array keeps its null.
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

import { postgresHarnessUrl } from "./harness.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * What the SafeQL rule reports about a module holding one adapter query.
 *
 * The text stands in for an adapter module that exists, so it is typed in
 * the program `tsconfig.json` defines and nothing is written to disk.
 */
async function queryRowTypesFindings(
  row: string,
  columns: string,
): Promise<readonly string[]> {
  process.env["CHUG_SAFEQL_DATABASE_URL"] = postgresHarnessUrl();
  const linter = new ESLint({ cwd: root });
  const source = [
    'import type pg from "pg";',
    'import { sql } from "@ts-safeql/sql-tag";',
    "export async function queryRowTypesFixture(pool: pg.Pool): Promise<unknown> {",
    `  const found = await pool.query<${row}>(`,
    `    sql\`SELECT ${columns} FROM ticket_definition d\`,`,
    "  );",
    "  return found.rows;",
    "}",
    "",
  ].join("\n");
  const [result] = await linter.lintText(source, {
    filePath: join(root, "src/adapters/postgres/nativeReads.ts"),
  });
  assert.ok(result !== undefined, "eslint returned no result");
  const fatal = result.messages.filter((message) => message.fatal === true);
  assert.deepEqual(fatal, [], "the fixture did not parse");
  return result.messages
    .filter((message) => message.ruleId === "@ts-safeql/check-sql")
    .map((message) => message.message);
}

test("a jsonb column read bare into a text row type is a finding", async () => {
  const findings = await queryRowTypesFindings(
    "{ overrides: string | null; selection: string | null }",
    "d.overrides,d.selection",
  );
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0] ?? "", /incorrect type annotation/u);
});

test("a jsonb column cast to text agrees with a text row type", async () => {
  const findings = await queryRowTypesFindings(
    "{ overrides: string | null; selection: string | null }",
    "d.overrides::text AS overrides,d.selection::text AS selection",
  );
  assert.deepEqual(findings, []);
});

test("a nullable jsonb column read bare agrees with an unknown row type", async () => {
  const findings = await queryRowTypesFindings(
    "{ overrides: unknown; selection: unknown }",
    "d.overrides,d.selection",
  );
  assert.deepEqual(findings, []);
});

const nullableJsonbArray =
  "CASE WHEN d.overrides IS NULL THEN NULL ELSE ARRAY['{}'::jsonb] END AS overrides";

test("a nullable jsonb array read into a non-null array row type is a finding", async () => {
  const findings = await queryRowTypesFindings(
    "{ overrides: unknown[] }",
    nullableJsonbArray,
  );
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0] ?? "", /incorrect type annotation/u);
});

test("a nullable jsonb array agrees with a nullable array row type", async () => {
  const findings = await queryRowTypesFindings(
    "{ overrides: unknown[] | null }",
    nullableJsonbArray,
  );
  assert.deepEqual(findings, []);
});
