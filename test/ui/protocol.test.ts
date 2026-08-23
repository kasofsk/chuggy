/**
 * The console's copy of the wire, held against the server's own.
 *
 * A static artifact cannot import the server's TypeScript, so the constants are
 * written twice; this suite is what makes the second copy a checked claim
 * rather than a comment.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  nativeHttpBasePath,
  nativeHttpBodyBytesMax,
  nativeHttpCursorCharsMax,
  nativeHttpMediaType,
  nativeHttpPathSegmentCharsMax,
  nativeHttpRoutes,
} from "../../src/adapters/http/contract.ts";
import { projectPageLimitMax } from "../../src/interpreter/nativeWeb.ts";
import { executionPageLimitMax } from "../../src/interpreter/operationsView.ts";
import {
  artifactRequest,
  basePath,
  bodyBytesMax,
  classify,
  cursorCharsMax,
  dispatchViewRequest,
  executionRequest,
  executionStateQuery,
  executionsRequest,
  mediaType,
  notificationsRequest,
  operationRequest,
  operationalStatusRequest,
  pageLimitMax,
  partitionPath,
  pathSegmentCharsMax,
  phaseQuery,
  projectsRequest,
  retryAfterSeconds,
  retryAfterSecondsFallback,
  retryAfterSecondsMax,
  submissionRequest,
  ticketsRequest,
} from "../../ui/app/protocol.js";

const token = "opaque-access-token";
const partition = { tenant: "acme", project: "atlas" };
const noHeader = () => null;

test("the console's wire constants are the server's", () => {
  assert.equal(mediaType, nativeHttpMediaType);
  assert.equal(basePath, nativeHttpBasePath);
  assert.equal(cursorCharsMax, nativeHttpCursorCharsMax);
  assert.equal(bodyBytesMax, nativeHttpBodyBytesMax);
  assert.equal(pageLimitMax, projectPageLimitMax);
  assert.equal(pageLimitMax, executionPageLimitMax);
  assert.equal(pathSegmentCharsMax, nativeHttpPathSegmentCharsMax);
});

test("every path the console builds is a route the server registers", () => {
  const template = (path: string) =>
    path
      .replace(
        `${basePath}/tenants/acme/projects/atlas`,
        `${basePath}/tenants/:tenant/projects/:project`,
      )
      .replace(/\?.*$/u, "");
  const built = [
    projectsRequest(token, undefined, 50).url,
    ticketsRequest(token, partition, { limit: 50 }).url,
    dispatchViewRequest(token, partition, { limit: 50 }).url,
    notificationsRequest(token, partition, 0, 50).url,
    operationalStatusRequest(token, partition).url,
    executionsRequest(token, partition, { limit: 50 }).url,
    submissionRequest(token, partition, {
      operation: "o1",
      idempotencyKey: "k1",
      mutation: {
        mutation: "ManualDispatch",
        ticket: 1,
        expectedTicketVersion: 2,
      },
    }).url,
  ].map(template);
  const registered: readonly string[] = Object.values(nativeHttpRoutes);
  for (const path of built) assert.ok(registered.includes(path), path);
});

test("a parameterised path is the route with its parameter filled in", () => {
  const root = `${basePath}/tenants/acme/projects/atlas`;
  assert.equal(
    operationRequest(token, partition, "op 1").url,
    `${root}/operations/op%201`,
  );
  assert.equal(
    executionRequest(token, partition, "e/1").url,
    `${root}/executions/e%2F1`,
  );
  assert.equal(
    artifactRequest(token, partition, "e1", 3).url,
    `${root}/executions/e1/artifacts/3`,
  );
});

test("a read carries the bearer and no body", () => {
  const request = operationalStatusRequest(token, partition);
  assert.equal(request.method, "GET");
  assert.equal(request.headers["authorization"], `Bearer ${token}`);
  assert.equal(request.body, undefined);
});

test("a submission carries the versioned media type and an idempotency key", () => {
  const request = submissionRequest(token, partition, {
    operation: "o1",
    idempotencyKey: "k1",
    mutation: {
      mutation: "ManualDispatch",
      ticket: 7,
      expectedTicketVersion: 4,
    },
  });
  assert.equal(request.headers["content-type"], mediaType);
  assert.equal(request.headers["idempotency-key"], "k1");
  assert.deepEqual(JSON.parse(request.body ?? ""), {
    operation: "o1",
    mutation: {
      mutation: "ManualDispatch",
      ticket: 7,
      expectedTicketVersion: 4,
    },
  });
});

test("the bounds the server will not explain are checked before the request", () => {
  assert.throws(
    () => ticketsRequest(token, partition, { limit: 0 }),
    RangeError,
  );
  assert.throws(
    () => ticketsRequest(token, partition, { limit: pageLimitMax + 1 }),
    RangeError,
  );
  assert.throws(() => projectsRequest(token, "", 50), RangeError);
  assert.throws(
    () => projectsRequest(token, "c".repeat(cursorCharsMax + 1), 50),
    RangeError,
  );
  assert.throws(
    () =>
      partitionPath({
        tenant: "t".repeat(pathSegmentCharsMax + 1),
        project: "p",
      }),
    RangeError,
  );
});

test("a selection is sent as the server's own field, repeated", () => {
  assert.deepEqual(phaseQuery({ selection: "All" }), []);
  assert.deepEqual(phaseQuery({ selection: "NonTerminal" }), [
    ["phase", "NonTerminal"],
  ]);
  assert.deepEqual(
    phaseQuery({ selection: "Selected", phases: ["Working", "Done"] }),
    [
      ["phase", "Working"],
      ["phase", "Done"],
    ],
  );
  const request = executionsRequest(token, partition, {
    limit: 25,
    states: executionStateQuery({
      selection: "Selected",
      states: ["Queued", "Running"],
    }),
  });
  assert.ok(request.url.endsWith("?limit=25&state=Queued&state=Running"));
});

test("absent and inaccessible classify as one outcome", () => {
  assert.deepEqual(classify(404, noHeader, undefined), { outcome: "Absent" });
});

test("a backlog is a retryable outcome carrying its own delay", () => {
  const outcome = classify(
    429,
    (name) => (name === "retry-after" ? "12" : null),
    {
      error: {
        code: "DispatchBacklog",
        message: "The request can be retried.",
      },
    },
  );
  assert.deepEqual(outcome, {
    outcome: "Retryable",
    code: "DispatchBacklog",
    retryAfterSeconds: 12,
  });
});

test("an accepted submission surfaces its location", () => {
  const outcome = classify(
    202,
    (name) => (name === "location" ? "/api/v1/x" : null),
    {
      operation: "o1",
      state: "Pending",
    },
  );
  assert.equal(outcome.outcome, "Accepted");
  assert.equal(
    outcome.outcome === "Accepted" ? outcome.location : undefined,
    "/api/v1/x",
  );
});

test("a hostile retry-after is clamped rather than believed", () => {
  assert.equal(retryAfterSeconds(undefined), retryAfterSecondsFallback);
  assert.equal(retryAfterSeconds("not a number"), retryAfterSecondsFallback);
  assert.equal(retryAfterSeconds("-4"), retryAfterSecondsFallback);
  assert.equal(retryAfterSeconds("99999999"), retryAfterSecondsMax);
  assert.equal(retryAfterSeconds("2.1"), 3);
});

test("the remaining statuses land in the outcomes the console can draw", () => {
  assert.deepEqual(classify(401, noHeader, undefined), {
    outcome: "Unauthenticated",
  });
  assert.equal(
    classify(409, noHeader, { error: { code: "ProjectionBehind" } }).outcome,
    "Conflict",
  );
  assert.equal(classify(415, noHeader, undefined).outcome, "Rejected");
  assert.equal(classify(500, noHeader, undefined).outcome, "Fault");
  assert.equal(
    classify(503, noHeader, { error: { code: "ServerBusy" } }).outcome,
    "Retryable",
  );
});
