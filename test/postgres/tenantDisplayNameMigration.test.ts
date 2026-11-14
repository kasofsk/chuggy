/**
 * 184 gives every tenant already standing its id as its display name, an id
 * longer than a display name may be among them, and
 * leaves the rest of what keeps a tenant as it was: no id changes, and a
 * tenant any project names is not deleted.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import {
  migration184,
  tenantDisplayNameCharsMaxAt184,
} from "../../src/adapters/postgres/schema/migrations/184-tenant-display-name.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

test("184 names every tenant standing by its id, however long, and a tenant's id and a tenant a project names stay held", async () => {
  await migrationDatabase("tenant_display_name", async (subject) => {
    await migratedBefore(subject, migration184.version);
    const long = `long-184-${"l".repeat(tenantDisplayNameCharsMaxAt184)}`;
    await subject.query(
      `INSERT INTO tenant(tenant) VALUES('tenant-184'),('empty-184'),($1)`,
      [long],
    );
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-184','web','Active')`,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration184.version));
    assert.deepEqual(
      (
        await subject.query(
          `SELECT tenant,display_name FROM tenant ORDER BY tenant`,
        )
      ).rows,
      [
        { tenant: "empty-184", display_name: "empty-184" },
        { tenant: long, display_name: long },
        { tenant: "tenant-184", display_name: "tenant-184" },
      ],
    );
    await assert.rejects(
      subject.query(
        `UPDATE tenant SET tenant='moved-184' WHERE tenant='tenant-184'`,
      ),
      /tenant rows are immutable/u,
    );
    await assert.rejects(
      subject.query(`DELETE FROM tenant WHERE tenant='tenant-184'`),
      /tenant rows are immutable/u,
    );
    await subject.query(`DELETE FROM tenant WHERE tenant<>'tenant-184'`);
    assert.deepEqual((await subject.query(`SELECT tenant FROM tenant`)).rows, [
      { tenant: "tenant-184" },
    ]);
  });
});
