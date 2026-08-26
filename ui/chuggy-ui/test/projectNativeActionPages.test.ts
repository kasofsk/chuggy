/**
 * The list of a project's open native actions: what a page, a refusal and a
 * live frame each do to it.
 *
 * The frame cases are the ones the inbox rests on — an approval opening has to
 * arrive and its answer has to leave — so each is driven through the fold the
 * screen registers rather than through anything the screen does.
 */

import { expect, test } from "vitest";

import { nativeHttpPageItemsMax } from "../../../src/contract/http.ts";
import type {
  ProjectNativeActionResponse,
  ProjectNativeActionsResponse,
} from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectNativeActionPagesMax,
  projectNativeActionRowsAppend,
  projectNativeActionRowsEmpty,
  projectNativeActionRowsFold,
  projectNativeActionRowsHaveMore,
  projectNativeActionRowsRead,
  projectNativeActionRowsMax,
} from "../app/core/projectNativeActionPages.ts";

function approval(ticket: number, action: string): ProjectNativeActionResponse {
  return {
    ticket,
    action,
    kind: "FinalizationApproval",
    authorizingSequence: 40 + ticket,
    admits: ["Approve", "Decline"],
  };
}

function page(
  actions: readonly ProjectNativeActionResponse[],
  nextCursor?: string,
): ProjectNativeActionsResponse {
  return {
    actions: [...actions],
    ...(nextCursor === undefined ? {} : { nextCursor }),
  };
}

const held = projectNativeActionRowsAppend(
  projectNativeActionRowsEmpty,
  page([approval(7, "action-seven"), approval(9, "action-nine")]),
);

function ticketsHeld(
  rows:
    { readonly actions: readonly ProjectNativeActionResponse[] } | undefined,
): readonly number[] {
  return (rows?.actions ?? []).map((action) => action.ticket);
}

test("a page is held in the order it gave, and a repeat is not listed twice", () => {
  expect(ticketsHeld(held)).toStrictEqual([7, 9]);
  const again = projectNativeActionRowsAppend(
    held,
    page([approval(9, "action-nine"), approval(3, "action-three")]),
  );
  expect(ticketsHeld(again)).toStrictEqual([7, 9, 3]);
});

test("an approval opening arrives at the head of the list", () => {
  const folded = projectNativeActionRowsFold(held, "5", {
    actions: [
      {
        action: "action-five",
        kind: "FinalizationApproval",
        authorizingSequence: 51,
        admits: ["Approve", "Decline"],
      },
    ],
  });
  expect(ticketsHeld(folded)).toStrictEqual([5, 7, 9]);
  expect(folded?.actions[0]?.action).toBe("action-five");
});

test("an answered action leaves on the frame that says it is answered", () => {
  const folded = projectNativeActionRowsFold(held, "7", { actions: [] });
  expect(ticketsHeld(folded)).toStrictEqual([9]);
});

test("a frame replaces a ticket's actions rather than adding to them", () => {
  const folded = projectNativeActionRowsFold(held, "7", {
    actions: [
      {
        action: "action-later",
        kind: "TicketEscalation",
        authorizingSequence: 71,
        admits: ["Revoke"],
      },
    ],
  });
  expect(ticketsHeld(folded)).toStrictEqual([7, 9]);
  expect(folded?.actions[0]?.action).toBe("action-later");
});

test("folding one frame twice lands where folding it once does", () => {
  const arriving = {
    actions: [
      {
        action: "action-five",
        kind: "FinalizationApproval",
        authorizingSequence: 51,
        admits: ["Approve", "Decline"],
      },
    ],
  };
  const once = projectNativeActionRowsFold(held, "5", arriving);
  const twice = projectNativeActionRowsFold(once, "5", arriving);
  expect(twice?.actions).toStrictEqual(once?.actions);
});

test("a tombstone takes the ticket's actions with it", () => {
  expect(
    ticketsHeld(projectNativeActionRowsFold(held, "7", null)),
  ).toStrictEqual([9]);
});

test("a frame the read's own schema rejects leaves the list alone", () => {
  expect(
    projectNativeActionRowsFold(held, "7", { actions: [{ kind: "Nonsense" }] })
      ?.actions,
  ).toStrictEqual(held.actions);
  expect(
    projectNativeActionRowsFold(held, "not-a-ticket", { actions: [] })?.actions,
  ).toStrictEqual(held.actions);
  expect(
    projectNativeActionRowsFold(undefined, "7", { actions: [] }),
  ).toBeUndefined();
});

function reading(pages: readonly ApiResult<ProjectNativeActionsResponse>[]): {
  readonly read: (
    cursor: string | undefined,
  ) => Promise<ApiResult<ProjectNativeActionsResponse>>;
  readonly cursors: (string | undefined)[];
} {
  const cursors: (string | undefined)[] = [];
  let asked = 0;
  return {
    cursors,
    read: (cursor) => {
      cursors.push(cursor);
      const answered = pages[asked] ?? pages.at(-1);
      asked += 1;
      return Promise.resolve(
        answered ?? { outcome: "Ok" as const, value: page([]) },
      );
    },
  };
}

test("the read walks the cursor to the page the wire stops at", async () => {
  const held = reading([
    { outcome: "Ok", value: page([approval(7, "a")], "after-seven") },
    { outcome: "Ok", value: page([approval(9, "b")]) },
  ]);
  const answered = await projectNativeActionRowsRead(held.read);
  expect(answered.outcome).toBe("Ok");
  expect(held.cursors).toStrictEqual([undefined, "after-seven"]);
  if (answered.outcome !== "Ok") return;
  expect(ticketsHeld(answered.value)).toStrictEqual([7, 9]);
  expect(answered.value.nextCursor).toBeUndefined();
  expect(projectNativeActionRowsHaveMore(answered.value)).toBe(false);
});

test("the walk stops at its page budget with the cursor it did not follow", async () => {
  const held = reading([
    { outcome: "Ok", value: page([approval(1, "a")], "again") },
  ]);
  const answered = await projectNativeActionRowsRead(held.read);
  expect(answered.outcome).toBe("Ok");
  if (answered.outcome !== "Ok") return;
  expect(answered.value.pagesRead).toBe(projectNativeActionPagesMax);
  expect(answered.value.nextCursor).toBe("again");
  expect(projectNativeActionRowsHaveMore(answered.value)).toBe(false);
});

test("the walk stops at its row cap too", () => {
  const full = page(
    Array.from({ length: projectNativeActionRowsMax + 5 }, (_ignored, at) =>
      approval(at + 1, `action-${String(at)}`),
    ),
    "again",
  );
  const rows = projectNativeActionRowsAppend(
    projectNativeActionRowsEmpty,
    full,
  );
  expect(rows.actions.length).toBe(projectNativeActionRowsMax);
  expect(projectNativeActionRowsHaveMore(rows)).toBe(false);
});

/**
 * The fold's own site of the same bound, which a frame can reach without the
 * walk being involved: a list already at the cap keeps up to that many actions
 * for other tickets, and one frame carries up to the contract's whole page for
 * the ticket it names. Nothing trims the sum but the fold itself, and the
 * frames arrive on a stream the reader does not control.
 */
test("a frame cannot grow the list past its cap, however often it arrives", () => {
  const full = projectNativeActionRowsAppend(
    projectNativeActionRowsEmpty,
    page(
      Array.from({ length: projectNativeActionRowsMax }, (_unused, at) =>
        approval(at + 1, `action-${String(at)}`),
      ),
    ),
  );
  expect(full.actions.length).toBe(projectNativeActionRowsMax);
  const arriving = {
    actions: Array.from({ length: nativeHttpPageItemsMax }, (_unused, at) => ({
      action: `action-arriving-${String(at)}`,
      kind: "FinalizationApproval",
      authorizingSequence: 500 + at,
      admits: ["Approve", "Decline"],
    })),
  };
  const once = projectNativeActionRowsFold(full, "1", arriving);
  expect(once?.actions.length).toBe(projectNativeActionRowsMax);
  const twice = projectNativeActionRowsFold(once, "1", arriving);
  expect(twice?.actions.length).toBe(projectNativeActionRowsMax);
  const thrice = projectNativeActionRowsFold(twice, "1", arriving);
  expect(thrice?.actions.length).toBe(projectNativeActionRowsMax);
});

test("a refusal after a page keeps what was read and says why", async () => {
  const held = reading([
    { outcome: "Ok", value: page([approval(7, "a")], "after-seven") },
    { outcome: "Unreachable", reason: "the socket closed" },
  ]);
  const answered = await projectNativeActionRowsRead(held.read);
  expect(answered.outcome).toBe("Ok");
  if (answered.outcome !== "Ok") return;
  expect(ticketsHeld(answered.value)).toStrictEqual([7]);
  expect(answered.value.failure).toContain("the socket closed");
});

test("a first page that will not read is answered with the refusal itself", async () => {
  const held = reading([
    { outcome: "Unreachable", reason: "the socket closed" },
  ]);
  const answered = await projectNativeActionRowsRead(held.read);
  expect(answered.outcome).toBe("Unreachable");
});
