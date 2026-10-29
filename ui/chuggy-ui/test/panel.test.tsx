/**
 * The panel's chrome: the heading a region is named by, the meta slot, and the
 * collapsible form.
 *
 * What is asserted is the accessible shape rather than the frame — the region
 * is labelled by its own heading, and a collapsible panel is a heading holding
 * a disclosure the keyboard already knows how to open.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import panelSheet from "../app/browser/ui/Panel.css?raw";
import { Panel } from "../app/browser/ui/Panel.tsx";
import tokenSheet from "../app/styles/tokens.css?raw";
import { sheetDeclared, sheetRules } from "./sheet.ts";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

test("the region is labelled by its own heading, and the meta sits beside it", () => {
  const view = render(
    <Panel title="Ledger" meta="12s ago">
      <p>Stage 2 of 2 passed</p>
    </Panel>,
  );
  const region = screen.getByRole("region", { name: "Ledger" });
  expect(region.querySelector(".panel-meta")?.textContent).toBe("12s ago");
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Ledger");
  expect(region.classList.contains("rounded-3")).toBe(true);
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("the level chooses the heading, and quiet drops the frame's utilities", () => {
  render(
    <Panel title="Provenance" level={3} variant="quiet">
      <p>Stages 2</p>
    </Panel>,
  );
  expect(screen.getByRole("heading", { level: 3 })).toBeDefined();
  const panel = screen.getByRole("region", { name: "Provenance" });
  expect(panel.classList.contains("min-w-0")).toBe(true);
  expect(panel.classList.contains("border-edge")).toBe(false);
  styleless();
});

/** Radix writes the content's measured height through the CSSOM, which the
 * served policy permits; what it must never do is append a sheet. */
test("a collapsible panel opens from its prop and its trigger toggles aria-expanded", () => {
  render(
    <Panel title="Configuration" collapsible={{ open: true }} meta="rev 11">
      <p>Revision</p>
    </Panel>,
  );
  const trigger = screen.getByRole("button", { name: "Configuration" });
  expect(trigger.closest("h2")).not.toBeNull();
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByText("Revision")).toBeDefined();
  styleless();

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("Revision")).toBeNull();
  styleless();

  fireEvent.click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  styleless();
});

test("a collapsible panel starts closed when its prop says so", () => {
  render(
    <Panel title="Refusals" collapsible={{ open: false }}>
      <p>None</p>
    </Panel>,
  );
  expect(
    screen
      .getByRole("button", { name: "Refusals" })
      .getAttribute("aria-expanded"),
  ).toBe("false");
  expect(screen.queryByText("None")).toBeNull();
  styleless();
});

/** A panel is as narrow as the column it stands in, and the line about the
 * region is read before the meta is. */
test("a panel too narrow for its names beside its meta puts the meta under them", () => {
  render(
    <Panel title="Accounts" about="The forge accounts" meta="Connect">
      <p>gdoteof</p>
    </Panel>,
  );
  const rules = sheetRules(panelSheet, []);
  const region = screen.getByRole("region", { name: "Accounts" });
  const head = region.querySelector(".panel-head");
  const named = region.querySelector(".panel-named");
  if (head === null || named === null) throw new Error("no head was drawn");
  expect(sheetDeclared(rules, head, "flex-wrap")).toBe("wrap");
  expect(sheetDeclared(rules, named, "flex")).toBe(
    "1 1 var(--width-panel-named)",
  );
  expect(
    sheetDeclared(
      sheetRules(tokenSheet, []),
      document.documentElement,
      "--width-panel-named",
    ),
  ).toMatch(/rem$/u);
});
