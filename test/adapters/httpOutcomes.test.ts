import assert from "node:assert/strict";
import { test } from "node:test";

import { asPublicInstant } from "../../src/interpreter/nativeWeb.ts";
import {
  asAuthorityKind,
  asOperationId,
  type Accepted,
} from "../../src/interpreter/operationInbox.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  cancellationResponse,
  inventoryResponse,
  notificationsResponse,
  operationResponse,
  projectResponse,
  submissionResponse,
} from "../../src/adapters/http/outcomes.ts";
import { populated } from "../interpreter/roster.ts";

const partition = {
  tenant: asTenantId("tenant/one"),
  project: asProjectId("project two"),
};
const operation = asOperationId("operation/three");
const standing = {
  partition,
  operation,
  ordinal: 1,
  state: "Pending" as const,
  authorityKind: asAuthorityKind("User"),
  admission: "Ordinary" as const,
  lifecycleGeneration: 1,
};

test("durable acceptance returns the operation location without a decision", () => {
  const found = submissionResponse(partition, operation, {
    result: "Authorized",
    acceptance: { accepted: "Accepted", operation: standing },
  });
  assert.deepEqual(found, {
    status: 202,
    headers: {
      "content-type": "application/vnd.chuggy.v1+json",
      location:
        "/api/v1/tenants/tenant%2Fone/projects/project%20two/operations/operation%2Fthree",
    },
    body: { operation: "operation/three", state: "Pending" },
  });
});

test("every acceptance outcome has a closed safe status mapping", () => {
  const cases: readonly (readonly [Accepted, number])[] = [
    [{ accepted: "Accepted", operation: standing }, 202],
    [{ accepted: "Original", operation: standing }, 202],
    [{ accepted: "IdempotencyConflict" }, 409],
    [{ accepted: "InvalidCommand" }, 422],
    [{ accepted: "Backpressure", retryAfterSeconds: 3 }, 429],
    [{ accepted: "Unavailable", retryAfterSeconds: 4 }, 503],
    [{ accepted: "NotAdmitted", lifecycle: "Suspended" }, 409],
  ];
  for (const [accepted, status] of populated(cases, "acceptance outcomes")) {
    const found = submissionResponse(partition, operation, {
      result: "Authorized",
      acceptance: accepted,
    });
    assert.equal(found.status, status);
    assert.doesNotMatch(
      JSON.stringify(found.body),
      /Suspended|authority|command/u,
    );
  }
});

test("retryable refusal carries bounded retry guidance", () => {
  const found = submissionResponse(partition, operation, {
    result: "Backlogged",
    scope: "Project",
    retryAfterSeconds: 7,
  });
  assert.equal(found.status, 429);
  assert.equal(found.headers["retry-after"], "7");
  assert.doesNotMatch(JSON.stringify(found.body), /Project/u);
});

test("operation absence and presence use the public resource only", () => {
  assert.equal(operationResponse(undefined).status, 404);
  const resource = {
    operation,
    acceptedAt: asPublicInstant("2026-01-01T00:00:00Z"),
    state: "Pending" as const,
  };
  assert.deepEqual(operationResponse(resource).body, resource);
});

test("minimum sequence remains an authoritative projection response", () => {
  assert.equal(
    projectResponse({ result: "Behind", observedSequence: 12 }).status,
    409,
  );
  assert.deepEqual(
    projectResponse({ result: "Behind", observedSequence: 12 }).body,
    {
      error: {
        code: "ProjectionBehind",
        message: "The projection has not reached the required sequence.",
      },
      observedSequence: 12,
    },
  );
});

test("cancellation maps every closed inbox result", () => {
  const cases = [
    { result: { cancelled: "Cancelled", operation: standing }, status: 200 },
    {
      result: { cancelled: "AlreadyCancelled", operation: standing },
      status: 200,
    },
    { result: { cancelled: "NotPending", state: "Succeeded" }, status: 409 },
    { result: { cancelled: "Unknown" }, status: 404 },
  ] as const;
  for (const each of populated(cases, "cancellation outcomes")) {
    assert.equal(
      cancellationResponse({ result: "Found", cancellation: each.result })
        .status,
      each.status,
    );
  }
  assert.equal(cancellationResponse({ result: "NotFound" }).status, 404);
});

test("notification authorization and reset remain visible without SSE", () => {
  assert.equal(notificationsResponse({ result: "NotFound" }).status, 404);
  assert.deepEqual(
    notificationsResponse({
      result: "Authorized",
      value: { result: "Reset", cursor: 17 },
    }).body,
    { result: "Reset", cursor: 17 },
  );
});

test("inventory exposes only an opaque continuation cursor", () => {
  const found = inventoryResponse({
    projects: [partition],
    nextAfter: partition,
  });
  assert.deepEqual((found.body as { projects: unknown }).projects, [partition]);
  assert.equal(
    typeof (found.body as { nextCursor: unknown }).nextCursor,
    "string",
  );
  assert.equal(JSON.stringify(found.body).includes("nextAfter"), false);
});
