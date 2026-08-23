/**
 * The deployment's role file against the migration list, without a server: a
 * group role a migration creates and this file does not is what nothing else
 * in this tree can see.
 *
 * WHY NO SUITE COULD SEE IT. Every suite migrates as a superuser, which owns
 * every object and needs no membership, so an orphaned group role is invisible
 * to all of them. A deployment's migrating identity owns some of the objects
 * and none of the SECURITY DEFINER functions, and PostgreSQL answers a GRANT
 * on an object the grantor neither owns nor holds grant option for with a
 * warning rather than an error — so the migration that needed the missing
 * membership commits its ledger row having granted nothing.
 *
 * THE EXPECTED SET IS DERIVED FROM THE MIGRATIONS, never listed here. A
 * migration that adds a group role turns these red until the file names it,
 * which is the coupling the file's own header says nothing was checking.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  apiRole,
  migrations,
  selectorReviewRole,
} from "../../src/adapters/postgres/schema.ts";

const rolesFilePath = "deploy/rig/postgres/postgres-roles.sql";
const rolesFile = readFileSync(rolesFilePath, "utf8").replaceAll(/\s+/gu, " ");

/** Every role the declared migrations create, in the one form `roleStatement` emits. */
function migrationGroupRoles(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const migration of migrations)
    for (const statement of migration.statements)
      for (const [, role] of statement.matchAll(
        /CREATE ROLE (chuggy_\w+) NOLOGIN/gu,
      ))
        if (role !== undefined) found.add(role);
  return found;
}

/** The role names one statement of the file names, matched by the shape around them. */
function rolesFileNames(pattern: RegExp): ReadonlySet<string> {
  const found = pattern.exec(rolesFile);
  assert.notEqual(found, null, `${rolesFilePath} has no ${pattern.source}`);
  return new Set(
    Array.from(found?.[1]?.matchAll(/chuggy_\w+/gu) ?? [], ([role]) => role),
  );
}

const declared = migrationGroupRoles();

test("the deployment file creates every group role a migration creates", () => {
  assert.deepEqual(
    rolesFileNames(
      /CREATE ROLE %I NOLOGIN', role_name\) FROM unnest\(ARRAY\[([^\]]*)\]/u,
    ),
    declared,
  );
});

test("it restates the attributes of every one of them", () => {
  const attributed = new Set(
    Array.from(
      rolesFile.matchAll(/ALTER ROLE (chuggy_\w+) WITH NOLOGIN/gu),
      ([, role]) => role,
    ),
  );
  assert.deepEqual(attributed, declared);
});

test("the migrating identity is a member of every one of them", () => {
  assert.deepEqual(
    rolesFileNames(/GRANT ((?:chuggy_\w+,? )+)TO chuggy_owner;/u),
    declared,
  );
});

test("every one of them is granted usage on the schema they live in", () => {
  assert.deepEqual(
    rolesFileNames(/GRANT USAGE ON SCHEMA public TO ((?:chuggy_\w+,? ?)+);/u),
    declared,
  );
});

test("the API's credential can become the role its second pool asserts", () => {
  const login = /GRANT chuggy_api TO (chuggy_\w+);/u.exec(rolesFile)?.[1];
  assert.equal(login, `${apiRole}_login`);
  assert.match(
    rolesFile,
    new RegExp(`GRANT ${selectorReviewRole} TO ${String(login)};`, "u"),
    `${rolesFilePath} leaves ${selectorReviewRole} with no login role, and the API refuses to start without one`,
  );
});
