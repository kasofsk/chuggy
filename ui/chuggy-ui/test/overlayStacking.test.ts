/**
 * The overlay band: a menu and a tooltip, which Radix portals to the body,
 * carry `--z-overlay`; a toast, which already drew above a menu, keeps that
 * order by building on top of the same token. Every page layer's own
 * z-index — a sticky bar, a slid-in pane, a trigger list — stays under the
 * band regardless of what carries it there.
 */

import { expect, test } from "vitest";

import conversationSheet from "../app/browser/conversation/conversation.css?raw";
import locomotiveSheet from "../app/browser/ui/Locomotive.css?raw";
import menuSheet from "../app/browser/ui/Menu.css?raw";
import projectTableSheet from "../app/browser/ProjectTable.css?raw";
import shellSheet from "../app/browser/shell/shell.css?raw";
import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import toastSheet from "../app/browser/ui/Toast.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import tooltipSheet from "../app/browser/ui/Tooltip.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";

/** Every `z-index` a sheet declares, in any rule at any nesting — a page
 * layer's own stacking is never conditioned on a selector matching an
 * element, so this reads literally rather than through the cascade. */
function sheetZIndexValues(text: string): readonly string[] {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(text);
  const values: string[] = [];
  const walk = (list: CSSRuleList): void => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSStyleRule) {
        const value = rule.style.getPropertyValue("z-index");
        if (value !== "") values.push(value);
      } else if (rule instanceof CSSGroupingRule) walk(rule.cssRules);
    }
  };
  walk(sheet.cssRules);
  return values;
}

const overlay = Number(
  sheetDeclared(
    sheetRules(tokenSheet, []),
    document.documentElement,
    "--z-overlay",
  ),
);

test("the overlay token is the number every page layer is held under", () => {
  expect(Number.isFinite(overlay)).toBe(true);
  expect(overlay).toBeGreaterThan(0);
});

test("a menu and a tooltip draw in the overlay band", () => {
  const menu = document.createElement("div");
  menu.className = "menu";
  expect(sheetDeclared(sheetRules(menuSheet, []), menu, "z-index")).toBe(
    "var(--z-overlay)",
  );

  const tooltip = document.createElement("div");
  tooltip.className = "tooltip";
  expect(sheetDeclared(sheetRules(tooltipSheet, []), tooltip, "z-index")).toBe(
    "var(--z-overlay)",
  );
});

test("a toast keeps stacking above the overlay band, as it stacked above a menu before it existed", () => {
  const viewport = document.createElement("ul");
  viewport.className = "toast-viewport";
  expect(sheetDeclared(sheetRules(toastSheet, []), viewport, "z-index")).toBe(
    "calc(var(--z-overlay) + 10)",
  );
});

test("every page layer's own z-index stays under the overlay band", () => {
  const pageSheets = [
    projectTableSheet,
    ticketSheet,
    shellSheet,
    conversationSheet,
    locomotiveSheet,
  ];
  const found = pageSheets.flatMap(sheetZIndexValues);
  expect(found.length).toBeGreaterThan(0);
  for (const value of found) expect(Number(value)).toBeLessThan(overlay);
});
