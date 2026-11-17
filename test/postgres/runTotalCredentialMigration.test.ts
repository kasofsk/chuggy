/**
 * 190 gives a run's totals the credential it ran on, and every totals row kept
 * before it reads back whole, naming none.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration190 } from "../../src/adapters/postgres/schema/migrations/190-run-total-credential.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** A run and its totals as the baseline keeps them, written past their references. */
const runTotalCredentialKept = [
  "BEGIN",
  "SET LOCAL session_replication_role=replica",
  `INSERT INTO execution_run (tenant,project,execution,attempt)
     VALUES('t','p','e','a')`,
  `INSERT INTO execution_run_total
       (tenant,project,execution,attempt,turns,duration_ms,duration_api_ms,
        tokens_input,tokens_output,tokens_cache_creation,tokens_cache_read,
        cost_usd_micros,cost_basis,permission_denials,result_subtype,stop_reason)
     VALUES('t','p','e','a',3,1200,900,10,20,30,40,4200,'List',1,'success','end_turn')`,
  "COMMIT",
].join(";\n");

const runTotalCredentialRead = `SELECT tenant,project,execution,attempt,turns::text,duration_ms::text,
       duration_api_ms::text,tokens_input::text,tokens_output::text,
       tokens_cache_creation::text,tokens_cache_read::text,cost_usd_micros::text,
       cost_basis,permission_denials::text,result_subtype,stop_reason,recorded_at
  FROM execution_run_total`;

test("190 keeps every totals row kept before it whole, naming no credential", async () => {
  await migrationDatabase("run_total_credential", async (subject) => {
    await migratedBefore(subject, migration190.version);
    await subject.query(runTotalCredentialKept);
    const before = (await subject.query(runTotalCredentialRead)).rows;
    assert.equal(before.length, 1);

    assert.ok((await postgresMigrate(subject)).includes(migration190.version));
    assert.deepEqual(
      (await subject.query(runTotalCredentialRead)).rows,
      before,
    );
    assert.deepEqual(
      (await subject.query("SELECT credential FROM execution_run_total")).rows,
      [{ credential: null }],
    );
  });
});
