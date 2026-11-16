/**
 * The tabs: a named navigation landmark of links, the current one marked, a
 * count read after its tab's label, and a row wider than its container marked
 * on the side its more is on and scrolling inside itself.
 *
 * The router is stubbed, as the breadcrumb's suite stubs it, so the links are
 * drawn with no provider around them.
 */

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import scrollSidesSheet from "../app/browser/ui/ScrollSides.css?raw";
import tabSheet from "../app/browser/ui/TabNav.css?raw";
import { TabNav, TabNavLink } from "../app/browser/ui/TabNav.tsx";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

vi.mock(
  "@tanstack/react-router",
  async () => await import("./routerLinkStubbed.tsx"),
);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tabNavParams = { tenant: "acme", project: "web", ticket: "7" };

function tabNavDrawn(): ReturnType<typeof render> {
  return render(
    <TabNav label="Ticket">
      <TabNavLink to="/$tenant/$project/tickets/$ticket" params={tabNavParams}>
        Overview
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/tickets/$ticket/runs"
        params={tabNavParams}
        count="3+"
        aria-current="page"
      >
        Runs
      </TabNavLink>
      <TabNavLink
        to="/$tenant/$project/tickets/$ticket/usage"
        params={tabNavParams}
        count={0}
      >
        Usage
      </TabNavLink>
    </TabNav>,
  );
}

test("the tabs are links in a navigation landmark named by its label, the current one marked", () => {
  const view = tabNavDrawn();
  const nav = screen.getByRole("navigation", { name: "Ticket" });
  const links = within(nav).getAllByRole("link");
  expect(
    links.map((link) => [
      link.getAttribute("href"),
      link.getAttribute("aria-current"),
    ]),
  ).toStrictEqual([
    ["/$tenant/$project/tickets/$ticket", null],
    ["/$tenant/$project/tickets/$ticket/runs", "page"],
    ["/$tenant/$project/tickets/$ticket/usage", null],
  ]);
  expect(within(nav).getAllByRole("listitem")).toHaveLength(3);
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("a tab's name is its label, then its count where it carries one", () => {
  tabNavDrawn();
  expect(
    screen
      .getAllByRole("link")
      .map((link) => [
        link.textContent,
        link.querySelector(".tab-nav-count")?.textContent,
      ]),
  ).toStrictEqual([
    ["Overview", undefined],
    ["Runs 3+", "3+"],
    ["Usage 0", "0"],
  ]);
  expect(screen.getByRole("link", { name: "Runs 3+" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
});

test("a row that fits its container is marked on neither side", () => {
  tabNavDrawn();
  const nav = screen.getByRole("navigation", { name: "Ticket" });
  expect(nav.hasAttribute("data-more-start")).toBe(false);
  expect(nav.hasAttribute("data-more-end")).toBe(false);
});

test("a row wider than its container is marked on the side its more is on", () => {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  tabNavDrawn();
  const nav = screen.getByRole("navigation", { name: "Ticket" });
  expect(nav.hasAttribute("data-more-start")).toBe(false);
  expect(nav.hasAttribute("data-more-end")).toBe(true);
});

test("the row scrolls inside itself, and once it holds more keeps its scrolling to itself and fades", () => {
  tabNavDrawn();
  const nav = screen.getByRole("navigation", { name: "Ticket" });
  const rules = sheetRules(tabSheet + scrollSidesSheet, []);
  expect(sheetDeclared(rules, nav, "overflow-x")).toBe("auto");
  expect(sheetDeclared(rules, nav, "min-width")).toBe("0px");
  expect(sheetDeclared(rules, nav, "mask-image")).toBe("");
  nav.setAttribute("data-more-end", "");
  expect(sheetDeclared(rules, nav, "overscroll-behavior-x")).toBe("contain");
  expect(sheetDeclared(rules, nav, "mask-image")).toContain("to left");
});

/** Whether jsdom counts a focus as a keyboard's depends on what an earlier case
 * pressed, so the focus is named by an attribute the sheet is read with. */
test("a row holding a tab focused by keyboard drops the fade that would cut its ring away", () => {
  tabNavDrawn();
  const nav = screen.getByRole("navigation", { name: "Ticket" });
  nav.setAttribute("data-more-end", "");
  const focused = "data-keyboard-focused";
  const rules = sheetRules(
    scrollSidesSheet.replaceAll(":focus-visible", `[${focused}]`),
    [],
  );
  expect(sheetDeclared(rules, nav, "mask-image")).toContain("to left");
  screen.getByRole("link", { name: "Overview" }).setAttribute(focused, "");
  expect(sheetDeclared(rules, nav, "mask-image")).toBe("none");
});

test("each tab is at least the touch height under a coarse pointer", () => {
  tabNavDrawn();
  const tab = screen.getByRole("link", { name: "Overview" });
  expect(sheetDeclared(sheetRules(tabSheet, []), tab, "min-height")).toBe("");
  expect(
    sheetDeclared(
      sheetRules(tabSheet, ["(pointer: coarse)"]),
      tab,
      "min-height",
    ),
  ).toBe("var(--height-touch)");
});
