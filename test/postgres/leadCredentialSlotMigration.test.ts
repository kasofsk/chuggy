/**
 * 143 recreates `lead_session` answering the credential slot each lead was
 * opened on, owned and granted as 133 left it.
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
import { migration143 } from "../../src/adapters/postgres/schema/migrations/143-lead-credential-slot.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** Writes rows past their references, which a case about one door's answer has no use for. */
async function leadCredentialSlotPlanted(
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

test("143's lead_session answers the slot each stored lead was opened on", async () => {
  await migrationDatabase("lead_credential_slot", async (subject) => {
    await migratedBefore(subject, migration143.version);
    await leadCredentialSlotPlanted(
      subject,
      `INSERT INTO agent_session(tenant,project,session,kind,principal,
              capabilities,credential_slot,account,cluster,state)
       VALUES('tenant-143','project-subscription','lead-subscription','Lead',
              'principal-lead',ARRAY['ProjectRead'],'claude-code',
              'account-143','cluster-143','Open'),
             ('tenant-143','project-api','lead-api','Lead','principal-lead',
              ARRAY['ProjectRead'],'anthropic-api','account-143',
              'cluster-143','Open')`,
    );

    assert.ok((await postgresMigrate(subject)).includes(migration143.version));
    const slots = await subject.query<{
      session: string | null;
      credential_slot: string | null;
    }>(
      `SELECT l.session,l.credential_slot
         FROM unnest(ARRAY['project-subscription','project-api']) AS p(project),
              LATERAL lead_session('tenant-143',p.project) l
        ORDER BY l.session`,
    );
    assert.deepEqual(slots.rows, [
      { session: "lead-api", credential_slot: "anthropic-api" },
      { session: "lead-subscription", credential_slot: "claude-code" },
    ]);
  });
});

test("143's lead_session is owned and callable as 133 left it", async () => {
  await migrationDatabase("lead_credential_slot_door", async (subject) => {
    await migratedBefore(subject, migration143.version);
    await postgresMigrate(subject);
    const door = await subject.query(
      `SELECT pg_get_userbyid(p.proowner) AS owner,p.prosecdef AS definer,
              has_function_privilege($1,p.oid,'EXECUTE') AS api,
              has_function_privilege($2,p.oid,'EXECUTE') AS control,
              has_function_privilege($3,p.oid,'EXECUTE') AS selector,
              has_function_privilege($4,p.oid,'EXECUTE') AS worker,
              has_function_privilege('public',p.oid,'EXECUTE') AS public
         FROM pg_proc p WHERE p.proname='lead_session'`,
      [apiRole, selectorControlRole, selectorServiceRole, workerPlaneRole],
    );
    assert.deepEqual(door.rows, [
      {
        owner: boundaryOwnerRole,
        definer: true,
        api: false,
        control: false,
        selector: true,
        worker: false,
        public: false,
      },
    ]);
  });
});
