/**
 * The floor the baseline seeds, held to the bound its derivation names, with no
 * server.
 *
 * A DERIVED FIGURE IS DERIVED ONLY WHILE SOMETHING HOLDS IT TO ITS SOURCE.
 * `leadObservationTokensPerDecision` is argued as the token ceiling of reading
 * one whole legal observation, and that argument is a relation between two
 * constants rather than anything a database can be asked. The seed's own cases
 * import the constant and assert the row against it, so they are true of
 * whatever value it is given: narrowing it by any factor leaves every
 * server-driven case green while the defect it was raised to close comes back.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { leadObservationTokensPerDecision } from "../../src/adapters/postgres/schema/migrations/baseline/seed.ts";
import { sessionTurnInputCharsMax } from "../../src/contract/http.ts";

test("the floor is the widest observation the mailbox row holds", () => {
  assert.equal(leadObservationTokensPerDecision, sessionTurnInputCharsMax);
});
