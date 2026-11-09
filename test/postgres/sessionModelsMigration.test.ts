/**
 * 133 adds the columns a session's model and effort are held in, and a
 * project's choice of them, as nullable columns alone: every row written
 * before it reads as it did, holding no model and no effort, and every door it
 * re-creates is callable by the roles it was before and by no other.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  boundaryOwnerRole,
  selectorControlRole,
  selectorServiceRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
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

test("133 keeps each door it re-created where it was granted", async () => {
  await migrationDatabase("session_model_doors", async (subject) => {
    await migratedBefore(subject, migration133.version);
    await postgresMigrate(subject);
    const doors = await subject.query(
      `SELECT p.proname AS name, pg_get_userbyid(p.proowner) AS owner,
              p.prosecdef AS definer,
              has_function_privilege($1,p.oid,'EXECUTE') AS api,
              has_function_privilege($2,p.oid,'EXECUTE') AS control,
              has_function_privilege($3,p.oid,'EXECUTE') AS selector,
              has_function_privilege($4,p.oid,'EXECUTE') AS worker,
              has_function_privilege('public',p.oid,'EXECUTE') AS public,
              pg_get_function_identity_arguments(p.oid) ~ '(in|new)_[a-z_]*(model|effort)'
                OR pg_get_function_result(p.oid) ~ '\\m(model|effort)\\M' AS chosen
         FROM pg_proc p
        WHERE p.proname IN ('update_selector_project_settings','open_project_lead',
                            'open_member_thread','lead_session','read_session_attempt')
        ORDER BY p.proname`,
      [apiRole, selectorControlRole, selectorServiceRole, workerPlaneRole],
    );
    const door = {
      owner: boundaryOwnerRole,
      definer: true,
      api: false,
      control: false,
      selector: false,
      worker: false,
      public: false,
      chosen: true,
    };
    assert.deepEqual(doors.rows, [
      { name: "lead_session", ...door, selector: true },
      { name: "open_member_thread", ...door, api: true },
      { name: "open_project_lead", ...door, selector: true },
      { name: "read_session_attempt", ...door, worker: true },
      {
        name: "update_selector_project_settings",
        ...door,
        api: true,
        control: true,
      },
    ]);
  });
});
