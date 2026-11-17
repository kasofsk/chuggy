/**
 * Two settings forms open on a phone, pressed by a finger: an agent's
 * thresholds on the Usage page and the lead's limits. In each, with the
 * section's Edit pressed, nothing scrolls the page sideways, every control in
 * the section is at least the touch height, and every box a reader types into
 * is drawn at `--text-unzoomed` or larger and leaves the page at its own scale
 * once focused.
 */

import type { Page } from "@playwright/test";

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  renderedTypedUnzoomed,
  test,
} from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const settingsRoot = `/${stubApiTenant}/${stubApiProject}/settings`;

/** The section whose title starts `title`, before any badge beside it, its
 * Edit pressed and its form drawn. */
async function settingsFormOpened(page: Page, title: string): Promise<void> {
  const section = page.getByRole("region", {
    name: new RegExp(`^${title}\\b`, "u"),
  });
  await section.getByRole("button", { name: "Edit" }).click();
  await expect(
    section.getByRole("button", { name: "Save changes" }),
  ).toBeVisible();
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, section);
  await renderedTypedUnzoomed(page, section.locator("input, textarea"));
}

test("on a phone an agent's thresholds open as a form that fits, each control a finger's height, and focusing a box zooms nothing", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `${settingsRoot}/workspace/usage`,
    viewport: "phone",
    signedIn: true,
    touch: true,
    ready: (page) => page.getByRole("heading", { level: 2, name: "Claude" }),
  });
  await settingsFormOpened(rendered.page, "Claude");
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});

test("on a phone the lead's limits open as a form that fits, each control a finger's height, and focusing a box zooms nothing", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `${settingsRoot}/lead`,
    viewport: "phone",
    signedIn: true,
    touch: true,
    ready: (page) =>
      page.getByRole("heading", { level: 2, name: /^Limits\b/u }),
  });
  await settingsFormOpened(rendered.page, "Limits");
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});
