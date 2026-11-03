/**
 * `deploy/rig/wipe-tickets.sql` run against the installed schema.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { draftReleaseFunction } from "../../src/adapters/postgres/schema.ts";
import type pg from "pg";
import {
  journalledRevocation,
  migratedDatabase,
  createdProposingDraft,
  seedProposingBinding,
} from "./migrationHarness.ts";

/** The wipe the migration's guard names, read from the tree rather than restated here. */
const wipeScriptPath = "deploy/rig/wipe-tickets.sql";

function wipeTruncated(script: string): readonly string[] {
  const named = /TRUNCATE TABLE([\s\S]*?)RESTART IDENTITY/u.exec(script)?.[1];
  if (named === undefined)
    throw new Error("the wipe names no relations to truncate");
  return [...named.matchAll(/public\.(\w+)/gu)].map(([, table]) =>
    String(table),
  );
}

/** What the wipe keeps: what a project is, rather than what it has done, and what was reported or read of its repositories. */
const wipeKept = [
  "action_observation",
  "admitted_worker",
  "agent_account_press",
  "agent_account_setting",
  "capacity_account",
  "chat_host",
  "configuration_revision",
  "deployment_authoring_policy",
  "execution_cluster",
  "execution_routing",
  "forge_installation",
  "installation_authority",
  "invite_link",
  "member_thread_limit",
  "personal_runner",
  "personal_runner_project",
  "personal_runner_registration_token",
  "project",
  "project_creation_grant",
  "project_creation_operation",
  "project_execution_placement",
  "project_owner_fallback",
  "project_repository",
  "project_repository_bind_operation",
  "project_session_placement",
  "recovery_epoch",
  "repository_action",
  "repository_configuration_import",
  "repository_configuration_provenance",
  "repository_configuration_version",
  "repository_configuration_workload_path",
  "schema_migration",
  "selector_inventory_state",
  "selector_project_settings",
  "selector_project_settings_history",
  "selector_runtime_readiness",
  "selector_runtime_settings",
  "selector_runtime_settings_history",
  "session_launch",
  "session_routing",
  "tenant",
  "thread_wake_cursor",
  "worker_pool",
  "worker_pool_registration_token",
];

/** The history the wipe is run against: a released draft, a journalled decision and the ticket it projected. */
const wipedHistory = `
  INSERT INTO operation
    (tenant,project,operation,authority_kind,authority_subject,admission,
     key_version,key_digest,payload_digest,command,command_tag)
  VALUES('tenant-91','project-91','operation-91','User','author','Ordinary',
         'v1','key-91','payload-91','{}','CreateTicket');
  INSERT INTO decision_input
    (tenant,project,ordinal,input_kind,input_id,base_priority,lifecycle_generation,
     state,decided_seq,terminal_at)
  VALUES('tenant-91','project-91',50,'Operation','operation-91','Ordinary',1,
         'Journaled',1,now());
  INSERT INTO journal_entry
    (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
     recovery_epoch,cause_kind,cause_id)
  VALUES('tenant-91','project-91',1,'${journalledRevocation}','digest-91','genesis',
         'owner',1,'epoch-91','Operation','operation-91');
  INSERT INTO ticket_projection(tenant,project,ticket,phase,seq,escalation)
  VALUES('tenant-91','project-91',1,'Escalated',1,'WorkFailureEscalated');
  UPDATE project SET head=1,ingress_next=51,ticket_next=9,notification_next=4,
                     manifest_next=7
   WHERE tenant='tenant-91' AND project='project-91';
  UPDATE thread_wake_cursor SET sequence=40`;

/** What the seed above fills, so the case proves an emptying rather than an emptiness. */
const wipedFilled = [
  "draft",
  "draft_brief",
  "draft_revision",
  "decision_input",
  "journal_entry",
  "operation",
  "project_change",
  "ticket_projection",
];

async function wipeCounted(
  subject: pg.Pool,
  tables: readonly string[],
): Promise<Record<string, number>> {
  const counted: Record<string, number> = {};
  for (const table of tables)
    counted[table] = (
      await subject.query<{ held: number }>(
        `SELECT count(*)::int AS held FROM public.${table}`,
      )
    ).rows[0]?.held as number;
  return counted;
}

/** The history the wipe is run against: a released draft, a journalled decision and the ticket it projected. */
async function wipeSeeded(subject: pg.Pool): Promise<void> {
  await seedProposingBinding(subject);
  assert.deepEqual(
    await createdProposingDraft(subject, "refs/heads/branch-91"),
    [{ result: "Created", ticket: "1" }],
  );
  assert.deepEqual(
    (
      await subject.query<{ released: boolean }>(
        `SELECT ${draftReleaseFunction}
           ('tenant-91','project-91',1,1,'revision-91','digest-91',true) AS released`,
      )
    ).rows,
    [{ released: true }],
  );
  await subject.query(wipedHistory);
  assert.deepEqual(
    Object.entries(await wipeCounted(subject, wipedFilled))
      .filter(([, held]) => held === 0)
      .map(([table]) => table),
    [],
    "every relation the case counts on was filled",
  );
}

/** What the wipe leaves standing: a project at a fresh install's counters, and the rows it keeps. */
async function wipeStanding(subject: pg.Pool): Promise<void> {
  assert.deepEqual(
    (
      await subject.query(
        `SELECT head::text AS head,ingress_next::text AS ingress,
                ticket_next::text AS ticket,notification_next::text AS notification,
                manifest_next::text AS manifest,lifecycle
           FROM project`,
      )
    ).rows,
    [
      {
        head: "0",
        ingress: "1",
        ticket: "1",
        notification: "1",
        manifest: "1",
        lifecycle: "Active",
      },
    ],
  );
  assert.deepEqual(
    (
      await subject.query(
        "SELECT sequence::text AS sequence FROM thread_wake_cursor",
      )
    ).rows,
    [{ sequence: "0" }],
    "the cursor does not sit past a log that was restarted",
  );
  assert.deepEqual(
    await wipeCounted(subject, [
      "configuration_revision",
      "project_repository",
      "recovery_epoch",
      "selector_inventory_state",
      "selector_runtime_readiness",
      "selector_runtime_settings",
    ]),
    {
      configuration_revision: 1,
      project_repository: 1,
      recovery_epoch: 1,
      selector_inventory_state: 1,
      selector_runtime_readiness: 1,
      selector_runtime_settings: 1,
    },
  );
}

test("the wipe empties every relation it names, resets the counters and keeps the project", async () => {
  const script = await readFile(wipeScriptPath, "utf8");
  await migratedDatabase("wipe_tickets", async (subject) => {
    await wipeSeeded(subject);

    await subject.query(script);

    const truncated = wipeTruncated(script);
    assert.deepEqual(
      Object.entries(await wipeCounted(subject, truncated))
        .filter(([, held]) => held !== 0)
        .map(([table]) => table),
      [],
      "every relation the wipe names is empty",
    );
    await wipeStanding(subject);
    assert.deepEqual(
      (
        await subject.query<{ tablename: string }>(
          `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
        )
      ).rows
        .map(({ tablename }) => tablename)
        .filter((table) => !truncated.includes(table)),
      wipeKept,
      "every relation this schema has is either wiped or kept on purpose",
    );
  });
});
