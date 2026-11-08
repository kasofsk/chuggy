/**
 * The Context view's sheet as far as a suite with no layout can follow it:
 * the view draws inside the frame the page gives it rather than a second one
 * of its own, a bar span's label is shown whole or not at all, and a table
 * closes up to a phone's width rather than scrolling.
 */

import { afterEach, expect, test } from "vitest";

import contextSheet from "../app/browser/context/context.css?raw";
import { sheetDeclared, sheetNarrowCondition, sheetRules } from "./sheet.ts";

afterEach(() => {
  document.body.replaceChildren();
});

/** One element of `className` inside another of `outer`, in the document. */
function contextSheetPlaced(outer: string, className: string): Element {
  const frame = document.createElement("div");
  frame.className = outer;
  const placed = document.createElement("div");
  placed.className = className;
  frame.append(placed);
  document.body.append(frame);
  return placed;
}

test("a run's view draws no frame of its own inside the run's body, at any width", () => {
  const view = contextSheetPlaced("ticket-run-body", "context-view");
  for (const conditions of [[], [sheetNarrowCondition]]) {
    const rules = sheetRules(contextSheet, conditions);
    for (const property of ["padding", "background", "border", "border-radius"])
      expect(sheetDeclared(rules, view, property), property).toBe("");
  }
});

test("a bar span's label wraps beneath an empty first line as tall as the span, which the span clips, when it does not fit whole", () => {
  const label = contextSheetPlaced("context-bar-strip", "context-seg-label");
  const rules = sheetRules(contextSheet, []);
  expect(
    ["display", "flex-wrap", "overflow", "white-space", "height"].map(
      (property) => sheetDeclared(rules, label, property),
    ),
  ).toStrictEqual(["flex", "wrap", "hidden", "nowrap", "100%"]);
  const first = rules.find(
    (rule) => rule.selectorText === ".context-seg-label::before",
  );
  expect(first?.style.getPropertyValue("height")).toBe("100%");
});

test("at a phone's width a table's outer columns sit flush with the section and its names wrap", () => {
  const view = document.createElement("div");
  view.className = "context-view";
  view.innerHTML =
    '<table class="tabular"><tbody><tr><td>StructuredOutput</td><td class="num">9</td><td class="num">1,825</td></tr></tbody></table>';
  document.body.append(view);
  const [name, middle, last] = [...view.querySelectorAll("td")];
  if (name === undefined || middle === undefined || last === undefined)
    throw new Error("no row");
  const rules = sheetRules(contextSheet, [sheetNarrowCondition]);
  expect(sheetDeclared(rules, name, "padding-inline-start")).toBe("0px");
  expect(sheetDeclared(rules, name, "white-space")).toBe("normal");
  expect(sheetDeclared(rules, middle, "padding-inline")).toBe("var(--space-2)");
  expect(sheetDeclared(rules, last, "padding-inline-end")).toBe("0px");
});
