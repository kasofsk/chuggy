/**
 * 163 keys an account's usage and its limit by credential, lifting every row
 * kept before it to its agent's default name and dropping none.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";

import { postgresMigrate } from "../../src/adapters/postgres/pool.ts";
import { migration163 } from "../../src/adapters/postgres/schema/migrations/163-agent-account-credential.ts";
import { workerRunCredentialDefaults } from "../../src/contract/workerPlane.ts";
import { migratedBefore, migrationDatabase } from "./migrationHarness.ts";

/** Writes rows past their references in one transaction, which a case about the kept rows has no use for. */
async function agentAccountCredentialPlanted(
  subject: pg.Pool,
  statements: readonly string[],
): Promise<void> {
  await subject.query(
    [
      "BEGIN",
      "SET LOCAL session_replication_role=replica",
      ...statements,
      "COMMIT",
    ].join(";\n"),
  );
}

/** What the rule answers of each account's agent, read the same way on either side of the migration. */
async function agentAccountCredentialPauses(
  subject: pg.Pool,
): Promise<unknown[]> {
  return (
    await subject.query<Record<string, unknown>>(
      `SELECT k.principal,k.agent,h.paused_until,h.reasons,h.admitted_by_press
         FROM (VALUES ('person-a','Claude'),('person-a','Codex'),('person-b','Claude')) k(principal,agent)
        CROSS JOIN LATERAL agent_account_pause(k.principal,k.agent) h
        ORDER BY k.principal,k.agent`,
    )
  ).rows;
}

/** Readings, limits and a press as 109 and 110 keep them, before any is named by credential. */
const agentAccountCredentialKept: readonly string[] = [
  `INSERT INTO agent_account_usage
         (principal,agent,usage_window,utilization,resets_at,observed_at,
          tenant,project,execution,attempt)
       VALUES('person-a','Claude','five_hour',0.95,now()+interval '1 hour',now()-interval '2 minutes',
              't','p','e','a'),
             ('person-a','Claude','seven_day',0.1,now()+interval '1 day',now()-interval '2 minutes',
              't','p','e','a'),
             ('person-a','Codex','five_hour',0.2,now()+interval '1 hour',now()-interval '2 minutes',
              't','p','e','a')`,
  `INSERT INTO agent_account_limit
         (principal,agent,usage_window,resets_at,observed_at,tenant,project,execution,attempt)
       VALUES('person-a','Codex','five_hour',now()+interval '2 hours',now()-interval '1 minute',
              't','p','e','a'),
             ('person-b','Claude',NULL,NULL,now()-interval '1 minute','t','p','e','a')`,
  `INSERT INTO agent_account_press(principal,agent,pressed_at)
       VALUES('person-b','Claude',now())`,
];

/** One row as 163 lifts it, under its agent's default credential. */
function agentAccountCredentialLifted(
  kept: "reading" | "limit",
  principal: string,
  agent: "Claude" | "Codex",
  usageWindow: string | null,
) {
  return {
    kept,
    principal,
    agent,
    credential: workerRunCredentialDefaults[agent],
    usage_window: usageWindow,
  };
}

test("163 lifts every reading and limit kept before it to its agent's default credential, and the pause answers as it did", async () => {
  await migrationDatabase("agent_account_credential", async (subject) => {
    await migratedBefore(subject, migration163.version);
    await agentAccountCredentialPlanted(subject, agentAccountCredentialKept);
    const before = await agentAccountCredentialPauses(subject);

    assert.ok((await postgresMigrate(subject)).includes(migration163.version));
    assert.deepEqual(
      (
        await subject.query(
          `SELECT 'reading' AS kept,principal,agent,credential,usage_window
             FROM agent_account_usage
           UNION ALL
           SELECT 'limit',principal,agent,credential,usage_window
             FROM agent_account_limit
           ORDER BY kept DESC,principal,agent,usage_window`,
        )
      ).rows,
      [
        agentAccountCredentialLifted(
          "reading",
          "person-a",
          "Claude",
          "five_hour",
        ),
        agentAccountCredentialLifted(
          "reading",
          "person-a",
          "Claude",
          "seven_day",
        ),
        agentAccountCredentialLifted(
          "reading",
          "person-a",
          "Codex",
          "five_hour",
        ),
        agentAccountCredentialLifted("limit", "person-a", "Codex", "five_hour"),
        agentAccountCredentialLifted("limit", "person-b", "Claude", null),
      ],
    );
    assert.deepEqual(await agentAccountCredentialPauses(subject), before);
  });
});
