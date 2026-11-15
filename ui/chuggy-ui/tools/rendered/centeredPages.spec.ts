/**
 * The pages a person meets before the console, each drawn on `CenteredPage`
 * at a phone's width and the desk's: the sign-in, an invite link opened
 * signed out, and each forge landing at a return this tab cannot place. Each
 * is the document's one `main` and names the document by its title; on the
 * phone its column stands a gutter clear of both edges and every control is
 * at least the touch height, and on neither does the page scroll sideways.
 */

import type { Locator, Page } from "@playwright/test";

import {
  expect,
  renderedNoOverflow,
  renderedNoViolations,
  renderedOpen,
  renderedTokenPixels,
  renderedTouchTargets,
  test,
} from "./driver.ts";
import type { RenderedViewport } from "./driver.ts";

const zodProbeViolation = { directive: "script-src", blocked: "eval" };

const centeredPagesViewports: readonly RenderedViewport[] = ["phone", "desk"];

interface CenteredPageCase {
  readonly name: string;
  readonly route: string;
  readonly signedIn: boolean;
  readonly title: string;
  /** The page's one action, found under `within`. */
  readonly primary: (within: Page | Locator) => Locator;
}

const centeredPageCases: readonly CenteredPageCase[] = [
  {
    name: "the sign-in",
    route: "/",
    signedIn: false,
    title: "Sign in to chuggy",
    primary: (within) => within.getByRole("button", { name: "Sign in" }),
  },
  {
    name: "an invite link opened signed out",
    route: "/invite#t0ken",
    signedIn: false,
    title: "You are invited to chuggy",
    primary: (within) => within.getByRole("button", { name: "Sign in" }),
  },
  {
    name: "the forge's setup landing",
    route: "/forge/github/setup?action=install&state=not-this-tabs",
    signedIn: true,
    title: "GitHub sent you back unexpectedly",
    primary: (within) => within.getByRole("link", { name: "Home" }),
  },
  {
    name: "the forge's callback",
    route: "/forge/github/callback?code=a-code&state=not-this-tabs",
    signedIn: true,
    title: "GitHub sent you back unexpectedly",
    primary: (within) => within.getByRole("link", { name: "Home" }),
  },
];

/** The column's distance from each side of the viewport, in pixels. */
async function centeredPageGutters(
  page: Page,
): Promise<{ readonly left: number; readonly right: number }> {
  return page.locator(".centered-page-column").evaluate((column) => {
    const box = column.getBoundingClientRect();
    return {
      left: box.left,
      right: document.documentElement.clientWidth - box.right,
    };
  });
}

for (const drawn of centeredPageCases)
  for (const viewport of centeredPagesViewports)
    test(`${drawn.name} is one centred page on the ${viewport}, clear of its edges, and nothing else is refused`, async ({
      browser,
      served,
    }) => {
      const rendered = await renderedOpen(browser, served.origin, {
        route: drawn.route,
        viewport,
        signedIn: drawn.signedIn,
        touch: viewport === "phone",
        ready: drawn.primary,
      });
      const page = rendered.page;
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        drawn.title,
      );
      await expect(page).toHaveTitle(drawn.title);
      const main = page.getByRole("main");
      const actions = main.locator(".centered-page-actions");
      await expect(actions.locator("> *")).toHaveCount(1);
      await expect(drawn.primary(actions)).toBeVisible();
      await renderedNoOverflow(page);
      if (viewport === "phone") {
        const gutter = await renderedTokenPixels(page, "--space-4");
        expect(gutter, "the root states no --space-4").toBeGreaterThan(0);
        const gutters = await centeredPageGutters(page);
        expect(gutters.left).toBeGreaterThanOrEqual(gutter - 0.5);
        expect(gutters.right).toBeGreaterThanOrEqual(gutter - 0.5);
        await renderedTouchTargets(page, main);
      }
      renderedNoViolations(rendered, [zodProbeViolation]);
      expect(served.unanswered).toEqual([]);
    });
