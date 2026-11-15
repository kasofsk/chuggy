/**
 * 186 gives every tenant already standing its id as its display name, an id
 * longer than a display name may be among them, and
 * leaves the rest of what keeps a tenant as it was: no id changes, and a
 * tenant any project names is not deleted.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import {
  migration186,
  tenantDisplayNameCharsMaxAt186,
} from "../../src/adapters/postgres/schema/migrations/186-tenant-display-name.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

test("186 names every tenant standing by its id, however long, and a tenant's id and a tenant a project names stay held", async () => {
  await migrationDatabase("tenant_display_name", async (subject) => {
    await migratedBefore(subject, migration186.version);
    const long = `long-186-${"l".repeat(tenantDisplayNameCharsMaxAt186)}`;
    await subject.query(
      `INSERT INTO tenant(tenant) VALUES('tenant-186'),('empty-186'),($1)`,
      [long],
    );
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-186','web','Active')`,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration186.version));
    assert.deepEqual(
      (
        await subject.query(
          `SELECT tenant,display_name FROM tenant ORDER BY tenant`,
        )
      ).rows,
      [
        { tenant: "empty-186", display_name: "empty-186" },
        { tenant: long, display_name: long },
        { tenant: "tenant-186", display_name: "tenant-186" },
      ],
    );
    await assert.rejects(
      subject.query(
        `UPDATE tenant SET tenant='moved-186' WHERE tenant='tenant-186'`,
      ),
      /tenant rows are immutable/u,
    );
    await assert.rejects(
      subject.query(`DELETE FROM tenant WHERE tenant='tenant-186'`),
      /tenant rows are immutable/u,
    );
    await subject.query(`DELETE FROM tenant WHERE tenant<>'tenant-186'`);
    assert.deepEqual((await subject.query(`SELECT tenant FROM tenant`)).rows, [
      { tenant: "tenant-186" },
    ]);
  });
});
