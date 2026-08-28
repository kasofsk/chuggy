/**
 * The public operation row's closed-set narrowing, driven over the roster the
 * contract publishes rather than over the codes a reader remembers.
 *
 * A REFUSAL CODE IS WRITTEN BY THE WRITER AND READ BACK HERE, so a code the
 * narrowing does not admit is not a compile error anywhere — it is a thrown
 * read the first time a client asks for the operation that carries it, and the
 * refusal the console exists to show is what is lost.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { operationRefusalCodes } from "../../src/contract/rosters.ts";
import { publicOperation } from "../../src/adapters/postgres/nativeReads.ts";

/** A refused operation row carrying the code under test and nothing else of interest. */
function refusedRow(code: string): Parameters<typeof publicOperation>[0] {
  return {
    operation: "operation",
    accepted_at: "2026-08-28 12:00:00+00",
    state: "Refused",
    decided_seq: null,
    outcome_code: code,
    refused_head: "3",
    refused_lifecycle_generation: "1",
  };
}

test("every refusal code the contract names is read back as itself", () => {
  assert.deepEqual(
    operationRefusalCodes.map((code) => {
      const resource = publicOperation(refusedRow(code));
      return resource.state === "Refused" ? resource.code : resource.state;
    }),
    [...operationRefusalCodes],
  );
});

test("a stored code the contract does not name is refused, not read", () => {
  assert.throws(
    () => publicOperation(refusedRow("NoSuchCode")),
    /not a public refusal code/u,
  );
});
