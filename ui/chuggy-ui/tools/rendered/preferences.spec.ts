/**
 * The Preferences page and the open account menu at a phone's width: neither
 * scrolls the page sideways, and every control of each is at least the touch
 * height. The account menu holds who the stub's member is, the settings, the
 * preferences and signing out, in that order.
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
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const projectRoot = `/${stubApiTenant}/${stubApiProject}`;

test("on the phone the Preferences page does not scroll sideways, and every control on it is the touch height", async ({
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
  const preferences = page.locator(".preferences");
  await expect(page.getByRole("heading", { level: 2 })).toHaveText([
    "Appearance",
  ]);
  await expect(preferences.getByRole("radio")).toHaveCount(3);
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, preferences);
  await preferences.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await renderedNoOverflow(page);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});

test("on the phone the open account menu does not scroll sideways, and its trigger and every item are the touch height", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `${projectRoot}/`,
    viewport: "phone",
    signedIn: true,
    ready: (page) => page.getByRole("link", { name: "#1", exact: true }),
  });
  const page = rendered.page;
  const trigger = page.getByRole("button", { name: "Account menu" });
  await expect(trigger).toHaveText("RM");
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect(menu.locator(".account-name > span")).toHaveText([
    "rendered-member",
    "member@rendered.invalid",
  ]);
  await expect(menu.getByRole("menuitem")).toHaveText([
    "Settings",
    "Preferences",
    "Sign out",
  ]);
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, menu);
  const least = await renderedTokenPixels(page, "--height-touch");
  const box = await trigger.boundingBox();
  expect(box, "the trigger is drawn").not.toBeNull();
  expect(
    Math.min(box?.width ?? 0, box?.height ?? 0),
    "the trigger is the touch height",
  ).toBeGreaterThanOrEqual(least - 0.5);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});
