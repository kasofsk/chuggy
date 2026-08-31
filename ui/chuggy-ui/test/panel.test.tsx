/**
 * The panel's chrome: the heading a region is named by, the meta slot, and the
 * collapsible form.
 *
 * What is asserted is the accessible shape rather than the frame — the region
 * is labelled by its own heading, and a collapsible panel is a disclosure the
 * keyboard already knows how to open.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { Panel } from "../app/browser/ui/Panel.tsx";

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
  expect(view.container.querySelector("[style]")).toBeNull();
});

test("the level chooses the heading, and quiet drops the frame's class", () => {
  const view = render(
    <Panel title="Provenance" level={3} variant="quiet">
      <p>Stages 2</p>
    </Panel>,
  );
  expect(screen.getByRole("heading", { level: 3 })).toBeDefined();
  expect(
    view.container.querySelector(".panel")?.classList.contains("panel-quiet"),
  ).toBe(true);
});

test("a collapsible panel is a disclosure that opens from its prop", () => {
  const view = render(
    <Panel title="Configuration" collapsible={{ open: true }}>
      <p>Revision</p>
    </Panel>,
  );
  const details = view.container.querySelector("details");
  expect(details?.hasAttribute("open")).toBe(true);
  expect(details?.querySelector("summary")?.textContent).toBe("Configuration");
});
