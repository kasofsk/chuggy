/**
 * What a rendered case calls, each in one line: open a route at a viewport,
 * and then hold the page to a property no suite on a document without layout
 * can see.
 *
 * `test` is Playwright's with one worker-scoped fixture, `served`: the build's
 * `dist` behind `served.ts` for as long as the worker lives. Every browser
 * context a case opens on the worker's browser is closed when the case ends,
 * whether it passed or failed. A case opens a
 * route with `renderedOpen`, which records every content-security-policy
 * violation the document reports from its first byte, and ends with
 * `renderedNoViolations`, which fails on any.
 *
 * Before a route is opened for its case, `renderedOpen` opens it again at the
 * phone and the desk, each in a context of its own, and in each the light
 * scheme and then the dark, and fails the case on any finding `audited.ts`
 * returns there. So a route a case opens is held to axe with nothing more
 * written for it. A route a worker has once passed is not audited again on
 * that worker.
 */

import { test as base, expect } from "@playwright/test";
import type {
  Browser,
  BrowserContextOptions,
  Locator,
  Page,
} from "@playwright/test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sessionRefreshTokenKey } from "../../app/core/sessionHolder.ts";
import {
  viewportDeskEm,
  viewportEmPixels,
  viewportHeightEmDefault,
} from "../../test/viewportSizes.ts";
import { auditedFindings, auditedSettled } from "./audited.ts";
import { servedOpen } from "./served.ts";
import type { Served } from "./served.ts";
import type { StubApiRead } from "./stubApi.ts";

export const renderedDist = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../dist",
);

/** The widths a screen is held at: a phone, a tablet, the desk the vitest
 * suites read at, `viewportDeskEm` in `ui/chuggy-ui/test/viewportSizes.ts`,
 * and a wide screen's, where a page beside the chat pane is wider than a
 * settings form beside the settings' navigation. */
export const renderedViewports = {
  phone: { width: 360, height: 740 },
  tablet: { width: 768, height: 1024 },
  desk: {
    width: viewportDeskEm * viewportEmPixels,
    height: viewportHeightEmDefault * viewportEmPixels,
  },
  wide: { width: 1920, height: 1080 },
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
  /** Whether the screen is a phone's own, pressed by a finger: a coarse
   * pointer, and touch. */
  readonly touch?: boolean;
  /** What is on the screen once it has drawn, waited for before returning. */
  readonly ready: (page: Page) => Locator;
  /** Whether the route is audited before it opens; only a page written to
   * carry a defect another helper names is not. */
  readonly audited?: boolean;
}

export const test = base.extend<
  { renderedContextsClosed: undefined },
  { served: Served }
>({
  renderedContextsClosed: [
    async ({ browser }, use) => {
      const before = new Set(browser.contexts());
      await use(undefined);
      await Promise.all(
        browser
          .contexts()
          .filter((context) => !before.has(context))
          .map((context) => context.close()),
      );
    },
    { auto: true },
  ],
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

async function renderedContextOpened(
  browser: Browser,
  origin: string,
  opening: RenderedOpening,
  options: BrowserContextOptions = {},
): Promise<Page> {
  const context = await browser.newContext({
    viewport: renderedViewports[opening.viewport],
    ...(opening.touch === true ? { hasTouch: true, isMobile: true } : {}),
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
    ...options,
  });
  return context.newPage();
}

const renderedAuditedViewports: readonly RenderedViewport[] = ["phone", "desk"];

const renderedAuditedSchemes = ["light", "dark"] as const;

/** The routes this worker has audited clean, by origin, route and session. */
const renderedAuditedClean = new Set<string>();

/** `opening`'s route at the phone and the desk, light and then dark, with
 * motion reduced, which takes every duration to zero, so what axe measures is
 * each colour as it stands. A case's `ready` can be its own width's alone, so
 * at the other width the page is waited for by its `main`, and in each scheme
 * it is waited for to fall still, since a screen may answer the scheme in
 * script as well as in its sheets. */
async function renderedAudited(
  browser: Browser,
  origin: string,
  opening: RenderedOpening,
): Promise<void> {
  const key = JSON.stringify([origin, opening.route, opening.signedIn]);
  if (renderedAuditedClean.has(key)) return;
  for (const viewport of renderedAuditedViewports) {
    const page = await renderedContextOpened(
      browser,
      origin,
      { ...opening, viewport, touch: viewport === "phone" },
      { colorScheme: "light", reducedMotion: "reduce" },
    );
    try {
      await page.goto(`${origin}${opening.route}`);
      await expect(
        viewport === opening.viewport
          ? opening.ready(page)
          : page.getByRole("main"),
      ).toBeVisible();
      for (const colorScheme of renderedAuditedSchemes) {
        await page.emulateMedia({ colorScheme });
        await auditedSettled(page);
        expect(
          await auditedFindings(page),
          `axe on ${opening.route} at the ${viewport} in ${colorScheme}`,
        ).toEqual([]);
      }
    } finally {
      await page.context().close();
    }
  }
  renderedAuditedClean.add(key);
}

export async function renderedOpen(
  browser: Browser,
  origin: string,
  opening: RenderedOpening,
): Promise<Rendered> {
  if (opening.audited !== false)
    await renderedAudited(browser, origin, opening);
  const page = await renderedContextOpened(browser, origin, opening);
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
 * names the elements whose right edge is past it, under `scope` where it is
 * given, which leaves out a strip that scrolls inside itself elsewhere on the
 * page but never the page's own scroll. */
export async function renderedNoOverflow(
  page: Page,
  scope: Locator = page.locator("body"),
): Promise<void> {
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  const scrolled = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  const past = await scope.evaluate(
    (root, edge) =>
      [...root.querySelectorAll("*")]
        .filter((element) => element.getBoundingClientRect().right > edge + 0.5)
        .slice(0, 8)
        .map(
          (element) => `${element.tagName.toLowerCase()}.${element.className}`,
        ),
    width,
  );
  expect({ scrolled, past }, "the page scrolls sideways").toEqual({
    scrolled: 0,
    past: [],
  });
}

/** The chat pane widened by dragging its edge, again where a drag lands
 * before the panels have laid out, until the page's column is narrower than
 * `em`, a breakpoint a container query reads in the column's own em. */
export async function renderedChatWidened(
  page: Page,
  em: number,
): Promise<void> {
  const edge = page.getByRole("separator", { name: /chat/iu });
  const narrow = (): Promise<boolean> =>
    page.evaluate((under) => {
      const column = document.querySelector("#shell-main > div");
      return (
        column !== null &&
        column.clientWidth <
          under * Number.parseFloat(getComputedStyle(column).fontSize)
      );
    }, em);
  const stride = (page.viewportSize()?.width ?? 0) / 10;
  await expect(async () => {
    const box = await edge.boundingBox();
    expect(box, "the pane's edge is drawn").not.toBeNull();
    if (box === null) return;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    for (let step = 1; step < 10 && !(await narrow()); step += 1)
      await page.mouse.move(box.x - step * stride, y, { steps: 4 });
    await page.mouse.up();
    expect(await narrow(), "the pane leaves the page narrow").toBe(true);
  }).toPass();
}

/** A screen a page's every tab is opened on: a phone, or the desk with the
 * chat pane open and, where `narrowed`, widened until the page's column is
 * narrower than the breakpoint a case names. */
export interface RenderedScreen {
  readonly name: string;
  readonly viewport: RenderedViewport;
  readonly narrowed: boolean;
}

export const renderedScreens: readonly RenderedScreen[] = [
  { name: "desk with the chat pane open", viewport: "desk", narrowed: false },
  { name: "desk with the chat pane widened", viewport: "desk", narrowed: true },
  { name: "phone", viewport: "phone", narrowed: false },
];

/** Each tab under `route`, by the level-two heading it opens with, opened
 * signed in on `screen` against the stub with `reads` ahead of its own, and
 * held to `each`: the chat pane is drawn at the desk and widened past
 * `narrowEm` where the screen says, no violation but those `known` is
 * reported, and every read is one the stub answers. */
export async function renderedTabsOpened<
  Tab extends { readonly at: string; readonly heading: string },
>(
  browser: Browser,
  opening: {
    readonly reads: readonly StubApiRead[];
    readonly route: string;
    readonly tabs: readonly Tab[];
    readonly screen: RenderedScreen;
    readonly narrowEm: number;
    readonly known: readonly RenderedViolationKnown[];
    readonly each: (page: Page, tab: Tab) => Promise<void>;
  },
): Promise<void> {
  const { screen } = opening;
  const served = await servedOpen({ root: renderedDist, reads: opening.reads });
  try {
    for (const tab of opening.tabs) {
      const rendered = await renderedOpen(browser, served.origin, {
        route: `${opening.route}${tab.at}`,
        viewport: screen.viewport,
        touch: screen.viewport === "phone",
        signedIn: true,
        ready: (page) =>
          page.getByRole("heading", { level: 2, name: tab.heading }),
      });
      const page = rendered.page;
      if (screen.viewport === "desk")
        await expect(
          page.getByRole("complementary", { name: "Chat", exact: true }),
        ).toBeVisible();
      if (screen.narrowed) await renderedChatWidened(page, opening.narrowEm);
      await opening.each(page, tab);
      renderedNoViolations(rendered, opening.known);
      await page.context().close();
    }
    expect(served.unanswered).toEqual([]);
  } finally {
    await served.close();
  }
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

/** Each box in `boxes` is drawn at no less than `--text-unzoomed`, the size
 * a phone types in without zooming, and focusing it leaves the page at its
 * own scale and no wider than the screen. */
export async function renderedTypedUnzoomed(
  page: Page,
  boxes: Locator,
): Promise<void> {
  const least = await renderedTokenPixels(page, "--text-unzoomed");
  expect(least, "the root states no --text-unzoomed").toBeGreaterThan(0);
  const all = await boxes.all();
  expect(all.length).toBeGreaterThan(0);
  for (const box of all) {
    const pixels = await box.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(pixels, await box.evaluate((element) => element.outerHTML)).toBe(
      Math.max(pixels, least),
    );
    await box.focus();
    expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(
      1,
    );
    await renderedNoOverflow(page);
  }
}

export interface RenderedInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** The screen's unsafe edges, in pixels, as a phone with a notch and a home
 * indicator reports them to `env(safe-area-inset-*)`. Chromium alone can be
 * told them, through its own protocol. */
export async function renderedSafeAreaInsets(
  page: Page,
  insets: RenderedInsets,
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setSafeAreaInsetsOverride", { insets });
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
 * not a target. A control drawn smaller than a finger and pressed through an
 * absolutely placed `::after` of its own, as a radio and a checkbox are under
 * a coarse pointer, is measured by the larger of the two. */
export async function renderedTouchTargets(
  page: Page,
  scope: Locator = page.locator("body"),
): Promise<void> {
  const least = await renderedTokenPixels(page, "--height-touch");
  expect(least, "the root states no --height-touch").toBeGreaterThan(0);
  const small = await scope.evaluate(
    (root, { selector, pixels }) =>
      [...root.querySelectorAll(selector)]
        .map((element) => {
          const drawn = element.getBoundingClientRect();
          const area = getComputedStyle(element, "::after");
          const pressed =
            area.content !== "none" && area.position === "absolute";
          const side = (length: string): number =>
            pressed ? Number.parseFloat(length) || 0 : 0;
          return {
            element,
            box: {
              width: Math.max(drawn.width, side(area.width)),
              height: Math.max(drawn.height, side(area.height)),
            },
          };
        })
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
