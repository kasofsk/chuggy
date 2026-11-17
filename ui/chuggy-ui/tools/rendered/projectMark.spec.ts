/**
 * A project's mark under the served policy, over the tickets list. With an
 * icon the switcher at the desk and the phone's bar draw it, the browser
 * decodes it, and nothing in the bar moves as it arrives: its read is held
 * across a reload, the bar's boxes are taken while the mark's box stands
 * empty and again once the icon is in it, and they are the same. The tab's
 * icon is the project's while it is open. With no icon both draw the
 * initial. zod's probe is the one violation known, as `console.spec.ts` says.
 */

import type { Page } from "@playwright/test";

import {
  projectArtifactResponseSchema,
  projectInventoryResponseSchema,
} from "../../../../src/contract/responses.ts";
import {
  expect,
  renderedDist,
  renderedNoViolations,
  renderedOpen,
  test,
} from "./driver.ts";
import type { Rendered, RenderedViewport } from "./driver.ts";
import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const projectRoute = `/${stubApiTenant}/${stubApiProject}/`;
const iconPath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/artifacts/icon-rendered`;

/** A single opaque pixel, which the mark draws over its whole box. */
const iconPng =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const projectName = "Rendered project";

function projectMarkServed(icon: boolean): Promise<Served> {
  return servedOpen({
    root: renderedDist,
    reads: [
      stubApiRead("/api/v1/projects", projectInventoryResponseSchema, {
        projects: [
          {
            tenant: stubApiTenant,
            project: stubApiProject,
            name: projectName,
            ...(icon ? { icon: "icon-rendered" } : {}),
          },
        ],
      }),
      stubApiRead(iconPath, projectArtifactResponseSchema, {
        mediaType: "image/png",
        content: iconPng,
        encoding: "base64",
      }),
    ],
  });
}

function projectMarkOpen(
  browser: Parameters<typeof renderedOpen>[0],
  served: Served,
  viewport: RenderedViewport,
): Promise<Rendered> {
  return renderedOpen(browser, served.origin, {
    route: projectRoute,
    viewport,
    signedIn: true,
    ready: (page) => page.getByText("#1", { exact: true }),
  });
}

function triggerMark(page: Page) {
  return page.locator(".topbar-project button .project-mark");
}

/** Every box of the bar's first row, in document order, the mark's own box
 * among them and what is drawn inside it not. */
function barBoxes(page: Page): Promise<readonly string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("header.topbar *")]
      .filter(
        (element) => element.parentElement?.closest(".project-mark") === null,
      )
      .map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].join(" ");
      }),
  );
}

/** The bar's boxes while the icon's read is held, and once it has landed. */
async function barBoxesAcrossIcon(page: Page): Promise<{
  readonly held: readonly string[];
  readonly landed: readonly string[];
}> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**${iconPath}`, async (route) => {
    await released;
    await route.continue();
  });
  const asked = page.waitForRequest(`**${iconPath}`);
  await page.reload();
  await asked;
  await expect(triggerMark(page)).toBeVisible();
  await expect(triggerMark(page).locator("img")).toHaveCount(0);
  const held = await barBoxes(page);
  release();
  await expect(triggerMark(page).locator("img")).toBeVisible();
  return { held, landed: await barBoxes(page) };
}

async function iconDecoded(page: Page): Promise<void> {
  const image = triggerMark(page).locator("img");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate((drawn: HTMLImageElement) => drawn.naturalWidth),
  ).toBeGreaterThan(0);
}

for (const viewport of ["desk", "phone"] as const)
  test(`at the ${viewport} the bar draws the project's icon, and nothing in it moves as the icon arrives`, async ({
    browser,
  }) => {
    const served = await projectMarkServed(true);
    try {
      const rendered = await projectMarkOpen(browser, served, viewport);
      const page = rendered.page;
      await iconDecoded(page);
      const boxes = await barBoxesAcrossIcon(page);
      expect(boxes.landed).toStrictEqual(boxes.held);
      if (viewport === "phone")
        await expect(
          page
            .locator(".topbar-project button")
            .getByRole("img", { name: projectName }),
        ).toBeVisible();
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });

test("the switcher's list draws the icon beside the project, and the tab's icon is the project's", async ({
  browser,
}) => {
  const served = await projectMarkServed(true);
  try {
    const rendered = await projectMarkOpen(browser, served, "desk");
    const page = rendered.page;
    await iconDecoded(page);
    await page.locator(".topbar-project button").click();
    const item = page.getByRole("menuitemradio", { name: projectName });
    await expect(item.locator(".project-mark img")).toBeVisible();
    await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute(
      "href",
      `data:image/png;base64,${iconPng}`,
    );
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  } finally {
    await served.close();
  }
});

for (const viewport of ["desk", "phone"] as const)
  test(`at the ${viewport} a project with no icon is drawn as its initial`, async ({
    browser,
  }) => {
    const served = await projectMarkServed(false);
    try {
      const rendered = await projectMarkOpen(browser, served, viewport);
      const mark = triggerMark(rendered.page);
      await expect(mark).toHaveText("R");
      await expect(mark.locator("img")).toHaveCount(0);
      await expect(
        rendered.page.locator('link[rel="icon"]').first(),
      ).toHaveAttribute("href", "/chug-icon.svg");
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });
