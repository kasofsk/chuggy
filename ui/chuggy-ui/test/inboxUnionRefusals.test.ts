/**
 * The inbox's fourth member: a ticket the lead is refusing to dispatch.
 *
 * THE CASE WITH TEETH IS A REFUSAL WITH NO TICKET ROW BEHIND IT. A refused
 * ticket stays where it is, so no phase the section holds finds it and no open
 * question waits on it; a union drawn only from the other two reads would leave
 * it off the list and the badge would count a project that has nothing wrong
 * with it. The other half is the ticket both reads name, which is one row and
 * one count, exactly as an escalation carrying an action already is.
 */

import { expect, test } from "vitest";

import type {
  AgenticRefusalsResponse,
  ProjectNativeActionResponse,
  ProjectNativeActionsResponse,
  ProjectResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import { inboxCountLabel } from "../app/core/inboxList.ts";
import {
  inboxUnion,
  inboxUnionRefusals,
  inboxUnionState,
} from "../app/core/inboxUnion.ts";
import type { InboxUnion } from "../app/core/inboxUnion.ts";
import {
  projectNativeActionRowsAppend,
  projectNativeActionRowsEmpty,
} from "../app/core/projectNativeActionPages.ts";
import type { ProjectNativeActionRows } from "../app/core/projectNativeActionPages.ts";
import {
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
} from "../app/core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../app/core/projectTicketPages.ts";
import { leadRefusals } from "./leadFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

const partition = { tenant: "acme", project: "atlas" };

const escalated: TicketResponse = {
  ticket: 4,
  phase: "Escalated",
  sequence: 9,
  reason: "WorkFailed",
  ...ticketInstants,
};

const escalation: ProjectNativeActionResponse = {
  ticket: 4,
  action: "action-four",
  kind: "TicketEscalation",
  authorizingSequence: 9,
  admits: ["Resume", "Revoke"],
};

function ticketPage(tickets: readonly TicketResponse[]): ProjectResponse {
  return { partition, sequence: 12, tickets: [...tickets] };
}

function actionPage(
  actions: readonly ProjectNativeActionResponse[],
): ProjectNativeActionsResponse {
  return { actions: [...actions] };
}

const parked: ProjectTicketRows = projectTicketRowsAppend(
  projectTicketRowsEmpty,
  ticketPage([escalated]),
);

const open: ProjectNativeActionRows = projectNativeActionRowsAppend(
  projectNativeActionRowsEmpty,
  actionPage([escalation]),
);

/** The refused ticket, which is ticket 42 and is in neither other read. */
const refused: AgenticRefusalsResponse = leadRefusals(false);

function ready<T>(value: T, observedAtMs = 40): PanelState<T> {
  return { state: "Ready", value, observedAtMs };
}

const pending: PanelState<never> = { state: "Pending" };

const standingFailed: PanelState<AgenticRefusalsResponse> = {
  state: "Failed",
  reason: "the API failed with InternalError",
};

function unionOfThree(): InboxUnion {
  return inboxUnion(parked, open, refused);
}

test("a ticket only the refusals name is a row, and the badge counts it", () => {
  const union = unionOfThree();
  expect(union.entries.map((entry) => entry.ticket)).toStrictEqual([4, 42]);
  expect(inboxCountLabel(union)).toBe("2");
  const forty2 = union.entries.find((entry) => entry.ticket === 42);
  expect(forty2?.held).toBeUndefined();
  expect(forty2?.actions).toStrictEqual([]);
  expect(forty2?.refusals).toStrictEqual(refused.refusals);
});

test("a ticket a phase already parks carries its refusal on the same row", () => {
  const union = inboxUnion(
    projectTicketRowsAppend(
      projectTicketRowsEmpty,
      ticketPage([{ ...escalated, ticket: 42 }]),
    ),
    open,
    refused,
  );
  expect(union.entries.map((entry) => entry.ticket)).toStrictEqual([42, 4]);
  expect(inboxCountLabel(union)).toBe("2");
  const forty2 = union.entries.find((entry) => entry.ticket === 42);
  expect(forty2?.refusals).toStrictEqual(refused.refusals);
});

test("a further page of refusals makes the count say it is short", () => {
  expect(
    inboxCountLabel(inboxUnion(parked, open, { ...refused, more: true })),
  ).toBe("2+");
});

/** The read that answered draws the union; the one that refused says so beside
 * the rows rather than in place of them. */
test("the refusals read refusing does not take the other rows off the panel", () => {
  const union = inboxUnion(parked, open, undefined);
  const state = inboxUnionState(
    union,
    ready(parked),
    ready(open),
    standingFailed,
  );
  expect(state.state).toBe("Ready");
  expect(state.state === "Ready" && state.value.entries.length).toBe(1);
  expect(
    inboxUnionRefusals(state, ready(parked), ready(open), standingFailed),
  ).toStrictEqual({
    phase: undefined,
    open: undefined,
    standing: "the API failed with InternalError",
  });
});

test("the refusals read alone is enough to draw the union and date it", () => {
  const state = inboxUnionState(
    inboxUnion(undefined, undefined, refused),
    pending,
    pending,
    ready(refused, 90),
  );
  expect(state.state === "Ready" && state.value.entries.length).toBe(1);
  expect(state.state === "Ready" && state.observedAtMs).toBe(90);
});
