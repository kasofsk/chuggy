/**
 * The guard a case driven by a roster needs. Every assertion inside
 * `for (const each of roster)` is unreachable when the roster is empty, so the
 * case reports green rather than red under exactly the mutation that empties
 * it — which is the mutation such a case is usually red-proofed with.
 */

import assert from "node:assert/strict";

/** The roster, refusing an empty one so a loop over it asserts something. */
export function populated<Item>(
  roster: readonly Item[],
  named: string,
): readonly Item[] {
  assert.ok(roster.length > 0, `${named} is empty, so this proves nothing`);
  return roster;
}
