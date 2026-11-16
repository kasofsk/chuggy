/**
 * The ticket page's header at a phone's width and the desk's, the phone's
 * under a coarse pointer as a phone's is: a ticket whose title runs past a
 * phone, Pending with every action in its menu and Done leading with
 * Duplicate. Neither scrolls the page sideways, the title is the page's one
 * heading and wraps rather than pushing the actions off the screen, on the
 * phone every control in the header is at least the touch height, and every
 * read is one the stub answers.
 */

import {
  projectResponseSchema,
  ticketResponseSchema,
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
import { servedOpen } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

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
