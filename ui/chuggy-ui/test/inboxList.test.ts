/**
 * The inbox as this console holds it: the page it asks the wire for, what its
 * pages make, which `Ticket` frames read it again, and what the shell counts.
 *
 * The badge is the server's count of the whole inbox, so a page that holds
 * fewer entries than the inbox does is never counted as itself.
 */

import { expect, test } from "vitest";

import {
  inboxPhases,
  nativeHttpPageItemsMax,
} from "../../../src/contract/http.ts";
import { phaseRoster } from "../../../src/contract/rosters.ts";
import { executionSummarySchema } from "../../../src/contract/responses.ts";
import type {
  InboxResponse,
  ProjectTicket,
} from "../../../src/contract/responses.ts";
import {
  inboxCountLabel,
  inboxEntryPhased,
  inboxPage,
  inboxPagesMax,
  inboxPagesNext,
  inboxRowsAppend,
  inboxRowsEmpty,
  inboxRowsExecutionFold,
  inboxRowsOf,
  inboxRowsRereads,
} from "../app/core/inboxList.ts";
import type { InboxPages } from "../app/core/inboxList.ts";
import { inboxBody, inboxEntry } from "./inboxFixture.ts";
import { ticketInstants } from "./ticketInstants.ts";

function ticketAt(
  ticket: number,
  phase: ProjectTicket["phase"],
): ProjectTicket {
  return { ticket, phase, sequence: ticket, ...ticketInstants };
}

const parked = inboxBody(
  [inboxEntry(ticketAt(4, "Escalated")), inboxEntry(ticketAt(2, "Pending"))],
  { count: 3, nextCursor: "after-two" },
);

const last = inboxBody([inboxEntry(ticketAt(1, "Escalated"))]);

test("the page asks for as much as the wire answers, from the cursor it is given", () => {
  expect(inboxPage(undefined)).toStrictEqual({ limit: nativeHttpPageItemsMax });
  expect(inboxPage("after-four")).toStrictEqual({
    limit: nativeHttpPageItemsMax,
    cursor: "after-four",
  });
});

test("the badge is the count the server says the inbox holds, and nothing where it holds none", () => {
  const held = inboxRowsAppend(inboxRowsEmpty, parked);
  expect(held.entries).toHaveLength(2);
  expect(inboxCountLabel(held)).toBe("3");
  expect(inboxCountLabel(inboxRowsAppend(held, last))).toBe("1");
  expect(inboxCountLabel(inboxRowsEmpty)).toBeUndefined();
  expect(inboxCountLabel(undefined)).toBeUndefined();
});

test("a page after the first is appended, a ticket already held kept where it is", () => {
  const held = inboxRowsAppend(inboxRowsEmpty, parked);
  const repeated = inboxRowsAppend(
    held,
    inboxBody([
      inboxEntry({ ...ticketAt(2, "Pending"), sequence: 9 }),
      inboxEntry(ticketAt(1, "Escalated")),
    ]),
  );
  expect(repeated.entries.map((entry) => entry.ticket.ticket)).toStrictEqual([
    4, 2, 1,
  ]);
  expect(repeated.entries[1]?.ticket.sequence).toBe(2);
  expect([repeated.pagesRead, repeated.nextCursor]).toStrictEqual([
    2,
    undefined,
  ]);
});

/** The pages as the cache holds them, each read from the cursor the one before it answered. */
function pagesOf(pages: readonly InboxResponse[]): InboxPages {
  return {
    pages: [...pages],
    pageParams: pages.map((_page, at) => pages[at - 1]?.nextCursor),
  };
}

test("the rows the pages draw are the pages appended in the order they were read", () => {
  expect(inboxRowsOf(pagesOf([parked, last]))).toStrictEqual(
    inboxRowsAppend(inboxRowsAppend(inboxRowsEmpty, parked), last),
  );
  expect(inboxPagesNext(pagesOf([parked]))).toBe("after-two");
  expect(inboxPagesNext(pagesOf([parked, last]))).toBeUndefined();
});

test("no page is offered past the page bound", () => {
  const endless = inboxBody([inboxEntry(ticketAt(1, "Escalated"))], {
    count: 1,
    nextCursor: "again",
  });
  expect(
    inboxPagesNext(
      pagesOf(Array.from({ length: inboxPagesMax - 1 }, () => endless)),
    ),
  ).toBe("again");
  expect(
    inboxPagesNext(
      pagesOf(Array.from({ length: inboxPagesMax }, () => endless)),
    ),
  ).toBeUndefined();
});

test("a Ticket frame rereads the inbox for a ticket it holds or a phase it holds, and for nothing else", () => {
  const held = inboxRowsAppend(inboxRowsEmpty, parked);
  for (const phase of phaseRoster) {
    expect(
      inboxRowsRereads(held, {
        resource: "9",
        representation: ticketAt(9, phase),
      }),
    ).toBe(inboxPhases.includes(phase));
    expect(
      inboxRowsRereads(held, {
        resource: "2",
        representation: ticketAt(2, phase),
      }),
    ).toBe(true);
  }
  expect(inboxRowsRereads(held, { resource: "2", representation: null })).toBe(
    true,
  );
  expect(inboxRowsRereads(held, { resource: "9", representation: null })).toBe(
    false,
  );
});

test("an entry's phase answers are offered only where its phase is what holds it here", () => {
  const escalated = inboxEntry(ticketAt(4, "Escalated"));
  expect(inboxEntryPhased(escalated)).toBe(escalated.ticket);
  expect(inboxEntryPhased(inboxEntry(ticketAt(11, "Finalization")))).toBe(
    undefined,
  );
});

const execution = executionSummarySchema.parse({
  execution: "e2",
  ticket: 2,
  task: 3,
  taskKind: "Work",
  identity: { type: "WorkTask", value: { ticket: 2, cycle: 1 } },
  cluster: "rig",
  configurationRevision: "r1",
  requirementIdentity: "requirement-a",
  requirement: {
    mode: "Container",
    operatingSystem: "Linux",
    architecture: "Amd64",
    image: "chuggy/worker",
  },
  requirementDigest: "b".repeat(64),
  requirementSource: "TicketDefault",
  platformDefaultVersion: 1,
  status: "Running",
  retriesSpent: 0,
  registeredAt: "2026-08-26T10:00:00.000Z",
});

test("an Execution frame becomes the latest of a ticket the inbox holds, and of no other", () => {
  const held = inboxRowsAppend(inboxRowsEmpty, parked);
  const folded = inboxRowsExecutionFold(held, execution);
  expect(folded?.entries[1]?.ticket.latestExecution?.execution).toBe("e2");
  expect(folded?.entries[0]).toStrictEqual(held.entries[0]);
  expect(
    inboxRowsExecutionFold(held, { ...execution, ticket: 9 }),
  ).toStrictEqual(held);
  expect(inboxRowsExecutionFold(held, null)).toStrictEqual(held);
});
