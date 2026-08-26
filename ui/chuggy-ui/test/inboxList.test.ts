/**
 * Which tickets the inbox holds, what it asks the wire for, and what the shell
 * counts.
 *
 * The membership case walks every phase the wire names, because the inbox is
 * the section's own definition and a phase that changed section without
 * changing the inbox is exactly what would go unnoticed.
 *
 * The badge counts the union of both reads, so every count here goes through
 * the union with no open actions in it: what these cases pin is the rule the
 * badge applies, and `inboxUnion.test.ts` is where the join itself is held.
 */

import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import { phaseRoster } from "../../../src/contract/rosters.ts";
import type {
  ProjectResponse,
  TicketResponse,
} from "../../../src/contract/responses.ts";
import {
  inboxActionsPage,
  inboxCountLabel,
  inboxPage,
  inboxPhases,
} from "../app/core/inboxList.ts";
import { inboxUnion } from "../app/core/inboxUnion.ts";
import {
  projectTicketPagesMax,
  projectTicketRowsAppend,
  projectTicketRowsEmpty,
  projectTicketRowsFold,
} from "../app/core/projectTicketPages.ts";
import type { ProjectTicketRows } from "../app/core/projectTicketPages.ts";
import { actionsFor } from "../app/core/ticketActions.ts";

const partition = { tenant: "acme", project: "atlas" };

/** The badge over a project with no open native action, which is the phase
 * page's own count. */
function phaseCountLabel(
  rows: ProjectTicketRows | undefined,
): string | undefined {
  return inboxCountLabel(inboxUnion(rows, undefined));
}

function page(
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

const parked = page([
  { ticket: 4, phase: "Escalated", sequence: 9, reason: "WorkFailed" },
  { ticket: 2, phase: "HandoffBlocked", sequence: 8 },
]);

test("the inbox holds exactly the phases that are an open human task", () => {
  expect([...inboxPhases]).toStrictEqual(["HandoffBlocked", "Escalated"]);
});

test("a frame for any other phase takes its row out of the inbox", () => {
  const held = projectTicketRowsAppend(projectTicketRowsEmpty, parked);
  for (const phase of phaseRoster) {
    const folded = projectTicketRowsFold(
      held,
      "4",
      { ticket: 4, phase, sequence: 11 },
      inboxPhases,
    );
    const holds = folded?.tickets.some((ticket) => ticket.ticket === 4);
    expect(holds).toBe(inboxPhases.includes(phase));
  }
});

test("a row offers what the phase enables, and a blocked handoff no revoke", () => {
  const offered = (ticket: TicketResponse) =>
    actionsFor(ticket).map((action) => action.action);
  expect(
    offered({
      ticket: 4,
      phase: "Escalated",
      sequence: 9,
      reason: "WorkFailed",
    }),
  ).toStrictEqual(["Resume", "Revoke"]);
  expect(
    offered({ ticket: 2, phase: "HandoffBlocked", sequence: 8 }),
  ).toStrictEqual(["Resume"]);
  for (const phase of phaseRoster)
    if (!inboxPhases.includes(phase))
      expect(
        offered({ ticket: 1, phase, sequence: 1 }).includes("Resume"),
      ).toBe(false);
});

test("a row's answer is the mutation the wire carries for that ticket", () => {
  expect(
    actionsFor({ ticket: 4, phase: "Escalated", sequence: 9 }).map(
      (action) => action.mutation,
    ),
  ).toStrictEqual([
    { mutation: "ResumeTicket", ticket: 4 },
    { mutation: "RevokeTicket", ticket: 4 },
  ]);
});

test("the page asks for both phases, newest activity first", () => {
  const asked = inboxPage(undefined);
  expect(asked.order).toBe("RecentActivity");
  expect(asked.phase).toStrictEqual(inboxPhases);
  expect(asked.cursor).toBeUndefined();
  expect(inboxPage("after-four").cursor).toBe("after-four");
});

/** The page size is the console's rather than the route's, because a default
 * this console does not state is a row count it cannot reason about. */
test("the page states its own size and it is the largest the wire allows", () => {
  expect(inboxPage(undefined).limit).toBe(nativeHttpPageItemsMax);
  expect(inboxPage("after-four").limit).toBe(nativeHttpPageItemsMax);
});

/**
 * The second read's page, held to the same two things. The cursor is the half
 * with consequences: the walk resumes by handing it back through this function,
 * so a page that dropped it would re-read the first page to its budget, keep
 * `nextCursor` set, and leave an approval on page two unreachable while
 * reporting nothing wrong.
 */
test("the open-actions page states its own size and carries its cursor", () => {
  expect(inboxActionsPage(undefined).limit).toBe(nativeHttpPageItemsMax);
  expect(inboxActionsPage(undefined).cursor).toBeUndefined();
  expect(inboxActionsPage("after-eleven").limit).toBe(nativeHttpPageItemsMax);
  expect(inboxActionsPage("after-eleven").cursor).toBe("after-eleven");
});

test("the count is the rows a page gave, and follows a frame that moves one", () => {
  const held = projectTicketRowsAppend(projectTicketRowsEmpty, parked);
  expect(phaseCountLabel(held)).toBe("2");
  const resumed = projectTicketRowsFold(
    held,
    "4",
    { ticket: 4, phase: "Working", sequence: 13 },
    inboxPhases,
  );
  expect(phaseCountLabel(resumed)).toBe("1");
  const arriving = projectTicketRowsFold(
    resumed,
    "9",
    { ticket: 9, phase: "Escalated", sequence: 14, reason: "GasExhausted" },
    inboxPhases,
  );
  expect(phaseCountLabel(arriving)).toBe("2");
});

test("folding one frame twice counts the same as folding it once", () => {
  const held = projectTicketRowsAppend(projectTicketRowsEmpty, parked);
  const arriving = {
    ticket: 9,
    phase: "Escalated" as const,
    sequence: 14,
    reason: "GasExhausted" as const,
  };
  const once = projectTicketRowsFold(held, "9", arriving, inboxPhases);
  const twice = projectTicketRowsFold(once, "9", arriving, inboxPhases);
  expect(twice?.tickets).toStrictEqual(once?.tickets);
  expect(phaseCountLabel(twice)).toBe(phaseCountLabel(once));
  expect(phaseCountLabel(twice)).toBe("3");
});

test("an empty inbox is counted as nothing rather than as a zero", () => {
  expect(phaseCountLabel(projectTicketRowsEmpty)).toBeUndefined();
  expect(phaseCountLabel(undefined)).toBeUndefined();
});

/**
 * The badge asks whether a further page is unread, not whether the reader may
 * ask for it: at the accumulation's own page cap the wire still has more, and a
 * bare number there is a number the badge knows is short.
 */
test("a count with a further page unread says so, at the page cap too", () => {
  const held = projectTicketRowsAppend(
    projectTicketRowsEmpty,
    page([{ ticket: 4, phase: "Escalated", sequence: 9 }], "after-four"),
  );
  expect(phaseCountLabel(held)).toBe("1+");
  let walked: ProjectTicketRows = projectTicketRowsEmpty;
  for (let read = 0; read < projectTicketPagesMax; read += 1)
    walked = projectTicketRowsAppend(
      walked,
      page([{ ticket: read + 1, phase: "Escalated", sequence: 1 }], "again"),
    );
  expect(walked.nextCursor).toBe("again");
  expect(phaseCountLabel(walked)).toBe(`${String(projectTicketPagesMax)}+`);
  expect(
    phaseCountLabel(
      projectTicketRowsAppend(
        projectTicketRowsEmpty,
        page([{ ticket: 4, phase: "Escalated", sequence: 9 }]),
      ),
    ),
  ).toBe("1");
});
