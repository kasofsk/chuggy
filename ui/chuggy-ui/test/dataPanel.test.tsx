/**
 * The four states a read is drawn in, and the one thing a reader must never
 * see: an empty panel that looks healthy.
 *
 * Absence and failure are each drawn as their word, in different tones,
 * because "there is none" and "we could not tell" are answers a reader acts on
 * differently.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import {
  DataPanel,
  DataSection,
  ReadFailed,
} from "../app/browser/DataPanel.tsx";
import type { ApiFailure } from "../app/core/apiRequest.ts";

afterEach(cleanup);

test("a pending read says it is loading and draws no value", () => {
  render(
    <DataPanel title="Cycles" state={{ state: "Pending" }}>
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  expect(screen.getByText("Loading…")).toBeDefined();
});

test("an absent read and a failed read say which they are, each as the panel's noun and its word", () => {
  const view = render(
    <>
      <DataPanel title="Draft" state={{ state: "Absent" }}>
        {(value: string) => <p>{value}</p>}
      </DataPanel>
      <DataPanel
        title="Cycles"
        state={{
          state: "Failed",
          failure: { outcome: "Unreachable", reason: "fetch failed" },
        }}
      >
        {(value: string) => <p>{value}</p>}
      </DataPanel>
    </>,
  );
  const lines = view.container.querySelectorAll(".read-failed .notice");
  expect([...lines].map((line) => line.textContent)).toStrictEqual([
    "Draft · Not found",
    "Cycles · Not read · Offline",
  ]);
  expect(lines[0]?.classList.contains("notice-parked")).toBe(true);
  expect(lines[1]?.classList.contains("notice-danger")).toBe(true);
  expect(view.container.querySelector(".panel-meta")).toBeNull();
});

test("a failed read's detail is on hover of its word and in no line", async () => {
  render(
    <DataPanel
      title="Cycles"
      state={{
        state: "Failed",
        failure: {
          outcome: "Rejected",
          code: "Throttled",
          status: 429,
          body: {},
        },
      }}
    >
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  expect(document.body.textContent).not.toContain("Throttled");
  fireEvent.focus(screen.getByText("Refused"));
  expect((await screen.findByRole("tooltip")).textContent).toBe("Throttled");
});

test("no failed read's drawn line carries a code, a reason or the API", () => {
  const failures: readonly ApiFailure[] = [
    { outcome: "Unauthenticated" },
    { outcome: "Absent" },
    { outcome: "Conflict", code: "VersionMoved", body: {} },
    { outcome: "Retryable", code: "Backlog", retryAfterSeconds: 1 },
    { outcome: "Rejected", code: "Invalid", status: 400, body: {} },
    { outcome: "Fault", code: "InternalError", status: 500 },
    { outcome: "Unreachable", reason: "fetch failed" },
    { outcome: "Unreadable", reason: "expected string" },
  ];
  for (const failure of failures) {
    const view = render(<ReadFailed subject="Tickets" failure={failure} />);
    const drawn = view.container.textContent;
    expect(drawn, failure.outcome).toMatch(/^Tickets · /u);
    for (const internal of [
      "API",
      "code" in failure ? failure.code : "API",
      "reason" in failure ? failure.reason : "API",
    ])
      expect(drawn, failure.outcome).not.toContain(internal);
    cleanup();
  }
});

test("a read with no noun of its own says only that it was not read, and why", () => {
  render(
    <DataSection
      state={{
        state: "Failed",
        failure: { outcome: "Fault", code: "InternalError", status: 500 },
      }}
    >
      {(value: string) => <p>{value}</p>}
    </DataSection>,
  );
  expect(document.querySelector(".read-failed .notice")?.textContent).toBe(
    "Not read · Server error",
  );
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
        failure: { outcome: "Unreachable", reason: "API unreachable" },
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
    <DataPanel
      title="Cycles"
      state={{
        state: "Failed",
        failure: { outcome: "Unreachable", reason: "gone" },
      }}
    >
      {(value: string) => <p>{value}</p>}
    </DataPanel>,
  );
  expect(screen.queryByRole("button")).toBeNull();
});
