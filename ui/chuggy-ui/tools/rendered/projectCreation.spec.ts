/**
 * The new-project page on a phone, pressed by a finger, for a reader who may
 * add to two workspaces and make another: first as it opens, on a choice of
 * workspace, and then with New workspace chosen, which draws the name to
 * type. In each, nothing scrolls the page sideways, every control under the
 * bar is at least the touch height, and every box a reader types into is
 * drawn at `--text-unzoomed` or larger and leaves the page at its own scale
 * once focused. The bar is the shell's, not the page's, so the heights are
 * held under it alone.
 */

import {
  accessCallerTenantsSchema,
  accessSiteAbilitiesSchema,
} from "../../../../src/contract/accessPlane.ts";

import {
  expect,
  renderedDist,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  renderedTypedUnzoomed,
  test,
} from "./driver.ts";
import type { Browser } from "@playwright/test";

import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import { stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const creationReads = [
  stubApiRead("/access/v1/workspaces", accessCallerTenantsSchema, {
    tenants: [
      { tenant: stubApiTenant, roles: ["Admin"], administer: true },
      { tenant: "tenant-second", roles: ["Admin"], administer: true },
    ],
    truncated: false,
  }),
  stubApiRead("/access/v1/site/abilities", accessSiteAbilitiesSchema, {
    administer: false,
    createAccount: false,
    createTenant: true,
    manageAuthorities: false,
  }),
];

test("the new-project page fits a phone, each control a finger's height, and focusing a box zooms nothing, on a choice and on a new workspace", async ({
  browser,
}) => {
  const served = await servedOpen({
    root: renderedDist,
    reads: creationReads,
  });
  try {
    await creationOnPhone(browser, served);
  } finally {
    await served.close();
  }
});

async function creationOnPhone(
  browser: Browser,
  served: Served,
): Promise<void> {
  const rendered = await renderedOpen(browser, served.origin, {
    route: "/projects/new",
    viewport: "phone",
    signedIn: true,
    touch: true,
    ready: (page) => page.getByRole("button", { name: /^Workspace /u }),
  });
  const page = rendered.page;
  const main = page.locator("main");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText([
    "New project",
  ]);
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, main);
  await renderedTypedUnzoomed(page, main.locator("input"));

  await page.getByRole("button", { name: /^Workspace /u }).click();
  await page.getByRole("menuitemradio", { name: "New workspace" }).click();
  await expect(
    page.getByRole("textbox", { name: "Workspace name" }),
  ).toBeVisible();
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, main);
  await renderedTypedUnzoomed(page, main.locator("input"));
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
}
