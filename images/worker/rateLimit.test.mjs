/**
 * The predicate that decides whether a run or a turn was held, driven over each
 * value the SDK declares rather than over the two its callers happen to produce.
 *
 * THE MIDDLE VALUE IS WHY THIS SUITE EXISTS. `SDKRateLimitInfo.status` is a
 * three-valued closed set, and `allowed_warning` means the request was allowed
 * while the account nears a threshold. A predicate written as "not allowed"
 * reads that middle value as a refusal and prices an ordinary failure as free,
 * and a predicate written as "rejected" does not — so both members of the
 * vocabulary that are not a hold are asserted here, not just the one a caller
 * would naturally emit.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  observeRateLimit,
  rateLimitSightings,
  rateLimited,
} from "./rateLimit.mjs";

/** `SDKRateLimitInfo.status` as `sdk.d.ts` declares it, in its declared order. */
const declaredStatuses = ["allowed", "allowed_warning", "rejected"];

/** `SDKAssistantMessageError` as `sdk.d.ts` declares it. */
const declaredErrors = [
  "authentication_failed",
  "oauth_org_not_allowed",
  "account_on_hold",
  "billing_error",
  "rate_limit",
  "overloaded",
  "invalid_request",
  "model_not_found",
  "server_error",
  "unknown",
  "max_output_tokens",
];

const rateLimitEvent = (status) => ({
  type: "rate_limit_event",
  rate_limit_info: { status, rateLimitType: "five_hour", utilization: 1 },
});

/** The sightings a run that saw exactly these frames, in this order, ends with. */
function seenBy(...events) {
  return events.reduce(observeRateLimit, rateLimitSightings());
}

test("a run nothing was said about is not held", () => {
  assert.equal(rateLimited(rateLimitSightings()), false);
  assert.equal(rateLimited(undefined), false);
});

test("exactly one of the three declared statuses is a hold", () => {
  assert.deepEqual(
    declaredStatuses.map((status) =>
      rateLimited(seenBy(rateLimitEvent(status))),
    ),
    [false, false, true],
  );
});

test("exactly one of the declared assistant errors is a hold", () => {
  assert.deepEqual(
    declaredErrors.filter((error) =>
      rateLimited(seenBy({ type: "assistant", error })),
    ),
    ["rate_limit"],
  );
});

test("the latest status is the one that counts, in either direction", () => {
  assert.equal(
    rateLimited(seenBy(rateLimitEvent("rejected"), rateLimitEvent("allowed"))),
    false,
  );
  assert.equal(
    rateLimited(
      seenBy(rateLimitEvent("rejected"), rateLimitEvent("allowed_warning")),
    ),
    false,
  );
  assert.equal(
    rateLimited(seenBy(rateLimitEvent("allowed"), rateLimitEvent("rejected"))),
    true,
  );
});

test("a refusal the runtime named on its own frame outlives a later allowance", () => {
  assert.equal(
    rateLimited(
      seenBy(
        { type: "assistant", error: "rate_limit" },
        rateLimitEvent("allowed"),
      ),
    ),
    true,
  );
});

test("a frame that carries no status of its own leaves the last one standing", () => {
  for (const event of [
    { type: "rate_limit_event" },
    { type: "rate_limit_event", rate_limit_info: {} },
    { type: "rate_limit_event", rate_limit_info: { status: 7 } },
  ])
    assert.equal(rateLimited(seenBy(rateLimitEvent("rejected"), event)), true);
});

test("no other frame the runtime emits is read as a hold", () => {
  for (const event of [
    {
      type: "result",
      subtype: "error_during_execution",
      terminal_reason: "api_error",
    },
    {
      type: "result",
      subtype: "error_during_execution",
      stop_reason: "rate_limit",
    },
    { type: "result", subtype: "rate_limit" },
    { type: "assistant", message: { role: "assistant" }, error: undefined },
    { type: "system", subtype: "init" },
    { type: "user", message: { content: "rate_limit" } },
    undefined,
  ])
    assert.equal(
      rateLimited(seenBy(event)),
      false,
      JSON.stringify(event ?? null),
    );
});
