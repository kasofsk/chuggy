/**
 * The console's thread standing and the interpreter's are one rule.
 *
 * WHY THERE ARE TWO. A browser is served nothing this tree holds outside `ui/`
 * but the public contract — `console-reaches-no-source` in
 * `.dependency-cruiser.cjs` is that rule — so the console cannot import
 * `src/interpreter/thread.ts`, and `Orphaned` is not a word the wire carries:
 * the read answers a session state and an owner, and the standing an
 * administrator needs is the pair folded. So the fold is written on both sides,
 * and this is where the two are held equal.
 *
 * IT WALKS THE ROSTER RATHER THAN NAMING CASES. A drift is a state one side
 * folds and the other does not, and a suite that named the states it thought of
 * would pass over the one nobody thought of — which is exactly how a roster the
 * wire grows becomes a difference between two copies.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { sessionStates } from "../../src/contract/rosters.ts";
import {
  allThreadStandings,
  threadStanding as threadStandingInterpreted,
} from "../../src/interpreter/thread.ts";
import {
  threadStanding as threadStandingDrawn,
  threadStandings,
} from "../../ui/chuggy-ui/app/core/threads.ts";

test("the console draws the standings the interpreter derives", () => {
  assert.deepEqual([...threadStandings], [...allThreadStandings]);
});

test("the two folds answer the same standing over every state and either owner", () => {
  for (const state of sessionStates)
    for (const owner of ["geoff", undefined])
      assert.equal(
        threadStandingDrawn({ state, owner }),
        threadStandingInterpreted({
          state,
          ...(owner === undefined ? {} : { owner }),
        }),
        `${state} with ${owner ?? "no owner"}`,
      );
});
