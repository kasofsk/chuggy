/**
 * The shell's landmarks and the ways between them: the bar a banner holding a
 * named trail, the screens a named nav, the page the one `main`, and the chat
 * pane a named aside, each landmark drawn more than once named apart; a link
 * past the bar, first in the document, to the page; the document titled for
 * the page; and the reader's focus moved to the page on a move to another
 * page, but not on the first, not on a move of the query alone, and not out
 * of the chat pane.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { fireEvent, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { viewportNarrowEm } from "../app/browser/shell/viewport.ts";
import { chatDrawn, mounted, shellFrameEachCase } from "./shellFrame.tsx";
import { viewportDeskEm } from "./viewport.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

/** The address the router is at, which a case moves between pages. */
let pathname = "/acme/atlas";

vi.mock("../app/browser/ports.ts", async (importOriginal) =>
  (await import("./shellRouter.tsx")).portsDouble(
    await importOriginal<typeof BrowserPorts>(),
  ),
);

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const { atlas, routerDouble } = await import("./shellRouter.tsx");
  return routerDouble(await importOriginal<typeof RouterModule>(), {
    outlet: () => <h1>Page</h1>,
    params: () => atlas,
    pathname: () => pathname,
  });
});
// jscpd:ignore-end -- the case's own doubles resume here

shellFrameEachCase(() => {
  pathname = "/acme/atlas";
  document.title = "";
});

/** Each landmark role's names, so a role drawn twice shows whether its names
 * tell the two apart. */
function landmarkNames(role: string): readonly string[] {
  return screen
    .queryAllByRole(role)
    .map((landmark) => landmark.getAttribute("aria-label") ?? "");
}

/** The banners a browser maps: a `header` scoped to sectioning content or
 * `main` is no landmark, which the suite's role reading does not apply. */
function banners(): readonly HTMLElement[] {
  return screen
    .queryAllByRole("banner")
    .filter(
      (header) =>
        header.parentElement?.closest("article, aside, main, nav, section") ===
        null,
    );
}

/** The elements a reader's Tab reaches, in document order. */
function tabbable(): readonly Element[] {
  return Array.from(
    document.querySelectorAll(
      "a[href], button:not([disabled]), input, select, textarea, [tabindex]",
    ),
  ).filter((element) => element.getAttribute("tabindex") !== "-1");
}

test("the bar is a banner holding the named trail, and the screens a named nav", async () => {
  await mounted(viewportDeskEm);
  expect(banners()).toHaveLength(1);
  const banner = banners()[0] ?? document.body;
  expect(
    within(banner).getByRole("navigation", { name: "Breadcrumb" }),
  ).toBeDefined();
  expect(landmarkNames("navigation")).toStrictEqual(["Breadcrumb", "Console"]);
});

test("the page is the one main, and the chat pane an aside named apart from the details", async () => {
  await mounted(viewportDeskEm);
  expect(screen.getAllByRole("main")).toHaveLength(1);
  expect(within(screen.getByRole("main")).getByText("Page")).toBeDefined();
  expect(chatDrawn()).not.toBeNull();
  const asides = landmarkNames("complementary");
  expect(asides).toContain("Chat");
  expect(new Set(asides).size).toBe(asides.length);
});

test("on a phone the screens' nav along the foot is named apart from the trail", async () => {
  await mounted(viewportNarrowEm);
  const navs = landmarkNames("navigation");
  expect(navs).toStrictEqual(["Breadcrumb", "Console"]);
  expect(screen.getAllByRole("main")).toHaveLength(1);
});

test("the first thing Tab reaches is a link that moves focus to the main", async () => {
  await mounted(viewportDeskEm);
  const skip = screen.getByRole("link", { name: "Skip to content" });
  expect(tabbable()[0]).toBe(skip);
  const main = screen.getByRole("main");
  expect(skip.getAttribute("href")).toBe(`#${main.id}`);
  expect(skip.className).toContain("shell-skip");
  fireEvent.click(skip);
  expect(document.activeElement).toBe(main);
});

test("the document and the main are named for the page, the page first", async () => {
  const frame = await mounted(viewportDeskEm);
  expect(document.title).toBe("tickets · atlas");
  expect(screen.getByRole("main", { name: "tickets · atlas" })).toBeDefined();
  pathname = "/acme/atlas/tickets/7";
  await frame.redrawn();
  expect(document.title).toBe("7 · tickets · atlas");
});

test("a move to another page takes focus to the main, and the first page does not", async () => {
  const frame = await mounted(viewportDeskEm);
  expect(document.activeElement).toBe(document.body);
  pathname = "/acme/atlas/inbox";
  await frame.redrawn();
  expect(document.activeElement).toBe(
    screen.getByRole("main", { name: "inbox · atlas" }),
  );
});

test("a page drawn again at the same address, as a query moved alone draws it, leaves focus where it is", async () => {
  const frame = await mounted(viewportDeskEm);
  const skip = screen.getByRole("link", { name: "Skip to content" });
  skip.focus();
  await frame.redrawn();
  expect(document.activeElement).toBe(skip);
});

test("a move to another page leaves focus held in the chat pane where it is", async () => {
  const frame = await mounted(viewportDeskEm);
  const held = within(chatDrawn() ?? document.body).getAllByRole("button")[0];
  held?.focus();
  expect(document.activeElement).toBe(held);
  pathname = "/acme/atlas/inbox";
  await frame.redrawn();
  expect(document.activeElement).toBe(held);
});
