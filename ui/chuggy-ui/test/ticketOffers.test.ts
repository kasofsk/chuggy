/**
 * Which read the panel's buttons come from, and which reads offer none.
 *
 * The phase-derived list is `retryableIn`'s first conjunct alone, so the cases
 * below hold it to the one state it is honest in: an open-actions read that
 * came back and said there was nothing open (kasofsk/chuggy#453).
 */

import { expect, test } from "vitest";

import type { TicketNativeActionsResponse } from "../../../src/contract/responses.ts";
import { phaseRoster } from "../../../src/contract/rosters.ts";
import type { PanelState } from "../app/core/freshness.ts";
import type { TicketAction } from "../app/core/ticketActions.ts";
import {
  offersDispatchByHand,
  ticketOffers,
} from "../app/core/ticketOffers.ts";
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

/** The edit screen is an update's only way in, and only a Pending ticket
 * admits one. */
test("the edit screen is offered to a Pending ticket and to no other", () => {
  for (const phase of phaseRoster) {
    const drawn = ticketOffers(ready([]), { ...parked, phase }, undefined);
    expect(drawn.offers === "Actions" && drawn.editable).toBe(
      phase === "Pending",
    );
  }
});

test("a read that has not answered offers nothing, whatever the phase enables", () => {
  const unread: PanelState<TicketNativeActionsResponse>[] = [
    { state: "Pending" },
    { state: "Failed", reason: "the API failed with Fault" },
    { state: "Absent", reason: "the API has no such resource" },
  ];
  expect(offered(ready([]))).not.toEqual([]);
  for (const open of unread)
    expect(ticketOffers(open, parked, dispatch)).toEqual({ offers: "Unread" });
});

/** Dispatch is a press by hand only where the read has said there is no lead;
 * a lead, a read not yet back, or no Dispatch on offer says nothing. */
test("the bar says Dispatch is by hand only beside a Dispatch in a project with no lead", () => {
  const withDispatch = ticketOffers(ready([]), parked, dispatch);
  const withoutDispatch = ticketOffers(ready([]), parked, undefined);
  expect(offersDispatchByHand(withDispatch, false)).toBe(true);
  expect(offersDispatchByHand(withDispatch, true)).toBe(false);
  expect(offersDispatchByHand(withDispatch, undefined)).toBe(false);
  expect(offersDispatchByHand(withoutDispatch, false)).toBe(false);
  expect(offersDispatchByHand({ offers: "Unread" }, false)).toBe(false);
});
