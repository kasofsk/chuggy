/**
 * The runners page at a phone's width and the desk's: its roster, the ask
 * with its Advanced fold closed and then open, and the steps a minted token is
 * handed over in, which hold the longest command the page draws. The roster is
 * cards on the phone and columns on the desk. No state scrolls the page
 * sideways, on the phone every control each state draws is at least the touch
 * height, and every read is one the stub answers. The shell around the page is
 * not this page's, so the touch height is held under the page's own column,
 * the element its head is in.
 *
 * A member's own runners page is held to the same, with its roster and then
 * the question a runner's removal waits on.
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
  test(`the runners page and its steps do not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: `/${stubApiTenant}/${stubApiProject}/settings/runners`,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("rowheader", { name: /^build-linux/u }),
    });
    const page = rendered.page;
    const column = page.locator("header.page-header").locator("..");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Runners");
    const cardLabel = page.locator("tbody .tabular-label").first();
    if (viewport === "phone") await expect(cardLabel).toBeVisible();
    else await expect(cardLabel).toBeHidden();
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    await page.getByRole("button", { name: "Add runner" }).click();
    await expect(page.getByRole("form", { name: "Runner" })).toBeVisible();
    if (viewport === "phone") await renderedTouchTargets(page, column);
    await page.getByRole("button", { name: "Advanced" }).click();
    await expect(
      page.getByRole("textbox", { name: "Capabilities" }),
    ).toBeVisible();
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    await page.getByRole("button", { name: "Create token" }).click();
    await expect(
      page.getByRole("list", { name: "Add runner" }).getByRole("listitem"),
    ).toHaveCount(3);
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });

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
    if (viewport === "phone") await expect(cardLabel).toBeVisible();
    else await expect(cardLabel).toBeHidden();
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
