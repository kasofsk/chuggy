/**
 * 208 deletes every lead and inquiry with the rows under them, keeps every
 * thread whole, refuses over a lead still live, and narrows the session checks
 * to a thread's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration208 } from "../../src/adapters/postgres/schema/migrations/208-session-history-retired.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** One session row of `kind`, its `parent` NULL or quoted, in `state`. */
function sessionRow(
  session: string,
  kind: string,
  parent: string,
  state: string,
  capabilities: string,
): string {
  const closedAt = state === "Closed" ? "now()" : "NULL";
  return `('t','p','${session}','${kind}','principal',${parent},${capabilities},
           'slot','account','cluster','${state}',${closedAt})`;
}

/** One answered turn of `session` at `ordinal`, holding an `inputKind`. */
function answeredTurn(
  session: string,
  ordinal: number,
  inputKind: string,
): string {
  return `('t','p','${session}','turn-${session}',${String(ordinal)},'${inputKind}',
           'asked','InCluster','Answered','answered',now())`;
}

/**
 * A closed lead with a turn, its context reading, a store batch, an attempt, an
 * operation and a draft naming it and its changes; a closed inquiry forked from
 * it; and an open thread holding the same, one attempt of it a chat host's whose
 * set names `LeadDecision`. Written past the triggers and references, so the
 * migration's own deletion is what the references are checked against.
 */
function historySeeded(leadState: string): string {
  return [
    "BEGIN",
    "SET LOCAL session_replication_role=replica",
    `INSERT INTO agent_session
       (tenant,project,session,kind,principal,parent_session,capabilities,
        credential_slot,account,cluster,state,closed_at)
     VALUES ${[
       sessionRow("lead", "Lead", "NULL", leadState, "ARRAY['LeadDecision']"),
       sessionRow("inquiry", "Inquiry", "'lead'", "Closed", "'{}'"),
       sessionRow("thread", "Thread", "NULL", "Open", "ARRAY['ProjectRead']"),
     ].join(",\n")}`,
    `INSERT INTO session_turn
       (tenant,project,session,turn,ordinal,input_kind,input,route,state,result,ended_at)
     VALUES ${[
       answeredTurn("lead", 1, "Observation"),
       answeredTurn("inquiry", 1, "Inquiry"),
       answeredTurn("thread", 1, "UserMessage"),
     ].join(",\n")}`,
    `INSERT INTO session_turn_context(tenant,project,session,turn_ordinal,reading,cause)
     VALUES ('t','p','lead',1,1,'End'),('t','p','thread',1,1,'End')`,
    `INSERT INTO session_store_batch(tenant,project,session,stream,batch,digest,bytes,events)
     VALUES ('t','p','lead','transcript',1,repeat('a',64),1,1),
            ('t','p','thread','transcript',1,repeat('b',64),1,1)`,
    `INSERT INTO session_attempt
       (tenant,project,session,attempt,attempt_number,recovery_epoch,bearer,
        bearer_secret_digest,state,ended_at)
     VALUES ('t','p','lead','attempt-lead',1,'e','bearer-lead',repeat('c',64),
             'Reported',now())`,
    `INSERT INTO session_attempt
       (tenant,project,session,attempt,attempt_number,recovery_epoch,bearer,
        bearer_secret_digest,state,ended_at,pool,pool_principal,holder_kind,
        assignment,image,launch,host_capabilities)
     VALUES ('t','p','thread','attempt-thread',1,'e','bearer-thread',repeat('d',64),
             'Reported',now(),'owner','principal','ChatHost','assignment','image',
             '{}',ARRAY['ProjectRead','LeadDecision'])`,
    `INSERT INTO operation
       (tenant,project,operation,authority_kind,authority_subject,admission,
        key_version,key_digest,payload_digest,command,command_tag,via_session)
     VALUES ('t','p','operation-lead','Agent','subject','Ordinary','v1',
             repeat('9',64),repeat('f',64),'{}','CreateTicket','lead'),
            ('t','p','operation-thread','Agent','subject','Ordinary','v1',
             repeat('e',64),repeat('f',64),'{}','CreateTicket','thread')`,
    `INSERT INTO draft
       (tenant,project,ticket,authoring_version,state,configuration_revision,origin_session)
     VALUES ('t','p',1,1,'Draft','revision','lead'),
            ('t','p',2,1,'Draft','revision','thread')`,
    `INSERT INTO project_change(tenant,project,kind,resource)
     VALUES ('t','p','Session','{"session":"lead","kind":"Lead","state":"Closed"}'),
            ('t','p','Session','{"session":"inquiry","kind":"Inquiry","turn":"turn-inquiry"}'),
            ('t','p','Session','{"session":"thread","kind":"Thread","state":"Open"}'),
            ('t','p','Ticket','{"ticket":1}')`,
    "COMMIT",
  ].join(";\n");
}

/** Every relation the seed writes, read whole in a stable order. */
const seededRelations = [
  "agent_session",
  "session_turn",
  "session_turn_context",
  "session_store_batch",
  "session_attempt",
  "operation",
  "draft",
  "project_change",
] as const;

async function rowsOf(subject: pg.Pool, relation: string): Promise<unknown[]> {
  return (
    await subject.query<{ row: unknown }>(
      `SELECT to_jsonb(t) AS row FROM ${relation} t ORDER BY to_jsonb(t)::text`,
    )
  ).rows.map((found) => found.row);
}

/** The column `column` of every row of `relation`, in its order. */
async function columnOf(
  subject: pg.Pool,
  relation: string,
  column: string,
  order: string,
): Promise<unknown[]> {
  return (
    await subject.query<Record<string, unknown>>(
      `SELECT ${column} AS value FROM ${relation} ORDER BY ${order}`,
    )
  ).rows.map((row) => row["value"]);
}

async function appliedThrough(subject: pg.Pool): Promise<number> {
  const found = await subject.query<{ version: number }>(
    "SELECT max(version)::int AS version FROM schema_migration",
  );
  return found.rows[0]?.version ?? 0;
}

/** The thread's rows under every relation the deletion reaches, less the columns it drops. */
async function threadRows(subject: pg.Pool): Promise<unknown[][]> {
  return Promise.all(
    [
      "agent_session",
      "session_turn",
      "session_turn_context",
      "session_store_batch",
    ].map(async (relation) =>
      (
        await subject.query<{ row: unknown }>(
          `SELECT to_jsonb(t) - ARRAY['parent_session','auto_compact_window',
                                      'system_prompt_own'] AS row
             FROM ${relation} t WHERE session='thread'`,
        )
      ).rows.map((found) => found.row),
    ),
  );
}

/** Asserts that what named a lead names nothing, what named the thread still does, and the columns and index are gone. */
async function historyRetiredReferencesCleared(
  subject: pg.Pool,
): Promise<void> {
  assert.deepEqual(
    await columnOf(subject, "operation", "via_session", "operation"),
    [null, "thread"],
  );
  assert.deepEqual(
    await columnOf(subject, "draft", "origin_session", "ticket"),
    [null, "thread"],
  );
  assert.deepEqual(
    await columnOf(subject, "project_change", "resource", "sequence"),
    ['{"session":"thread","kind":"Thread","state":"Open"}', '{"ticket":1}'],
  );
  assert.deepEqual(
    (
      await subject.query(
        `SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='agent_session'
              AND column_name IN ('parent_session','auto_compact_window','system_prompt_own')`,
      )
    ).rows,
    [],
  );
  assert.deepEqual(
    (
      await subject.query(
        "SELECT to_regclass('public.agent_session_one_lead_per_project') AS index",
      )
    ).rows,
    [{ index: null }],
  );
}

test("208 deletes every lead and inquiry with the rows under them, clears the references and keeps the thread whole", async () => {
  await migrationDatabase("session_history_retired", async (subject) => {
    await migratedBefore(subject, migration208.version);
    await subject.query(historySeeded("Closed"));
    const threadBefore = await threadRows(subject);

    assert.ok((await postgresMigrate(subject)).includes(migration208.version));

    for (const relation of [
      "agent_session",
      "session_turn",
      "session_turn_context",
      "session_store_batch",
      "session_attempt",
    ])
      assert.deepEqual(
        await columnOf(subject, relation, "session", "session"),
        ["thread"],
        relation,
      );
    assert.deepEqual(await threadRows(subject), threadBefore);
    assert.deepEqual(
      await columnOf(
        subject,
        "session_attempt",
        "host_capabilities",
        "attempt",
      ),
      [["ProjectRead"]],
    );
    await historyRetiredReferencesCleared(subject);
  });
});

test("208 refuses over an open lead, and leaves every row as it found them", async () => {
  await migrationDatabase("session_history_refused", async (subject) => {
    await migratedBefore(subject, migration208.version);
    await subject.query(historySeeded("Open"));
    const before = await Promise.all(
      seededRelations.map((relation) => rowsOf(subject, relation)),
    );

    await assert.rejects(
      postgresMigrate(subject),
      /migration 208: a lead or an inquiry is open/u,
    );

    assert.equal(await appliedThrough(subject), migration208.version - 1);
    assert.deepEqual(
      await Promise.all(
        seededRelations.map((relation) => rowsOf(subject, relation)),
      ),
      before,
    );
  });
});

test("after 208 a session is a thread, holds no LeadDecision and takes no observation", async () => {
  await migrationDatabase("session_history_narrowed", async (subject) => {
    await migratedBefore(subject, migration208.version);
    await subject.query(historySeeded("Closed"));
    assert.ok((await postgresMigrate(subject)).includes(migration208.version));

    const client = await subject.connect();
    try {
      for (const [statement, refusal] of [
        [
          "UPDATE agent_session SET kind='Lead'",
          /agent_session_kind_is_known/u,
        ],
        [
          "UPDATE agent_session SET capabilities=ARRAY['LeadDecision']",
          /agent_session_capabilities_are_known/u,
        ],
        [
          "UPDATE session_attempt SET host_capabilities=ARRAY['LeadDecision']",
          /session_attempt_host_capabilities_are_known/u,
        ],
        [
          "UPDATE session_turn SET input_kind='Observation'",
          /session_turn_kind_is_known/u,
        ],
      ] as const) {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role=replica");
        await assert.rejects(client.query(statement), refusal);
        await client.query("ROLLBACK");
      }
    } finally {
      client.release();
    }
  });
});
