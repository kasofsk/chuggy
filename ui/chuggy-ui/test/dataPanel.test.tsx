/**
 * The four states a read is drawn in, and the one thing a reader must never
 * see: an empty panel that looks healthy.
 *
 * Absence and failure carry their reason and are drawn in different tones,
 * because "there is none" and "we could not tell" are answers a reader acts on
 * differently.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

test("a ready read whose last read failed keeps its value and says Not updated where its freshness was, with Retry", () => {
  let retried = 0;
  const view = render(
    <DataPanel
      title="Cycles"
      state={{
        state: "Ready",
        value: "Cycle 3",
        observedAtMs: Date.now(),
        rereadFailed: true,
        retry: () => {
          retried += 1;
        },
      }}
    >
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  expect(screen.getByText("Cycle 3")).toBeDefined();
  expect(screen.queryByText("0s ago")).toBeNull();
  const meta = view.container.querySelector(".panel-meta");
  expect(meta?.textContent).toBe("Not updatedRetry");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retried).toBe(1);
});

test("a failed read offers Retry beside its line where it can be read again, and nothing where it cannot", () => {
  let retried = 0;
  render(
    <DataPanel
      title="Cycles"
      state={{
        state: "Failed",
        reason: "API unreachable",
        retry: () => {
          retried += 1;
        },
      }}
    >
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(retried).toBe(1);
  cleanup();
  render(
    <DataPanel title="Cycles" state={{ state: "Failed", reason: "gone" }}>
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  expect(screen.queryByRole("button")).toBeNull();
});
