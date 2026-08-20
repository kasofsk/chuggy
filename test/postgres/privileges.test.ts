/**
 * The whole privilege set both runtime roles hold, read back from the server
 * and compared against a set written down here.
 *
 * WHY THIS EXISTS. A table-level grant reaches every column, while the prose
 * beside it names only the columns the code happens to write — so a grant
 * written without its column list reads exactly like the narrow one it was
 * meant to be.
 *
 * WHY THE EXPECTED SET IS WRITTEN OUT LONGHAND rather than derived from
 * `schema.ts`. A test that built its expectation from the same constants that
 * emit the `GRANT` statements would agree with any widening, because both
 * sides would move together. These literals are a second, independent
 * statement of the same fact, and that is the only arrangement in which a
 * disagreement means anything.
 *
 * WHY IT READS `pg_catalog` AND NOT `information_schema`. The
 * `information_schema` privilege views show only what is granted to or by a
 * currently enabled role, so a superuser reading them sees nothing about
 * `chuggy_api`. `aclexplode` over the catalogue's own ACL columns is
 * unfiltered, which is what an audit needs.
 *
 * PUBLIC IS A GRANTEE WITH NO ROLE ROW. `aclexplode` reports it as OID zero,
 * so an inner join to `pg_roles` drops the one grant that reaches every
 * connected user. The joins below are outer and render that grantee as
 * `PUBLIC`, which is what makes the expected sets complete rather than
 * complete for the two roles they name.
 *
 * WHICH IS WHY THE READS ARE SCOPED TO ONE SCHEMA. Naming two roles was the
 * whole filter before, and PUBLIC is granted `SELECT` on every system
 * catalogue and `information_schema` view — so admitting it without a
 * namespace join replaces this audit with a page about relations no migration
 * here created.
 *
 * A GRANT IS NOT THE WHOLE OF WHAT A ROLE MAY DO. Membership carries another
 * role's privileges and an attribute steps around grants altogether, so
 * `pg_auth_members` and the attribute columns are read here too — and so is
 * the owner a `SECURITY DEFINER` body runs as, which is nobody's decision yet.
 *
 * WHAT IT STILL CANNOT SEE. A null ACL column is default privileges rather
 * than none, and `aclexplode` returns no rows for one — so a routine created
 * without revoking `PUBLIC`'s default EXECUTE would be invisible to the
 * routine set below. Every routine `schema.ts` creates revokes it, which is
 * what leaves that limit without an instance behind it.
 *
 * A CHANGE HERE IS A CHANGE TO THE AUTHORITY BOUNDARY. If a slice legitimately
 * widens a grant, this list moves with it in the same commit, and the diff is
 * where a reviewer sees the boundary move.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  apiRole,
  cancellationFunction,
  dispatcherRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresHarnessOpen, type PostgresHarness } from "./harness.ts";

let harness: PostgresHarness;

before(async () => {
  harness = await postgresHarnessOpen();
});

after(async () => {
  await harness.close();
});

/**
 * Every privilege held on a whole relation. A column-level grant does not
 * appear here, which is what makes this list the one that catches a grant
 * written without its columns.
 */
const tableWide: readonly string[] = [
  `${apiRole} inbox_item SELECT`,
  `${apiRole} operation SELECT`,
  `${apiRole} project SELECT`,
  `${apiRole} project_readiness SELECT`,
  `${dispatcherRole} inbox_item SELECT`,
  `${dispatcherRole} journal_entry INSERT`,
  `${dispatcherRole} journal_entry SELECT`,
  `${dispatcherRole} operation SELECT`,
  `${dispatcherRole} project SELECT`,
  `${dispatcherRole} project_readiness SELECT`,
  `${dispatcherRole} recovery_epoch SELECT`,
  `${dispatcherRole} ticket_projection INSERT`,
  `${dispatcherRole} ticket_projection SELECT`,
];

/** Every privilege held on named columns, with the columns it names. */
const columnWise: readonly string[] = [
  `${apiRole} inbox_item INSERT (operation, ordinal, project, tenant)`,
  `${apiRole} operation INSERT (admission, authority_kind, authority_subject, command, key_digest, key_version, lifecycle_generation, operation, payload_digest, project, tenant)`,
  `${apiRole} project UPDATE (ingress_next)`,
  `${apiRole} project_readiness INSERT (generation, project, ready, tenant)`,
  /**
   * Acceptance raises readiness and advances the generation, so this grant
   * also permits lowering `ready` over a consumable item — an enqueued
   * submission no writer discovers until something raises readiness again —
   * and rewinding the generation a stale observation is refused by. Direction
   * is the adapter's discipline rather than the server's here and for the
   * dispatcher's `ready` below, kasofsk/chuggy#121 is open on what makes it
   * the server's, and this expected set moves only if the answer is a
   * narrower grant.
   */
  `${apiRole} project_readiness UPDATE (generation, ready)`,
  `${dispatcherRole} inbox_item UPDATE (consumable)`,
  `${dispatcherRole} operation UPDATE (decided_seq, outcome_code, settled_at, settled_authority_kind, settled_authority_subject, state)`,
  `${dispatcherRole} project UPDATE (fencing_epoch, head, lease_expires_at, owner, recovery_epoch)`,
  `${dispatcherRole} project_readiness UPDATE (ready)`,
  `${dispatcherRole} ticket_projection UPDATE (phase, seq)`,
];

/** Every routine either role may execute. */
const routines: readonly string[] = [
  `${apiRole} ${cancellationFunction} EXECUTE`,
];

/** The grantee an ACL entry names, with PUBLIC's absent role row spelled out. */
const granteeName = "coalesce(g.rolname, 'PUBLIC')";

/** The grantees an audit reads: the two roles it names, and PUBLIC however it was granted. */
const granteeWhere = `${granteeName} IN ($1, $2) OR x.grantee = 0`;

/**
 * Confines a read to the schema the migrations create in. Admitting PUBLIC
 * without this admits every catalogue and `information_schema` grant, which is
 * a page of rows about relations this tree did not create.
 */
function inAuditSchema(namespaceColumn: string): string {
  return `JOIN pg_namespace n ON n.oid = ${namespaceColumn} AND n.nspname = 'public'`;
}

/** Reads the ACL of every relation, one row per grantee and privilege. */
async function actualTableWide(): Promise<readonly string[]> {
  const rows = (await harness.query(
    `SELECT ${granteeName} AS role, c.relname AS rel, x.privilege_type AS priv
       FROM pg_class c
       ${inAuditSchema("c.relnamespace")}
       CROSS JOIN LATERAL aclexplode(c.relacl) x
       LEFT JOIN pg_roles g ON g.oid = x.grantee
      WHERE ${granteeWhere}
      ORDER BY 1, 2, 3`,
    [apiRole, dispatcherRole],
  )) as readonly { role: string; rel: string; priv: string }[];
  return rows.map((row) => `${row.role} ${row.rel} ${row.priv}`);
}

/** Reads the ACL of every column, folded to one row per grantee, relation and privilege. */
async function actualColumnWise(): Promise<readonly string[]> {
  const rows = (await harness.query(
    `SELECT ${granteeName} AS role, c.relname AS rel, x.privilege_type AS priv,
            string_agg(a.attname, ', ' ORDER BY a.attname) AS cols
       FROM pg_class c
       ${inAuditSchema("c.relnamespace")}
       JOIN pg_attribute a
         ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       CROSS JOIN LATERAL aclexplode(a.attacl) x
       LEFT JOIN pg_roles g ON g.oid = x.grantee
      WHERE ${granteeWhere}
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3`,
    [apiRole, dispatcherRole],
  )) as readonly { role: string; rel: string; priv: string; cols: string }[];
  return rows.map((row) => `${row.role} ${row.rel} ${row.priv} (${row.cols})`);
}

/** Reads the ACL of every routine. */
async function actualRoutines(): Promise<readonly string[]> {
  const rows = (await harness.query(
    `SELECT ${granteeName} AS role, p.proname AS proc, x.privilege_type AS priv
       FROM pg_proc p
       ${inAuditSchema("p.pronamespace")}
       CROSS JOIN LATERAL aclexplode(p.proacl) x
       LEFT JOIN pg_roles g ON g.oid = x.grantee
      WHERE ${granteeWhere}
      ORDER BY 1, 2, 3`,
    [apiRole, dispatcherRole],
  )) as readonly { role: string; proc: string; priv: string }[];
  return rows.map((row) => `${row.role} ${row.proc} ${row.priv}`);
}

/** Says what moved in both directions, because a widening and a narrowing read differently. */
function drift(actual: readonly string[], expected: readonly string[]): string {
  const gained = actual.filter((entry) => !expected.includes(entry));
  const lost = expected.filter((entry) => !actual.includes(entry));
  return [
    gained.length === 0
      ? ""
      : `granted but not written down:\n  ${gained.join("\n  ")}`,
    lost.length === 0
      ? ""
      : `written down but not granted:\n  ${lost.join("\n  ")}`,
  ]
    .filter((half) => half !== "")
    .join("\n");
}

test("no role holds a privilege on a whole relation that is not written down", async () => {
  const actual = await actualTableWide();
  assert.deepEqual(actual, tableWide, drift(actual, tableWide));
});

test("no role holds a column privilege on a column that is not written down", async () => {
  const actual = await actualColumnWise();
  assert.deepEqual(actual, columnWise, drift(actual, columnWise));
});

test("no role may execute a routine that is not written down", async () => {
  const actual = await actualRoutines();
  assert.deepEqual(actual, routines, drift(actual, routines));
});

/** One role's attributes as `pg_roles` holds them, which no grant on a relation can narrow. */
type RoleAttributeRow = {
  readonly rolname: string;
  readonly rolcanlogin: boolean;
  readonly rolsuper: boolean;
  readonly rolcreaterole: boolean;
  readonly rolbypassrls: boolean;
};

/** The attribute columns a role is read by, under whichever alias carries them. */
function roleAttributes(alias: string): string {
  return ["rolname", "rolcanlogin", "rolsuper", "rolcreaterole", "rolbypassrls"]
    .map((column) => `${alias}.${column}`)
    .join(", ");
}

/** One role as a line, so a drift names which attribute moved rather than that one did. */
function attributeLine(row: RoleAttributeRow): string {
  return [
    row.rolname,
    `login=${String(row.rolcanlogin)}`,
    `super=${String(row.rolsuper)}`,
    `createrole=${String(row.rolcreaterole)}`,
    `bypassrls=${String(row.rolbypassrls)}`,
  ].join(" ");
}

test("neither runtime role may log in or hold an attribute that steps around a grant", async () => {
  const rows = (await harness.query(
    `SELECT ${roleAttributes("pg_roles")} FROM pg_roles
      WHERE rolname IN ($1, $2) ORDER BY 1`,
    [apiRole, dispatcherRole],
  )) as readonly RoleAttributeRow[];
  assert.deepEqual(rows.map(attributeLine), [
    `${apiRole} login=false super=false createrole=false bypassrls=false`,
    `${dispatcherRole} login=false super=false createrole=false bypassrls=false`,
  ]);
});

/**
 * Membership is the other way a privilege reaches a role, so an audit of
 * grants is complete only while no membership carries one in or out. A
 * deployment's login roles are members of these, and that is what moves this
 * case.
 */
test("neither runtime role is a member of anything, and nothing is a member of them", async () => {
  const rows = (await harness.query(
    `SELECT m.rolname AS member, r.rolname AS held
       FROM pg_auth_members a
       JOIN pg_roles m ON m.oid = a.member
       JOIN pg_roles r ON r.oid = a.roleid
      WHERE m.rolname IN ($1, $2) OR r.rolname IN ($1, $2)
      ORDER BY 1, 2`,
    [apiRole, dispatcherRole],
  )) as readonly { member: string; held: string }[];
  assert.deepEqual(
    rows.map((row) => `${row.member} holds ${row.held}`),
    [],
  );
});

/**
 * A `SECURITY DEFINER` body carries its owner's privileges, and nothing
 * chooses that owner: it is whichever role applied the migration, which no
 * expectation here can name and kasofsk/chuggy#134 carries the production
 * answer for. What holds whoever it was is that it is not a runtime role — an
 * owner that was would leave the definer rights buying nothing — and the
 * owner's attributes are what a failure prints.
 */
test("cancellation does not run as either runtime role, whoever owns it", async () => {
  const rows = (await harness.query(
    `SELECT ${roleAttributes("o")}, o.rolname IN ($2, $3) AS runtime_owner
       FROM pg_proc p
       ${inAuditSchema("p.pronamespace")}
       JOIN pg_roles o ON o.oid = p.proowner
      WHERE p.proname = $1`,
    [cancellationFunction, apiRole, dispatcherRole],
  )) as readonly (RoleAttributeRow & { runtime_owner: boolean })[];
  assert.equal(rows.length, 1, "the cancellation function has one owner");
  assert.deepEqual(
    rows.filter((row) => row.runtime_owner).map(attributeLine),
    [],
  );
});
