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
  ticketOffersAllowed,
  ticketOffersStartable,
} from "../app/core/ticketOffers.ts";
import type { TicketOffers } from "../app/core/ticketOffers.ts";
import { abilitiesEvery, abilitiesNone } from "./projectAbilitiesFixture.ts";
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

const pending = { ...parked, phase: "Pending" as const };

/** What is left of the offers of a Pending ticket's page and of a parked
 * one's, as the actions' names and whether the edit screen stands. */
function allowed(abilities: Parameters<typeof ticketOffersAllowed>[1]): {
  readonly parked: readonly string[];
  readonly editable: boolean;
} {
  const left = (offers: TicketOffers) => ticketOffersAllowed(offers, abilities);
  const actions = left(ticketOffers(ready([]), parked, dispatch));
  const edit = left(ticketOffers(ready([]), pending, undefined));
  return {
    parked:
      actions.offers === "Actions"
        ? actions.actions.map((action) => action.action)
        : [],
    editable: edit.offers === "Actions" && edit.editable,
  };
}

test("a reader the read has not answered for, or said yes to, keeps every offer", () => {
  const every = { parked: ["Dispatch", "Resume", "Revoke"], editable: true };
  expect(allowed(undefined)).toStrictEqual(every);
  expect(allowed(abilitiesEvery)).toStrictEqual(every);
});

test("a reader who may not dispatch loses Dispatch and nothing else", () => {
  expect(allowed({ ...abilitiesEvery, dispatch: false })).toStrictEqual({
    parked: ["Resume", "Revoke"],
    editable: true,
  });
});

test("a reader who may not mutate keeps Dispatch and loses every answer and the edit screen", () => {
  expect(allowed({ ...abilitiesEvery, mutate: false })).toStrictEqual({
    parked: ["Dispatch"],
    editable: false,
  });
  expect(allowed(abilitiesNone)).toStrictEqual({ parked: [], editable: false });
});

test("an open action's answers go with the ability to mutate", () => {
  const open = ticketOffers(
    ready([
      {
        action: "action-one",
        kind: "FinalizationApproval",
        authorizingSequence: 42,
        admits: ["Approve", "Decline"],
      },
    ]),
    parked,
    dispatch,
  );
  expect(ticketOffersAllowed(open, abilitiesEvery)).toStrictEqual(open);
  expect(ticketOffersAllowed(open, abilitiesNone)).toStrictEqual({
    offers: "Actions",
    actions: [],
    editable: false,
  });
});

test("an unread offer stays unread whatever the reader may do", () => {
  expect(
    ticketOffersAllowed({ offers: "Unread" }, abilitiesNone),
  ).toStrictEqual({ offers: "Unread" });
});

const startable = ticketOffers(ready([]), pending, dispatch);

/** A press that would escalate the ticket is not offered, and the line that
 * says why stands where it was; the rest of the bar is what it was. */
test("work with no runner to go to loses Dispatch and nothing else, and says so", () => {
  expect(ticketOffersStartable(startable, "NoRunner")).toStrictEqual({
    offers: {
      offers: "Actions",
      actions: [
        {
          action: "Revoke",
          mutation: { mutation: "RevokeTicket", ticket: pending.ticket },
        },
      ],
      editable: true,
    },
    noRunner: true,
  });
});

/** Held is a read not yet back and Clear is a runner, work the cluster runs,
 * or a read that failed: none of them says the press cannot run. */
test.each(["Held", "Clear"] as const)(
  "a runner question standing %s leaves every offer as it was",
  (runner) => {
    const left = ticketOffersStartable(startable, runner);
    expect(left.offers).toBe(startable);
    expect(left.noRunner).toBe(false);
  },
);

/** The line stands in for a Dispatch, so where none was offered there is
 * nothing for it to stand in for. */
test("no runner says nothing where no Dispatch was offered", () => {
  const undispatched = ticketOffers(ready([]), pending, undefined);
  const refused = ticketOffersAllowed(startable, {
    ...abilitiesEvery,
    dispatch: false,
  });
  for (const offers of [undispatched, refused, { offers: "Unread" } as const]) {
    const left = ticketOffersStartable(offers, "NoRunner");
    expect(left.offers).toBe(offers);
    expect(left.noRunner).toBe(false);
  }
});

/** The words about the hand belong beside a Dispatch, so they go with it. */
test("a Dispatch that gave way to no runner is not said to be by hand", () => {
  const left = ticketOffersStartable(startable, "NoRunner").offers;
  expect(offersDispatchByHand(startable, false)).toBe(true);
  expect(offersDispatchByHand(left, false)).toBe(false);
});
