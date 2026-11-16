/**
 * 207 closes every open lead and inquiry through the session's own close,
 * drops the lead's, the inquiries' and the subsidy's objects, and leaves a
 * project's placement and settings holding their thread columns.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import {
  migration207,
  selectorSettingsColumnsRetiredAt207,
} from "../../src/adapters/postgres/schema/migrations/207-lead-retired.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** An open lead, an open inquiry of it with a queued turn, a subsidized placement, settings naming a lead model, and the subsidy. */
const leadKept = `
  INSERT INTO tenant(tenant) VALUES('tenant-207');
  INSERT INTO project(tenant,project,lifecycle) VALUES('tenant-207','project-207','Active');
  INSERT INTO execution_cluster(cluster,slots_max,policy_revision) VALUES('cluster-207',1,1);
  INSERT INTO capacity_account(account,cluster,reserved,maximum,policy_revision)
  VALUES('account-207','cluster-207',0,1,1);
  INSERT INTO agent_session
    (tenant,project,session,kind,principal,parent_session,capabilities,
     credential_slot,account,cluster)
  VALUES('tenant-207','project-207','lead-207','Lead','principal-lead',NULL,'{}',
         'slot-207','account-207','cluster-207'),
        ('tenant-207','project-207','inquiry-207','Inquiry','principal-member',
         'lead-207','{}','slot-207','account-207','cluster-207');
  INSERT INTO session_turn(tenant,project,session,turn,ordinal,input_kind,input,route)
  VALUES('tenant-207','project-207','inquiry-207','turn-207',1,'UserMessage',
         'why?','InCluster');
  INSERT INTO project_session_placement
    (tenant,project,thread_route,lead_route,lead_offering)
  VALUES('tenant-207','project-207','Pool','InCluster','Subsidized');
  INSERT INTO selector_project_settings
    (tenant,project,revision,north_star,thread_standing_rules,thread_model,
     thread_effort,lead_model,lead_effort,mode)
  VALUES('tenant-207','project-207',3,'Ship it.','Be brief.','thread-model',
         'low','lead-model','high','Running');
  INSERT INTO subsidized_lead
    (credential_slot,model,effort,auto_compact_window,input_bytes_per_decision,
     turn_tokens_max,tenant_monthly_micros,deployment_monthly_micros,
     unmeasured_turn_micros)
  VALUES('slot-subsidy','model-subsidy','low',200000,1,1000,1,1,1);`;

/** Every function this drops, by name. */
const droppedFunctionNames = [
  "open_project_lead",
  "lead_session",
  "close_project_lead",
  "enqueue_lead_turn",
  "read_lead_turn",
  "withdraw_lead_turn",
  "read_lead_standing",
  "set_session_system_prompt",
  "lead_runner_standing",
  "read_lead_refusal",
  "read_selector_planning_intent",
  "open_lead_inquiry",
  "read_lead_inquiries",
  "read_lead_inquiry",
  "inquiry_closes_with_its_turn",
  "inquiry_writes_no_store_batch",
  "read_subsidized_lead",
  "session_lead_profile",
  "subsidized_lead_spend",
  "session_lead_offering",
  "stored_lead_offering",
  "pool_sessions_awaiting_claim",
  "open_pool_session_attempt",
  "update_selector_project_settings",
];

const droppedColumns: readonly (readonly [string, string])[] = [
  ["project_session_placement", "lead_route"],
  ["project_session_placement", "lead_offering"],
  ["session_routing", "lead_route"],
  ...["selector_project_settings", "selector_project_settings_history"].flatMap(
    (table) =>
      selectorSettingsColumnsRetiredAt207.map(
        (column) => [table, column] as const,
      ),
  ),
];

/** Asserts that no function, trigger, table or column this drops still stands. */
async function leadRetiredObjectsGone(subject: pg.Pool): Promise<void> {
  assert.deepEqual(
    (
      await subject.query(
        `SELECT p.proname FROM pg_proc p
           JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname=ANY($1::text[])`,
        [droppedFunctionNames],
      )
    ).rows,
    [],
  );
  assert.deepEqual(
    (
      await subject.query(
        `SELECT t.tgname FROM pg_trigger t
          WHERE t.tgname IN ('inquiry_closes_when_its_turn_ends',
                             'session_store_batch_is_never_an_inquiry_s')`,
      )
    ).rows,
    [],
  );
  assert.deepEqual(
    (
      await subject.query(
        "SELECT to_regclass('public.subsidized_lead') IS NULL AS dropped",
      )
    ).rows,
    [{ dropped: true }],
  );
  for (const [table, column] of droppedColumns)
    assert.deepEqual(
      (
        await subject.query(
          `SELECT 1 FROM information_schema.columns
            WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
          [table, column],
        )
      ).rows,
      [],
      `${table}.${column}`,
    );
}

test("207 closes every open lead and inquiry, abandons their turns and appends the change of each", async () => {
  await migrationDatabase("lead_retired_sessions", async (subject) => {
    await migratedBefore(subject, migration207.version);
    await subject.query(leadKept);
    const appendedBefore = (
      await subject.query<{ sequence: string }>(
        "SELECT coalesce(max(sequence),0)::text AS sequence FROM project_change",
      )
    ).rows[0]?.sequence;

    assert.ok((await postgresMigrate(subject)).includes(migration207.version));

    assert.deepEqual(
      (
        await subject.query(
          `SELECT session,state,closed_at IS NOT NULL AS closed
             FROM agent_session ORDER BY session`,
        )
      ).rows,
      [
        { session: "inquiry-207", state: "Closed", closed: true },
        { session: "lead-207", state: "Closed", closed: true },
      ],
    );
    assert.deepEqual(
      (await subject.query("SELECT turn,state,failure FROM session_turn")).rows,
      [{ turn: "turn-207", state: "Abandoned", failure: "SessionClosed" }],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT resource::jsonb AS resource FROM project_change
            WHERE kind='Session' AND sequence>$1 AND resource::jsonb ? 'state'
            ORDER BY resource::jsonb->>'session'`,
          [appendedBefore],
        )
      ).rows,
      [
        {
          resource: {
            session: "inquiry-207",
            kind: "Inquiry",
            state: "Closed",
          },
        },
        { resource: { session: "lead-207", kind: "Lead", state: "Closed" } },
      ],
    );
  });
});

test("207 drops the lead's, the inquiries' and the subsidy's objects, keeps the thread settings, and the placement door still takes a lead and writes the thread alone", async () => {
  await migrationDatabase("lead_retired_objects", async (subject) => {
    await migratedBefore(subject, migration207.version);
    await subject.query(leadKept);

    assert.ok((await postgresMigrate(subject)).includes(migration207.version));

    await leadRetiredObjectsGone(subject);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT revision::text AS revision,north_star,thread_standing_rules,
                  thread_model,thread_effort
             FROM selector_project_settings`,
        )
      ).rows,
      [
        {
          revision: "3",
          north_star: "Ship it.",
          thread_standing_rules: "Be brief.",
          thread_model: "thread-model",
          thread_effort: "low",
        },
      ],
    );

    const placed = `SELECT set_project_session_placement('tenant-207','project-207',
      $1,'Pool','Subsidized','Member','an-owner')::text AS outcome`;
    assert.deepEqual((await subject.query(placed, ["InCluster"])).rows, [
      { outcome: "Written" },
    ]);
    assert.deepEqual((await subject.query(placed, ["InCluster"])).rows, [
      { outcome: "Unchanged" },
    ]);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT route,source FROM session_route('tenant-207','project-207','Thread')`,
        )
      ).rows,
      [{ route: "InCluster", source: "Project" }],
    );
  });
});
