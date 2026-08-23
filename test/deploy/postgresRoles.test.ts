/**
 * The deployment's role file against the migration list, without a server: a
 * group role a migration creates and this file does not is what nothing else
 * in this tree can see.
 *
 * WHY NO SUITE COULD SEE IT. Every suite migrates as a superuser, which owns
 * every object and needs no membership, so an orphaned group role is invisible
 * to all of them. A deployment's migrating identity owns some of the objects
 * and none of the SECURITY DEFINER functions, and a GRANT by a grantor that
 * neither owns the object nor holds grant option on it is a hard error only
 * where the grantor holds nothing on it at all; where it inherits any privilege
 * through a group, PostgreSQL warns instead — so the migration that needed the
 * missing membership commits its ledger row having granted nothing.
 *
 * THE EXPECTED SET IS DERIVED FROM THE MIGRATIONS AND FROM `src/roots/`, never
 * listed here. A migration that adds a group role, or a serving command that
 * asserts one, turns these red until the file names it — which is the coupling
 * the file's own header says nothing was checking.
 *
 * THE LOGIN HALF IS THE SAME PROPERTY AND NEEDS THE SAME COVER. A login role is
 * complete only when the file creates it, restates its attributes, gives it a
 * password from a variable it read, grants it CONNECT and grants it the group
 * its process asserts; drop any one of those and every other suite stays green
 * while the process cannot start. So the five places are checked against each
 * other rather than against a list, and the groups against `src/roots/`.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import * as schema from "../../src/adapters/postgres/schema.ts";

const { apiRole, migrations, selectorReviewRole } = schema;
const rolesFilePath = "deploy/rig/postgres/postgres-roles.sql";
const rolesFile = readFileSync(rolesFilePath, "utf8").replaceAll(/\s+/gu, " ");
const rootsDirectory = "src/roots";
const schemaExports: Readonly<Record<string, unknown>> = schema;

/** Every role the declared migrations create, in whatever form they create it. */
function migrationGroupRoles(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const migration of migrations)
    for (const statement of migration.statements)
      for (const [, role] of statement.matchAll(/CREATE ROLE (chuggy_\w+)/gu))
        if (role !== undefined) found.add(role);
  return found;
}

/** Every role a migration hands an object to, which the receiver must be able to create. */
function migrationReceivingRoles(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const migration of migrations)
    for (const statement of migration.statements)
      for (const [, role] of statement.matchAll(/OWNER TO (chuggy_\w+)/gu))
        if (role !== undefined) found.add(role);
  return found;
}

/** Every group role a command under `src/roots/` names, which is the one it refuses to serve without. */
function rootAssertedRoles(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(rootsDirectory)) {
    const source = readFileSync(`${rootsDirectory}/${entry}`, "utf8");
    for (const [, name] of source.matchAll(/\b(\w+Role)\b/gu)) {
      const role = name === undefined ? undefined : schemaExports[name];
      if (typeof role === "string" && role.startsWith("chuggy_"))
        found.add(role);
    }
  }
  return found;
}

/** Every role name one repeated statement of the file names, and the shape it names them in. */
function rolesFileRepeated(pattern: RegExp): ReadonlySet<string> {
  const found = new Set<string>();
  for (const [, role] of rolesFile.matchAll(pattern))
    if (role !== undefined) found.add(role);
  assert.notEqual(found.size, 0, `${rolesFilePath} has no ${pattern.source}`);
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

test("a role a migration makes an owner may create in the schema it owns in", () => {
  const creators = new Set<string>();
  for (const [, list] of rolesFile.matchAll(
    /GRANT (?:[A-Z]+, )*CREATE ON SCHEMA public TO ((?:chuggy_\w+,? ?)+);/gu,
  ))
    for (const [role] of String(list).matchAll(/chuggy_\w+/gu))
      creators.add(role);
  const receiving = migrationReceivingRoles();
  assert.notEqual(receiving.size, 0, "no migration hands an object to a role");
  for (const role of receiving)
    assert.ok(
      creators.has(role),
      `${rolesFilePath} leaves ${role} without CREATE on schema public, and PostgreSQL refuses ALTER ... OWNER TO a role that cannot create there`,
    );
});

test("every group role a serving command asserts is granted to a login role", () => {
  assert.deepEqual(
    rolesFileRepeated(/GRANT (chuggy_\w+) TO chuggy_\w+_login;/gu),
    rootAssertedRoles(),
  );
});

test("every login role is created, attributed, passworded and connected alike", () => {
  const created = rolesFileNames(
    /CREATE ROLE %I LOGIN', role_name\) FROM unnest\(ARRAY\[([^\]]*)\]/u,
  );
  const connected = rolesFileNames(
    /GRANT CONNECT ON DATABASE %I TO %I'[^[]*\[([^\]]*)\]/u,
  );
  const attributed = rolesFileRepeated(/ALTER ROLE (chuggy_\w+) WITH LOGIN/gu);
  const passworded = rolesFileRepeated(/ALTER ROLE (chuggy_\w+) PASSWORD /gu);
  assert.deepEqual(connected, created);
  assert.deepEqual(attributed, created);
  assert.deepEqual(passworded, created);
  for (const role of rolesFileRepeated(/GRANT chuggy_\w+ TO (chuggy_\w+);/gu))
    assert.ok(
      created.has(role),
      `${rolesFilePath} grants a group to ${role}, which it does not create`,
    );
});

test("no login role is left locked out by an attribute a rotation does not touch", () => {
  const restated = Array.from(
    rolesFile.matchAll(/ALTER ROLE (chuggy_\w+) WITH LOGIN ([^;]*);/gu),
  );
  assert.notEqual(
    restated.length,
    0,
    `${rolesFilePath} restates no login role`,
  );
  for (const [, role, attributes] of restated) {
    assert.match(
      String(attributes),
      /CONNECTION LIMIT -1/u,
      `${role} is refused every connection`,
    );
    assert.match(
      String(attributes),
      /VALID UNTIL 'infinity'/u,
      `${role} is refused every password`,
    );
  }
});

test("every login role's password is a distinct variable the file reads", () => {
  const read = rolesFileRepeated(/\\getenv (\w+) CHUG_\w+/gu);
  const used = Array.from(
    rolesFile.matchAll(/ALTER ROLE chuggy_\w+ PASSWORD :'(\w+)';/gu),
    ([, variable]) => String(variable),
  );
  assert.notEqual(used.length, 0, `${rolesFilePath} sets no password`);
  assert.equal(
    new Set(used).size,
    used.length,
    `${rolesFilePath} gives two roles one password`,
  );
  for (const variable of used)
    assert.ok(
      read.has(variable),
      `${rolesFilePath} interpolates ${variable} without reading it`,
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
