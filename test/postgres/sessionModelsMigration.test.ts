/**
 * 133 adds the columns a session's model and effort are held in, and a
 * project's choice of them, as nullable columns alone: every row written
 * before it reads as it did, holding no model and no effort.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration133 } from "../../src/adapters/postgres/schema/migrations/133-session-model-effort.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** Writes rows past their references, which a case about columns has no use for. */
async function sessionModelsPlanted(
  subject: pg.Pool,
  statements: readonly string[],
): Promise<void> {
  const planting = await subject.connect();
  try {
    await planting.query("BEGIN");
    await planting.query("SET LOCAL session_replication_role=replica");
    for (const statement of statements) await planting.query(statement);
    await planting.query("COMMIT");
  } finally {
    planting.release();
  }
}

const sessionColumns = `tenant,project,session,kind,principal,capabilities,
  credential_slot,account,cluster,state,system_prompt,auto_compact_window`;

const settingsColumns = `tenant,project,revision,north_star,
  thread_standing_rules,auto_compact_window`;

test("133 keeps every session and settings row as it stood, holding no model and no effort", async () => {
  await migrationDatabase("session_models", async (subject) => {
    await migratedBefore(subject, migration133.version);
    await sessionModelsPlanted(subject, [
      `INSERT INTO agent_session(${sessionColumns})
       VALUES('tenant-133','project-133','lead-133','Lead','principal-lead',
              ARRAY['ProjectRead'],'claude-code','account-133','cluster-133',
              'Open','the lead objectives',300000),
             ('tenant-133','project-133','thread-133','Thread','principal-member',
              ARRAY['RepositoryRead'],'claude-code','account-133','cluster-133',
              'Open','the thread objectives',NULL)`,
      `INSERT INTO selector_project_settings(${settingsColumns})
       VALUES('tenant-133','project-133',4,'ship it','- act as asked',300000)`,
    ]);
    const sessions = `SELECT ${sessionColumns} FROM agent_session ORDER BY session`;
    const settings = `SELECT ${settingsColumns} FROM selector_project_settings`;
    const sessionsBefore = (await subject.query(sessions)).rows;
    const settingsBefore = (await subject.query(settings)).rows;

    assert.ok((await postgresMigrate(subject)).includes(migration133.version));
    assert.deepEqual((await subject.query(sessions)).rows, sessionsBefore);
    assert.deepEqual((await subject.query(settings)).rows, settingsBefore);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT session,model,effort FROM agent_session ORDER BY session`,
        )
      ).rows,
      [
        { session: "lead-133", model: null, effort: null },
        { session: "thread-133", model: null, effort: null },
      ],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT lead_model,lead_effort,thread_model,thread_effort
             FROM selector_project_settings`,
        )
      ).rows,
      [
        {
          lead_model: null,
          lead_effort: null,
          thread_model: null,
          thread_effort: null,
        },
      ],
    );
  });
});
