/**
 * The floor 070 writes, held to the bounds its derivation names, with no
 * server.
 *
 * A DERIVED FIGURE IS DERIVED ONLY WHILE SOMETHING HOLDS IT TO ITS SOURCE. The
 * floor is argued as the token ceiling of reading one whole legal observation,
 * and that argument is a relation between two constants rather than anything a
 * database can be asked. The migration's own cases import the constant and
 * assert the row against it, so they are true of whatever value it is given:
 * narrowing it by any factor leaves every server-driven case green while the
 * defect it was raised to close comes back.
 *
 * THE RENDERING READ HERE IS THE LATEST MIGRATION'S, NOT THE BASELINE'S. A
 * landed migration renders the figure it landed with and is never rewritten,
 * so what an installation ends on is whichever migration last moved it, and
 * that is the one rendering a derivation can be compared against.
 *
 * THE SECOND RELATION IS THE ONE THE FIRST DOES NOT IMPLY. The floor is the
 * mailbox bound today because the input bound is too, and a mailbox that grew
 * in two steps would leave a project able to widen `inputBytesPerDecision` past
 * a budget still pinned to the older figure — which is #552 reached by widening
 * the input alone, the one thing the derivation promises cannot happen.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { leadObservationTokensPerDecisionAt009 } from "../../src/adapters/postgres/schema/migrations/009-work-fanout.ts";
import { sessionTurnInputCharsMax } from "../../src/contract/http.ts";
import { leadObservationBytesMax } from "../../src/interpreter/selector.ts";

test("the floor is the widest observation the mailbox row holds", () => {
  assert.equal(leadObservationTokensPerDecisionAt009, sessionTurnInputCharsMax);
});

test("the floor is never under the input a project may widen to", () => {
  assert.ok(
    leadObservationTokensPerDecisionAt009 >= leadObservationBytesMax,
    `the floor is ${String(leadObservationTokensPerDecisionAt009)} against an input bound of ${String(leadObservationBytesMax)}`,
  );
});
