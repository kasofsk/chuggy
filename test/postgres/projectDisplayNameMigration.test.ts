/**
 * 183 leaves every project that already stands unnamed, which the inventory
 * reads as the project's identity, and holds a name from then on to the
 * contract's bound.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { projectDisplayNameCharsMax } from "../../src/contract/requests.ts";
import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { postgresProjectInventory } from "../../src/adapters/postgres/projectInventory.ts";
import { migration183 } from "../../src/adapters/postgres/schema/migrations/183-project-display-name.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

test("183 lists every project that stands by its identity, and bounds a name as the contract does", async () => {
  await migrationDatabase("project_display_name", async (subject) => {
    await migratedBefore(subject, migration183.version);
    await subject.query(`INSERT INTO tenant(tenant) VALUES('tenant-183')`);
    await subject.query(
      `INSERT INTO project(tenant,project,lifecycle)
       VALUES('tenant-183','atlas','Active'),('tenant-183','borealis','Suspended')`,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration183.version));
    const stored = await subject.query<{
      project: string;
      name: string | null;
    }>(
      `SELECT project,name FROM project WHERE tenant='tenant-183' ORDER BY project`,
    );
    assert.deepEqual(stored.rows, [
      { project: "atlas", name: null },
      { project: "borealis", name: null },
    ]);
    assert.deepEqual(
      await postgresProjectInventory(subject).projects(undefined, 10),
      [
        { tenant: "tenant-183", project: "atlas", name: "atlas" },
        { tenant: "tenant-183", project: "borealis", name: "borealis" },
      ],
    );
    const longest = "n".repeat(projectDisplayNameCharsMax);
    await subject.query(
      `UPDATE project SET name=$1 WHERE tenant='tenant-183' AND project='atlas'`,
      [longest],
    );
    for (const name of ["", `${longest}n`])
      await assert.rejects(
        subject.query(
          `UPDATE project SET name=$1 WHERE tenant='tenant-183' AND project='atlas'`,
          [name],
        ),
        /project_name_is_bounded/u,
        JSON.stringify(name),
      );
  });
});
