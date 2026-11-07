/**
 * A setting written before 130 with its lead option off is carried forward by
 * it: its thresholds and its threads option read as they were, and its lead
 * pauses with the account, since the option is retired.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import {
  postgresMigrate,
  postgresMigrateCompatible,
} from "../../src/adapters/postgres/pool.ts";
import { migrations } from "../../src/adapters/postgres/schema.ts";
import { migrationDatabase } from "./migrationHarness.ts";

/** Migrates an empty database through every migration before 130, and no further. */
async function leadPausesBefore(subject: pg.Pool): Promise<void> {
  const before = migrations
    .filter(({ version }) => version < 130)
    .map(({ version, name }) => ({ version, name }));
  const contract = { required: before, compatible: before };
  assert.deepEqual(
    await postgresMigrateCompatible(subject, {
      current: contract,
      retainedPrevious: contract,
    }),
    { migrated: "Applied", versions: before.map(({ version }) => version) },
  );
}

const principal = "https://issuer.invalid#member-130";

/** Whether the account's pause holds back a session of `kind`, as the pool plane's claim asks. */
async function leadPausesHeld(subject: pg.Pool, kind: string) {
  return (
    await subject.query<{ paused: boolean }>(
      `SELECT agent_account_session_paused($1,$2) AS paused`,
      [principal, kind],
    )
  ).rows[0]?.paused;
}

test("a setting that kept its lead running before 130 keeps its thresholds and threads option after it, and its lead pauses", async () => {
  await migrationDatabase("lead_pauses", async (subject) => {
    await leadPausesBefore(subject);
    await subject.query(
      `INSERT INTO agent_account_setting
         (principal,agent,five_hour_percent,seven_day_percent,pauses_threads,pauses_lead)
       VALUES($1,'Claude',70,95,true,false)`,
      [principal],
    );
    const planting = await subject.connect();
    try {
      await planting.query("BEGIN");
      await planting.query("SET LOCAL session_replication_role=replica");
      await planting.query(
        `INSERT INTO agent_account_usage
           (principal,agent,usage_window,utilization,resets_at,observed_at,
            tenant,project,execution,attempt)
         VALUES($1,'Claude','seven_day',0.96,now()+interval '1 hour',now(),
                'tenant','project','execution','attempt')`,
        [principal],
      );
      await planting.query("COMMIT");
    } finally {
      planting.release();
    }
    assert.equal(await leadPausesHeld(subject, "Lead"), false);
    await postgresMigrate(subject);
    assert.deepEqual(
      (
        await subject.query(
          `SELECT principal,agent,five_hour_percent,seven_day_percent,pauses_threads
             FROM agent_account_setting`,
        )
      ).rows,
      [
        {
          principal,
          agent: "Claude",
          five_hour_percent: 70,
          seven_day_percent: 95,
          pauses_threads: true,
        },
      ],
    );
    assert.deepEqual(
      (
        await subject.query(
          `SELECT * FROM agent_account_settings($1,'Claude')`,
          [principal],
        )
      ).rows,
      [{ five_hour_percent: 70, seven_day_percent: 95, pauses_threads: true }],
    );
    assert.equal(await leadPausesHeld(subject, "Lead"), true);
    assert.equal(await leadPausesHeld(subject, "Thread"), true);
  });
});
