/**
 * Which tickets the inbox reads on their own: those a row names that the phase
 * page did not carry, and never one it did, since that would read the same
 * ticket twice.
 */

import { expect, test } from "vitest";

import type {
  ProjectNativeActionResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import {
  inboxUnion,
  inboxUnionTicketsUnheld,
  inboxUnionTicketsUnheldMax,
} from "../app/core/inboxUnion.ts";
import {
  projectNativeActionRowsAppend,
  projectNativeActionRowsEmpty,
} from "../app/core/projectNativeActionPages.ts";
import {
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
} from "../app/core/projectTicketPages.ts";
import { ticketInstants } from "./ticketInstants.ts";

const parked: TicketResponse = {
  ticket: 4,
  phase: "Escalated",
  sequence: 9,
  ...ticketInstants,
};

function approvalOn(ticket: number): ProjectNativeActionResponse {
  return {
    ticket,
    action: `action-${String(ticket)}`,
    kind: "FinalizationApproval",
    authorizingSequence: 51,
    admits: ["Approve", "Decline"],
  };
}

const phasePage = projectTicketRowsAppend(projectTicketRowsEmpty, {
  partition: { tenant: "acme", project: "atlas" },
  sequence: 9,
  tickets: [parked],
});

test("only the tickets the phase page did not carry are read, in the union's order", () => {
  const union = inboxUnion(
    phasePage,
    projectNativeActionRowsAppend(projectNativeActionRowsEmpty, {
      actions: [approvalOn(11), approvalOn(4)],
    }),
    undefined,
    { proposals: [{ decision: "dec-one", tickets: [7, 11] }], more: false },
  );
  expect(inboxUnionTicketsUnheld(union)).toStrictEqual([11, 7]);
});

test("no more are read than the reads besides the phase page can name", () => {
  const tickets = Array.from(
    { length: inboxUnionTicketsUnheldMax + 1 },
    (_, at) => at + 1,
  );
  const union = inboxUnion(undefined, undefined, undefined, {
    proposals: [{ decision: "dec-many", tickets }],
    more: false,
  });
  expect(union.entries.length).toBe(inboxUnionTicketsUnheldMax + 1);
  expect(inboxUnionTicketsUnheld(union)).toStrictEqual(
    tickets.slice(0, inboxUnionTicketsUnheldMax),
  );
});
