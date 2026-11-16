/**
 * 205 drops the selector's tables and every function over them, leaves the
 * selector roles holding nothing, and keeps a project's settings and their
 * history whole.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import {
  selectorControlRole,
  selectorReviewRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  migration205,
  selectorRetiredTables,
} from "../../src/adapters/postgres/schema/migrations/205-selector-retired.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";
import type pg from "pg";

/** A project's settings at their second revision, with both revisions' history. */
const settingsKept = `
  INSERT INTO tenant(tenant) VALUES('tenant-205');
  INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-205','project-205','Active');
  INSERT INTO selector_project_settings
    (tenant,project,revision,north_star,thread_standing_rules,mode,dispatch_mode,
     base_prompt,lead_model,lead_effort,thread_model,thread_effort)
  VALUES('tenant-205','project-205',2,'Ship it.','Be brief.','Running',
         'ApprovalRequired','Lead well.','lead-model','high','thread-model','low');
  INSERT INTO selector_project_settings_history
    (tenant,project,revision,north_star,administrator_kind,administrator_subject)
  VALUES('tenant-205','project-205',1,'Ship.','User','alice'),
        ('tenant-205','project-205',2,'Ship it.','User','alice');`;

async function settingsRead(subject: pg.Pool): Promise<unknown[]> {
  return (
    await subject.query<{ relation: string; row: unknown }>(
      `SELECT 'settings' AS relation, to_jsonb(s) AS row FROM selector_project_settings s
       UNION ALL
       SELECT 'history', to_jsonb(h) FROM selector_project_settings_history h
       ORDER BY 1, 2`,
    )
  ).rows;
}

const droppedTablesStanding = `SELECT c.relname FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname = ANY($1::text[])`;

const functionsNamingDropped = `SELECT p.oid::regprocedure::text AS function, t.name
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    CROSS JOIN unnest($1::text[]) t(name)
   WHERE n.nspname='public' AND p.prosrc ~ ('\\m' || t.name || '\\M')`;

const privilegesHeld = `
  SELECT grantee, 'table' AS kind, table_name AS object FROM information_schema.role_table_grants
   WHERE grantee = ANY($1::text[])
  UNION ALL
  SELECT grantee, 'column', table_name || '.' || column_name FROM information_schema.role_column_grants
   WHERE grantee = ANY($1::text[])
  UNION ALL
  SELECT grantee, 'routine', specific_name FROM information_schema.role_routine_grants
   WHERE grantee = ANY($1::text[])
  UNION ALL
  SELECT grantee, 'usage', object_name FROM information_schema.role_usage_grants
   WHERE grantee = ANY($1::text[])`;

const selectorRoles = [
  selectorServiceRole,
  selectorControlRole,
  selectorReviewRole,
];

test("205 drops the selector's tables and every function naming one, and the selector roles hold nothing", async () => {
  await migrationDatabase("selector_retired", async (subject) => {
    await migratedBefore(subject, migration205.version);
    const tables = [...selectorRetiredTables];
    assert.equal(
      (await subject.query(droppedTablesStanding, [tables])).rows.length,
      tables.length,
    );
    assert.notDeepEqual(
      (await subject.query(functionsNamingDropped, [tables])).rows,
      [],
    );
    assert.notDeepEqual(
      (await subject.query(privilegesHeld, [selectorRoles])).rows,
      [],
    );

    assert.ok((await postgresMigrate(subject)).includes(migration205.version));

    assert.deepEqual(
      (await subject.query(droppedTablesStanding, [tables])).rows,
      [],
    );
    assert.deepEqual(
      (await subject.query(functionsNamingDropped, [tables])).rows,
      [],
    );
    assert.deepEqual(
      (await subject.query(privilegesHeld, [selectorRoles])).rows,
      [],
    );
    for (const role of selectorRoles)
      assert.equal(
        (
          await subject.query<{ granted: boolean }>(
            "SELECT has_schema_privilege($1,'public','USAGE') AS granted",
            [role],
          )
        ).rows[0]?.granted,
        true,
        `${role} keeps the schema's usage`,
      );
  });
});

test("205 keeps a project's settings and their history whole", async () => {
  await migrationDatabase("selector_retired_settings", async (subject) => {
    await migratedBefore(subject, migration205.version);
    await subject.query(settingsKept);
    const before = await settingsRead(subject);
    assert.equal(before.length, 3);

    assert.ok((await postgresMigrate(subject)).includes(migration205.version));

    assert.deepEqual(await settingsRead(subject), before);
  });
});
