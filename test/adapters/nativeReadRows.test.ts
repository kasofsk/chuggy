/**
 * The public operation row's closed-set narrowing, driven over the roster the
 * contract publishes rather than over the codes a reader remembers.
 *
 * A REFUSAL CODE IS WRITTEN BY THE WRITER AND READ BACK HERE, so a code the
 * narrowing does not admit is not a compile error anywhere — it is a thrown
 * read the first time a client asks for the operation that carries it, and the
 * refusal the console exists to show is what is lost. The machine's refusals
 * are read back with the refusal beside them, and the boundary's with none.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  operationBoundaryRefusalCodes,
  operationRefusalCodes,
  operationTicketRefusalCodes,
} from "../../src/contract/rosters.ts";
import { publicOperation } from "../../src/adapters/postgres/nativeReads.ts";
import { encodeRefusalText } from "../../src/interpreter/wire.ts";
import { ticketRefusals } from "../contract/representations.ts";

/** A refused operation row carrying the code and refusal under test and nothing else of interest. */
function refusedRow(
  code: string,
  refusal: string | null,
): Parameters<typeof publicOperation>[0] {
  return {
    operation: "operation",
    accepted_at: "2026-08-28 12:00:00+00",
    state: "Refused",
    decided_seq: null,
    outcome_code: code,
    refusal,
    refused_head: "3",
    refused_lifecycle_generation: "1",
  };
}

function refusedCode(row: Parameters<typeof publicOperation>[0]): string {
  const resource = publicOperation(row);
  return resource.state === "Refused" ? resource.refusal.type : resource.state;
}

test("every refusal code the contract names is read back as itself", () => {
  assert.deepEqual(
    [
      ...operationTicketRefusalCodes.map((code) =>
        refusedCode(refusedRow(code, encodeRefusalText(ticketRefusals[code]))),
      ),
      ...operationBoundaryRefusalCodes.map((code) =>
        refusedCode(refusedRow(code, null)),
      ),
    ],
    [...operationRefusalCodes],
  );
});

test("the machine's refusal is read back whole", () => {
  const resource = publicOperation(
    refusedRow(
      "DependenciesIncomplete",
      encodeRefusalText(ticketRefusals.DependenciesIncomplete),
    ),
  );
  assert.deepEqual(
    resource.state === "Refused" ? resource.refusal : undefined,
    ticketRefusals.DependenciesIncomplete,
  );
});

test("a stored code the contract does not name is refused, not read", () => {
  assert.throws(
    () => publicOperation(refusedRow("NoSuchCode", null)),
    /NoSuchCode is not a refusal code/u,
  );
});

test("a code and a refusal that disagree are refused, not read", () => {
  assert.throws(
    () =>
      publicOperation(
        refusedRow(
          "TicketNotFound",
          encodeRefusalText(ticketRefusals.TicketNotResumable),
        ),
      ),
    /a TicketNotResumable is named TicketNotFound/u,
  );
  assert.throws(
    () =>
      publicOperation(
        refusedRow(
          "TicketChanged",
          encodeRefusalText(ticketRefusals.TicketNotFound),
        ),
      ),
    /TicketChanged carries no refusal/u,
  );
  assert.throws(
    () => publicOperation(refusedRow("TaskNotCurrent", null)),
    /TaskNotCurrent has no refusal beside it/u,
  );
});
