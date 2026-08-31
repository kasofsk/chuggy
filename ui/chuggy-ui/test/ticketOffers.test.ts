/**
 * Which read the panel's buttons come from, and which reads offer none.
 *
 * The phase-derived list is `retryableIn`'s first conjunct alone, so the cases
 * below hold it to the one state it is honest in: an open-actions read that
 * came back and said there was nothing open (kasofsk/chuggy#453).
 */

import { expect, test } from "vitest";

import type { TicketNativeActionsResponse } from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import type { TicketAction } from "../app/core/ticketActions.ts";
import { ticketOffers } from "../app/core/ticketOffers.ts";
import { ticketInstants } from "./ticketInstants.ts";

const parked = {
  ticket: 11,
  phase: "Escalated" as const,
  sequence: 7,
  ...ticketInstants,
};

const dispatch: TicketAction = {
  action: "Dispatch",
  mutation: {
    mutation: "ManualDispatch",
    ticket: 11,
    expectedTicketVersion: 4,
  },
};

function ready(
  actions: TicketNativeActionsResponse["actions"],
): PanelState<TicketNativeActionsResponse> {
  return { state: "Ready", value: { actions }, observedAtMs: undefined };
}

function offered(open: PanelState<TicketNativeActionsResponse>): string[] {
  const drawn = ticketOffers(open, parked, dispatch);
  return drawn.offers === "Unread"
    ? []
    : drawn.actions.map((action) => action.action);
}

test("an answered read with nothing open falls back to the phase and the dispatch", () => {
  expect(offered(ready([]))).toEqual(["Dispatch", "Resume", "Revoke"]);
});

test("an open action's admitted answers replace the phase's guess at them", () => {
  expect(
    offered(
      ready([
        {
          action: "action-one",
          kind: "TicketEscalation",
          authorizingSequence: 42,
          admits: ["Revoke"],
        },
      ]),
    ),
  ).toEqual(["Revoke"]);
});

test("a read that has not answered offers nothing, whatever the phase enables", () => {
  const unread: PanelState<TicketNativeActionsResponse>[] = [
    { state: "Pending" },
    { state: "Failed", reason: "the API failed with Fault" },
    { state: "Absent", reason: "the API has no such resource" },
  ];
  for (const open of unread) {
    expect(ticketOffers(open, parked, dispatch).offers).toBe("Unread");
    expect(offered(open)).toEqual([]);
  }
});
