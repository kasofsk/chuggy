/**
 * The outcome classification, run over the responses the server's own encoders
 * build.
 *
 * Every status the server can answer with has to land in the closed set, and
 * the codes a caller branches on have to survive the trip.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { failureResponse } from "../../src/adapters/http/outcomes.ts";
import type { NativeHttpResponse } from "../../src/adapters/http/outcomes.ts";
import {
  classify,
  retryAfterSeconds,
  retryAfterSecondsFallback,
  retryAfterSecondsMax,
  type ApiOutcome,
} from "../../src/contract/outcomes.ts";
import { nativeHttpError } from "../../src/contract/http.ts";
import { populated } from "../interpreter/roster.ts";

function classified(response: NativeHttpResponse): ApiOutcome {
  const header = (name: string) => response.headers[name] ?? null;
  return classify(response.status, header, response.body);
}

test("every status the server answers with lands in the closed set", () => {
  const cases: readonly (readonly [number, ApiOutcome["outcome"]])[] = [
    [200, "Ok"],
    [201, "Ok"],
    [202, "Accepted"],
    [401, "Unauthenticated"],
    [404, "Absent"],
    [409, "Conflict"],
    [413, "Rejected"],
    [415, "Rejected"],
    [422, "Rejected"],
    [429, "Retryable"],
    [500, "Fault"],
    [503, "Retryable"],
  ];
  for (const [status, outcome] of populated(cases, "the status roster"))
    assert.equal(
      classify(status, () => null, nativeHttpError("Code", "Message")).outcome,
      outcome,
    );
});

test("a rejection the server builds keeps the code a caller branches on", () => {
  const tooLarge = classified(failureResponse({ statusCode: 413 }));
  assert.equal(tooLarge.outcome, "Rejected");
  assert.equal(
    tooLarge.outcome === "Rejected" ? tooLarge.code : undefined,
    "BodyTooLarge",
  );
  const internal = classified(failureResponse(new Error("unexpected")));
  assert.equal(internal.outcome, "Fault");
  assert.equal(
    internal.outcome === "Fault" ? internal.code : undefined,
    "InternalError",
  );
});

test("an accepted submission carries the location the server sent", () => {
  const accepted = classify(
    202,
    (name) => (name === "location" ? "/api/v1/operations/one" : null),
    { operation: "one", state: "Pending" },
  );
  assert.equal(
    accepted.outcome === "Accepted" ? accepted.location : undefined,
    "/api/v1/operations/one",
  );
});

test("a body with no envelope falls back rather than reading undefined", () => {
  const conflict = classify(409, () => null, { unexpected: true });
  assert.equal(
    conflict.outcome === "Conflict" ? conflict.code : undefined,
    "Conflict",
  );
});

test("a hostile retry-after becomes a delay the caller can still bound", () => {
  assert.equal(retryAfterSeconds(undefined), retryAfterSecondsFallback);
  assert.equal(retryAfterSeconds("not a number"), retryAfterSecondsFallback);
  assert.equal(retryAfterSeconds("-1"), retryAfterSecondsFallback);
  assert.equal(retryAfterSeconds("1.2"), 2);
  assert.equal(retryAfterSeconds("99999"), retryAfterSecondsMax);
});
