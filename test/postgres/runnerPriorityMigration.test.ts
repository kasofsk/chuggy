/**
 * 147 lifts every project already on a member's allowlist at `Normal`, and
 * holds a priority to its roster from then on.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration147 } from "../../src/adapters/postgres/schema/migrations/147-runner-priority.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** Writes allowlist rows past their references, which a case about this table's own rows has no use for. */
async function runnerPriorityPlanted(
  subject: pg.Pool,
  statement: string,
): Promise<void> {
  const planting = await subject.connect();
  try {
    await planting.query("BEGIN");
    await planting.query("SET LOCAL session_replication_role=replica");
    await planting.query(statement);
    await planting.query("COMMIT");
  } finally {
    planting.release();
  }
}

test("147 reads every project already allowed at Normal, and refuses a priority off the roster", async () => {
  await migrationDatabase("runner_priority", async (subject) => {
    await migratedBefore(subject, migration147.version);
    await runnerPriorityPlanted(
      subject,
      `INSERT INTO personal_runner_project(tenant,owner,project)
       VALUES('tenant-147','owner-147','atlas'),('tenant-147','owner-147','borealis')`,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration147.version));
    const lifted = await subject.query<{ project: string; priority: string }>(
      `SELECT project,priority FROM personal_runner_project
        WHERE tenant='tenant-147' ORDER BY project`,
    );
    assert.deepEqual(lifted.rows, [
      { project: "atlas", priority: "Normal" },
      { project: "borealis", priority: "Normal" },
    ]);
    await assert.rejects(
      subject.query(
        `UPDATE personal_runner_project SET priority='Urgent'
          WHERE tenant='tenant-147' AND project='atlas'`,
      ),
      /personal_runner_project_priority_is_known/u,
    );
  });
});
