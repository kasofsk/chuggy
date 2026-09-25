/**
 * The one rule both writers of a ticket's key go through, over each pair of
 * what is held and what arrives.
 *
 * The case that went wrong quietly is the row written whole: the ledger lost
 * the program it groups by, and the page drew the ticket as though it had
 * never been released with one. Every body is parsed by the contract's own
 * schema, so no case asserts over a ticket the wire could not carry.
 */

import { expect, test } from "vitest";

import {
  ticketResponseSchema,
  type TicketResponse,
} from "../../../src/contract/responses.ts";
import { ticketArrival } from "../app/core/ticketArrival.ts";
import { ticketInstants } from "./ticketInstants.ts";

const runTotals = {
  turns: 12,
  durationMs: 60_000,
  durationApiMs: 50_000,
  tokensInput: 1_000,
  tokensOutput: 200,
  tokensCacheCreation: 0,
  tokensCacheRead: 0,
  costUsdMicros: 350_000,
  costBasis: "List",
  models: [],
  permissionDenials: 0,
};

/** Everything only the ticket's own read carries. */
const ownRead = {
  brief: { intent: "ship it", links: [] },
  configurationRevision: "r1",
  configurationVersion: { name: "chuggy", number: 3 },
  program: [{ key: 1, evaluators: [{ key: 1 }] }],
  runTotals,
};

function ticketOf(body: Record<string, unknown>): TicketResponse {
  return ticketResponseSchema.parse({ ticket: 7, ...ticketInstants, ...body });
}

const heldRead = ticketOf({
  phase: "Escalated",
  sequence: 4,
  escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
  ...ownRead,
});

const resumedRow = ticketOf({ phase: "Work", sequence: 9 });

test("a row over a read of the same revision keeps what only the read carries", () => {
  expect(
    ticketArrival(heldRead, { carried: "ProjectRow", ticket: resumedRow }),
  ).toEqual({
    arrival: "Write",
    representation: ticketOf({ phase: "Work", sequence: 9, ...ownRead }),
  });
});

test("a row drops the fields it supersedes", () => {
  const arrival = ticketArrival(heldRead, {
    carried: "ProjectRow",
    ticket: resumedRow,
  });
  if (arrival.arrival !== "Write") throw new Error("the row was not written");
  expect(arrival.representation.escalation).toBeUndefined();
});

test("a row older than what is held does not put it back", () => {
  const newer = ticketOf({ phase: "Done", sequence: 12, ...ownRead });
  expect(
    ticketArrival(newer, { carried: "ProjectRow", ticket: resumedRow }),
  ).toEqual({ arrival: "Keep" });
});

test("a row at the same sequence is written, not dropped", () => {
  const held = ticketOf({ phase: "Work", sequence: 9, ...ownRead });
  const arrival = ticketArrival(held, {
    carried: "ProjectRow",
    ticket: ticketOf({ phase: "Done", sequence: 9 }),
  });
  expect(arrival).toMatchObject({
    arrival: "Write",
    representation: { phase: "Done", program: ownRead.program },
  });
});

test("a row with nothing held is read again rather than drawn", () => {
  expect(
    ticketArrival(undefined, { carried: "ProjectRow", ticket: resumedRow }),
  ).toEqual({ arrival: "Reread" });
});

test("a row past an update is read again rather than drawn half-empty", () => {
  expect(
    ticketArrival(heldRead, {
      carried: "ProjectRow",
      ticket: ticketOf({ phase: "Pending", sequence: 9, revision: 2 }),
    }),
  ).toEqual({ arrival: "Reread" });
});

test("an own read with nothing held is written as it came", () => {
  const read = ticketOf({ phase: "Work", sequence: 9, ...ownRead });
  expect(
    ticketArrival(undefined, { carried: "OwnRead", ticket: read }),
  ).toEqual({ arrival: "Write", representation: read });
});

test("an own read past an update carries nothing over from the revision before it", () => {
  const updated = ticketOf({ phase: "Pending", sequence: 9, revision: 2 });
  expect(
    ticketArrival(heldRead, { carried: "OwnRead", ticket: updated }),
  ).toEqual({ arrival: "Write", representation: updated });
});

test("an own read's fields win over what is held", () => {
  const later = { ...runTotals, turns: 30, costUsdMicros: 900_000 };
  const read = ticketOf({
    phase: "Work",
    sequence: 9,
    ...ownRead,
    runTotals: later,
  });
  expect(
    ticketArrival(heldRead, { carried: "OwnRead", ticket: read }),
  ).toMatchObject({ arrival: "Write", representation: { runTotals: later } });
});

test("an own read older than what is held does not put it back", () => {
  const newer = ticketOf({ phase: "Done", sequence: 12, ...ownRead });
  expect(
    ticketArrival(newer, {
      carried: "OwnRead",
      ticket: ticketOf({ phase: "Work", sequence: 9, ...ownRead }),
    }),
  ).toEqual({ arrival: "Keep" });
});

test("an own read of the same revision lacking a field keeps the held one", () => {
  expect(
    ticketArrival(heldRead, { carried: "OwnRead", ticket: resumedRow }),
  ).toEqual({
    arrival: "Write",
    representation: ticketOf({ phase: "Work", sequence: 9, ...ownRead }),
  });
});
