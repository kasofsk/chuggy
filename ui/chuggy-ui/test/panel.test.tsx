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

import { Panel } from "../app/browser/ui/Panel.tsx";
import { styleless } from "./styleless.ts";

afterEach(cleanup);

test("the region is labelled by its own heading, and the meta sits beside it", () => {
  const view = render(
    <Panel title="Budgets" meta="12s ago">
      <p>Rework 2/2 used</p>
    </Panel>,
  );
  const region = screen.getByRole("region", { name: "Budgets" });
  expect(region.querySelector(".panel-meta")?.textContent).toBe("12s ago");
  expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Budgets");
  expect(region.classList.contains("rounded-3")).toBe(true);
  expect(view.container.querySelector("[style]")).toBeNull();
  styleless();
});

test("the level chooses the heading, and quiet drops the frame's class", () => {
  const view = render(
    <Panel title="Provenance" level={3} variant="quiet">
      <p>Stages 2</p>
    </Panel>,
  );
  expect(screen.getByRole("heading", { level: 3 })).toBeDefined();
  const panel = view.container.querySelector(".panel");
  expect(panel?.classList.contains("panel-quiet")).toBe(true);
  expect(panel?.classList.contains("border-edge")).toBe(false);
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
