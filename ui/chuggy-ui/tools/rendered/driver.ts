/**
 * What a rendered case calls, each in one line: open a route at a viewport,
 * and then hold the page to a property no suite on a document without layout
 * can see.
 *
 * `test` is Playwright's with one worker-scoped fixture, `served`: the build's
 * `dist` behind `served.ts` for as long as the worker lives. A case opens a
 * route with `renderedOpen`, which records every content-security-policy
 * violation the document reports from its first byte, and ends with
 * `renderedNoViolations`, which fails on any.
 */

import { test as base, expect } from "@playwright/test";
import type { Browser, Locator, Page } from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sessionRefreshTokenKey } from "../../app/core/sessionHolder.ts";
import {
  viewportDeskEm,
  viewportEmPixels,
  viewportHeightEmDefault,
} from "../../test/viewportSizes.ts";
import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";

export const renderedDist = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../dist",
);

/** The widths a screen is held at: a phone, a tablet, and the desk the
 * vitest suites read at, `viewportDeskEm` in `ui/chuggy-ui/test/viewportSizes.ts`. */
export const renderedViewports = {
  phone: { width: 360, height: 740 },
  tablet: { width: 768, height: 1024 },
  desk: {
    width: viewportDeskEm * viewportEmPixels,
    height: viewportHeightEmDefault * viewportEmPixels,
  },
} as const;

export type RenderedViewport = keyof typeof renderedViewports;

export interface RenderedViolation {
  readonly directive: string;
  readonly blocked: string;
  readonly source: string;
}

export interface Rendered {
  readonly page: Page;
  /** Every violation the document has reported so far. */
  readonly violations: readonly RenderedViolation[];
}

export interface RenderedOpening {
  readonly route: string;
  readonly viewport: RenderedViewport;
  /** Whether the console holds a member's session as it loads. */
  readonly signedIn: boolean;
  /** What is on the screen once it has drawn, waited for before returning. */
  readonly ready: (page: Page) => Locator;
}

export const test = base.extend<object, { served: Served }>({
  served: [
    // eslint-disable-next-line no-empty-pattern -- Playwright reads what a fixture depends on from this pattern, and this one depends on nothing
    async ({}, use) => {
      const served = await servedOpen({ root: renderedDist });
      await use(served);
      await served.close();
    },
    { scope: "worker" },
  ],
});

export { expect };

/** The listener is installed before any of the document's own script runs,
 * and it reports to this process, so a violation during load is seen. */
async function renderedViolationsHeard(
  page: Page,
  violations: RenderedViolation[],
): Promise<void> {
  await page.exposeFunction(
    "renderedViolationHeard",
    (violation: RenderedViolation) => {
      violations.push(violation);
    },
  );
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const heard = (
        window as unknown as {
          renderedViolationHeard: (violation: RenderedViolation) => void;
        }
      ).renderedViolationHeard;
      heard({
        directive: event.effectiveDirective,
        blocked: event.blockedURI,
        source: `${event.sourceFile}:${String(event.lineNumber)}`,
      });
    });
  });
}

export async function renderedOpen(
  browser: Browser,
  origin: string,
  opening: RenderedOpening,
): Promise<Rendered> {
  const context = await browser.newContext({
    viewport: renderedViewports[opening.viewport],
    storageState: {
      cookies: [],
      origins: opening.signedIn
        ? [
            {
              origin,
              localStorage: [
                { name: sessionRefreshTokenKey, value: "stub-refresh-token" },
              ],
            },
          ]
        : [],
    },
  });
  const page = await context.newPage();
  const violations: RenderedViolation[] = [];
  await renderedViolationsHeard(page, violations);
  await page.goto(`${origin}${opening.route}`);
  await expect(opening.ready(page)).toBeVisible();
  return { page, violations };
}

/** A violation a case knows of, by its directive and what was blocked. */
export interface RenderedViolationKnown {
  readonly directive: string;
  readonly blocked: string;
}

/** Fails on every violation the document reported but those `known` names. */
export function renderedNoViolations(
  rendered: Rendered,
  known: readonly RenderedViolationKnown[] = [],
): void {
  expect(
    rendered.violations.filter(
      (violation) =>
        !known.some(
          (kind) =>
            kind.directive === violation.directive &&
            kind.blocked === violation.blocked,
        ),
    ),
    "the served content security policy refused something the page did",
  ).toEqual([]);
}

/** Wider than the viewport is a page a reader scrolls sideways; the finding
 * names the elements whose right edge is past it. */
export async function renderedNoOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const past = [...document.querySelectorAll("body *")]
      .filter((element) => element.getBoundingClientRect().right > width + 0.5)
      .slice(0, 8)
      .map(
        (element) => `${element.tagName.toLowerCase()}.${element.className}`,
      );
    return { scrolled: document.documentElement.scrollWidth - width, past };
  });
  expect(overflow, "the page scrolls sideways").toEqual({
    scrolled: 0,
    past: [],
  });
}

/** The pixels a custom property on the root resolves to as a height. Set
 * through the object model, which the policy leaves to script. */
export async function renderedTokenPixels(
  page: Page,
  property: string,
): Promise<number> {
  return page.evaluate((name) => {
    const probe = document.createElement("div");
    probe.style.height = `var(${name})`;
    document.body.append(probe);
    const pixels = probe.getBoundingClientRect().height;
    probe.remove();
    return pixels;
  }, property);
}

const renderedInteractive = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "select",
  "textarea",
  "summary",
  "[role=button]",
  "[role=link]",
  "[role=tab]",
  "[role=menuitem]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** Every interactive element drawn on the page, or under `scope` where it is
 * given, is at least `--height-touch` on each side; one drawn with no box is
 * not a target. */
export async function renderedTouchTargets(
  page: Page,
  scope: Locator = page.locator("body"),
): Promise<void> {
  const least = await renderedTokenPixels(page, "--height-touch");
  expect(least, "the root states no --height-touch").toBeGreaterThan(0);
  const small = await scope.evaluate(
    (root, { selector, pixels }) =>
      [...root.querySelectorAll(selector)]
        .map((element) => ({ element, box: element.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && box.height > 0)
        .filter(({ box }) => Math.min(box.width, box.height) < pixels - 0.5)
        .map(
          ({ element, box }) =>
            `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}" ${String(Math.round(box.width))}x${String(Math.round(box.height))}`,
        ),
    { selector: renderedInteractive, pixels: least },
  );
  expect(small, `a target smaller than ${String(least)}px`).toEqual([]);
}

export async function renderedComputedStyle(
  locator: Locator,
  property: string,
): Promise<string> {
  return locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

/** Custom properties written onto the root through the object model, which
 * is how a case re-themes a screen. */
export async function renderedRootPropertiesSet(
  page: Page,
  properties: Readonly<Record<string, string>>,
): Promise<void> {
  await page.evaluate((set) => {
    for (const [name, value] of Object.entries(set))
      document.documentElement.style.setProperty(name, value);
  }, properties);
}

export interface RenderedColour {
  readonly element: string;
  readonly property: string;
  readonly value: string;
}

const renderedColourProperties = [
  "color",
  "background-color",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "outline-color",
  "fill",
  "stroke",
];

/** Every computed colour of every element under `body`, each element named
 * by its path of tags and position so two sweeps line up row for row. */
export async function renderedColoursSwept(
  page: Page,
): Promise<readonly RenderedColour[]> {
  return page.evaluate((properties) => {
    const named = (element: Element): string => {
      const parent = element.parentElement;
      const at = parent === null ? 0 : [...parent.children].indexOf(element);
      const here = `${element.tagName.toLowerCase()}[${String(at)}]`;
      return parent === null || element === document.body
        ? here
        : `${named(parent)}>${here}`;
    };
    return [document.body, ...document.querySelectorAll("body *")].flatMap(
      (element) => {
        const style = getComputedStyle(element);
        return properties.map((property) => ({
          element: named(element),
          property,
          value: style.getPropertyValue(property),
        }));
      },
    );
  }, renderedColourProperties);
}
