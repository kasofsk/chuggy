/**
 * The tickets list at a phone's width and the desk's: a page of rows, one
 * with a title and a repository that each run past a phone, waiting on two
 * tickets and in an epic, beside a ready row and an escalated one; a filter
 * that matches none of them; and a project with no ticket. The phone's is
 * under a coarse pointer, as a phone's is. Neither scrolls the page
 * sideways, on the phone every control the page draws is at least the touch
 * height and the long title is drawn in two lines and no part of a third,
 * and every read is one the stub answers. On the phone the Filter control
 * opens its panel as a sheet across the screen's foot, every control in it
 * the touch height; a state chosen there is written to the address and drawn
 * as a mark under the bar, and Escape closes the sheet. The shell around the
 * page is not this page's, so the touch height is held under the page's own
 * section.
 */

import { projectResponseSchema } from "../../../../src/contract/responses.ts";

import {
  expect,
  renderedDist,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";
import type { Page } from "@playwright/test";
import { servedOpen } from "./served.ts";
import {
  stubApiProject,
  stubApiRead,
  stubApiRepositoryLong,
  stubApiTenant,
} from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const ticketsViewports: readonly RenderedViewport[] = ["phone", "desk"];

const ticketsPath = `/${stubApiTenant}/${stubApiProject}/`;

const ticketsProjectPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}`;

const ticketsTitleLong =
  "Draw every row of the tickets list from the one record list primitive the console shares";

function ticketsTicket(
  ticket: number,
  title: string,
  phase: string,
  over: Readonly<Record<string, unknown>> = {},
) {
  return {
    ticket,
    title,
    creator: "issuer member",
    phase,
    sequence: ticket,
    revision: 1,
    releasedAt: "2026-11-01T00:00:00Z",
    changedAt: "2026-11-02T00:00:00Z",
    revokedDependencies: [],
    openDependencies: [],
    ...over,
  };
}

const ticketsPage = {
  partition: { tenant: stubApiTenant, project: stubApiProject },
  sequence: 4,
  tickets: [
    ticketsTicket(4, ticketsTitleLong, "Pending", {
      repository: stubApiRepositoryLong,
      openDependencies: [
        { ticket: 3, phase: "Work" },
        { ticket: 2, phase: "Pending" },
      ],
      epics: [{ number: 1, title: "Billing", visibility: "Active" }],
    }),
    ticketsTicket(3, "Billing export", "Work"),
    ticketsTicket(2, "Search index", "Pending"),
    ticketsTicket(1, "Broken migration", "Escalated", {
      escalation: { kind: "WorkFailureEscalated", resumeAt: "ResumeWork" },
    }),
  ],
};

/** How many lines of the long title are drawn: its words' height over a
 * line's, so a line drawn in the height its link adds is counted. */
async function ticketsTitleLines(page: Page): Promise<number> {
  return page
    .getByRole("heading", { level: 3, name: ticketsTitleLong })
    .locator(".record-row-title-words")
    .evaluate(
      (words) =>
        words.getBoundingClientRect().height /
        Number.parseFloat(getComputedStyle(words).lineHeight),
    );
}

const ticketsCases = [
  {
    name: "a page of tickets",
    route: ticketsPath,
    page: ticketsPage,
    ready: "heading",
  },
  {
    name: "a filter that matches none of them",
    route: `${ticketsPath}?filter=Blocked`,
    page: {
      ...ticketsPage,
      tickets: ticketsPage.tickets.filter(({ phase }) => phase !== "Pending"),
    },
    ready: "cleared",
  },
  {
    name: "no ticket",
    route: ticketsPath,
    page: { ...ticketsPage, tickets: [] },
    ready: "empty",
  },
] as const;

for (const viewport of ticketsViewports)
  for (const drawn of ticketsCases)
    test(`the tickets list with ${drawn.name} does not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
      browser,
    }) => {
      const served = await servedOpen({
        root: renderedDist,
        reads: [
          stubApiRead(ticketsProjectPath, projectResponseSchema, drawn.page),
        ],
      });
      try {
        const rendered = await renderedOpen(browser, served.origin, {
          route: drawn.route,
          viewport,
          touch: viewport === "phone",
          signedIn: true,
          ready: (page) => {
            switch (drawn.ready) {
              case "heading":
                return page.getByRole("heading", {
                  level: 3,
                  name: ticketsTitleLong,
                });
              case "cleared":
                return page.getByRole("button", { name: "Clear filters" });
              case "empty":
                return page.getByText(
                  "No tickets yet. Ask in a chat to make one.",
                );
            }
          },
        });
        const page = rendered.page;
        await renderedNoOverflow(page);
        if (viewport === "phone")
          await renderedTouchTargets(page, page.locator(".ticket-list-page"));
        if (drawn.ready === "heading") {
          const rows = page.getByRole("list", { name: "Tickets", exact: true });
          await expect(rows.getByRole("heading", { level: 3 })).toHaveCount(4);
          await expect(
            page.getByRole("button", { name: "Dispatch ticket #2" }),
          ).toBeVisible();
          if (viewport === "phone")
            await expect(ticketsTitleLines(page)).resolves.toBe(2);
        }
        renderedNoViolations(rendered, [zodProbeViolation]);
        expect(served.unanswered).toEqual([]);
      } finally {
        await served.close();
      }
    });

test("on the phone the Filter control opens a sheet across the screen's foot, and a state chosen there is the address's and a mark under the bar", async ({
  browser,
}) => {
  const served = await servedOpen({
    root: renderedDist,
    reads: [
      stubApiRead(ticketsProjectPath, projectResponseSchema, ticketsPage),
    ],
  });
  try {
    const rendered = await renderedOpen(browser, served.origin, {
      route: ticketsPath,
      viewport: "phone",
      touch: true,
      signedIn: true,
      ready: (page) =>
        page.getByRole("heading", { level: 3, name: ticketsTitleLong }),
    });
    const page = rendered.page;
    await expect(page.getByRole("list", { name: "Filters on" })).toHaveCount(0);
    await page.getByRole("button", { name: /^Filter/u }).tap();
    const sheet = page.getByRole("dialog", { name: "Filter" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("combobox", { name: "State" })).toBeFocused();
    await sheet.evaluate((element) =>
      Promise.all(element.getAnimations().map((motion) => motion.finished)),
    );
    const viewport = page.viewportSize();
    const box = await sheet.boundingBox();
    expect(box?.x).toBe(0);
    expect(box?.width).toBe(viewport?.width);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeCloseTo(
      viewport?.height ?? 0,
      0,
    );
    await renderedNoOverflow(page);
    await renderedTouchTargets(page, sheet);
    await sheet
      .getByRole("combobox", { name: "State" })
      .selectOption("Escalated");
    await expect(page).toHaveURL(/[?&]filter=Escalated(&|$)/u);
    await expect(
      page.getByRole("button", { name: /^Filter.*1 filter on$/u }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Filter/u })).toBeFocused();
    await expect(
      page
        .getByRole("list", { name: "Filters on" })
        .getByText("State: Escalated", { exact: true }),
    ).toBeVisible();
    await renderedTouchTargets(page, page.locator(".ticket-list-page"));
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  } finally {
    await served.close();
  }
});
