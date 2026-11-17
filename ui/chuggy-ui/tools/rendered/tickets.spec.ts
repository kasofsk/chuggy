/**
 * The tickets list at a phone's width and the desk's: a page of rows, one
 * with a title and a repository that each run past a phone, waiting on two
 * tickets and in an epic, beside a ready row and an escalated one; a filter
 * that matches none of them; and a project with no ticket. The phone's is
 * under a coarse pointer, as a phone's is. Neither scrolls the page
 * sideways, on the phone every control the page draws is at least the touch
 * height and the long title is drawn in two lines and no part of a third,
 * and every read is one the stub answers. The shell around the
 * page is not this page's, so the touch height is held under the page's own
 * section.
 */

import {
  projectArtifactResponseSchema,
  projectImagesResponseSchema,
  projectResponseSchema,
} from "../../../../src/contract/responses.ts";

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
        await expect(page.locator(".project-banner")).toHaveCount(0);
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

/**
 * The one Filter control opened over a page of tickets: on the phone a sheet
 * risen to the screen's foot, every control in it at least the touch height,
 * and on the desk a popover that stands beside the control. A state chosen in
 * it is written to the address as it always was, and is then a mark under
 * the bar that one press takes away.
 */
for (const viewport of ticketsViewports)
  test(`the Filter panel on the ${viewport} holds every filter, writes the address, and leaves a mark that takes it away`, async ({
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
        viewport,
        touch: viewport === "phone",
        signedIn: true,
        ready: (page) =>
          page.getByRole("heading", { level: 3, name: ticketsTitleLong }),
      });
      const page = rendered.page;
      await expect(page.getByRole("list", { name: "Filters set" })).toHaveCount(
        0,
      );
      await page.getByRole("button", { name: /^Filter/u }).click();
      const panel = page.getByRole("dialog", { name: "Filter" });
      await expect(panel).toBeVisible();
      for (const field of ["State", "Creator", "Owner"])
        await expect(
          panel.getByRole("combobox", { name: field, exact: true }),
        ).toBeVisible();
      await renderedNoOverflow(page);
      const drawn = await panel.boundingBox();
      const screenSize = page.viewportSize();
      if (viewport === "phone") {
        await renderedTouchTargets(page, panel);
        expect(drawn?.x).toBe(0);
        expect(drawn?.width).toBe(screenSize?.width);
        await expect
          .poll(async () => {
            const box = await panel.boundingBox();
            return box === null ? undefined : box.y + box.height;
          })
          .toBe(screenSize?.height);
      } else expect(drawn?.width ?? 0).toBeLessThan(screenSize?.width ?? 0);
      await panel
        .getByRole("combobox", { name: "State", exact: true })
        .selectOption({ label: "Ready" });
      await expect(page).toHaveURL(/[?&]filter=Ready(&|$)/u);
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      const mark = page.getByRole("button", { name: "Remove State: Ready" });
      await expect(mark).toBeVisible();
      if (viewport === "phone")
        await renderedTouchTargets(page, page.locator(".ticket-list-page"));
      await mark.click();
      await expect(page).toHaveURL(/[?&]filter=All(&|$)/u);
      await expect(page.getByRole("list", { name: "Filters set" })).toHaveCount(
        0,
      );
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });

const ticketsBannerArtifact = "banner-rendered";

const ticketsBannerPath = `${ticketsProjectPath}/artifacts/${ticketsBannerArtifact}`;

/** A single opaque pixel, which the band crops to fill it. */
const ticketsBannerPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/** The rows the first screen holds whole under the banner, at either size. */
const ticketsBannerRowsFirstScreen = 3;

/** Enough rows that the page scrolls well past the band. */
const ticketsBannerPage = {
  ...ticketsPage,
  sequence: 40,
  tickets: Array.from({ length: 40 }, (_, at) =>
    ticketsTicket(40 - at, `Ticket ${String(40 - at)}`, "Work"),
  ),
};

/** Where the band and the first row stand and how tall each is, as drawn
 * now. */
function ticketsBannerBoxes(page: Page): Promise<readonly string[]> {
  return page.evaluate(() =>
    [".project-banner", ".ticket-list-page [aria-label='Tickets'] > li"].map(
      (selector) => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box === undefined ? "none" : [box.y, box.height].join(" ");
      },
    ),
  );
}

/** The boxes while the image's read is held across a reload, and once it has
 * landed. */
async function ticketsBannerBoxesAcrossImage(page: Page): Promise<{
  readonly held: readonly string[];
  readonly landed: readonly string[];
}> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${ticketsBannerPath}`, async (route) => {
    await released;
    await route.continue();
  });
  const asked = page.waitForRequest(`**${ticketsBannerPath}`);
  await page.reload();
  await asked;
  await expect(
    page.getByRole("heading", { level: 3, name: "Ticket 40" }),
  ).toBeVisible();
  await expect(page.locator(".project-banner")).toBeVisible();
  await expect(page.locator(".project-banner img")).toHaveCount(0);
  const held = await ticketsBannerBoxes(page);
  release();
  await expect(page.locator(".project-banner img")).toBeVisible();
  return { held, landed: await ticketsBannerBoxes(page) };
}

/** Scrolls what the band scrolls in to `pixels` from its top, and returns once
 * the frame after has been drawn, by which the scroll's event has been
 * handled. */
function ticketsBannerScrolled(page: Page, pixels: number): Promise<void> {
  return page.locator(".project-banner").evaluate(async (band, by) => {
    let scroller: Element | null = band.parentElement;
    while (
      scroller !== null &&
      !/auto|scroll/u.test(getComputedStyle(scroller).overflowY)
    )
      scroller = scroller.parentElement;
    (scroller ?? document.scrollingElement)?.scrollTo({
      top: by,
      behavior: "instant",
    });
    for (let frame = 0; frame < 2; frame += 1)
      await new Promise((drawn) => requestAnimationFrame(drawn));
  }, pixels);
}

/**
 * A project's banner over its tickets list under the served policy: the image
 * decodes and the band says nothing of it; the first rows are still on the
 * first screen whole; nothing under the band moves as the image lands; and
 * once the page scrolls the band is gone, not back a pixel short of the top,
 * and back at the top.
 */
for (const viewport of ticketsViewports)
  test(`on the ${viewport} a project's banner heads its tickets list without taking the list's first screen, and is gone once the list scrolls`, async ({
    browser,
  }) => {
    const served = await servedOpen({
      root: renderedDist,
      reads: [
        stubApiRead(
          ticketsProjectPath,
          projectResponseSchema,
          ticketsBannerPage,
        ),
        stubApiRead(
          `${ticketsProjectPath}/appearance/images`,
          projectImagesResponseSchema,
          { banner: ticketsBannerArtifact, administers: false },
        ),
        stubApiRead(ticketsBannerPath, projectArtifactResponseSchema, {
          mediaType: "image/png",
          content: ticketsBannerPng,
          encoding: "base64",
        }),
      ],
    });
    try {
      const rendered = await renderedOpen(browser, served.origin, {
        route: ticketsPath,
        viewport,
        touch: viewport === "phone",
        signedIn: true,
        ready: (page) => page.locator(".project-banner img"),
      });
      const page = rendered.page;
      const image = page.locator(".project-banner img");
      await expect(image).toHaveAttribute("alt", "");
      expect(
        await image.evaluate((drawn: HTMLImageElement) => drawn.naturalWidth),
      ).toBeGreaterThan(0);
      await renderedNoOverflow(page);
      const rows = page
        .getByRole("list", { name: "Tickets", exact: true })
        .getByRole("listitem");
      const screenHeight = page.viewportSize()?.height ?? 0;
      for (let at = 0; at < ticketsBannerRowsFirstScreen; at += 1) {
        const box = await rows.nth(at).boundingBox();
        expect(
          box === null ? Infinity : box.y + box.height,
        ).toBeLessThanOrEqual(screenHeight);
      }
      const boxes = await ticketsBannerBoxesAcrossImage(page);
      expect(boxes.landed).toStrictEqual(boxes.held);
      const band = page.locator(".project-banner");
      await ticketsBannerScrolled(page, screenHeight);
      await expect(band).toHaveAttribute("data-gone");
      await expect(band).toHaveCSS("height", "0px");
      await ticketsBannerScrolled(page, 1);
      await expect(band).toHaveAttribute("data-gone");
      await ticketsBannerScrolled(page, 0);
      await expect(band).not.toHaveAttribute("data-gone");
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });
