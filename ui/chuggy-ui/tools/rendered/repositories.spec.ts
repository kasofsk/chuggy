/**
 * The repositories list and one repository's page at a phone's width and the
 * desk's. The list holds a repository whose name runs past a phone, its marks
 * and its Unbind, and the page is that repository's own, with its sections
 * and its configurations. No state scrolls the page sideways, on the phone
 * every control each draws is at least the touch height, and every read is
 * one the stub answers. The shell around the page is not this page's, so the
 * touch height is held under the page's own column, the element its head is
 * in.
 *
 * The reader here administers the project, so every press a row offers is
 * drawn.
 */

import { projectAbilitiesResponseSchema } from "../../../../src/contract/responses.ts";

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";
import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import { renderedDist } from "./driver.ts";
import {
  stubApiProject,
  stubApiRead,
  stubApiRepositoryLong,
  stubApiTenant,
} from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const repositoriesViewports: readonly RenderedViewport[] = ["phone", "desk"];

const repositoriesPath = `/${stubApiTenant}/${stubApiProject}/settings/repositories`;

/** The site, answering this reader as one who administers the project. */
async function repositoriesServed(): Promise<Served> {
  return servedOpen({
    root: renderedDist,
    reads: [
      stubApiRead(
        `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/abilities`,
        projectAbilitiesResponseSchema,
        {
          principal: "issuer member",
          mutate: true,
          dispatch: true,
          manageSelector: false,
          overrideTicketConfig: false,
          skipPlannedEvaluations: false,
          administer: true,
          writeEpic: true,
        },
      ),
    ],
  });
}

for (const viewport of repositoriesViewports)
  test(`the repositories list and its unbind question do not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
    browser,
  }) => {
    const served = await repositoriesServed();
    try {
      const rendered = await renderedOpen(browser, served.origin, {
        route: repositoriesPath,
        viewport,
        signedIn: true,
        ready: (page) =>
          page.getByRole("heading", {
            level: 2,
            name: "kasofsk/chuggy",
            exact: true,
          }),
      });
      const page = rendered.page;
      const column = page.locator("header.page-header").locator("..");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Repositories",
      );
      await expect(
        page.getByRole("link", { name: "Review on GitHub" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
      await renderedNoOverflow(page);
      if (viewport === "phone") await renderedTouchTargets(page, column);
      await page.getByRole("button", { name: "Unbind" }).first().click();
      await expect(page.getByRole("group", { name: /^Unbind / })).toBeVisible();
      await renderedNoOverflow(page);
      if (viewport === "phone") await renderedTouchTargets(page, column);
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });

for (const viewport of repositoriesViewports)
  test(`a repository's page does not scroll sideways on the ${viewport}, and nothing else is refused`, async ({
    browser,
  }) => {
    const served = await repositoriesServed();
    try {
      const rendered = await renderedOpen(browser, served.origin, {
        route: `${repositoriesPath}/${encodeURIComponent(stubApiRepositoryLong)}`,
        viewport,
        signedIn: true,
        ready: (page) => page.getByRole("heading", { name: "Configurations" }),
      });
      const page = rendered.page;
      const column = page.locator("header.page-header").locator("..");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "kasofsk/chuggy-a-repository-whose-name-runs-past-a-phone",
      );
      await expect(page.locator(".page-header-description")).toHaveText(
        stubApiRepositoryLong,
      );
      const cardLabel = page.locator("tbody .tabular-label").first();
      if (viewport === "phone") await expect(cardLabel).toBeVisible();
      else await expect(cardLabel).toBeHidden();
      await renderedNoOverflow(page);
      if (viewport === "phone") await renderedTouchTargets(page, column);
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    } finally {
      await served.close();
    }
  });
