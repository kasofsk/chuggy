/**
 * The Context view's sheet as far as a suite with no layout can follow it:
 * the view draws inside the frame the page gives it rather than a second one
 * of its own, and a bar span's label is shown whole or not at all.
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
