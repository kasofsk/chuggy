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
  asCanonicalConfiguration,
  asConfigurationRevisionId,
} from "../../src/interpreter/authoring.ts";
import {
  cancellationResponse,
  configurationCreationResponse,
  configurationResponse,
  configurationsResponse,
  dispatchViewResponse,
  draftCreationResponse,
  draftInitializationResponse,
  draftDeletionResponse,
  draftResponse,
  draftsResponse,
  draftRevisionResponse,
  inventoryResponse,
  notificationsResponse,
  operationResponse,
  projectResponse,
  repositoryConfigurationImportResponse,
  submissionResponse,
} from "../../src/adapters/http/outcomes.ts";
import { draftsResponseSchema } from "../../src/contract/responses.ts";
import { populated } from "../interpreter/roster.ts";
import { id } from "../domain/fixtures.ts";
import { plainAuthoring } from "../actor/harness.ts";

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

test("repository import outcomes distinguish retry, refusal, and conflict", () => {
  assert.equal(
    repositoryConfigurationImportResponse({
      result: "Unavailable",
      unavailable: "Repository",
    }).status,
    503,
  );
  assert.equal(
    repositoryConfigurationImportResponse({
      result: "DeclarationsRefused",
      faults: [{ path: "declaration", fault: "EnvelopeInvalid" }],
    }).status,
    422,
  );
  assert.equal(
    repositoryConfigurationImportResponse({ result: "IdentityConflict" })
      .status,
    409,
  );
  assert.equal(
    repositoryConfigurationImportResponse({ result: "StaleBinding" }).status,
    409,
  );
  assert.equal(
    repositoryConfigurationImportResponse({ result: "Imported" }).status,
    200,
  );
});

test("durable acceptance returns the operation location without a decision", () => {
  const found = submissionResponse(partition, {
    result: "Authorized",
    acceptance: { accepted: "Accepted", operation: standing },
  });
  assert.deepEqual(found, {
    status: 202,
    headers: {
      "cache-control": "no-store",
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
    const found = submissionResponse(partition, {
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

test("an idempotent retry returns the originally accepted operation", () => {
  const found = submissionResponse(partition, {
    result: "Authorized",
    acceptance: { accepted: "Original", operation: standing },
  });
  assert.deepEqual(found.body, {
    operation: "operation/three",
    state: "Pending",
  });
  assert.match(found.headers["location"] ?? "", /operation%2Fthree$/u);
});

test("an idempotent retry may expose a terminal public state only", () => {
  const found = submissionResponse(partition, {
    result: "Authorized",
    acceptance: {
      accepted: "Original",
      operation: { ...standing, state: "Succeeded" },
    },
  });
  assert.deepEqual(found.body, {
    operation: "operation/three",
    state: "Succeeded",
  });
  assert.doesNotMatch(
    JSON.stringify(found.body),
    /ordinal|authority|lifecycle/u,
  );
});

test("retryable refusal carries bounded retry guidance", () => {
  const found = submissionResponse(partition, {
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

test("recent ticket pages expose only an opaque continuation cursor", () => {
  const found = projectResponse({
    result: "Found",
    project: {
      partition,
      sequence: 7,
      tickets: [
        {
          ticket: id(2),
          phase: "Working",
          sequence: 7,
          releasedAt: asPublicInstant("2026-01-01T00:00:00Z"),
          changedAt: asPublicInstant("2026-01-01T00:00:07Z"),
        },
      ],
      nextRecentActivityAfter: { sequence: 7, ticket: id(2) },
    },
  });
  assert.equal(
    typeof (found.body as { nextCursor: unknown }).nextCursor,
    "string",
  );
  assert.equal(
    JSON.stringify(found.body).includes("nextRecentActivityAfter"),
    false,
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

const configuration = {
  partition,
  revision: asConfigurationRevisionId("revision"),
  canonical: asCanonicalConfiguration('{"image":"worker:v1","version":1}'),
  digest: "digest",
};
const draft = {
  partition,
  ticket: id(1),
  authoringVersion: 2,
  state: "Draft" as const,
  configurationRevision: configuration.revision,
  authoring: plainAuthoring,
};

test("configuration outcomes are closed and location-bearing", () => {
  assert.equal(configurationResponse(undefined).status, 404);
  const cases = [
    { value: { created: "Created", revision: configuration }, status: 201 },
    {
      value: { created: "AlreadyExists", revision: configuration },
      status: 200,
    },
    { value: { created: "IdentityConflict" }, status: 409 },
    { value: { created: "ParentNotFound" }, status: 404 },
  ] as const;
  for (const each of populated(cases, "configuration creation outcomes")) {
    assert.equal(
      configurationCreationResponse({
        result: "Authorized",
        value: each.value,
      }).status,
      each.status,
    );
  }
  assert.equal(
    configurationCreationResponse({ result: "NotFound" }).status,
    404,
  );
});

test("configuration pages expose only an opaque continuation cursor", () => {
  const nextAfter = {
    createdAt: asPublicInstant("2026-08-24T12:00:00Z"),
    revision: configuration.revision,
  };
  const found = configurationsResponse({
    result: "Authorized",
    value: { partition, configurations: [], nextAfter },
  });
  assert.equal(found.status, 200);
  assert.equal(
    typeof (found.body as { nextCursor: unknown }).nextCursor,
    "string",
  );
  assert.equal(JSON.stringify(found.body).includes("nextAfter"), false);
  assert.equal(configurationsResponse({ result: "NotFound" }).status, 404);
});

test("draft resources encode sets as stable JSON arrays", () => {
  assert.deepEqual(
    (draftResponse(draft).body as { authoring: { dependencies: unknown } })
      .authoring.dependencies,
    [],
  );
  assert.equal(
    draftCreationResponse({
      result: "Authorized",
      value: { created: "Created", draft },
    }).status,
    201,
  );
});

test("a drafts page names its cursor exactly where it says there is more", () => {
  const answered = draftsResponse({
    result: "Authorized",
    value: { partition, drafts: [draft], nextCursor: draft.ticket, more: true },
  });
  assert.equal(answered.status, 200);
  assert.deepEqual(
    draftsResponseSchema.parse(answered.body).drafts.map((one) => one.ticket),
    [draft.ticket],
  );
  const cursor = (answered.body as { nextCursor: unknown }).nextCursor;
  assert.equal(typeof cursor, "string");
  assert.equal(String(cursor).includes(String(draft.ticket)), false);

  const ended = draftsResponse({
    result: "Authorized",
    value: { partition, drafts: [], more: false },
  });
  assert.equal(
    Object.hasOwn(ended.body as object, "nextCursor"),
    false,
    "a page that ends the collection names no cursor",
  );
  assert.equal(draftsResponse({ result: "NotFound" }).status, 404);
});

test("draft initialization outcomes remain discriminated at HTTP", () => {
  for (const [initialized, status] of [
    ["ConfigurationNotFound", 404],
    ["ConfigurationIncomplete", 409],
    ["PolicyUnavailable", 503],
  ] as const)
    assert.equal(
      draftInitializationResponse({
        result: "Authorized",
        value: { initialized },
      }).status,
      status,
    );
  const response = draftInitializationResponse({
    result: "Authorized",
    value: {
      initialized: "Initialized",
      value: {
        configuration: {
          partition,
          revision: asConfigurationRevisionId("revision"),
          canonical: asCanonicalConfiguration("{}"),
          digest: "a".repeat(64),
        },
        projectSequence: 2,
        defaults: plainAuthoring,
        choices: {
          stages: plainAuthoring.prog,
          programStagesMax: 1,
          workFanouts: [1],
          reworkPolicies: [plainAuthoring.reworkPolicy],
          finalizationPricings: [plainAuthoring.finalizationPricing],
          resumePricings: [plainAuthoring.resumePricing],
          finalizers: [plainAuthoring.finalizer],
        },
        dependencyCandidates: [id(1)],
        dependencyCandidatesTruncated: false,
      },
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual((response.body as { fence: unknown }).fence, {
    projectSequence: 2,
    configurationDigest: "a".repeat(64),
  });
});

test("draft revision and deletion map every closed result", () => {
  const revisions = [
    { value: { revised: "Revised", draft }, status: 200 },
    { value: { revised: "NotFound" }, status: 404 },
    { value: { revised: "Stale", currentVersion: 3 }, status: 409 },
    { value: { revised: "NotDraft", state: "Released" }, status: 409 },
    { value: { revised: "ConfigurationNotFound" }, status: 404 },
  ] as const;
  for (const each of populated(revisions, "draft revision outcomes")) {
    assert.equal(
      draftRevisionResponse({ result: "Authorized", value: each.value }).status,
      each.status,
    );
  }
  const deletions = [
    { value: { deleted: "Deleted", draft }, status: 200 },
    { value: { deleted: "NotFound" }, status: 404 },
    { value: { deleted: "Stale", currentVersion: 3 }, status: 409 },
    { value: { deleted: "NotDraft", state: "Released" }, status: 409 },
  ] as const;
  for (const each of populated(deletions, "draft deletion outcomes")) {
    assert.equal(
      draftDeletionResponse({ result: "Authorized", value: each.value }).status,
      each.status,
    );
  }
});

test("dispatch view authorization preserves reset and page outcomes", () => {
  assert.equal(dispatchViewResponse({ result: "NotFound" }).status, 404);
  assert.deepEqual(
    dispatchViewResponse({
      result: "Authorized",
      value: { result: "Reset" },
    }).body,
    { result: "Reset" },
  );
});
