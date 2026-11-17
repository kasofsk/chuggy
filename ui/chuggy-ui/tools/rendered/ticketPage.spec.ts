/**
 * The ticket page's header at a phone's width and the desk's, the phone's
 * under a coarse pointer as a phone's is: a ticket whose title runs past a
 * phone, Pending with every action in its menu and Done leading with
 * Duplicate. Neither scrolls the page sideways, the title is the page's one
 * heading and wraps rather than pushing the actions off the screen, on the
 * phone every control in the header is at least the touch height, and every
 * read is one the stub answers. Beside them, a ticket whose Runs tab counts
 * more runs than leave its tabs room on a phone: the tab row scrolls inside
 * itself, and the page still does not.
 *
 * Then every tab, a run's details and the landing of a ticket that has run,
 * whose branch, model and conflicting path are each longer than a phone is
 * wide: at the desk with the chat pane open, at the desk with the pane widened
 * until the page is narrower than the two-column breakpoint, and on a phone.
 * None scrolls the page or its column sideways and none cuts content off,
 * where the pane leaves the page narrow the overview lays one column while
 * the screen is still a desk's, which is the page asking its own width, and a
 * step's evaluator list sits below its box rather than over it.
 */

import { ticketActionReachResponseSchema } from "../../../../src/contract/actionReach.ts";
import {
  configurationResponseSchema,
  executionResponseSchema,
  executionsResponseSchema,
  projectResponseSchema,
  ticketLandingsResponseSchema,
  ticketNativeActionsResponseSchema,
  ticketResponseSchema,
} from "../../../../src/contract/responses.ts";
import {
  landingConflicted,
  landingsRead,
} from "../../test/ticketLandingsFixture.ts";
import {
  ledgerExecution,
  ledgerPage,
  ticket21Parked,
  ticket21Program,
} from "../../test/ticketLedgerFixture.ts";

import { viewportTwoColumnEm } from "../../app/browser/shell/viewport.ts";
import {
  expect,
  renderedDist,
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
import { servedOpen } from "./served.ts";
import {
  stubApiNotFound,
  stubApiProject,
  stubApiRead,
  stubApiTenant,
} from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const ticketPageViewports: readonly RenderedViewport[] = ["phone", "desk"];

const ticketPageProjectPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}`;

const ticketPageTitleLong =
  "Move the ticket page's header onto the page header primitive and its menu";

/** The stub's one ticket, titled past a phone's width, in `phase`. */
function ticketPageTicket(phase: "Pending" | "Done") {
  return {
    ticket: 1,
    creator: "issuer member",
    title: ticketPageTitleLong,
    phase,
    sequence: 1,
    revision: 1,
    releasedAt: "2026-11-01T00:00:00Z",
    changedAt: "2026-11-02T00:00:00Z",
    revokedDependencies: [],
    openDependencies: [],
  };
}

const ticketPageCases = [
  { phase: "Pending", leads: undefined },
  { phase: "Done", leads: "Duplicate" },
] as const;

for (const viewport of ticketPageViewports)
  for (const drawn of ticketPageCases)
    test(`a ${drawn.phase} ticket's header with a long title does not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
      browser,
    }) => {
      const ticket = ticketPageTicket(drawn.phase);
      const served = await servedOpen({
        root: renderedDist,
        reads: [
          stubApiRead(
            `${ticketPageProjectPath}/tickets/1`,
            ticketResponseSchema,
            ticket,
          ),
          stubApiRead(ticketPageProjectPath, projectResponseSchema, {
            partition: { tenant: stubApiTenant, project: stubApiProject },
            sequence: 1,
            tickets: [ticket],
          }),
        ],
      });
      try {
        const rendered = await renderedOpen(browser, served.origin, {
          route: `/${stubApiTenant}/${stubApiProject}/tickets/1`,
          viewport,
          touch: viewport === "phone",
          signedIn: true,
          ready: (page) =>
            page.getByRole("heading", { level: 1, name: /^Move the ticket/u }),
        });
        const page = rendered.page;
        const header = page.locator("header.page-header");
        await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
        await expect(header.getByRole("heading", { level: 1 })).toHaveText(
          `${ticketPageTitleLong} #1`,
        );
        if (viewport === "phone")
          expect(
            await header
              .getByRole("heading", { level: 1 })
              .evaluate(
                (title) =>
                  title.getBoundingClientRect().height /
                  Number.parseFloat(getComputedStyle(title).lineHeight),
              ),
            "the title wraps onto a second line",
          ).toBeGreaterThan(1.5);
        const menu = header.getByRole("button", { name: "More actions" });
        await expect(menu).toBeInViewport({ ratio: 1 });
        if (drawn.leads !== undefined)
          await expect(
            header.getByRole("link", { name: drawn.leads }),
          ).toBeInViewport({ ratio: 1 });
        await renderedNoOverflow(page);
        if (viewport === "phone") await renderedTouchTargets(page, header);
        await menu.click();
        await expect(page.getByRole("menu")).toBeInViewport({ ratio: 1 });
        await renderedNoOverflow(page);
        renderedNoViolations(rendered, [zodProbeViolation]);
        expect(served.unanswered).toEqual([]);
      } finally {
        await served.close();
      }
    });

const ticketPageRunCount = 12;

/** The stub ticket's runs, one a cycle, each a work run that passed. */
const ticketPageRuns = Array.from(
  { length: ticketPageRunCount },
  (_, index) => ({
    execution: `e${String(index + 1)}`,
    ticket: 1,
    task: index + 1,
    taskKind: "Work",
    identity: { type: "WorkTask", value: { ticket: 1, cycle: index + 1 } },
    cluster: "rig",
    configurationRevision: "r1",
    requirementIdentity: "req-1",
    requirement: {
      mode: "Container",
      operatingSystem: "Linux",
      architecture: "Amd64",
      image: "chuggy/worker",
    },
    requirementDigest: "a".repeat(64),
    requirementSource: "PlatformDefault",
    platformDefaultVersion: 1,
    status: "Terminal",
    outcome: "Passed",
    retriesSpent: 0,
    registeredAt: "2026-11-01T00:00:00Z",
  }),
);

test("a ticket whose Runs tab carries its count has more tabs than a phone holds: the row scrolls inside itself and the page does not", async ({
  browser,
}) => {
  const ticket = ticketPageTicket("Pending");
  const served = await servedOpen({
    root: renderedDist,
    reads: [
      stubApiRead(
        `${ticketPageProjectPath}/tickets/1`,
        ticketResponseSchema,
        ticket,
      ),
      stubApiRead(ticketPageProjectPath, projectResponseSchema, {
        partition: { tenant: stubApiTenant, project: stubApiProject },
        sequence: 1,
        tickets: [ticket],
      }),
      stubApiRead(
        `${ticketPageProjectPath}/executions`,
        executionsResponseSchema,
        { executions: ticketPageRuns },
      ),
    ],
  });
  try {
    const rendered = await renderedOpen(browser, served.origin, {
      route: `/${stubApiTenant}/${stubApiProject}/tickets/1`,
      viewport: "phone",
      touch: true,
      signedIn: true,
      ready: (page) =>
        page.getByRole("link", {
          name: `Runs ${String(ticketPageRunCount)}`,
        }),
    });
    const page = rendered.page;
    const tabs = page.getByRole("navigation", { name: "Ticket" });
    const usage = tabs.getByRole("link", { name: "Usage" });
    expect(
      await tabs.evaluate((row) => row.scrollWidth > row.clientWidth),
      "the tabs are wider than their row",
    ).toBe(true);
    await expect(tabs).toHaveAttribute("data-more-end", "");
    await expect(tabs).toBeInViewport({ ratio: 1 });
    await expect(usage).not.toBeInViewport({ ratio: 1 });
    await renderedNoOverflow(page, page.locator("header.page-header"));
    await tabs.evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
    });
    await expect(usage).toBeInViewport({ ratio: 1 });
    await expect(tabs).toHaveAttribute("data-more-start", "");
    await renderedNoOverflow(page, page.locator("header.page-header"));
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  } finally {
    await served.close();
  }
});

/** Ticket 21's program with its second stage two evaluators wide, so its
 * step lists them under its box. */
const ticketPageRanProgram = [
  ticket21Program[0],
  { key: 2, evaluators: [{ key: 1 }, { key: 2 }] },
];

/** Ticket 21 of the ledger fixture, parked after three cycles, its branch,
 * its model and the path its landing conflicted on each one unbroken string
 * longer than a phone is wide. */
const ticketPageRan = {
  ticket: 21,
  creator: "issuer member",
  title: "Lay the ticket page out by its container",
  phase: "Escalated",
  sequence: 167,
  revision: 1,
  releasedAt: "2026-08-26T00:00:00Z",
  changedAt: "2026-08-27T00:00:00Z",
  revokedDependencies: [],
  openDependencies: [],
  brief: {
    intent: "Lay the ticket page out by the space it is given.",
    links: [],
    branch:
      "refs/heads/chug/ticket-21-the-ticket-page-lays-out-by-its-container-not-the-viewport",
    finalization: { kind: "PullRequest", target: "refs/heads/main" },
  },
  configurationRevision: "r1",
  program: ticketPageRanProgram,
  escalation: { kind: "EvaluationFailureEscalated", resumeAt: "ResumeRework" },
  runTotals: {
    turns: 212,
    durationMs: 3_960_000,
    durationApiMs: 3_490_000,
    tokensInput: 150_000,
    tokensOutput: 12_000,
    tokensCacheCreation: 16_000,
    tokensCacheRead: 20_000,
    costUsdMicros: 2_740_000,
    costBasis: "List",
    permissionDenials: 0,
    models: [
      {
        model: "claude-opus-5-5-a-model-whose-name-runs-past-a-phone-unbroken",
        tokensInput: 120_000,
        tokensOutput: 9_000,
        tokensCacheCreation: 12_000,
        tokensCacheRead: 15_000,
        costUsdMicros: 2_310_000,
      },
    ],
  },
};

const ticketPageRanPath = `${ticketPageProjectPath}/tickets/21`;

const ticketPageRanReads = [
  stubApiRead(ticketPageRanPath, ticketResponseSchema, ticketPageRan),
  stubApiRead(ticketPageProjectPath, projectResponseSchema, {
    partition: { tenant: stubApiTenant, project: stubApiProject },
    sequence: 1,
    tickets: [ticketPageRan],
  }),
  stubApiNotFound(`${ticketPageProjectPath}/drafts/21`),
  stubApiRead(
    `${ticketPageRanPath}/native-actions`,
    ticketNativeActionsResponseSchema,
    { actions: [] },
  ),
  stubApiRead(
    `${ticketPageRanPath}/action-reach`,
    ticketActionReachResponseSchema,
    { repository: null, commit: null, actions: [] },
  ),
  stubApiRead(
    `${ticketPageProjectPath}/executions`,
    executionsResponseSchema,
    ledgerPage(ticket21Parked),
  ),
  ...ticket21Parked.map((shape) =>
    stubApiRead(
      `${ticketPageProjectPath}/executions/${shape.execution}`,
      executionResponseSchema,
      { ...ledgerExecution(shape), attempts: [] },
    ),
  ),
  stubApiRead(
    `${ticketPageRanPath}/landings`,
    ticketLandingsResponseSchema,
    landingsRead([
      {
        ...landingConflicted(3),
        conflict: {
          paths: [
            "services/billing/src/invoices/a-module-whose-path-runs-past-a-phone-unbroken.ts",
          ],
          truncated: false,
        },
      },
    ]),
  ),
  stubApiRead(
    `${ticketPageProjectPath}/configurations/r1`,
    configurationResponseSchema,
    {
      partition: { tenant: stubApiTenant, project: stubApiProject },
      revision: "r1",
      canonical: "{}",
      digest: "c".repeat(64),
    },
  ),
];

/** Each tab, by the heading it opens with, and the two pages under Runs. The
 * landing's details are opened, since they hold its commits and paths. */
const ticketPageRanTabs = [
  { at: "", heading: "Overview" },
  { at: "/runs", heading: "Runs" },
  { at: "/runs/7?view=details", heading: "Runs" },
  { at: "/landing", heading: "Runs", opens: "Details" },
  { at: "/configuration", heading: "Configuration" },
  { at: "/usage", heading: "Usage" },
] as const;

/** The page's own column neither scrolls sideways nor holds anything past its
 * edge or cut off inside a box: only the tab row, which scrolls itself, what
 * is hidden but for assistive technology, and a value cut short with an
 * ellipsis whose whole is drawn too, are wider than they show. */
async function ticketPageRanFits(page: Page): Promise<void> {
  await renderedNoOverflow(page, page.locator("header.page-header"));
  const column = await page.evaluate(() => {
    const scroller = document.querySelector("#shell-main > div");
    if (scroller === null) return { scrolled: -1, past: [], cut: [] };
    const edge = scroller.getBoundingClientRect().right;
    const drawn = [...scroller.querySelectorAll("*")].filter(
      (element) => element.closest(".tab-nav") === null,
    );
    const text = (element: Element): string =>
      (element.textContent ?? "").trim();
    const whole = (element: Element): boolean =>
      getComputedStyle(element).textOverflow === "ellipsis" &&
      (element.getAttribute("title") === text(element) ||
        drawn.some(
          (other) =>
            other !== element &&
            !other.contains(element) &&
            text(other).includes(text(element)),
        ));
    const named = (element: Element): string =>
      `${element.tagName.toLowerCase()}.${element.className}`;
    return {
      scrolled: scroller.scrollWidth - scroller.clientWidth,
      past: drawn
        .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
        .map(named),
      cut: drawn
        .filter(
          (element) =>
            getComputedStyle(element).overflowX !== "visible" &&
            element.clientWidth > 1 &&
            element.scrollWidth > element.clientWidth + 1 &&
            !whole(element),
        )
        .map(named),
    };
  });
  expect(column, "the page's column scrolls sideways or cuts content").toEqual({
    scrolled: 0,
    past: [],
    cut: [],
  });
}

/** A step's evaluator list is drawn, and below its step's box rather than
 * over it. */
async function ticketPageRanStepsApart(page: Page): Promise<void> {
  const list = page.locator(".ticket-steps-evaluators");
  await expect(list).toHaveCount(1);
  const box = list.locator("xpath=preceding-sibling::*[1]");
  await expect(box).toHaveClass(/ticket-steps-box/u);
  const [listTop, boxBottom] = await Promise.all([
    list.evaluate((drawn) => drawn.getBoundingClientRect().top),
    box.evaluate((drawn) => drawn.getBoundingClientRect().bottom),
  ]);
  expect(
    listTop,
    "the evaluator list starts below its box",
  ).toBeGreaterThanOrEqual(boxBottom);
}

for (const screen of renderedScreens)
  test(`every tab of a ticket that has run fits the page, with no sideways scroll and nothing cut off, on the ${screen.name}`, async ({
    browser,
  }) => {
    await renderedTabsOpened(browser, {
      reads: ticketPageRanReads,
      route: `/${stubApiTenant}/${stubApiProject}/tickets/21`,
      tabs: ticketPageRanTabs,
      screen,
      narrowEm: viewportTwoColumnEm,
      known: [zodProbeViolation],
      each: async (page, tab) => {
        if ("opens" in tab)
          await page
            .locator("#shell-main")
            .getByRole("button", { name: tab.opens })
            .click();
        if (tab.at === "") {
          const overview = page.locator(".ticket-overview");
          await expect(overview).toBeVisible();
          await expect
            .poll(
              () =>
                overview.evaluate(
                  (grid) =>
                    getComputedStyle(grid).gridTemplateColumns.split(" ")
                      .length,
                ),
              { message: "the overview's columns" },
            )
            .toBe(screen.viewport === "desk" && !screen.narrowed ? 2 : 1);
          await ticketPageRanStepsApart(page);
        }
        await ticketPageRanFits(page);
      },
    });
  });
