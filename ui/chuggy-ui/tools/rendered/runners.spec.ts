/**
 * A member's own runners page, at a phone's width and the desk's: its roster
 * as cards on the phone and columns on the desk, then the question a runner's
 * removal waits on. No state scrolls the page sideways, on the phone every
 * control each state draws is at least the touch height, and every read is
 * one the stub answers. The shell around a page is not the page's, so the
 * touch height is held under the page's own column, the element its head is
 * in. On the phone the chat host's card is titled by its name, the line under
 * it at the regular weight; on the desk the runners page's projects keep the
 * settings listings' fixed columns and light no row under the pointer.
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

const runnersViewports: readonly RenderedViewport[] = ["phone", "desk"];

for (const viewport of runnersViewports)
  test(`a member's own runners page and its removal question do not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: `/${stubApiTenant}/${stubApiProject}/settings/workspace/runner`,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("rowheader", { name: /^3f2a9c1e/u }),
    });
    const page = rendered.page;
    const column = page.locator("header.page-header").locator("..");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Personal runners",
    );
    const cardLabel = page.locator("tbody .tabular-label").first();
    if (viewport === "phone") {
      await expect(cardLabel).toBeVisible();
      const host = page
        .getByRole("table", { name: "Chat host" })
        .getByRole("rowheader");
      await expect(host.getByText("5b7d2e90")).toHaveCSS("font-weight", "600");
      await expect(host.getByText(/^Chats here/u)).toHaveCSS(
        "font-weight",
        "400",
      );
    } else {
      await expect(cardLabel).toBeHidden();
      const projects = page.getByRole("table", { name: "Projects" });
      await expect(projects).toHaveCSS("table-layout", "fixed");
      const row = projects.locator("tbody tr").first();
      const resting = await row.evaluate(
        (tr) => getComputedStyle(tr).backgroundColor,
      );
      await row.hover();
      await expect(row).toHaveCSS("background-color", resting);
    }
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    await page.getByRole("button", { name: "Remove runner a81c04d2" }).click();
    await expect(
      page.getByRole("group", { name: "Remove runner a81c04d2?" }),
    ).toBeVisible();
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });
