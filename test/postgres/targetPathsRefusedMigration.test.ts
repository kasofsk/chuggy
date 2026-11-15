/**
 * 192 gives a request's hold the files it is over, and every request held
 * before it reads back whole, naming none.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration192 } from "../../src/adapters/postgres/schema/migrations/192-target-paths-refused.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** A request held as the baseline keeps one, written past its references. */
const heldRequestKept = [
  "BEGIN",
  "SET LOCAL session_replication_role=replica",
  `INSERT INTO finalization_request
     (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
      request_generation,state,claim_owner,claim_generation,claim_expires_at,
      recovery_epoch,kind,work_cycle,finalization_generation,hold_kind,
      hold_passes,held_since)
   VALUES('t','p','r',1,0,1,1,1,'Registered','o',1,now()+make_interval(secs=>60),
          'e','RunFinalizer',1,1,'TargetUnreadable',2,now())`,
  "COMMIT",
].join(";\n");

const heldRequestRead = `SELECT request,state,hold_kind,hold_passes,held_since
  FROM finalization_request`;

test("192 keeps every request held before it whole, naming no file", async () => {
  await migrationDatabase("target_paths_refused", async (subject) => {
    await migratedBefore(subject, migration192.version);
    await subject.query(heldRequestKept);
    const before = (await subject.query(heldRequestRead)).rows;
    assert.equal(before.length, 1);

    assert.ok((await postgresMigrate(subject)).includes(migration192.version));
    assert.deepEqual((await subject.query(heldRequestRead)).rows, before);
    assert.deepEqual(
      (
        await subject.query(
          "SELECT hold_paths,hold_paths_truncated FROM finalization_request",
        )
      ).rows,
      [{ hold_paths: null, hold_paths_truncated: null }],
    );
  });
});
