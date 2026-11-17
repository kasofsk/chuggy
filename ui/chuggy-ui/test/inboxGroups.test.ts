/**
 * The inbox's groups and where focus goes when an item leaves: each entry in
 * the one group its ask puts it in, the groups in their order with an empty one
 * left out, and focus to the next item drawn, then the group's heading, then
 * the first group's, then the line saying the inbox is clear.
 */

import { expect, test } from "vitest";

import type {
  InboxEntryResponse,
  ProjectNativeActionResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import {
  inboxEntryGroupKind,
  inboxFocusAfter,
  inboxGroups,
} from "../app/core/inboxGroups.ts";
import type { InboxGroup } from "../app/core/inboxGroups.ts";
import { inboxEntry } from "./inboxFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

function ticketAt(
  ticket: number,
  phase: ProjectTicket["phase"],
): ProjectTicket {
  return { ticket, phase, sequence: ticket, ...ticketInstants };
}

function approvalOn(ticket: number): ProjectNativeActionResponse {
  return {
    ticket,
    action: `action-${String(ticket)}`,
    kind: "EvaluationApproval",
    authorizingSequence: 5,
    admits: ["Approve", "Reject"],
    answerable: true,
    approval: {
      execution: `e${String(ticket)}`,
      workCycle: 1,
      stage: 1,
      generation: 1,
      evaluator: 1,
      approvers: "Developer",
    },
  };
}

const approval = inboxEntry(ticketAt(1, "Evaluation"), {
  actions: [approvalOn(1)],
});
const escalated = inboxEntry(ticketAt(4, "Escalated"));
const phased = inboxEntry(ticketAt(5, "Pending"));
const escalatedLater = inboxEntry(ticketAt(6, "Escalated"));

function tickets(groups: readonly InboxGroup[]) {
  return groups.map((group) => ({
    kind: group.kind,
    tickets: group.entries.map((entry) => entry.ticket.ticket),
  }));
}

test("an approval an entry holds puts it with the approvals, and anything else is a question", () => {
  const kinds = (entries: readonly InboxEntryResponse[]) =>
    entries.map(inboxEntryGroupKind);
  expect(kinds([approval, escalated, phased])).toStrictEqual([
    "Approvals",
    "Questions",
    "Questions",
  ]);
});

test("the groups come approvals, then questions, each in the read's order", () => {
  expect(tickets(inboxGroups([escalated, approval, phased]))).toStrictEqual([
    { kind: "Approvals", tickets: [1] },
    { kind: "Questions", tickets: [4, 5] },
  ]);
});

test("a group no entry is in is not drawn, and no entry draws no group", () => {
  expect(tickets(inboxGroups([escalated]))).toStrictEqual([
    { kind: "Questions", tickets: [4] },
  ]);
  expect(inboxGroups([])).toStrictEqual([]);
});

const before = inboxGroups([approval, escalated, phased, escalatedLater]);

test("focus goes to the next item of the group the left one was in", () => {
  expect(
    inboxFocusAfter(before, inboxGroups([approval, phased, escalatedLater]), {
      kind: "Questions",
      ticket: 4,
    }),
  ).toStrictEqual({ to: "Item", item: { kind: "Questions", ticket: 5 } });
});

test("an item after it that left too is passed over", () => {
  expect(
    inboxFocusAfter(before, inboxGroups([approval, escalatedLater]), {
      kind: "Questions",
      ticket: 4,
    }),
  ).toStrictEqual({ to: "Item", item: { kind: "Questions", ticket: 6 } });
});

test("with no item after it, focus goes to its group's heading", () => {
  expect(
    inboxFocusAfter(before, inboxGroups([approval, escalated, phased]), {
      kind: "Questions",
      ticket: 6,
    }),
  ).toStrictEqual({ to: "Group", kind: "Questions" });
});

test("with its group gone, focus goes to the first group's heading, and with every group gone to the clear line", () => {
  expect(
    inboxFocusAfter(before, inboxGroups([escalated, phased, escalatedLater]), {
      kind: "Approvals",
      ticket: 1,
    }),
  ).toStrictEqual({ to: "Group", kind: "Questions" });
  expect(
    inboxFocusAfter(inboxGroups([approval]), [], {
      kind: "Approvals",
      ticket: 1,
    }),
  ).toStrictEqual({ to: "Clear" });
});

test("an item that moved to another group has left the one it was in", () => {
  const answered = inboxEntry(ticketAt(1, "Escalated"));
  expect(
    inboxFocusAfter(before, inboxGroups([answered, escalated]), {
      kind: "Approvals",
      ticket: 1,
    }),
  ).toStrictEqual({ to: "Group", kind: "Questions" });
});

test("focus is never moved from an item still drawn", () => {
  expect(() =>
    inboxFocusAfter(before, before, { kind: "Questions", ticket: 4 }),
  ).toThrow();
});
