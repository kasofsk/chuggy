/**
 * The overlay band: every layer Radix portals to the body builds on
 * `--z-overlay`, lowest first a toast, a dialog's scrim, its frame, then a
 * menu and a tooltip, which draw on top because one can be anchored to a
 * control inside a dialog. Every page layer's own z-index — a sticky bar, a
 * slid-in pane, a trigger list — stays under the band regardless of what
 * carries it there.
 */

import { cleanup, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, expect, test } from "vitest";

import conversationSheet from "../app/browser/conversation/conversation.css?raw";
import locomotiveSheet from "../app/browser/ui/Locomotive.css?raw";
import menuSheet from "../app/browser/ui/Menu.css?raw";
import projectTableSheet from "../app/browser/ProjectTable.css?raw";
import shellSheet from "../app/browser/shell/shell.css?raw";
import ticketSheet from "../app/browser/ticket/ticket.css?raw";
import toastSheet from "../app/browser/ui/Toast.css?raw";
import tokenSheet from "../app/styles/tokens.css?raw";
import tooltipSheet from "../app/browser/ui/Tooltip.css?raw";
import { Dialog } from "../app/browser/ui/Dialog.tsx";
import { renderCopied } from "./copied.tsx";
import { sheetDeclared, sheetRules } from "./sheet.ts";

afterEach(cleanup);

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

function declaredZIndex(text: string, className: string): string {
  const element = document.createElement("div");
  element.className = className;
  return sheetDeclared(sheetRules(text, []), element, "z-index");
}

/** What a layer adds to `--z-overlay`, read from a sheet's
 * `calc(var(--z-overlay) + n)` or a Tailwind `z-[calc(var(--z-overlay)+n)]`;
 * a value built any other way is not on the band, and reads as not a number. */
function overlayOffset(value: string): number {
  const match =
    /^z-\[calc\(var\(--z-overlay\)\+(\d+)\)\]$|^calc\(var\(--z-overlay\) \+ (\d+)\)$/.exec(
      value,
    );
  return match === null ? Number.NaN : Number(match[1] ?? match[2]);
}

function dialogOffsets(): { readonly scrim: number; readonly frame: number } {
  renderCopied(
    createElement(Dialog, {
      title: "Add",
      trigger: "Add",
      open: true,
      onOpenChange: () => undefined,
      children: createElement("p", null, "body"),
    }),
  );
  const frame = screen.getByRole("dialog", { name: "Add" }).parentElement;
  const scrim = frame?.previousElementSibling ?? null;
  const offsetOf = (element: Element | null): number => {
    const found = [...(element?.classList ?? [])]
      .map(overlayOffset)
      .filter((offset) => !Number.isNaN(offset));
    expect(found).toHaveLength(1);
    return found[0] ?? Number.NaN;
  };
  return { scrim: offsetOf(scrim), frame: offsetOf(frame) };
}

test("a menu and a tooltip draw above a dialog's frame, over a scrim over a toast", () => {
  const { scrim, frame } = dialogOffsets();
  const toast = overlayOffset(declaredZIndex(toastSheet, "toast-viewport"));
  const menu = overlayOffset(declaredZIndex(menuSheet, "menu"));
  const tooltip = overlayOffset(declaredZIndex(tooltipSheet, "tooltip"));
  for (const offset of [toast, scrim, frame, menu, tooltip])
    expect(offset).toBeGreaterThan(0);
  expect(scrim).toBeGreaterThan(toast);
  expect(frame).toBeGreaterThan(scrim);
  expect(menu).toBeGreaterThan(frame);
  expect(tooltip).toBeGreaterThan(frame);
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
