/**
 * The four states a read is drawn in, and the one thing a reader must never
 * see: an empty panel that looks healthy.
 *
 * Absence and failure carry their reason and are drawn in different tones,
 * because "there is none" and "we could not tell" are answers a reader acts on
 * differently.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { DataPanel } from "../app/browser/DataPanel.tsx";

afterEach(cleanup);

test("a pending read says it is loading and draws no value", () => {
  render(
    <DataPanel title="Cycles" state={{ state: "Pending" }}>
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  expect(screen.getByText("Loading…")).toBeDefined();
});

test("an absent read and a failed read say which they are, with the reason", () => {
  const view = render(
    <>
      <DataPanel
        title="Draft"
        state={{ state: "Absent", reason: "no draft for this ticket" }}
      >
        {(value: string) => <p>{value}</p>}
      </DataPanel>
      <DataPanel
        title="Cycles"
        state={{ state: "Failed", reason: "API unreachable" }}
      >
        {(value: string) => <p>{value}</p>}
      </DataPanel>
    </>,
  );
  expect(
    screen
      .getByText("Not available · no draft for this ticket")
      .classList.contains("notice-parked"),
  ).toBe(true);
  expect(
    screen
      .getByText("Failed to load · API unreachable")
      .classList.contains("notice-danger"),
  ).toBe(true);
  expect(view.container.querySelector(".panel-meta")).toBeNull();
});

test("a ready read draws its value and when it was observed", () => {
  render(
    <DataPanel
      title="Cycles"
      state={{ state: "Ready", value: "Cycle 3", observedAtMs: Date.now() }}
    >
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  expect(screen.getByText("Cycle 3")).toBeDefined();
  expect(screen.getByText("0s ago")).toBeDefined();
});
