/**
 * The durable ceilings the wire restates, read off the live schema rather than
 * off the migration that wrote them.
 *
 * A migration's text is frozen the moment it ships, so a constant pinned
 * against it stays green while a later migration moves the constraint — and a
 * migration that interpolated the constant would agree with it by construction
 * and prove nothing. What an installation actually holds is the only thing a
 * reader of the bound cares about, and `pg_get_constraintdef` is where it says
 * so.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { selectorHandoffNoteBytesMax } from "../../src/contract/http.ts";
import { postgresReadHarness } from "./readHarness.ts";

const subject = postgresReadHarness();

test("the handoff note's wire bound is the ceiling its own column checks", async () => {
  const constraint = await subject.pool.query<{ definition: string }>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
       FROM pg_constraint c
      WHERE c.conrelid = 'selector_project_state'::regclass
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) LIKE '%handoff_note%'`,
  );
  const definition = constraint.rows[0]?.definition;
  assert.ok(definition !== undefined, "the handoff-note ceiling was not found");
  const checked = /length\(handoff_note\) <= (\d+)/u.exec(definition);
  assert.ok(checked !== null, "the ceiling is not a length check");
  assert.equal(Number(checked[1]), selectorHandoffNoteBytesMax);
});
