/**
 * The startup privilege check, against a real migrated database: every door a
 * decision opens answers for the selector's own role, and nothing it names is
 * a signature no function has.
 *
 * IT IS DRIVEN ON THE SELECTOR'S POOL AND NOT THE OWNER'S. The migration owner
 * holds EXECUTE on everything, so a case run as the owner would be green over
 * any grant at all and would say nothing about the control.
 *
 * A SIGNATURE NO FUNCTION HAS IS A RAISE, NOT A REFUSAL.
 * `has_function_privilege` resolves a signature exactly, so a hand-copied
 * argument type does not answer false — it throws, and the precondition that
 * calls it answers Undecided at every start.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  leadDoorRefused,
  leadDoorSignatures,
  postgresLeadDoorsRefused,
} from "../../src/adapters/postgres/leadMailbox.ts";
import {
  agenticRefusalRecordFunction,
  agenticRefusalStandingFunction,
  leadSessionFunction,
  leadTurnEnqueueFunction,
  leadTurnReadFunction,
  leadTurnWithdrawFunction,
  selectorInteractionsReadFunction,
  sessionSystemPromptSetFunction,
} from "../../src/adapters/postgres/schema/shared.ts";
import {
  apiRole,
  selectorServiceRole,
} from "../../src/adapters/postgres/schema.ts";
import { postgresHarnessRolePool } from "./harness.ts";
import type pg from "pg";

let selectorPool: pg.Pool;
let apiPool: pg.Pool;

before(() => {
  selectorPool = postgresHarnessRolePool(selectorServiceRole);
  apiPool = postgresHarnessRolePool(apiRole);
});

after(async () => {
  await selectorPool.end();
  await apiPool.end();
});

test("every door a decision opens is one the selector's own role may execute", async () => {
  assert.deepEqual(
    await postgresLeadDoorsRefused(selectorPool),
    [],
    "a door this role cannot execute is a selector that never starts",
  );
});

test("every door names a signature the migrated schema actually has", async () => {
  for (const door of leadDoorSignatures) {
    const found = await selectorPool.query<{ resolved: string | null }>(
      `SELECT $1::regprocedure::text AS resolved`,
      [door],
    );
    assert.equal(
      found.rows[0]?.resolved?.replace(/\s/gu, ""),
      door.replace(/\s/gu, ""),
      `${door} must resolve to itself, or the privilege read raises rather than refusing`,
    );
  }
});

test("a door the role was never granted is reported as refused", async () => {
  const refused = await postgresLeadDoorsRefused(apiPool);
  assert.notDeepEqual(
    refused,
    [],
    "the API role holds none of the selector's write doors, so it must be refused",
  );
  for (const door of refused) assert.ok(leadDoorSignatures.includes(door));
});

test("an answer the server did not give is refused rather than permitted", () => {
  assert.equal(leadDoorRefused({ permitted: true }), false);
  assert.equal(leadDoorRefused({ permitted: false }), true);
  assert.equal(
    leadDoorRefused({ permitted: null }),
    true,
    "a control that reads a null as consent is worse than no control",
  );
});

test("the list names every door the selector's own role is granted", () => {
  const named = leadDoorSignatures.map((door) =>
    door.slice(0, door.indexOf("(")),
  );
  for (const door of [
    agenticRefusalRecordFunction,
    agenticRefusalStandingFunction,
    leadSessionFunction,
    leadTurnEnqueueFunction,
    leadTurnReadFunction,
    leadTurnWithdrawFunction,
    selectorInteractionsReadFunction,
    sessionSystemPromptSetFunction,
  ])
    assert.ok(
      named.includes(door),
      `${door} is granted to the selector, so a check that omits it passes a role that cannot start`,
    );
});
