import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { migrations } from "../../src/adapters/postgres/schema.ts";
import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import { postgresHarnessUrl } from "./harness.ts";
import type pg from "pg";
import { parseTicketCommand } from "../../src/interpreter/wire.ts";

function databaseUrl(database: string): string {
  const url = new URL(postgresHarnessUrl());
  url.pathname = `/${database}`;
  return url.toString();
}

async function seedI2(subject: pg.Pool): Promise<void> {
  await subject.query(`INSERT INTO recovery_epoch (epoch) VALUES ('epoch')`);
  await subject.query(
    `INSERT INTO project (tenant,project,lifecycle,head,ingress_next)
     VALUES ('tenant','project','Active',1,5)`,
  );
  const states = ["Pending", "Succeeded", "Refused", "Cancelled"] as const;
  for (const [index, state] of states.entries()) {
    const operation = state.toLowerCase();
    await subject.query(
      `INSERT INTO operation
       (tenant,project,operation,authority_kind,authority_subject,admission,
        key_version,key_digest,payload_digest,command,lifecycle_generation,state,
        settled_at,settled_authority_kind,settled_authority_subject,
        outcome_code,decided_seq,refused_head,refused_lifecycle_generation)
       VALUES ('tenant','project',$1,'User','subject','Ordinary','v1',$2,$3,
        '{"type":"Dispatch","value":1}',1,$4,
        CASE WHEN $4='Pending' THEN NULL ELSE now() END,
        CASE WHEN $4='Pending' THEN NULL ELSE 'ProjectWriter' END,
        CASE WHEN $4='Pending' THEN NULL ELSE 'owner' END,
        CASE WHEN $4='Refused' THEN 'NotEnabled' ELSE NULL END,
        CASE WHEN $4='Succeeded' THEN 1 ELSE NULL END,
        CASE WHEN $4='Refused' THEN 0 ELSE NULL END,
        CASE WHEN $4='Refused' THEN 1 ELSE NULL END)`,
      [operation, `key-${operation}`, `payload-${operation}`, state],
    );
    await subject.query(
      `INSERT INTO inbox_item (tenant,project,ordinal,operation,consumable)
       VALUES ('tenant','project',$1,$2,$3)`,
      [index + 1, operation, state === "Pending"],
    );
  }
  await subject.query(
    `INSERT INTO operation
     (tenant,project,operation,authority_kind,authority_subject,admission,
      key_version,key_digest,payload_digest,command,lifecycle_generation,state)
     VALUES ('tenant','project','opaque','User','subject','Ordinary',
       'v1','key-opaque','payload-opaque','not-json',1,'Pending')`,
  );
  await subject.query(
    `INSERT INTO inbox_item (tenant,project,ordinal,operation,consumable)
     VALUES ('tenant','project',5,'opaque',true)`,
  );
  await subject.query(
    `INSERT INTO journal_entry
     (tenant,project,seq,entry,entry_digest,prev_digest,owner,fencing_epoch,
      recovery_epoch,cause_operation)
     VALUES ('tenant','project',1,'{}','digest','genesis','owner',1,'epoch','succeeded')`,
  );
}

test("I3 preserves every I2 operation outcome and its journal cause", async () => {
  const database = `chuggy_i3_${randomUUID().replaceAll("-", "")}`;
  const admin = postgresPool(postgresHarnessUrl());
  await admin.query(`CREATE DATABASE ${database}`);
  const subject = postgresPool(databaseUrl(database));
  try {
    for (const migration of migrations.slice(0, 4)) {
      for (const statement of migration.statements)
        await subject.query(statement);
    }
    await seedI2(subject);
    for (const migration of migrations.slice(4)) {
      await subject.query("BEGIN");
      for (const statement of migration.statements)
        await subject.query(statement);
      await subject.query("COMMIT");
    }

    assert.deepEqual(
      (
        await subject.query(
          `SELECT input_id,state,decided_seq FROM decision_input ORDER BY ordinal`,
        )
      ).rows,
      [
        { input_id: "pending", state: "Pending", decided_seq: null },
        { input_id: "succeeded", state: "Journaled", decided_seq: "1" },
        { input_id: "refused", state: "Refused", decided_seq: null },
        { input_id: "cancelled", state: "Cancelled", decided_seq: null },
        { input_id: "opaque", state: "Refused", decided_seq: null },
      ],
    );
    assert.deepEqual(
      (await subject.query(`SELECT cause_kind,cause_id FROM journal_entry`))
        .rows,
      [{ cause_kind: "Operation", cause_id: "succeeded" }],
    );
    const migrated = await subject.query<{ command: string }>(
      `SELECT command FROM operation WHERE operation='pending'`,
    );
    assert.deepEqual(parseTicketCommand(migrated.rows[0]?.command ?? ""), {
      parsed: "Ok",
      value: {
        version: 1,
        command: "Decide",
        event: { type: "Dispatch", value: 1 },
      },
    });
    assert.deepEqual(
      (
        await subject.query(
          `SELECT state,outcome_code FROM decision_input WHERE input_id='opaque'`,
        )
      ).rows,
      [{ state: "Refused", outcome_code: "CommandUnreadable" }],
    );
  } finally {
    await subject.end();
    await admin.query(`DROP DATABASE ${database} WITH (FORCE)`);
    await admin.end();
  }
});
