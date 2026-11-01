/**
 * When the console's cache reads again on its own: a failed read on focus and
 * on reconnect, and one the network or the server failed asked again a bounded
 * number of times, never one whose answer asking again would not change.
 */

import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";

import { ApiOutcomeError, apiOrThrow } from "../app/core/apiRequest.ts";
import type { ApiFailure } from "../app/core/apiRequest.ts";
import { readFailedLine } from "../app/core/failureWords.ts";
import {
  panelQueryDefaults,
  panelQueryFailedRefetched,
  panelQueryRetried,
  panelQueryRetriesMax,
} from "../app/core/panelQueryDefaults.ts";

const failures: Readonly<Record<ApiFailure["outcome"], ApiFailure>> = {
  Unreachable: { outcome: "Unreachable", reason: "offline" },
  Fault: { outcome: "Fault", code: "InternalError", status: 500 },
  Absent: { outcome: "Absent" },
  Rejected: { outcome: "Rejected", code: "Invalid", status: 400, body: {} },
  Conflict: { outcome: "Conflict", code: "Moved", body: {} },
  Unauthenticated: { outcome: "Unauthenticated" },
  Retryable: { outcome: "Retryable", code: "Busy", retryAfterSeconds: 1 },
  Unreadable: { outcome: "Unreadable", reason: "not json" },
};

function failed(failure: ApiFailure): ApiOutcomeError {
  return new ApiOutcomeError(failure, readFailedLine(undefined, failure));
}

test("only a read that failed is read again on focus or reconnect", () => {
  expect(panelQueryFailedRefetched({ state: { status: "error" } })).toBe(true);
  expect(panelQueryFailedRefetched({ state: { status: "success" } })).toBe(
    false,
  );
  expect(panelQueryFailedRefetched({ state: { status: "pending" } })).toBe(
    false,
  );
});

test("an unreachable or failing server is asked again up to the bound, and every other answer never", () => {
  for (const [outcome, failure] of Object.entries(failures)) {
    const asked = outcome === "Unreachable" || outcome === "Fault";
    for (let count = 0; count < panelQueryRetriesMax; count += 1)
      expect(panelQueryRetried(count, failed(failure)), outcome).toBe(asked);
    expect(panelQueryRetried(panelQueryRetriesMax, failed(failure))).toBe(
      false,
    );
  }
  expect(panelQueryRetried(0, new Error("thrown"))).toBe(false);
});

test("a cache on the defaults asks a failing read again up to the bound and then holds the failure", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { ...panelQueryDefaults, retryDelay: 0 } },
  });
  let reads = 0;
  await client
    .fetchQuery({
      queryKey: ["probe"],
      queryFn: () => {
        reads += 1;
        return apiOrThrow(failures.Fault, (failure) =>
          readFailedLine(undefined, failure),
        );
      },
    })
    .catch(() => undefined);
  expect(reads).toBe(panelQueryRetriesMax + 1);
  expect(client.getQueryState(["probe"])?.status).toBe("error");
});
