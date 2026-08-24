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
 *
 * IT IS THE STATEMENTS THAT ARE MATCHED, NEVER THE PROSE. Every check here is a
 * pattern over text, so a commented-out statement is text that satisfies the
 * pattern that its deletion should have broken — and what is read is written in
 * a house style whose headers quote the statements they argue about. The
 * comments are stripped first, from all three sources: a `src/roots/` block
 * comment naming a group role is a mention rather than an assertion, and a
 * migration that mentions a grant it does not make is a read no role holds. The
 * SQL strip is line-wise, so a literal `--` inside a statement would take the
 * rest of that line with it. And a role list is matched to the end of the list
 * rather than to the end of the text it was found in, because a strip cannot
 * see a second statement inside one string, and a pattern that ran on would
 * collect the roles that second statement named. No migration writes either
 * shape today; the patterns are cut to the text a migration may carry rather
 * than to the text it happens to carry, because the first one that does would
 * otherwise be a green run over a grant nobody made.
 *
 * A `format()` TEMPLATE IS MATCHED THROUGH ITS `\gexec` AND ITS ARGUMENTS,
 * because the text of a template says nothing about whether psql runs it or
 * what it names. The CONNECT block is the one where neither failure is loud:
 * without the terminator psql prints the statements and exits zero, and with a
 * literal database name in place of `current_database()` the grants land on
 * another database and every set here is unchanged.
 *
 * AND PAIRWISE WHEREVER A SET WOULD HOLD STILL. Exchange two roles' group
 * grants, or two roles' password variables, and every set below is unchanged
 * while neither process starts: one authenticates and refuses to serve as the
 * wrong group, the other cannot authenticate at all. So a role's grant, its
 * password variable and that variable's environment name are each checked
 * against the role's own name rather than against the collection.
 *
 * AND A GROUP A COMMAND ASSERTS HAS TO SATISFY THE PRECONDITIONS EVERY COMMAND
 * SHARES. The only one of those reads the migration ledger, so a group role a
 * `src/roots/` command connects as and no migration grants that read is a pool
 * that authenticates and is then refused the first statement it makes — which
 * is what the API's selector-review pool was, and the deployment could not work
 * around it. The two sides are matched rather than listed, so a group nothing
 * connects as is left without the read and a grant to one is red as well.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import * as schema from "../../src/adapters/postgres/schema.ts";

const { apiRole, migrations, selectorReviewRole } = schema;
const rolesFilePath = "deploy/rig/postgres/postgres-roles.sql";
const rolesFile = readFileSync(rolesFilePath, "utf8")
  .replaceAll(/--.*$/gmu, " ")
  .replaceAll(/\s+/gu, " ");
const rootsDirectory = "src/roots";
const schemaExports: Readonly<Record<string, unknown>> = schema;

/** Every statement the declared migrations run, less the prose around it. */
const migrationStatements: readonly string[] = migrations.flatMap(
  ({ statements }) =>
    statements.map((statement) => statement.replaceAll(/--.*$/gmu, " ")),
);

/** Every role the declared migrations create, in whatever form they create it. */
function migrationGroupRoles(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const statement of migrationStatements)
    for (const [, role] of statement.matchAll(/CREATE ROLE (chuggy_\w+)/gu))
      if (role !== undefined) found.add(role);
  return found;
}

/** Every role a migration hands an object to, which the receiver must be able to create. */
function migrationReceivingRoles(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const statement of migrationStatements)
    for (const [, role] of statement.matchAll(/OWNER TO (chuggy_\w+)/gu))
      if (role !== undefined) found.add(role);
  return found;
}

/** Every role the migrations let read the ledger the shared precondition reads. */
function migrationLedgerReaders(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const statement of migrationStatements)
    for (const [, granted] of statement.matchAll(
      /GRANT SELECT ON schema_migration TO ((?:\s*chuggy_\w+\s*,?)+)/gu,
    ))
      for (const [role] of String(granted).matchAll(/chuggy_\w+/gu))
        found.add(role);
  return found;
}

/** Every group role a command under `src/roots/` names, which is the one it refuses to serve without. */
function rootAssertedRoles(): ReadonlySet<string> {
  const found = new Set<string>();
  for (const entry of readdirSync(rootsDirectory)) {
    const source = readFileSync(
      `${rootsDirectory}/${entry}`,
      "utf8",
    ).replaceAll(/\/\*[\s\S]*?\*\//gu, " ");
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

/** Every role the file creates with a login, which is one per process plus the owner. */
function loginRoles(): ReadonlySet<string> {
  return rolesFileNames(
    /CREATE ROLE %I LOGIN', role_name\) FROM unnest\(ARRAY\[([^\]]*)\]/u,
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

test("exactly the groups a serving command asserts may read the ledger", () => {
  assert.deepEqual(
    migrationLedgerReaders(),
    rootAssertedRoles(),
    "a group role a src/roots/ command connects as reads schema_migration before it serves, and a group no command connects as never does",
  );
});

test("each login role is granted the group its own name is made of", () => {
  let paired = 0;
  for (const login of loginRoles()) {
    const group = /^(chuggy_\w+)_login$/u.exec(login)?.[1];
    if (group === undefined) continue;
    assert.match(
      rolesFile,
      new RegExp(`GRANT ${group} TO ${login};`, "u"),
      `${rolesFilePath} never grants ${group} to ${login}, so that process authenticates and then refuses to serve as the group it is not`,
    );
    paired += 1;
  }
  assert.notEqual(
    paired,
    0,
    `${rolesFilePath} creates no login role named for a group`,
  );
});

test("every login role is created, attributed, passworded and connected alike", () => {
  const created = loginRoles();
  const connected = rolesFileNames(
    /GRANT CONNECT ON DATABASE %I TO %I', current_database\(\), role_name\) FROM unnest\(ARRAY\[([^\]]*)\]\) AS role_name \\gexec/u,
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

test("every login role's password is the distinct variable its own name names", () => {
  const read = new Map(
    Array.from(
      rolesFile.matchAll(/\\getenv (\w+) (\w+)/gu),
      ([, variable, name]) => [String(variable), String(name)] as const,
    ),
  );
  assert.notEqual(read.size, 0, `${rolesFilePath} reads no environment name`);
  const used = Array.from(
    rolesFile.matchAll(/ALTER ROLE (chuggy_\w+) PASSWORD :'(\w+)';/gu),
    ([, role, variable]) => [String(role), String(variable)] as const,
  );
  assert.notEqual(used.length, 0, `${rolesFilePath} sets no password`);
  assert.equal(
    new Set(used.map(([, variable]) => variable)).size,
    used.length,
    `${rolesFilePath} gives two roles one password`,
  );
  for (const [role, variable] of used) {
    const stem = role.replace(/^chuggy_/u, "").replace(/_login$/u, "");
    assert.equal(
      variable,
      `${stem}_password`,
      `${rolesFilePath} gives ${role} a password from ${variable}, which is another role's`,
    );
    assert.equal(
      read.get(variable),
      `CHUG_PG_${stem.toUpperCase()}_PASSWORD`,
      `${rolesFilePath} fills ${variable} from an environment name that is not ${role}'s`,
    );
  }
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
