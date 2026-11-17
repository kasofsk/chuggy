/**
 * The epic page at a phone's width and the desk's, the phone's under a coarse
 * pointer as a phone's is, on its Overview and its Tickets tab: the title is
 * the page's one top heading and the tab its address names is current.
 * Neither scrolls the page sideways, and nothing in the header or the tab's
 * content is past its edge, the tab row scrolling inside itself on the screen;
 * on the phone every control in the header and the tab row is at least the
 * touch height; the header's menu opens on the screen; and every read is one
 * the stub answers.
 */

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

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
