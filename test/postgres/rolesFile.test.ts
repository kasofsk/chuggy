/**
 * `deploy/rig/postgres/postgres-roles.sql` run by psql against a real server,
 * then a fresh database migrated where it ran: that the file runs on exactly
 * the variables it reads, drops a retired login an earlier run issued, and
 * leaves a second re-run nothing to change.
 *
 * ITS ROLES ARE RENAMED FOR THE RUN. A role is cluster-wide and suites beside
 * this one sweep every `chuggy_` role on the server, so the file's own names
 * would put a login holding a group's privileges into their sweeps. Every
 * `chuggy_` name in the file is given a prefix of this run's instead, which
 * leaves its statements, its variables and its order as they are.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { promisify } from "node:util";

import type pg from "pg";

import {
  postgresMigrate,
  postgresPool,
} from "../../src/adapters/postgres/pool.ts";
import { migrations } from "../../src/adapters/postgres/schema.ts";
import { postgresHarnessUrl } from "./harness.ts";
import { migrationDatabase } from "./migrationHarness.ts";

const execute = promisify(execFile);

const rolesFilePath = "deploy/rig/postgres/postgres-roles.sql";
const rolesFileText = readFileSync(rolesFilePath, "utf8");

/** The prefix this run's roles carry in place of `chuggy_`, outside every sweep of `chuggy\_%`. */
const rolesFilePrefix = `rolesfile_${randomUUID().replaceAll("-", "").slice(0, 12)}_`;

/** The file as this run executes it. */
const rolesFileRenamed = rolesFileText.replaceAll(
  /\bchuggy_/gu,
  rolesFilePrefix,
);

/** The login the file stopped issuing, under this run's prefix. */
const rolesFileRetiredLogin = `${rolesFilePrefix}selector_service_login`;

/** Every environment name the file reads, each given a password of its own. */
const rolesFileEnvironment: Readonly<Record<string, string>> =
  Object.fromEntries(
    Array.from(
      rolesFileText.matchAll(/^\\getenv \w+ (\w+)$/gmu),
      ([, name]) => [String(name), randomUUID()],
    ),
  );

/** Runs the file against the database `url` names, with nothing in its environment but what it reads. */
async function rolesFileRun(url: string): Promise<void> {
  const environment: Record<string, string | undefined> = {
    ...process.env,
    ...rolesFileEnvironment,
  };
  for (const name of Object.keys(environment))
    if (/^CHUG_PG_\w+_PASSWORD$/u.test(name) && !(name in rolesFileEnvironment))
      delete environment[name];
  const child = execute("psql", ["-X", "-q", "-d", url, "-f", "-"], {
    env: environment,
  });
  child.child.stdin?.end(rolesFileRenamed);
  await child.catch((failure: unknown) => {
    throw new Error(
      `psql did not run ${rolesFilePath} to completion: ${String(failure)}`,
    );
  });
}

/** Every role this run made, with every attribute, membership and grant the file is authoritative over. */
async function rolesFileState(subject: pg.Pool): Promise<unknown> {
  const roles = await subject.query(
    `SELECT rolname, rolcanlogin, rolsuper, rolinherit, rolcreaterole,
            rolcreatedb, rolreplication, rolbypassrls, rolconnlimit,
            rolvaliduntil::text AS valid_until
       FROM pg_roles WHERE starts_with(rolname, $1) ORDER BY rolname`,
    [rolesFilePrefix],
  );
  const memberships = await subject.query(
    `SELECT g.rolname AS granted, m.rolname AS member
       FROM pg_auth_members a
       JOIN pg_roles g ON g.oid = a.roleid
       JOIN pg_roles m ON m.oid = a.member
      WHERE starts_with(m.rolname, $1) ORDER BY granted, member`,
    [rolesFilePrefix],
  );
  const grants = await subject.query(
    `SELECT (SELECT datacl::text FROM pg_database WHERE datname = current_database()) AS database,
            (SELECT nspacl::text FROM pg_namespace WHERE nspname = 'public') AS schema`,
  );
  return {
    roles: roles.rows,
    memberships: memberships.rows,
    grants: grants.rows,
  };
}

/** Whether a role of that name is on the server. */
async function rolesFileHolds(
  subject: pg.Pool,
  role: string,
): Promise<boolean> {
  const found = await subject.query<{ held: number }>(
    "SELECT count(*)::int AS held FROM pg_roles WHERE rolname = $1",
    [role],
  );
  return found.rows[0]?.held === 1;
}

after(async () => {
  const admin = postgresPool(postgresHarnessUrl());
  try {
    const made = await admin.query<{ rolname: string }>(
      "SELECT rolname FROM pg_roles WHERE starts_with(rolname, $1)",
      [rolesFilePrefix],
    );
    for (const { rolname } of made.rows)
      await admin.query(`DROP ROLE IF EXISTS "${rolname}"`);
  } finally {
    await admin.end();
  }
});

test("the file runs on the variables it reads, drops the retired login, and a re-run changes nothing", async () => {
  assert.equal(
    "CHUG_PG_SELECTOR_SERVICE_PASSWORD" in rolesFileEnvironment,
    false,
  );
  await migrationDatabase("roles", async (subject, url) => {
    await subject.query(`CREATE ROLE "${rolesFileRetiredLogin}" LOGIN`);
    const grant = await subject.query<{ statement: string }>(
      "SELECT format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text) AS statement",
      [rolesFileRetiredLogin],
    );
    await subject.query(String(grant.rows[0]?.statement));

    await rolesFileRun(url);
    assert.equal(
      await rolesFileHolds(subject, `${rolesFilePrefix}owner`),
      true,
    );
    assert.equal(await rolesFileHolds(subject, rolesFileRetiredLogin), false);
    const converged = await rolesFileState(subject);

    await rolesFileRun(url);
    assert.equal(await rolesFileHolds(subject, rolesFileRetiredLogin), false);
    assert.deepEqual(await rolesFileState(subject), converged);

    assert.deepEqual(
      await postgresMigrate(subject),
      migrations.map(({ version }) => version),
    );
  });
});
