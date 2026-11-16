/**
 * The preferences page and the account menu at a phone's width. The page is
 * drawn alone under the link back to the settings' index with its Appearance
 * section, and a choice made on it is applied to the document; the menu
 * opened from the bar names the stub's member and holds Settings, Preferences
 * and Sign out. Neither scrolls the page sideways, and every control of each
 * is at least the touch height. The shell around the page is not this page's,
 * so the touch height is held under the page's own section column, and in
 * the menu and on its trigger.
 */

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTokenPixels,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import {
  stubApiEmail,
  stubApiLogin,
  stubApiProject,
  stubApiTenant,
} from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const projectRoot = `/${stubApiTenant}/${stubApiProject}`;

test("on the phone the preferences page does not scroll sideways, every control is the touch height, and a scheme chosen is applied", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `${projectRoot}/settings/preferences`,
    viewport: "phone",
    signedIn: true,
    ready: (page) => page.getByRole("radiogroup", { name: "Light or dark" }),
  });
  const page = rendered.page;
  await expect(
    page.getByRole("heading", { level: 2, name: "Appearance" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "All settings" })).toBeVisible();
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, page.locator(".settings-section"));
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await renderedNoOverflow(page);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});

test("on the phone the open account menu names the member and holds Settings, Preferences and Sign out, the touch height and within the page's width", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `${projectRoot}/`,
    viewport: "phone",
    signedIn: true,
    ready: (page) => page.getByRole("button", { name: "Account menu" }),
  });
  const page = rendered.page;
  const trigger = page.getByRole("button", { name: "Account menu" });
  await expect(trigger).toHaveText("MR");
  const triggerBox = await trigger.boundingBox();
  expect(triggerBox, "the trigger is drawn").not.toBeNull();
  expect(
    Math.min(triggerBox?.width ?? 0, triggerBox?.height ?? 0),
  ).toBeGreaterThanOrEqual(await renderedTokenPixels(page, "--height-touch"));
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Settings",
    "Preferences",
    "Sign out",
  ]);
  await expect(menu.getByText(stubApiLogin, { exact: true })).toBeVisible();
  await expect(menu.getByText(stubApiEmail, { exact: true })).toBeVisible();
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, menu);
  await menu.getByRole("menuitem", { name: "Preferences" }).click();
  await expect(page).toHaveURL(
    `${served.origin}${projectRoot}/settings/preferences`,
  );
  await expect(
    page.getByRole("radiogroup", { name: "Light or dark" }),
  ).toBeVisible();
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});
