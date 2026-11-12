/**
 * The settings at a phone's width and at the desk's with the chat pane open.
 * On the phone the settings' own address is the index, listing every section
 * the navigation model gives the stub's member, and a section is drawn alone:
 * its heading is within the first screen, under the link back to the index.
 * At the desk the settings' own address is its first section, with the
 * navigation beside it and the chat pane beside both, and nothing scrolls the
 * page sideways.
 */

import { copyTextEn } from "../../app/copy/catalog.ts";
import { settingsNav } from "../../app/core/settingsNav.ts";
import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTouchTargets,
  renderedViewports,
  test,
} from "./driver.ts";
import { stubApiProject, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const settingsRoot = `/${stubApiTenant}/${stubApiProject}/settings`;

/** Every section's name, in order, as the stub's member is drawn them: none
 * of the site's, whose abilities the stub answers with none. */
const settingsSectionNames = settingsNav({
  tenant: stubApiTenant,
  project: stubApiProject,
  site: { workspaces: false, permissions: false },
}).flatMap((group) => group.entries.map((entry) => copyTextEn(entry.label)));

test("on the phone the settings' own address is the index of every section, each a row the touch height", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: settingsRoot,
    viewport: "phone",
    signedIn: true,
    ready: (page) => page.getByRole("navigation", { name: "Settings" }),
  });
  const page = rendered.page;
  const nav = page.getByRole("navigation", { name: "Settings" });
  await expect(nav.getByRole("link")).toHaveText(settingsSectionNames);
  for (const link of await nav.getByRole("link").all())
    await expect(link).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(settingsRoot);
  await renderedNoOverflow(page);
  await renderedTouchTargets(page, nav);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});

test("on the phone a section is drawn alone, its heading within the first screen under the link back to the index", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: `${settingsRoot}/runners`,
    viewport: "phone",
    signedIn: true,
    ready: (page) => page.getByRole("rowheader", { name: /^build-linux/u }),
  });
  const page = rendered.page;
  await expect(page.getByRole("navigation", { name: "Settings" })).toBeHidden();
  const back = page.getByRole("link", { name: "All settings" });
  await expect(back).toBeVisible();
  await renderedTouchTargets(page, back.locator(".."));
  const heading = page.getByRole("heading", { level: 1, name: "Runners" });
  const box = await heading.boundingBox();
  expect(box, "the section's heading is drawn").not.toBeNull();
  expect(box?.y ?? Infinity).toBeLessThan(renderedViewports.phone.height);
  await back.click();
  await expect(
    page.getByRole("navigation", { name: "Settings" }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(settingsRoot);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});

test("at the desk with the chat pane open the settings' own address is its first section beside the navigation, and nothing scrolls sideways", async ({
  browser,
  served,
}) => {
  const rendered = await renderedOpen(browser, served.origin, {
    route: settingsRoot,
    viewport: "desk",
    signedIn: true,
    ready: (page) => page.getByRole("region", { name: "Chat", exact: true }),
  });
  const page = rendered.page;
  await expect(page).toHaveURL(`${served.origin}${settingsRoot}/lead`);
  const nav = page.getByRole("navigation", { name: "Settings" });
  await expect(nav).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Lead", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "All settings" })).toBeHidden();
  await renderedNoOverflow(page);
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});
