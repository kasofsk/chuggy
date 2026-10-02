/**
 * The inbox's fifth member: a ticket a lead decision held for approval names.
 *
 * A proposed ticket is released, which no phase the section holds, so like a
 * refusal it is a row only this read finds. A decision naming two tickets is
 * one question on both rows, and a reader the read answers absent has no
 * question to see rather than a refusal to be told about.
 */

import { expect, test } from "vitest";

import type {
  SelectorProposalResponse,
  SelectorProposalsResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import { inboxCountLabel } from "../app/core/inboxList.ts";
import { inboxProposalsHeld } from "../app/core/inboxProposals.ts";
import {
  inboxUnion,
  inboxUnionRefusals,
  inboxUnionState,
} from "../app/core/inboxUnion.ts";
import {
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
} from "../app/core/projectTicketPages.ts";
import { ticketInstants } from "./ticketInstants.ts";

const parkedNine: TicketResponse = {
  ticket: 9,
  phase: "Escalated",
  sequence: 4,
  ...ticketInstants,
};

const parked = projectTicketRowsAppend(projectTicketRowsEmpty, {
  partition: { tenant: "acme", project: "atlas" },
  sequence: 4,
  tickets: [parkedNine],
});

const pair: SelectorProposalResponse = { decision: "dec-a", tickets: [7, 9] };
const lone: SelectorProposalResponse = { decision: "dec-b", tickets: [5] };

function proposed(
  proposals: readonly SelectorProposalResponse[],
  more = false,
): SelectorProposalsResponse {
  return { proposals: [...proposals], more };
}

const pending: PanelState<never> = { state: "Pending" };

test("a proposed ticket is a row of its own after the phase page's, once however many decisions name it", () => {
  const union = inboxUnion(
    parked,
    undefined,
    undefined,
    proposed([pair, lone, { decision: "dec-c", tickets: [7] }]),
  );
  expect(union.entries.map((entry) => entry.ticket)).toStrictEqual([9, 7, 5]);
  expect(
    union.entries.map((entry) =>
      entry.proposals.map((proposal) => proposal.decision),
    ),
  ).toStrictEqual([["dec-a"], ["dec-a", "dec-c"], ["dec-b"]]);
  expect(inboxCountLabel(union)).toBe("3");
});

test("a decision left unread is more to read", () => {
  expect(
    inboxUnion(undefined, undefined, undefined, proposed([lone])).more,
  ).toBe(false);
  expect(
    inboxUnion(undefined, undefined, undefined, proposed([lone], true)).more,
  ).toBe(true);
});

test("the proposals read alone draws the union", () => {
  const read: PanelState<SelectorProposalsResponse> = {
    state: "Ready",
    value: proposed([lone]),
    observedAtMs: 70,
  };
  const state = inboxUnionState(
    inboxUnion(undefined, undefined, undefined, proposed([lone])),
    pending,
    pending,
    pending,
    read,
  );
  expect(state.state === "Ready" && state.value.entries.length).toBe(1);
  expect(state.state === "Ready" && state.observedAtMs).toBe(70);
});

/** Absent is the server declining to show a question the reader cannot answer. */
test("a reader who may not dispatch holds no proposal, and is told of no refusal", () => {
  const absent: PanelState<SelectorProposalsResponse> = {
    state: "Absent",
    reason: "the API answered NotFound",
  };
  const failed: PanelState<SelectorProposalsResponse> = {
    state: "Failed",
    reason: "the API could not be reached",
  };
  expect(inboxProposalsHeld(absent)).toStrictEqual(proposed([]));
  expect(inboxProposalsHeld(failed)).toBeUndefined();
  expect(inboxProposalsHeld(pending)).toBeUndefined();
  const union = inboxUnion(parked, undefined, undefined, proposed([]));
  const drawn: PanelState<typeof parked> = {
    state: "Ready",
    value: parked,
    observedAtMs: 40,
  };
  const state = inboxUnionState(union, drawn, pending, pending, absent);
  expect(
    inboxUnionRefusals(state, drawn, pending, pending, absent).proposals,
  ).toBeUndefined();
  expect(
    inboxUnionRefusals(state, drawn, pending, pending, failed).proposals,
  ).toBe("the API could not be reached");
});
