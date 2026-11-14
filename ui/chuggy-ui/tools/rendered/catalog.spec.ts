/**
 * The catalog at a phone's width and the desk's: a repository's catalog, then
 * its search matching nothing, and one configuration with an entry chosen.
 * The stub's repository and a workload's name each run past a phone. No state
 * scrolls the page sideways, on the phone every control each draws is at
 * least the touch height, and every read is one the stub answers. The search
 * is opened with motion reduced, so it is measured as it stands once open.
 * The shell around the page is not this page's, so the touch height is held
 * under the page's own column, the element its head is in.
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
