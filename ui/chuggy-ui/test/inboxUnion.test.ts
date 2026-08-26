/**
 * The join behind the inbox: one row per ticket a phase parks or a question
 * waits on, and a count that is the union rather than the sum.
 *
 * The count is the case with teeth. A ticket that is both escalated and
 * carrying an open escalation reaches both reads, so a screen that added them
 * would tell a person two things need them when one does — and one that
 * intersected them would hide every approval, which is the whole reason this
 * join exists.
 */

import { expect, test } from "vitest";

import type {
  ProjectNativeActionResponse,
  ProjectNativeActionsResponse,
  ProjectResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import { inboxCountLabel } from "../app/core/inboxList.ts";
import { inboxUnion } from "../app/core/inboxUnion.ts";
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
