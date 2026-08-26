/**
 * The join behind the inbox: one row per ticket a phase parks or a question
 * waits on, and a count that is the union rather than the sum.
 *
 * The count is the case with teeth. A ticket that is both escalated and
 * carrying an open escalation reaches both reads, so a screen that added them
 * would tell a person two things need them when one does — and one that
 * intersected them would hide every approval, which is the whole reason this
 * join exists.
 *
 * The crossed pairs are the other half: the badge and the panel take the same
 * two states through these functions, so what one of them draws when a read
 * refuses is decided once, here, rather than twice on the screen.
 */

import { expect, test } from "vitest";

import type {
  ProjectNativeActionResponse,
  ProjectNativeActionsResponse,
  ProjectResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import { inboxCountLabel } from "../app/core/inboxList.ts";
import {
  inboxUnion,
  inboxUnionEmpty,
  inboxUnionRefusals,
  inboxUnionState,
} from "../app/core/inboxUnion.ts";
import type { ProjectNativeActionRows } from "../app/core/projectNativeActionPages.ts";
import type { ProjectTicketRows } from "../app/core/projectTicketPages.ts";
import {
  projectNativeActionRowsAppend,
  projectNativeActionRowsEmpty,
} from "../app/core/projectNativeActionPages.ts";
import {
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
} from "../app/core/projectTicketPages.ts";

const partition = { tenant: "acme", project: "atlas" };

const escalated: TicketResponse = {
  ticket: 4,
  phase: "Escalated",
  sequence: 9,
  reason: "WorkFailed",
};

const blocked: TicketResponse = {
  ticket: 2,
  phase: "HandoffBlocked",
  sequence: 8,
};

function ticketPage(
  tickets: readonly TicketResponse[],
  nextCursor?: string,
): ProjectResponse {
  return {
    partition,
    sequence: 12,
    tickets: [...tickets],
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

function actionPage(
  actions: readonly ProjectNativeActionResponse[],
  nextCursor?: string,
): ProjectNativeActionsResponse {
  return {
    actions: [...actions],
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

const approval: ProjectNativeActionResponse = {
  ticket: 11,
  action: "action-eleven",
  kind: "FinalizationApproval",
  authorizingSequence: 51,
  admits: ["Approve", "Decline"],
};

const escalation: ProjectNativeActionResponse = {
  ticket: 4,
  action: "action-four",
  kind: "TicketEscalation",
  authorizingSequence: 9,
  admits: ["Resume", "Revoke"],
};

const parked = projectTicketRowsAppend(
  projectTicketRowsEmpty,
  ticketPage([escalated, blocked]),
);

const open = projectNativeActionRowsAppend(
  projectNativeActionRowsEmpty,
  actionPage([approval, escalation]),
);

test("a ticket in either read gets a row, and one in both gets one row", () => {
  const union = inboxUnion(parked, open);
  expect(union.entries.map((entry) => entry.ticket)).toStrictEqual([4, 2, 11]);
  expect(inboxCountLabel(union)).toBe("3");
});

test("a ticket the phase page reached carries its row and its open actions", () => {
  const union = inboxUnion(parked, open);
  const four = union.entries.find((entry) => entry.ticket === 4);
  expect(four?.held).toStrictEqual(escalated);
  expect(four?.actions).toStrictEqual([escalation]);
  const two = union.entries.find((entry) => entry.ticket === 2);
  expect(two?.held).toStrictEqual(blocked);
  expect(two?.actions).toStrictEqual([]);
});

test("a ticket only a question names is a row with no projection behind it", () => {
  const eleven = inboxUnion(parked, open).entries.find(
    (entry) => entry.ticket === 11,
  );
  expect(eleven?.held).toBeUndefined();
  expect(eleven?.actions).toStrictEqual([approval]);
});

test("an approval on a phase the inbox does not hold is still a row", () => {
  const union = inboxUnion(
    projectTicketRowsEmpty,
    projectNativeActionRowsAppend(
      projectNativeActionRowsEmpty,
      actionPage([approval]),
    ),
  );
  expect(union.entries.map((entry) => entry.ticket)).toStrictEqual([11]);
  expect(inboxCountLabel(union)).toBe("1");
});

test("either read still unread makes the count say it is short", () => {
  expect(
    inboxCountLabel(
      inboxUnion(
        projectTicketRowsAppend(
          projectTicketRowsEmpty,
          ticketPage([escalated], "after-four"),
        ),
        open,
      ),
    ),
  ).toBe("2+");
  expect(
    inboxCountLabel(
      inboxUnion(
        parked,
        projectNativeActionRowsAppend(
          projectNativeActionRowsEmpty,
          actionPage([approval], "after-eleven"),
        ),
      ),
    ),
  ).toBe("3+");
  expect(inboxCountLabel(inboxUnion(parked, open))).toBe("3");
});

test("a read that has answered nothing yet counts nothing", () => {
  expect(inboxUnion(undefined, undefined).entries).toStrictEqual([]);
  expect(inboxCountLabel(inboxUnion(undefined, undefined))).toBeUndefined();
  expect(
    inboxCountLabel(
      inboxUnion(projectTicketRowsEmpty, projectNativeActionRowsEmpty),
    ),
  ).toBeUndefined();
});

test("one read alone is the whole union while the other is still arriving", () => {
  expect(
    inboxUnion(parked, undefined).entries.map((entry) => entry.ticket),
  ).toStrictEqual([4, 2]);
  expect(
    inboxUnion(undefined, open).entries.map((entry) => entry.ticket),
  ).toStrictEqual([11, 4]);
});

function ready<T>(value: T, observedAtMs = 40): PanelState<T> {
  return { state: "Ready", value, observedAtMs };
}

const pending: PanelState<never> = { state: "Pending" };

const phaseFailed: PanelState<ProjectTicketRows> = {
  state: "Failed",
  reason: "the API failed with InternalError",
};

const openFailed: PanelState<ProjectNativeActionRows> = {
  state: "Failed",
  reason: "the API could not be reached",
};

/**
 * The finding this file exists to keep closed: a badge counting rows the panel
 * refuses to draw. Either read answering has to draw the union, because the
 * question the console did read is the one a person came here to answer.
 */
test("a read that refused does not take the other read's rows off the panel", () => {
  const union = inboxUnion(undefined, open);
  const state = inboxUnionState(union, phaseFailed, ready(open));
  expect(state.state).toBe("Ready");
  expect(state.state === "Ready" && state.value.entries.length).toBe(2);
  expect(inboxCountLabel(union)).toBe("2");
  expect(inboxUnionRefusals(state, phaseFailed, ready(open))).toStrictEqual({
    phase: "the API failed with InternalError",
    open: undefined,
  });
});

test("the same holds the other way round, and the refusal is said as itself", () => {
  const union = inboxUnion(parked, undefined);
  const state = inboxUnionState(union, ready(parked), openFailed);
  expect(state.state).toBe("Ready");
  expect(state.state === "Ready" && state.value.entries.length).toBe(2);
  expect(inboxUnionRefusals(state, ready(parked), openFailed)).toStrictEqual({
    phase: undefined,
    open: "the API could not be reached",
  });
});

test("a screen holding neither answer refuses, with the phase page's reason", () => {
  const refused = inboxUnionState(inboxUnionEmpty, phaseFailed, openFailed);
  expect(refused).toStrictEqual(phaseFailed);
  expect(
    inboxUnionRefusals(refused, phaseFailed, openFailed),
    "a refusal the panel is already drawing was repeated beside it",
  ).toStrictEqual({ phase: undefined, open: undefined });
});

test("both reads still arriving is pending, and one of them arriving is not", () => {
  expect(inboxUnionState(inboxUnionEmpty, pending, pending)).toStrictEqual({
    state: "Pending",
  });
  expect(inboxUnionState(inboxUnionEmpty, phaseFailed, pending).state).toBe(
    "Failed",
  );
  expect(
    inboxUnionState(inboxUnion(parked, undefined), ready(parked), pending)
      .state,
  ).toBe("Ready");
});

/** A panel is as fresh as the stalest half of what it draws. */
test("the panel is observed at the older of the two reads", () => {
  const state = inboxUnionState(
    inboxUnion(parked, open),
    ready(parked, 90),
    ready(open, 40),
  );
  expect(state.state === "Ready" && state.observedAtMs).toBe(40);
  const alone = inboxUnionState(
    inboxUnion(parked, undefined),
    ready(parked, 90),
    pending,
  );
  expect(alone.state === "Ready" && alone.observedAtMs).toBe(90);
});
