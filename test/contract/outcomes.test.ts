/**
 * The outcome classification, run over the responses the server's own encoders
 * build.
 *
 * Every status the server can answer with has to land in the closed set, and
 * the codes a caller branches on have to survive the trip.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  authorityRetryAfterSeconds,
  failureResponse,
  invalidRequestIssuesMax,
  invalidRequestReasonCharsMax,
} from "../../src/adapters/http/outcomes.ts";
import type { NativeHttpResponse } from "../../src/adapters/http/outcomes.ts";
import { briefLineCharsMax, briefSchema } from "../../src/contract/brief.ts";
import { ProjectAccessUnavailable } from "../../src/interpreter/projectAccess.ts";
import { asBriefIntent } from "../../src/interpreter/ticketBrief.ts";
import {
  classify,
  retryAfterSeconds,
  retryAfterSecondsFallback,
  retryAfterSecondsMax,
  type ApiOutcome,
} from "../../src/contract/outcomes.ts";
import {
  errorEnvelopeSchema,
  nativeHttpError,
  textCodePointsCount,
} from "../../src/contract/http.ts";
import { populated } from "../interpreter/roster.ts";

function classified(response: NativeHttpResponse): ApiOutcome {
  const header = (name: string) => response.headers[name] ?? null;
  return classify(response.status, header, response.body);
}

/** The failure a call raised, so a case states the rule in the raiser's own words. */
function raised(act: () => unknown): unknown {
  try {
    act();
  } catch (failure) {
    return failure;
  }
  throw new Error("the call answered where the case needs it to raise");
}

/** What a refused request is told, read back through the envelope the console parses. */
function refusalMessage(failure: unknown): string {
  const refusal = failureResponse(failure);
  assert.equal(refusal.status, 400);
  const outcome = classified(refusal);
  assert.equal(
    outcome.outcome === "Rejected" ? outcome.code : undefined,
    "InvalidRequest",
  );
  return errorEnvelopeSchema.parse(refusal.body).error.message;
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

test("an authority that could not be reached is retryable, never a refusal", () => {
  const refusal = failureResponse(
    new ProjectAccessUnavailable("the authority answered 503"),
  );
  assert.equal(refusal.status, 503);
  const outcome = classified(refusal);
  assert.equal(outcome.outcome, "Retryable");
  assert.equal(
    outcome.outcome === "Retryable" ? outcome.code : undefined,
    "AuthorityUnavailable",
  );
  assert.equal(
    retryAfterSeconds(refusal.headers["retry-after"]),
    authorityRetryAfterSeconds,
  );
});

test("a brand's refusal reaches the caller in the brand's own words", () => {
  const failure = raised(() => asBriefIntent("a line with a \u0007 in it"));
  assert.ok(failure instanceof RangeError);
  assert.equal(refusalMessage(failure), failure.message);
  assert.match(refusalMessage(failure), /intent/u);
});

test("a wire refusal names the field each issue was found at", () => {
  const failure = raised(() =>
    briefSchema.parse({
      intent: "x".repeat(briefLineCharsMax + 1),
      links: ["not a link"],
    }),
  );
  assert.ok(failure instanceof z.ZodError);
  const message = refusalMessage(failure);
  assert.match(message, /^intent: /mu);
  assert.match(message, /^links\.0: /mu);
});

test("a raise from inside the server tells the caller nothing about it", () => {
  assert.equal(
    refusalMessage(new TypeError("cannot read properties of undefined")),
    "The request is invalid.",
  );
  assert.equal(refusalMessage(new RangeError("")), "The request is invalid.");
});

test("a refusal renders bounded issues and a bounded reason", () => {
  const many = raised(() =>
    z
      .strictObject(
        Object.fromEntries(
          Array.from({ length: invalidRequestIssuesMax * 4 }, (_, at) => [
            `field${String(at)}`,
            z.string(),
          ]),
        ),
      )
      .parse({}),
  );
  assert.ok(many instanceof z.ZodError);
  assert.equal(
    refusalMessage(many).split("\n").length,
    invalidRequestIssuesMax,
  );
  assert.equal(
    textCodePointsCount(
      refusalMessage(
        new RangeError("x".repeat(invalidRequestReasonCharsMax * 2)),
      ),
    ),
    invalidRequestReasonCharsMax,
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
