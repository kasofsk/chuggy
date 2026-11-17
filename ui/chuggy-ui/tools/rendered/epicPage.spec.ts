/**
 * The epic page at a phone's width and the desk's, the phone's under a coarse
 * pointer as a phone's is, on its Overview and its Tickets tab: the title is
 * the page's one top heading and the tab its address names is current.
 * Neither scrolls the page sideways, and nothing in the header or the tab's
 * content is past its edge, the tab row scrolling inside itself on the screen;
 * on the phone every control in the header and the tab row is at least the
 * touch height; the header's menu opens on the screen; and every read is one
 * the stub answers.
 *
 * Then every tab of an epic of eight tickets, one titled and one changed by a
 * member each named by one unbroken string longer than a phone is wide, whose
 * graph has a layer wider than a phone: at the desk with the chat pane open,
 * at the desk with the pane widened until the page is narrower than the
 * narrow breakpoint, and on a phone. None scrolls the page or its column
 * sideways, and nothing is past the column's edge but inside a box that
 * scrolls itself. The tickets are record rows. Where the page is narrow the
 * overview, the graph and a history row each lay their narrow columns while
 * the screen may still be a desk's, which is the page asking its own width;
 * the graph's drawing pans sideways and never up or down, and it offers the
 * Tickets tab, which at the desk it does not.
 */

import {
  epicGraphResponseSchema,
  epicHistoryResponseSchema,
  epicViewResponseSchema,
  projectResponseSchema,
} from "../../../../src/contract/responses.ts";
import { viewportNarrowEm } from "../../app/browser/shell/viewport.ts";

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedScreens,
  renderedTabsOpened,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";
import type { Page } from "@playwright/test";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const epicPageViewports: readonly RenderedViewport[] = ["phone", "desk"];

const epicPagePath = `/${stubApiTenant}/${stubApiProject}/epics/1`;

const epicPageTabs = [
  { tab: "Overview", path: "", content: "div.epic-overview" },
  { tab: "Tickets", path: "/tickets", content: "section.epic-tickets" },
] as const;

for (const viewport of epicPageViewports)
  for (const drawn of epicPageTabs)
    test(`the epic page's ${drawn.tab} tab does not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
      browser,
      served,
    }) => {
      const rendered = await renderedOpen(browser, served.origin, {
        route: `${epicPagePath}${drawn.path}`,
        viewport,
        touch: viewport === "phone",
        signedIn: true,
        ready: (page) =>
          page.getByRole("heading", { level: 2, name: drawn.tab }),
      });
      const page = rendered.page;
      const header = page.locator("header.page-header");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(header.getByRole("heading", { level: 1 })).toHaveText(
        "Billing #1",
      );
      const tabs = page.getByRole("navigation", { name: "Epic" });
      await expect(tabs.locator('a[aria-current="page"]')).toHaveText(
        new RegExp(`^${drawn.tab}`, "u"),
      );
      await expect(tabs).toBeInViewport({ ratio: 1 });
      await renderedNoOverflow(page, header);
      await renderedNoOverflow(page, page.locator(drawn.content));
      if (viewport === "phone") {
        await renderedTouchTargets(page, header);
        await renderedTouchTargets(page, tabs);
      }
      const menu = header.getByRole("button", { name: "More actions" });
      await expect(menu).toBeInViewport({ ratio: 1 });
      await menu.click();
      await expect(page.getByRole("menu")).toBeInViewport({ ratio: 1 });
      await renderedNoOverflow(page, header);
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    });

const epicPageApiPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}`;

const epicPageUnbroken =
  "reconcile-the-refund-ledger-against-the-processor-in-one-unbroken-word";

const epicPageMember =
  "a-member-whose-name-runs-past-a-phone-unbroken-by-any-space";

/** A ticket of the epic, Pending on `after` where it names any. */
function epicPageTicket(
  ticket: number,
  title: string,
  phase: string,
  after: readonly number[] = [],
) {
  return {
    ticket,
    creator: epicPageMember,
    title,
    phase,
    sequence: ticket,
    revision: 1,
    releasedAt: "2026-11-01T00:00:00Z",
    changedAt: "2026-11-02T00:00:00Z",
    revokedDependencies: [],
    openDependencies: after.map((on) => ({ ticket: on, phase: "Work" })),
  };
}

/** One Done, one working, one ready and titled unbroken, four waiting on
 * the one working, and one escalated. */
const epicPageTickets = [
  epicPageTicket(1, "Charge the card at checkout", "Done"),
  epicPageTicket(2, "Refund a charge in part or in whole", "Work"),
  epicPageTicket(3, epicPageUnbroken, "Pending"),
  epicPageTicket(4, "Export the ledger", "Pending", [2]),
  epicPageTicket(5, "Report refunds by month", "Pending", [2]),
  epicPageTicket(6, "Notify the customer of a refund", "Pending", [2]),
  epicPageTicket(7, "Audit every refund over a limit", "Pending", [2]),
  epicPageTicket(8, "Retry a charge the processor declined", "Escalated"),
];

const epicPageWide = {
  number: 1,
  revision: 4,
  title: "Billing",
  summary: "All of billing",
  visibility: "Active",
  progress: {
    byPhase: {
      Pending: 5,
      Work: 1,
      Evaluation: 0,
      Finalization: 0,
      Done: 1,
      Escalated: 1,
      Revoked: 0,
    },
    drafts: 0,
    done: 1,
    total: 8,
  },
  status: "attention",
  waitingOnOutside: [],
  description: "The **whole** of billing",
  tickets: epicPageTickets.map((ticket) => ticket.ticket),
};

/** A revision by the member with the long name. */
function epicPageRevision(
  revision: number,
  changedAt: string,
  changes: unknown,
) {
  return {
    revision,
    changedAt,
    actor: { kind: "user", subject: epicPageMember },
    title: epicPageUnbroken,
    visibility: "Active",
    changes,
  };
}

const epicPageWideReads = [
  stubApiRead(
    `${epicPageApiPath}/epics/1`,
    epicViewResponseSchema,
    epicPageWide,
  ),
  stubApiRead(epicPageApiPath, projectResponseSchema, {
    partition: { tenant: stubApiTenant, project: stubApiProject },
    sequence: 8,
    tickets: epicPageTickets,
  }),
  stubApiRead(`${epicPageApiPath}/epics/1/graph`, epicGraphResponseSchema, {
    nodes: epicPageTickets.map((ticket) => ({
      ticket: ticket.ticket,
      title: ticket.title,
      phase: ticket.phase,
      member: true,
    })),
    edges: [{ from: 1, to: 2 }, ...[4, 5, 6, 7].map((to) => ({ from: 2, to }))],
  }),
  stubApiRead(`${epicPageApiPath}/epics/1/history`, epicHistoryResponseSchema, {
    revisions: [
      epicPageRevision(4, "2026-10-03T00:05:00Z", {
        kind: "Revised",
        fields: [],
        added: [5, 6, 7, 8],
        removed: [],
      }),
      epicPageRevision(3, "2026-10-03T00:00:00Z", {
        kind: "Revised",
        fields: [],
        added: [2, 3, 4],
        removed: [],
      }),
      epicPageRevision(2, "2026-10-02T00:00:00Z", {
        kind: "Revised",
        fields: ["title", "summary"],
        added: [],
        removed: [],
      }),
      epicPageRevision(1, "2026-10-01T00:00:00Z", { kind: "Created" }),
    ],
  }),
];

/** Each tab, by the heading it opens with, and the grid whose columns it
 * lays narrow where the page is: how many it has wide, and narrow. */
const epicPageWideTabs = [
  { at: "", heading: "Overview", grid: ".epic-overview", columns: [2, 1] },
  { at: "/tickets", heading: "Tickets" },
  { at: "/graph", heading: "Graph", grid: ".epic-graph", columns: [2, 1] },
  {
    at: "/history",
    heading: "History",
    grid: ".epic-history-row",
    columns: [3, 2],
  },
] as const;

/** How many columns the first `grid` lays, once it is drawn. */
async function epicPageWideColumns(
  page: Page,
  grid: string,
  columns: number,
): Promise<void> {
  const drawn = page.locator(grid).first();
  await expect(drawn).toBeVisible();
  await expect
    .poll(
      () =>
        drawn.evaluate(
          (held) =>
            getComputedStyle(held).gridTemplateColumns.split(" ").length,
        ),
      { message: `the columns of ${grid}` },
    )
    .toBe(columns);
}

/** The page's column scrolls not at all sideways, and nothing in it is past
 * its edge but what stands inside a box that scrolls sideways itself: the tab
 * row and the graph's drawing. */
async function epicPageWideFits(page: Page): Promise<void> {
  await renderedNoOverflow(page, page.locator("header.page-header"));
  const column = await page.evaluate(() => {
    const scroller = document.querySelector("#shell-main > div");
    if (scroller === null) return { scrolled: -1, past: ["no column"] };
    const edge = scroller.getBoundingClientRect().right;
    const scrolling = (element: Element): boolean => {
      for (
        let up = element.parentElement;
        up !== null && up !== scroller;
        up = up.parentElement
      )
        if (["auto", "scroll"].includes(getComputedStyle(up).overflowX))
          return true;
      return false;
    };
    return {
      scrolled: scroller.scrollWidth - scroller.clientWidth,
      past: [...scroller.querySelectorAll("*")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > edge + 0.5 &&
            !scrolling(element),
        )
        .map(
          (element) => `${element.tagName.toLowerCase()}.${element.className}`,
        ),
    };
  });
  expect(column, "the page's column scrolls sideways").toEqual({
    scrolled: 0,
    past: [],
  });
}

/** Where the page is narrow the graph's drawing pans sideways to its last
 * card and never up or down, and the Tickets tab is offered; at the desk it
 * does neither. */
async function epicPageWideGraph(page: Page, narrow: boolean): Promise<void> {
  const pan = page.locator(".epic-graph-pan");
  const asList = page.getByRole("link", {
    name: "Read these tickets as a list",
  });
  const panned = await pan.evaluate((box) => ({
    across: getComputedStyle(box).overflowX,
    down: getComputedStyle(box).overflowY,
    wider: box.scrollWidth > box.clientWidth,
  }));
  if (!narrow) {
    expect(panned, "the drawing fits its box").toEqual({
      across: "visible",
      down: "visible",
      wider: false,
    });
    await expect(asList).toBeHidden();
    return;
  }
  expect(panned, "the drawing pans sideways only").toEqual({
    across: "auto",
    down: "hidden",
    wider: true,
  });
  await expect(asList).toBeVisible();
  await expect(asList).toHaveAttribute(
    "href",
    `/${stubApiTenant}/${stubApiProject}/epics/1/tickets`,
  );
  const lastShown = (): Promise<boolean> =>
    pan.evaluate((box) => {
      const cards = box.querySelectorAll(".epic-card");
      const last = cards[cards.length - 1];
      return (
        last !== undefined &&
        last.getBoundingClientRect().right <=
          box.getBoundingClientRect().right + 0.5
      );
    });
  expect(await lastShown(), "the last card starts past the box").toBe(false);
  await pan.evaluate((box) => {
    box.scrollLeft = box.scrollWidth;
  });
  expect(await lastShown(), "the box pans to its last card").toBe(true);
}

for (const screen of renderedScreens)
  test(`every tab of an epic with long names and a wide graph fits the page, with no sideways scroll, on the ${screen.name}`, async ({
    browser,
  }) => {
    const narrow = screen.viewport === "phone" || screen.narrowed;
    await renderedTabsOpened(browser, {
      reads: epicPageWideReads,
      route: epicPagePath,
      tabs: epicPageWideTabs,
      screen,
      narrowEm: viewportNarrowEm,
      known: [zodProbeViolation],
      each: async (page, tab) => {
        if ("grid" in tab)
          await epicPageWideColumns(
            page,
            tab.grid,
            tab.columns[narrow ? 1 : 0],
          );
        if (tab.at === "/tickets")
          await expect(page.locator("li.record-list-item")).toHaveCount(
            epicPageTickets.length,
          );
        if (tab.at === "/graph") await epicPageWideGraph(page, narrow);
        if (tab.at === "/history")
          await page
            .locator("#shell-main")
            .getByRole("button", { name: /^Show each/u })
            .first()
            .click();
        await epicPageWideFits(page);
      },
    });
  });
