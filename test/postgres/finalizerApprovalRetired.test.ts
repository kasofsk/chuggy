/**
 * 181 retires the finalizer's approval: it refuses, and leaves every row as it
 * found it, while a stored row still names the approval or its `Decline`, and
 * on a database that names neither takes away the column, the action's attempt
 * and the door the approval was opened through.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration181 } from "../../src/adapters/postgres/schema/migrations/181-finalizer-approval-retired.ts";
import {
  deletionPartition,
  deletionJournalRow,
  journalledRevocation,
  migratedBefore,
  migrationDatabase,
} from "./migrationHarness.ts";

/** A claimed request and an attempt prepared against it, `required` naming whether it waits on an approval. */
function preparedAttempt(required: boolean): string {
  return `${deletionPartition}
  ${deletionJournalRow(1, journalledRevocation)};
  UPDATE project SET ingress_next=2 WHERE tenant='tenant-5' AND project='project-5';
  INSERT INTO configuration_revision
    (tenant,project,revision,canonical,digest,authority_kind,authority_subject)
  VALUES('tenant-5','project-5','revision-5','{}','digest-5','Agent','subject-5');
  INSERT INTO input_bundle(tenant,project,bundle,digest)
  VALUES('tenant-5','project-5','bundle-5',repeat('b',64));
  INSERT INTO project_repository(tenant,project,repository,recovery_epoch)
  VALUES('tenant-5','project-5','repository-5','epoch-5');
  INSERT INTO finalization_request
    (tenant,project,request,authorizing_seq,effect_position,ticket,ticket_version,
     request_generation,state,claim_owner,claim_generation,claim_expires_at,
     recovery_epoch,kind,work_cycle,finalization_generation)
  VALUES('tenant-5','project-5','request-5',1,0,1,1,1,'Open','owner',1,now(),
         'epoch-5','RunFinalizer',1,1);
  INSERT INTO finalization_attempt
    (tenant,project,attempt,request,ticket,repository,input_bundle,input_bundle_digest,
     target_ref,target_commit,strategy,configuration_revision,configuration_digest,
     attempt_digest,approval_required,outcome,candidate_commit,failure_kind)
  VALUES('tenant-5','project-5','attempt-5','request-5',1,'repository-5','bundle-5',
         repeat('b',64),'refs/heads/main',repeat('c',40),'Merge','revision-5','digest-5',
         repeat('d',64),${String(required)},'Prepared',repeat('c',40),NULL)`;
}

/** The approval a person was asked for against the prepared attempt, offering `Approve` and `Decline`. */
const openedApproval = `
  INSERT INTO native_action
    (tenant,project,action,authorizing_seq,effect_position,ticket,action_version,
     kind,escalation,required_capability,attempt)
  VALUES('tenant-5','project-5','action-5',1,0,1,1,
         'FinalizationApproval','NoEscalation','ApproveFinalization','attempt-5');
  INSERT INTO native_action_resolution(tenant,project,action,resolution)
  VALUES('tenant-5','project-5','action-5','Approve'),
        ('tenant-5','project-5','action-5','Decline')`;

/** An answer the inbox accepted and nothing has yet decided, which says `Decline`. */
const storedDecline = `${deletionPartition}
  INSERT INTO operation
    (tenant,project,operation,authority_kind,authority_subject,admission,
     key_version,key_digest,payload_digest,command,command_tag)
  VALUES('tenant-5','project-5','operation-decline','User','subject-5','Ordinary',
         'v1',repeat('e',64),repeat('f',64),
         '{"version":1,"command":"ResolveNativeAction","action":"action-5","authorizingSeq":1,"resolution":"Decline"}',
         'ResolveNativeAction')`;

/** Every row of `relation`, whole, in a stable order. */
async function rowsOf(subject: pg.Pool, relation: string): Promise<unknown[]> {
  return (
    await subject.query<{ row: unknown }>(
      `SELECT to_jsonb(t) AS row FROM ${relation} t ORDER BY to_jsonb(t)::text`,
    )
  ).rows.map((found) => found.row);
}

async function appliedThrough(subject: pg.Pool): Promise<number> {
  const found = await subject.query<{ version: number }>(
    "SELECT max(version)::int AS version FROM schema_migration",
  );
  return found.rows[0]?.version ?? 0;
}

const refusals: readonly (readonly [
  string,
  string,
  RegExp,
  readonly string[],
])[] = [
  [
    "an attempt that records an approval as required",
    preparedAttempt(true),
    /migration 181: a finalization attempt records an approval as required/u,
    ["finalization_attempt"],
  ],
  [
    "a finalization approval offering Decline",
    `${preparedAttempt(false)};\n${openedApproval}`,
    /migration 181: a finalization approval was opened/u,
    ["finalization_attempt", "native_action", "native_action_resolution"],
  ],
  [
    "a stored operation answering Decline",
    storedDecline,
    /migration 181: a stored operation answers Decline/u,
    ["operation"],
  ],
];

for (const [named, seed, refusal, relations] of refusals) {
  test(`181 refuses, and leaves its rows as it found them, over ${named}`, async () => {
    await migrationDatabase("approval_retired_refused", async (subject) => {
      await migratedBefore(subject, migration181.version);
      await subject.query(seed);
      const before = await Promise.all(
        relations.map((relation) => rowsOf(subject, relation)),
      );
      assert.ok(before.every((rows) => rows.length > 0));

      await assert.rejects(postgresMigrate(subject), refusal);

      assert.equal(await appliedThrough(subject), migration181.version - 1);
      assert.deepEqual(
        await Promise.all(
          relations.map((relation) => rowsOf(subject, relation)),
        ),
        before,
      );
    });
  });
}

test("181 applies over a database that names no approval, and takes the approval's column, attempt and door away", async () => {
  await migrationDatabase("approval_retired_applied", async (subject) => {
    await migratedBefore(subject, migration181.version);
    await subject.query(preparedAttempt(false));
    const attempt = await subject.query<{ outcome: string }>(
      "SELECT outcome FROM finalization_attempt WHERE attempt='attempt-5'",
    );

    assert.ok((await postgresMigrate(subject)).includes(migration181.version));

    assert.deepEqual(
      (
        await subject.query(
          `SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema='public'
              AND ((table_name='finalization_attempt' AND column_name='approval_required')
                OR (table_name='native_action' AND column_name='attempt'))`,
        )
      ).rows,
      [],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT proname FROM pg_proc
            WHERE proname='request_finalization_approval'`,
        )
      ).rows,
      [],
    );
    assert.deepEqual(
      (
        await subject.query<{ outcome: string }>(
          "SELECT outcome FROM finalization_attempt WHERE attempt='attempt-5'",
        )
      ).rows,
      attempt.rows,
    );
  });
});
