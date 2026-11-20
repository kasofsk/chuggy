/**
 * The browser's chrome colour: every `theme-color` meta says the page colour
 * in effect, and says it again when the scheme, the light or dark choice, or a
 * theme's properties change it.
 *
 * The suite's document resolves neither `light-dark()` nor `var()`, so the
 * page colour each case stands for is a sheet the case writes: a change of
 * scheme is that sheet rewritten as the browser would recompute it, then the
 * media query's own change event, and a theme's property is matched by the
 * style attribute it lands in.
 */

import { afterEach, expect, test } from "vitest";

import { themeColorFollow } from "../app/browser/themeColor.ts";

const light = "rgb(237, 240, 234)";
const dark = "rgb(14, 18, 16)";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.removeProperty("--surface-0");
});

/** The two metas `index.html` carries, and a sheet painting the body. */
function themeColorPage(body: string): HTMLStyleElement {
  const metas = (["light", "dark"] as const).map((scheme) => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.media = `(prefers-color-scheme: ${scheme})`;
    meta.content = "#000000";
    document.head.append(meta);
    return meta;
  });
  const sheet = document.createElement("style");
  sheet.textContent = body;
  document.head.append(sheet);
  cleanups.push(() => {
    for (const meta of metas) meta.remove();
    sheet.remove();
  });
  return sheet;
}

/** A media query list whose answer the case changes. */
function themeColorScheme(): MediaQueryList & { flip(): void } {
  const target = new EventTarget();
  let matches = false;
  return Object.assign(target, {
    media: "(prefers-color-scheme: dark)",
    get matches() {
      return matches;
    },
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    flip() {
      matches = !matches;
      target.dispatchEvent(new Event("change"));
    },
  });
}

function themeColorsSaid(): readonly string[] {
  return Array.from(
    document.querySelectorAll('meta[name="theme-color"]'),
    (meta) => meta.getAttribute("content") ?? "",
  );
}

function themeColorFollowed(scheme: MediaQueryList): void {
  cleanups.push(themeColorFollow(document, scheme));
}

/** A mutation observer reports on a microtask, after the change it heard. */
async function themeColorHeard(): Promise<void> {
  await Promise.resolve();
}

test("every theme-color meta says the page colour in effect from the start", () => {
  themeColorPage(`body { background-color: ${light}; }`);
  themeColorFollowed(themeColorScheme());
  expect(themeColorsSaid()).toStrictEqual([light, light]);
});

test("the meta follows a change of the machine's scheme", () => {
  const sheet = themeColorPage(`body { background-color: ${light}; }`);
  const scheme = themeColorScheme();
  themeColorFollowed(scheme);
  sheet.textContent = `body { background-color: ${dark}; }`;
  scheme.flip();
  expect(themeColorsSaid()).toStrictEqual([dark, dark]);
});

test("the meta follows the light or dark choice put on the document", async () => {
  themeColorPage(
    `body { background-color: ${light}; } :root[data-theme="dark"] body { background-color: ${dark}; }`,
  );
  themeColorFollowed(themeColorScheme());
  document.documentElement.setAttribute("data-theme", "dark");
  await themeColorHeard();
  expect(themeColorsSaid()).toStrictEqual([dark, dark]);
  document.documentElement.removeAttribute("data-theme");
  await themeColorHeard();
  expect(themeColorsSaid()).toStrictEqual([light, light]);
});

test("the meta follows a theme's surface set on the document element", async () => {
  themeColorPage(
    `body { background-color: ${light}; } :root[style*="--surface-0"] body { background-color: ${dark}; }`,
  );
  themeColorFollowed(themeColorScheme());
  document.documentElement.style.setProperty("--surface-0", dark);
  await themeColorHeard();
  expect(themeColorsSaid()).toStrictEqual([dark, dark]);
});

test("a follower stopped no longer writes the meta", () => {
  const sheet = themeColorPage(`body { background-color: ${light}; }`);
  const scheme = themeColorScheme();
  const stop = themeColorFollow(document, scheme);
  stop();
  sheet.textContent = `body { background-color: ${dark}; }`;
  scheme.flip();
  expect(themeColorsSaid()).toStrictEqual([light, light]);
});
