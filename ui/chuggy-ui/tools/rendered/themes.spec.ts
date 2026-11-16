/**
 * A project's resolved theme drawn under the served policy: the page's colours
 * are the theme's in the light scheme and the dark, the browser's chrome
 * follows them, and a reload puts them on the root from what this browser kept
 * before the console mounts, while the server has not yet answered. With no
 * theme the root carries no property, so the page is the sheet's own. zod's
 * probe is the one violation known, as `console.spec.ts` says.
 */

import type { Page } from "@playwright/test";

import { builtInThemes } from "../../../../src/contract/appearance.ts";
import type { ThemeColours } from "../../../../src/contract/appearance.ts";
import { projectAppearanceResponseSchema } from "../../../../src/contract/responses.ts";
import { themeAssignmentsOf, themeTokens } from "../../app/core/themeTokens.ts";
import {
  expect,
  renderedDist,
  renderedNoViolations,
  renderedOpen,
  test,
} from "./driver.ts";
import type { Rendered } from "./driver.ts";
import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import { stubApiProject, stubApiRead, stubApiTenant } from "./stubApi.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const projectRoute = `/${stubApiTenant}/${stubApiProject}/`;
const appearancePath = `/api/v1/tenants/${stubApiTenant}/projects/${stubApiProject}/appearance`;

const harbour = builtInThemes.harbour;
const chuggy = builtInThemes.chuggy;

function schemeColours(
  theme: typeof harbour,
  scheme: "light" | "dark",
): ThemeColours {
  if (theme.palette.schemes !== "Both")
    throw new Error(`${theme.name} carries both schemes`);
  return scheme === "light" ? theme.palette.light : theme.palette.dark;
}

/** A hex colour as a computed style says it. */
function themesRgb(hex: string): string {
  const [red, green, blue] = [1, 3, 5].map((start) =>
    Number.parseInt(hex.slice(start, start + 2), 16),
  ) as [number, number, number];
  return `rgb(${String(red)}, ${String(green)}, ${String(blue)})`;
}

/** The page drawn in `colours`: its ground, its ink, and the chrome over it. */
async function themesDrawnIn(page: Page, colours: ThemeColours): Promise<void> {
  const body = page.locator("body");
  await expect(body).toHaveCSS(
    "background-color",
    themesRgb(colours["surface-0"]),
  );
  await expect(body).toHaveCSS("color", themesRgb(colours["ink-2"]));
  await expect(
    page.locator('meta[name="theme-color"]').first(),
  ).toHaveAttribute("content", themesRgb(colours["surface-0"]));
}

/** What the root first wore on a load, and whether the console had mounted. */
interface ThemesFirstWorn {
  readonly mounted: boolean;
  readonly assignments: Record<string, string>;
}

/** Keeps, on each later load, the theme tokens the root carries the first time
 * its style is set, and whether the console had drawn into its mount then. */
async function themesFirstWornHeard(page: Page): Promise<void> {
  await page.addInitScript((tokens: readonly string[]) => {
    const heard = window as unknown as { themesFirstWorn?: ThemesFirstWorn };
    new MutationObserver((records, observer) => {
      const root = document.documentElement;
      if (!records.some((record) => record.target === root)) return;
      observer.disconnect();
      heard.themesFirstWorn = {
        mounted: (document.getElementById("root")?.childElementCount ?? 0) > 0,
        assignments: Object.fromEntries(
          tokens
            .map((token): [string, string] => [
              token,
              root.style.getPropertyValue(token),
            ])
            .filter(([, value]) => value !== ""),
        ),
      };
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
  }, themeTokens);
}

async function themesOpen(
  browser: Parameters<typeof renderedOpen>[0],
  served: Served,
): Promise<Rendered> {
  return renderedOpen(browser, served.origin, {
    route: projectRoute,
    viewport: "desk",
    signedIn: true,
    ready: (page) => page.getByText("#1", { exact: true }),
  });
}

test("a project's resolved theme repaints the page in the light scheme and the dark, the chrome follows, and a reload puts it on the root from the cache before the console mounts", async ({
  browser,
}) => {
  const served = await servedOpen({
    root: renderedDist,
    reads: [
      stubApiRead(appearancePath, projectAppearanceResponseSchema, {
        theme: harbour,
        layer: "ProjectDefault",
        layers: { projectDefault: harbour },
      }),
    ],
  });
  try {
    const rendered = await themesOpen(browser, served);
    const page = rendered.page;
    await page.emulateMedia({ colorScheme: "light" });
    await themesDrawnIn(page, schemeColours(harbour, "light"));
    await page.emulateMedia({ colorScheme: "dark" });
    await themesDrawnIn(page, schemeColours(harbour, "dark"));
    await page.emulateMedia({ colorScheme: "light" });

    await page.route(`**${appearancePath}`, () => undefined);
    await themesFirstWornHeard(page);
    const asked = page.waitForRequest(`**${appearancePath}`);
    await page.reload();
    await asked;
    await expect(page.getByText("#1", { exact: true })).toBeVisible();
    await themesDrawnIn(page, schemeColours(harbour, "light"));
    const firstWorn = await page.evaluate(
      () =>
        (window as unknown as { themesFirstWorn?: ThemesFirstWorn })
          .themesFirstWorn,
    );
    expect(firstWorn).toEqual({
      mounted: false,
      assignments: Object.fromEntries(
        themeAssignmentsOf(harbour).map(({ property, value }) => [
          property,
          value,
        ]),
      ),
    });
    renderedNoViolations(rendered, [zodProbeViolation]);
    expect(served.unanswered).toEqual([]);
  } finally {
    await served.close();
  }
});

test("with no theme the root carries no theme property and the page is the sheet's own in both schemes", async ({
  browser,
  served,
}) => {
  const rendered = await themesOpen(browser, served);
  const page = rendered.page;
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await themesDrawnIn(page, schemeColours(chuggy, scheme));
  }
  expect(await page.locator("html").getAttribute("style")).toBeNull();
  renderedNoViolations(rendered, [zodProbeViolation]);
  expect(served.unanswered).toEqual([]);
});
