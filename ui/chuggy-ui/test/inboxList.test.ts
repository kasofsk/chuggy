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
  inboxRowsAfterPage,
  inboxRowsAppend,
  inboxRowsEmpty,
  inboxRowsExecutionFold,
  inboxRowsRead,
  inboxRowsRereads,
} from "../app/core/inboxList.ts";
import type { InboxRows } from "../app/core/inboxList.ts";
import type { ApiFailure } from "../app/core/apiRequest.ts";
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

const fault: ApiFailure = {
  outcome: "Fault",
  code: "InternalError",
  status: 500,
};

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

/** A "more" that fails keeps the rows and says why; one that answers clears it. */
test("a further page the reader asked for that failed is said beside the rows", () => {
  const held = inboxRowsAppend(inboxRowsEmpty, parked);
  const failed = inboxRowsAfterPage(held, fault);
  expect(failed.entries).toStrictEqual(held.entries);
  expect(failed.failure).toBeDefined();
  expect(
    inboxRowsAfterPage(failed, { outcome: "Ok", value: last }).failure,
  ).toBeUndefined();
});

/** Every page a read asked for, answering each from `pages` in turn. */
function pagesServed(pages: readonly (InboxResponse | undefined)[]): {
  readonly read: (
    cursor: string | undefined,
  ) => ReturnType<Parameters<typeof inboxRowsRead>[1]>;
  readonly asked: (string | undefined)[];
} {
  const asked: (string | undefined)[] = [];
  return {
    asked,
    read: (cursor) => {
      const page = pages[asked.length];
      asked.push(cursor);
      return Promise.resolve(
        page === undefined ? fault : { outcome: "Ok", value: page },
      );
    },
  };
}

test("a first read is one page, and a reread is as many as the rows it replaces held", async () => {
  const first = pagesServed([parked, last]);
  const read = await inboxRowsRead(undefined, first.read);
  expect(first.asked).toStrictEqual([undefined]);
  expect(read.outcome).toBe("Ok");
  const walked = inboxRowsAppend(inboxRowsAppend(inboxRowsEmpty, parked), last);
  const again = pagesServed([parked, last]);
  const reread = await inboxRowsRead(walked, again.read);
  expect(again.asked).toStrictEqual([undefined, "after-two"]);
  expect(reread).toStrictEqual({ outcome: "Ok", value: walked });
});

/** The failure is the read's answer, so the rows it would have replaced stay drawn. */
test("a reread that fails on any page answers the failure", async () => {
  const walked = inboxRowsAppend(inboxRowsAppend(inboxRowsEmpty, parked), last);
  const failing = pagesServed([parked]);
  expect((await inboxRowsRead(walked, failing.read)).outcome).toBe("Fault");
});

test("a reread never gathers past the page bound", async () => {
  const endless = inboxBody([inboxEntry(ticketAt(1, "Escalated"))], {
    count: 1,
    nextCursor: "again",
  });
  const held: InboxRows = { ...inboxRowsEmpty, pagesRead: inboxPagesMax * 2 };
  const served = pagesServed(
    Array.from({ length: inboxPagesMax * 2 }, () => endless),
  );
  await inboxRowsRead(held, served.read);
  expect(served.asked).toHaveLength(inboxPagesMax);
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
