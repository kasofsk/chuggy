/**
 * Which page a matched route is: the contract's name for it and what its
 * address carries, nothing for an address the contract would refuse, and a
 * page for every route the console hangs under a project and draws the chat
 * pane on.
 */

import { expect, test } from "vitest";

import { consolePageSchema } from "../../../src/contract/consolePage.ts";
import { consoleRouter } from "../app/browser/routes.tsx";
import { chatPaneDefault, chatPaneOnPage } from "../app/core/chatPane.ts";
import { consolePageLabel, consolePageOf } from "../app/core/consolePage.ts";
import { ticketCreationQueryOf } from "../app/core/ticketCreationQuery.ts";

const partitionRouteId = "/$tenant/$project";

function matched(
  routeId: string,
  params: Readonly<Record<string, string>> = {},
  search: Readonly<Record<string, unknown>> = {},
) {
  return {
    routeId,
    params: { tenant: "acme", project: "atlas", ...params },
    search,
  };
}

test("a route is the page the contract names for it, with what its address carries", () => {
  expect(consolePageOf(matched("/$tenant/$project/"))).toEqual({
    page: "Tickets",
  });
  expect(
    consolePageOf(
      matched("/$tenant/$project/tickets/$ticket", { ticket: "41" }),
    ),
  ).toEqual({ page: "Ticket", ticket: 41 });
  expect(
    consolePageOf(
      matched("/$tenant/$project/tickets/$ticket/edit", { ticket: "41" }),
    ),
  ).toEqual({ page: "TicketEdit", ticket: 41 });
  expect(
    consolePageOf(
      matched("/$tenant/$project/repositories/$repository", {
        repository: "github.com/acme/atlas",
      }),
    ),
  ).toEqual({ page: "Repository", repository: "github.com/acme/atlas" });
  expect(
    consolePageOf(matched("/$tenant/$project/settings/placement")),
  ).toEqual({ page: "Settings", section: "ProjectPlacement" });
  expect(
    consolePageOf(matched("/$tenant/$project/settings/workspace/runner")),
  ).toEqual({ page: "Settings", section: "WorkspaceRunners" });
});

const ticketNew = "/$tenant/$project/tickets/new";

/** The router's query parser hands a number back as one, and a quoted one as
 * text, so both read as the ticket they name. */
test("a new ticket names the ticket it duplicates, or the draft its address names in its place", () => {
  expect(consolePageOf(matched(ticketNew))).toEqual({ page: "TicketNew" });
  expect(consolePageOf(matched(ticketNew, {}, { from: 12 }))).toEqual({
    page: "TicketNew",
    from: 12,
  });
  expect(
    consolePageOf(matched(ticketNew, {}, { from: 12, draft: "41" })),
  ).toEqual({ page: "TicketNew", draft: 41 });
  expect(consolePageOf(matched(ticketNew, {}, { from: 12, draft: 0 }))).toEqual(
    { page: "TicketNew", from: 12 },
  );
  expect(
    consolePageOf(matched(ticketNew, {}, { from: "x", draft: "y" })),
  ).toEqual({ page: "TicketNew" });
});

/** A page that read the address its own way could name a ticket other than
 * the one drawn, or none where one is drawn. */
test("a page names the ticket its route reads from the same address", () => {
  const from = "041";
  expect(consolePageOf(matched(ticketNew, {}, { from }))).toEqual({
    page: "TicketNew",
    ...ticketCreationQueryOf({ from }),
  });
  expect(consolePageOf(matched(ticketNew, {}, { draft: from }))).toEqual({
    page: "TicketNew",
    ...ticketCreationQueryOf({ draft: from }),
  });
  expect(
    consolePageOf(
      matched("/$tenant/$project/tickets/$ticket", { ticket: "041" }),
    ),
  ).toEqual({ page: "Ticket", ticket: 41 });
});

test("an address the contract would refuse, or a route it does not know, is no page", () => {
  expect(
    consolePageOf(
      matched("/$tenant/$project/tickets/$ticket", { ticket: "new" }),
    ),
  ).toBeUndefined();
  expect(
    consolePageOf(
      matched("/$tenant/$project/repositories/$repository", {
        repository: "acme\natlas",
      }),
    ),
  ).toBeUndefined();
  expect(
    consolePageOf(matched("/tenants/$tenant/settings/people")),
  ).toBeUndefined();
  expect(consolePageOf(matched("constructor"))).toBeUndefined();
  expect(consolePageOf(undefined)).toBeUndefined();
});

test("every route the console hangs under a project and draws the pane on is a page the contract names", () => {
  const routeIds = Object.keys(consoleRouter.routesById).filter((routeId) =>
    routeId.startsWith(`${partitionRouteId}/`),
  );
  const threadRouteId = `${partitionRouteId}/threads/$session`;
  expect(routeIds).toContain(threadRouteId);
  expect(chatPaneOnPage(chatPaneDefault, { session: "0123" })).toBeUndefined();
  expect(
    consolePageOf(matched(threadRouteId, { session: "0123" })),
  ).toBeUndefined();
  const paned = routeIds.filter((routeId) => routeId !== threadRouteId);
  expect(paned).not.toEqual([]);
  for (const routeId of paned) {
    const page = consolePageOf(
      matched(routeId, { ticket: "41", repository: "github.com/acme/atlas" }),
    );
    expect(page, routeId).toBeDefined();
    expect(consolePageSchema.safeParse(page).success, routeId).toBe(true);
  }
});

test("a page is named in the console's own words for it", () => {
  expect(
    [
      { page: "Tickets" },
      { page: "Ticket", ticket: 41 },
      { page: "TicketEdit", ticket: 41 },
      { page: "TicketNew" },
      { page: "TicketNew", from: 12 },
      { page: "TicketNew", draft: 7 },
      { page: "Inbox" },
      { page: "Lead" },
      { page: "Catalog" },
      { page: "Repositories" },
      { page: "Repository", repository: "github.com/acme/atlas.git" },
      { page: "Runners" },
      { page: "Settings" },
      { page: "Settings", section: "ProjectPlacement" },
      { page: "Settings", section: "WorkspaceRunners" },
    ].map((page) => consolePageLabel(consolePageSchema.parse(page))),
  ).toEqual([
    "Tickets",
    "Ticket #41",
    "Edit ticket #41",
    "New ticket",
    "New ticket from #12",
    "New ticket · draft #7",
    "Inbox",
    "Lead",
    "Catalog",
    "Repositories",
    "Repository acme/atlas",
    "Runners",
    "Settings",
    "Settings · Project · Placement",
    "Settings · Workspace · My runners",
  ]);
});
