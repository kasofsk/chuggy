/**
 * The preferences page and the account menu at a phone's width. The page is
 * drawn alone under the link back to the settings' index with its Appearance
 * section, and a choice made on it is applied to the document; a theme
 * chosen there, at the phone's width and the desk's, repaints the page with
 * no sideways scroll, every control the touch height on the phone; the menu
 * opened from the bar names the stub's member and holds Settings, Preferences
 * and Sign out. Neither scrolls the page sideways, and every control of each
 * is at least the touch height. The shell around the page is not this page's,
 * so the touch height is held under the page's own section column, and in
 * the menu and on its trigger.
 */

import type { Page } from "@playwright/test";

import { builtInThemes } from "../../../../src/contract/appearance.ts";
import type {
  ThemeChoice,
  ThemeDocument,
} from "../../../../src/contract/appearance.ts";
import type { ProjectAppearanceResponse } from "../../../../src/contract/responses.ts";
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
const choicePath = "/api/v1/appearance/choice";
const appearancePath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/appearance`;

/** The reader's global choice kept as the server keeps it, and the project,
 * which names no theme of its own, resolved from it. */
async function preferencesChoiceKept(page: Page): Promise<void> {
  let chosen: ThemeChoice | undefined;
  const themeOf = (choice: ThemeChoice): ThemeDocument => {
    if (choice.kind !== "BuiltIn")
      throw new Error("the stub holds no theme of the member's own");
    return builtInThemes[choice.theme];
  };
  await page.route(`**${choicePath}`, async (route) => {
    if (route.request().method() === "PUT") {
      chosen = route.request().postDataJSON() as ThemeChoice;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      json: chosen === undefined ? {} : { choice: chosen },
    });
  });
  await page.route(`**${appearancePath}`, async (route) => {
    const resolved: ProjectAppearanceResponse =
      chosen === undefined
        ? { theme: builtInThemes.chuggy, layer: "BuiltInDefault", layers: {} }
        : {
            theme: themeOf(chosen),
            layer: "Global",
            layers: { global: chosen },
          };
    await route.fulfill({ json: resolved });
  });
}

/** A hex colour as a computed style says it. */
function preferencesRgb(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as [number, number, number];
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
}

for (const viewport of ["phone", "desk"] as const)
  test(`at the ${viewport}'s width a theme chosen in Appearance repaints the page at once and is said to apply in the project, with no sideways scroll${viewport === "phone" ? " and every control the touch height" : ""}`, async ({
    browser,
    served,
  }) => {
    const rendered = await renderedOpen(browser, served.origin, {
      route: `${projectRoot}/settings/preferences`,
      viewport,
      signedIn: true,
      ready: (page) => page.getByRole("radiogroup", { name: "Theme" }),
    });
    const page = rendered.page;
    await page.emulateMedia({ colorScheme: "light" });
    await preferencesChoiceKept(page);
    const harbour = builtInThemes.harbour;
    if (harbour.palette.schemes !== "Both")
      throw new Error("Harbour carries both schemes");
    const theme = page.getByRole("radiogroup", { name: "Theme" });
    await expect(theme.getByRole("radio", { checked: true })).toHaveText(
      "Chuggy",
    );
    const applies = page.locator(".preferences-theme-applies > span");
    await expect(applies).toHaveText(["Chuggy", "The console's default"]);
    await renderedNoOverflow(page);
    if (viewport === "phone")
      await renderedTouchTargets(page, page.locator(".settings-section"));
    await theme.getByRole("radio", { name: "Harbour" }).click();
    await expect(page.locator("body")).toHaveCSS(
      "background-color",
      preferencesRgb(harbour.palette.light["surface-0"]),
    );
    await expect(theme.getByRole("radio", { checked: true })).toHaveText(
      "Harbour",
    );
    await expect(applies).toHaveText(["Harbour", "Your own theme"]);
    await renderedNoOverflow(page);
    if (viewport === "phone")
      await renderedTouchTargets(page, page.locator(".settings-section"));
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  });

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
