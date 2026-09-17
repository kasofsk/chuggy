/**
 * The doors a lead decision opens, against a real migrated database: every one
 * answers for the selector's own role, nothing it names is a signature no
 * function has, and the list is that role's decision grants exactly rather
 * than some of them.
 *
 * A LOWER BOUND IS NOT A CHECK. A list that merely contains the doors somebody
 * wrote down passes while it omits the door a new migration granted, and passes
 * while it names one a migration took away. So the case below reads the grants
 * out of the catalogue and compares sets.
 *
 * IT IS DRIVEN ON THE SELECTOR'S POOL AND NOT THE OWNER'S. The migration owner
 * holds EXECUTE on everything, so a case run as the owner would be green over
 * any grant at all and would say nothing about the control.
 *
 * A SIGNATURE NO FUNCTION HAS IS A RAISE, NOT A REFUSAL.
 * `has_function_privilege` resolves a signature exactly, so a hand-copied
 * argument type does not answer false — it throws.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import {
  leadDoorRefused,
  leadDoorSignatures,
  postgresLeadDoorsRefused,
} from "../../src/adapters/postgres/leadMailbox.ts";
import {
  selectorAttemptAdvanceFunction,
  selectorAttemptAllocateFunction,
  selectorAttemptReconcileFunction,
  selectorClaimFunction,
  selectorDeliveryFunction,
  selectorHostReadinessFunction,
  selectorReconcileClaimFunction,
  threadWakeCandidatesFunction,
  threadWakeCursorAdvanceFunction,
  threadWakeFunction,
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

/**
 * Every function this role is granted EXECUTE on that no decision opens: the
 * attempts, deliveries and thread wakes the same process drives, each named
 * where its own schema names it. It is what lets the case below compare sets
 * rather than test membership, and a door granted to this role that is in
 * neither it nor `leadDoorSignatures` reds that case until somebody says which
 * of the two it belongs in.
 */
const selectorDoorsBesideADecision: readonly string[] = [
  selectorAttemptAdvanceFunction,
  selectorAttemptAllocateFunction,
  selectorAttemptReconcileFunction,
  selectorClaimFunction,
  selectorDeliveryFunction,
  selectorHostReadinessFunction,
  selectorReconcileClaimFunction,
  threadWakeCandidatesFunction,
  threadWakeCursorAdvanceFunction,
  threadWakeFunction,
];

/** The function a door names, which is what classes it without its argument types. */
function leadDoorFunction(door: string): string {
  return door.slice(0, door.indexOf("("));
}

test("the list is every decision door this role is granted and no other", async () => {
  const granted = await selectorPool.query<{ door: string | null }>(
    `SELECT p.oid::regprocedure::text AS door
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid=p.pronamespace,
            LATERAL aclexplode(p.proacl) held
      WHERE n.nspname='public' AND held.privilege_type='EXECUTE'
        AND held.grantee=$1::regrole`,
    [selectorServiceRole],
  );
  const doors = granted.rows
    .map((row) => row.door ?? "")
    .filter(
      (door) => !selectorDoorsBesideADecision.includes(leadDoorFunction(door)),
    );
  assert.deepEqual(
    doors.toSorted(),
    [...leadDoorSignatures].toSorted(),
    "a door granted and unlisted starts a process that cannot decide, and a door listed and revoked stops one that can",
  );
});
