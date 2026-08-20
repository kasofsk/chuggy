/**
 * The whole privilege set both runtime roles hold, read back from the server
 * and compared against a set written down here.
 *
 * WHY THIS EXISTS. Three review rounds on this slice each found a grant wider
 * than the sentence above it: `UPDATE` on the project row, then `UPDATE` on
 * the operation, then `INSERT` on the operation and its inbox item. Every fix
 * was correct and every one left the adjacent hole, because a fix aimed at a
 * finding does not close a class. The class is that a table-level grant
 * reaches every column while the prose beside it describes the columns the
 * code happens to write, and no amount of reading catches that reliably.
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
  `${apiRole} project_readiness INSERT`,
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

/** Reads the ACL of every relation, one row per role and privilege. */
async function actualTableWide(): Promise<readonly string[]> {
  const rows = (await harness.query(
    `SELECT g.rolname AS role, c.relname AS rel, x.privilege_type AS priv
       FROM pg_class c
       CROSS JOIN LATERAL aclexplode(c.relacl) x
       JOIN pg_roles g ON g.oid = x.grantee
      WHERE g.rolname IN ($1, $2)
      ORDER BY 1, 2, 3`,
    [apiRole, dispatcherRole],
  )) as readonly { role: string; rel: string; priv: string }[];
  return rows.map((row) => `${row.role} ${row.rel} ${row.priv}`);
}

/** Reads the ACL of every column, folded to one row per role, relation and privilege. */
async function actualColumnWise(): Promise<readonly string[]> {
  const rows = (await harness.query(
    `SELECT g.rolname AS role, c.relname AS rel, x.privilege_type AS priv,
            string_agg(a.attname, ', ' ORDER BY a.attname) AS cols
       FROM pg_class c
       JOIN pg_attribute a
         ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
       CROSS JOIN LATERAL aclexplode(a.attacl) x
       JOIN pg_roles g ON g.oid = x.grantee
      WHERE g.rolname IN ($1, $2)
      GROUP BY 1, 2, 3
      ORDER BY 1, 2, 3`,
    [apiRole, dispatcherRole],
  )) as readonly { role: string; rel: string; priv: string; cols: string }[];
  return rows.map((row) => `${row.role} ${row.rel} ${row.priv} (${row.cols})`);
}

/** Reads the ACL of every routine. */
async function actualRoutines(): Promise<readonly string[]> {
  const rows = (await harness.query(
    `SELECT g.rolname AS role, p.proname AS proc, x.privilege_type AS priv
       FROM pg_proc p
       CROSS JOIN LATERAL aclexplode(p.proacl) x
       JOIN pg_roles g ON g.oid = x.grantee
      WHERE g.rolname IN ($1, $2)
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

test("neither runtime role may log in, so a credential is a separate grant", async () => {
  const rows = (await harness.query(
    "SELECT rolname, rolcanlogin, rolsuper FROM pg_roles WHERE rolname IN ($1, $2) ORDER BY 1",
    [apiRole, dispatcherRole],
  )) as readonly { rolname: string; rolcanlogin: boolean; rolsuper: boolean }[];
  assert.deepEqual(
    rows.map(
      (row) =>
        `${row.rolname} login=${String(row.rolcanlogin)} super=${String(row.rolsuper)}`,
    ),
    [
      `${apiRole} login=false super=false`,
      `${dispatcherRole} login=false super=false`,
    ],
  );
});
