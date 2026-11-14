/**
 * The catalog at a phone's width and the desk's: a repository's catalog, then
 * its search matching nothing, one configuration with an entry chosen, and
 * the repository's head with an entry chosen that another one uses, so the
 * head line's link and a reference's link are each drawn and measured.
 * The stub's repository and a workload's name each run past a phone. No state
 * scrolls the page sideways, on the phone every control each draws is at
 * least the touch height, and every read is one the stub answers. The search
 * is opened with motion reduced, so it is measured as it stands once open.
 * The shell around the page is not this page's, so the touch height is held
 * under the page's own column, the element its head is in. Scrolled past its
 * head and back up a little, the page holds its bar at the top of where it
 * scrolls, as the tickets list does, and the head draws no bar over it;
 * motion is reduced there too, so the bar is measured where it stands once
 * it has gone and come back.
 */

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { Page } from "@playwright/test";

import type { RenderedViewport } from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const catalogViewports: readonly RenderedViewport[] = ["phone", "desk"];

const catalogPath = `/${stubApiTenant}/${stubApiProject}/settings/catalog`;

const catalogWorkload = "build-and-test-everything-the-repository-declares";

for (const viewport of catalogViewports)
  test(`a repository's catalog and its search do not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: catalogPath,
      viewport,
      signedIn: true,
      ready: (page) =>
        page.getByRole("heading", { level: 4, name: catalogWorkload }),
    });
    const page = rendered.page;
    const column = page.locator("header.page-header").locator("..");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Catalog");
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Search the catalog" }).click();
    await page
      .getByRole("textbox", { name: "Search the catalog" })
      .fill("nothing-is-named-this");
    await expect(
      page.getByText("Nothing in the catalog matches"),
    ).toBeVisible();
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });

for (const viewport of catalogViewports)
  test(`a configuration with an entry chosen does not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
    browser,
    served,
  }) => {
    const entry = `workloads/${catalogWorkload}`;
    const rendered = await renderedOpen(browser, served.origin, {
      route: `${catalogPath}?${new URLSearchParams({ configuration: "revision-coding", entry }).toString()}`,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("article", { name: catalogWorkload }),
    });
    const page = rendered.page;
    const column = page.locator("header.page-header").locator("..");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "coding #3",
    );
    await expect(
      page
        .getByRole("heading", { level: 3, name: catalogWorkload })
        .getByRole("link"),
    ).toHaveAttribute("aria-current", "page");
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });

for (const viewport of catalogViewports)
  test(`the head with a used entry chosen does not scroll sideways on the ${viewport}, and its links are a finger's size`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: `${catalogPath}?${new URLSearchParams({ configuration: "revision-coding", source: "head", entry: "workloads/checks" }).toString()}`,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("article", { name: "checks" }),
    });
    const page = rendered.page;
    const column = page.locator("header.page-header").locator("..");
    await expect(
      page.getByRole("region", { name: "Used by" }).getByRole("link"),
    ).toHaveText("checked");
    await expect(
      page.getByRole("link", { name: "Show the import" }),
    ).toBeVisible();
    await renderedNoOverflow(page);
    if (viewport === "phone") await renderedTouchTargets(page, column);
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });

/** Scrolls the page's own scroller by `by` and waits for it to be there. */
async function catalogScrolled(page: Page, by: number): Promise<void> {
  const scrollTop = (delta: number) =>
    page.locator(".list-controls").evaluate((bar, moved) => {
      let scroller = bar.parentElement;
      while (
        scroller !== null &&
        !["auto", "scroll"].includes(getComputedStyle(scroller).overflowY)
      )
        scroller = scroller.parentElement;
      const scrolled = scroller ?? document.documentElement;
      scrolled.scrollTop += moved;
      return scrolled.scrollTop;
    }, delta);
  const from = await scrollTop(0);
  await scrollTop(by);
  await expect.poll(() => scrollTop(0)).toBe(from + by);
}

/** Far enough down that the head is gone and the bar has gone out of the
 * way, as `useHeadroom` puts it. */
const catalogScrollDown = 600;

/** Far enough back up that the bar comes back, and not so far the head does. */
const catalogScrollUp = 100;

for (const viewport of catalogViewports)
  test(`scrolled past its head and back on the ${viewport}, the catalog's bar stands at the top with no bar over it`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: `${catalogPath}?${new URLSearchParams({ configuration: "revision-coding", entry: `workloads/${catalogWorkload}` }).toString()}`,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("article", { name: catalogWorkload }),
    });
    const page = rendered.page;
    const bar = page.locator(".list-controls");
    const head = page.locator("header.page-header");
    await page.emulateMedia({ reducedMotion: "reduce" });
    const resting = await bar.boundingBox();
    await catalogScrolled(page, catalogScrollDown);
    await expect(bar).toHaveAttribute("data-hidden");
    await catalogScrolled(page, -catalogScrollUp);
    await expect(bar).not.toHaveAttribute("data-hidden");
    const stuck = await bar.boundingBox();
    const headed = await head.boundingBox();
    expect(stuck?.y).toBeLessThan(resting?.y ?? 0);
    expect(headed === null ? 0 : headed.y + headed.height).toBeLessThan(
      stuck?.y ?? 0,
    );
    await expect(
      page.getByRole("button", { name: "Search the catalog" }),
    ).toBeInViewport();
    await expect(page.locator(".page-header-sticky")).toHaveCount(0);
    expect(served.unanswered).toEqual([]);
  });
