/**
 * What a panel says about its data, including when there is none.
 *
 * The case that matters is the last one: absence and failure must not collapse
 * into an empty ready panel, which is what a reader would take for a healthy
 * table with nothing in it.
 */

import { expect, test } from "vitest";

import { ApiOutcomeError } from "../app/core/apiRequest.ts";
import {
  freshnessIsStale,
  freshnessLabel,
  freshnessStaleAfterMs,
  panelObservedAtMs,
  panelStateFromQuery,
} from "../app/core/freshness.ts";

const nowMs = Date.parse("2026-08-26T12:00:00Z");

test("the label is whole units, and no data is said to be none", () => {
  expect(freshnessLabel(nowMs, nowMs - 3_000)).toBe("3s ago");
  expect(freshnessLabel(nowMs, nowMs - 90_000)).toBe("1m ago");
  expect(freshnessLabel(nowMs, nowMs - 3_600_000 * 5)).toBe("5h ago");
  expect(freshnessLabel(nowMs, nowMs - 3_600_000 * 30)).toBe("1d ago");
  expect(freshnessLabel(nowMs, undefined)).toBe("Unknown");
});

test("a clock that ran backwards does not read as data from the future", () => {
  expect(freshnessLabel(nowMs, nowMs + 10_000)).toBe("0s ago");
});

test("data nobody ever observed is stale, and so is data past the bound", () => {
  expect(freshnessIsStale(nowMs, undefined)).toBe(true);
  expect(freshnessIsStale(nowMs, nowMs - freshnessStaleAfterMs)).toBe(true);
  expect(freshnessIsStale(nowMs, nowMs - freshnessStaleAfterMs + 1)).toBe(
    false,
  );
});

test("a resource that states when it was observed is believed over the cache", () => {
  const observed = "2026-08-26T11:59:00Z";
  expect(panelObservedAtMs({ observedAt: observed }, nowMs)).toBe(
    Date.parse(observed),
  );
  expect(panelObservedAtMs({ observedAt: "not a time" }, nowMs)).toBe(nowMs);
  expect(panelObservedAtMs({}, nowMs)).toBe(nowMs);
});

test("absence and failure are separate states, failure carrying its outcome", () => {
  const absent = panelStateFromQuery({
    data: undefined,
    error: new ApiOutcomeError({ outcome: "Absent" }, "gone"),
    isPending: false,
    dataUpdatedAt: 0,
  });
  const fault = {
    outcome: "Fault",
    code: "InternalError",
    status: 500,
  } as const;
  const failed = panelStateFromQuery({
    data: undefined,
    error: new ApiOutcomeError(fault, "read"),
    isPending: false,
    dataUpdatedAt: 0,
  });
  expect(absent.state).toBe("Absent");
  expect(failed.state).toBe("Failed");
  expect(failed.state === "Failed" && failed.failure).toStrictEqual(fault);
});

test("a query that failed is never drawn as an empty ready panel", () => {
  const result = { outcome: "Absent" } as const;
  const state = panelStateFromQuery({
    data: undefined,
    error: new ApiOutcomeError(result, "read"),
    isPending: false,
    dataUpdatedAt: 0,
  });
  expect(state.state).toBe("Absent");
});

test("a query still reading is pending rather than ready with nothing", () => {
  expect(
    panelStateFromQuery({
      data: undefined,
      error: null,
      isPending: true,
      dataUpdatedAt: 0,
    }).state,
  ).toBe("Pending");
});

test("a live write with no cache timestamp yet is ready without a claim", () => {
  const state = panelStateFromQuery({
    data: { ticket: 3 },
    error: null,
    isPending: false,
    dataUpdatedAt: 0,
  });
  expect(state).toEqual({
    state: "Ready",
    value: { ticket: 3 },
    observedAtMs: undefined,
  });
});

const fault = {
  outcome: "Fault",
  code: "InternalError",
  status: 500,
} as const;
const unreachable = { outcome: "Unreachable", reason: "offline" } as const;
const absent = { outcome: "Absent" } as const;

/** Any run of reads after an answer: the answer, then failures of either kind. */
const failedRereads = [
  [fault],
  [unreachable],
  [fault, unreachable],
  [unreachable, fault, fault],
] as const;

test("an answer held stays ready through any run of reads that fail after it, saying it was not updated", () => {
  for (const failures of failedRereads) {
    let query = {
      data: { route: "Pool" },
      error: null as unknown,
      isPending: false,
      dataUpdatedAt: nowMs,
    };
    expect(panelStateFromQuery(query)).toStrictEqual({
      state: "Ready",
      value: { route: "Pool" },
      observedAtMs: nowMs,
    });
    for (const failure of failures) {
      query = {
        ...query,
        error: new ApiOutcomeError(failure, "read"),
      };
      expect(panelStateFromQuery(query)).toStrictEqual({
        state: "Ready",
        value: { route: "Pool" },
        observedAtMs: nowMs,
        rereadFailed: true,
      });
    }
  }
});

test("an answer held stays ready through a read that failed with no outcome", () => {
  expect(
    panelStateFromQuery({
      data: { route: "Pool" },
      error: new Error("boom"),
      isPending: false,
      dataUpdatedAt: nowMs,
    }),
  ).toMatchObject({ state: "Ready", rereadFailed: true });
});

test("an answer of absent wins over an answer held, because the resource is gone", () => {
  expect(
    panelStateFromQuery({
      data: { route: "Pool" },
      error: new ApiOutcomeError(absent, "read"),
      isPending: false,
      dataUpdatedAt: nowMs,
    }),
  ).toStrictEqual({ state: "Absent" });
});

test("a read that never answered is failed, however it failed", () => {
  for (const failure of [fault, unreachable])
    expect(
      panelStateFromQuery({
        data: undefined,
        error: new ApiOutcomeError(failure, "read"),
        isPending: false,
        dataUpdatedAt: 0,
      }),
    ).toStrictEqual({ state: "Failed", failure });
});
