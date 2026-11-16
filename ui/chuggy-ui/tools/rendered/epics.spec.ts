/**
 * The epics list at a phone's width and the desk's: a page of rows, one with
 * a title and a summary that each run past a phone and one archived, and a
 * project with no epic, the phone's under a coarse pointer as a phone's is.
 * Neither scrolls the page sideways, on the phone every
 * control the page draws is at least the touch height, and every read is one
 * the stub answers. The shell around the page is not this page's, so the
 * touch height is held under the page's own section.
 */

import { epicListResponseSchema } from "../../../../src/contract/responses.ts";

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

const epicsViewports: readonly RenderedViewport[] = ["phone", "desk"];

const epicsPath = `/${stubApiTenant}/${stubApiProject}/epics`;

const epicsListPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/epics`;

const epicsTitleLong =
  "Move every list the console draws onto the one record list primitive";

function epicsSummary(
  number: number,
  title: string,
  status: string,
  visibility: string,
) {
  return {
    number,
    revision: 1,
    title,
    visibility,
    progress: {
      byPhase: {
        Pending: 4,
        Work: 1,
        Evaluation: 0,
        Finalization: 0,
        Done: 3,
        Escalated: 1,
        Revoked: 0,
      },
      drafts: 0,
      done: 3,
      total: 9,
    },
    status,
    waitingOnOutside: [],
  };
}

const epicsPage = {
  epics: [
    {
      ...epicsSummary(3, epicsTitleLong, "attention", "Active"),
      summary:
        "Tickets, epics, repositories and the catalog each draw their rows from RecordList",
    },
    epicsSummary(2, "Billing", "in_progress", "Active"),
    epicsSummary(1, "Search", "done", "Archived"),
  ],
  nextAfter: 1,
};

const epicsCases = [
  {
    name: "a page of epics",
    page: epicsPage,
    ready: "heading",
  },
  { name: "no epic", page: { epics: [] }, ready: "empty" },
] as const;

for (const viewport of epicsViewports)
  for (const drawn of epicsCases)
    test(`the epics list with ${drawn.name} does not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
      browser,
    }) => {
      const served = await servedOpen({
        root: renderedDist,
        reads: [stubApiRead(epicsListPath, epicListResponseSchema, drawn.page)],
      });
      try {
        const rendered = await renderedOpen(browser, served.origin, {
          route: epicsPath,
          viewport,
          touch: viewport === "phone",
          signedIn: true,
          ready: (page) =>
            drawn.ready === "heading"
              ? page.getByRole("heading", { level: 3, name: epicsTitleLong })
              : page.getByText("No epics yet. Ask in a chat to make one."),
        });
        const page = rendered.page;
        const section = page.locator("section.epic-list-page");
        await renderedNoOverflow(page);
        if (viewport === "phone") await renderedTouchTargets(page, section);
        if (drawn.ready === "heading") {
          await expect(
            page.getByRole("list", { name: "Epics" }).getByRole("link"),
          ).toHaveCount(3);
          await expect(
            page.getByRole("button", { name: "Show more" }),
          ).toBeVisible();
        }
        renderedNoViolations(rendered, [zodProbeViolation]);
        expect(served.unanswered).toEqual([]);
      } finally {
        await served.close();
      }
    });
