import assert from "node:assert/strict";
import { test } from "node:test";

import {
  failureResponse,
  forgeCredentialResponse,
  inventoryResponse,
  projectRepositoryLandingResponse,
} from "../../src/adapters/http/outcomes.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asForgeInstallationToken } from "../../src/interpreter/forgeInstallation.ts";
import { asRepositoryId } from "../../src/interpreter/finalizer.ts";

test("request shape failures expose bounded validation details", () => {
  const found = failureResponse(new RangeError("repository is absent"));
  assert.equal(found.status, 400);
  assert.deepEqual(found.body, {
    error: { code: "InvalidRequest", message: "repository is absent" },
  });
});

test("inventory continuation remains opaque", () => {
  const partition = {
    tenant: asTenantId("tenant"),
    project: asProjectId("project"),
  };
  const found = inventoryResponse({
    projects: [partition],
    nextAfter: partition,
  });
  assert.equal(found.status, 200);
  assert.equal(
    typeof (found.body as { nextCursor: unknown }).nextCursor,
    "string",
  );
});

test("forge credentials return only the minted value", () => {
  assert.deepEqual(
    forgeCredentialResponse({
      result: "Authorized",
      value: {
        token: asForgeInstallationToken("credential"),
        expiresAtMs: 123,
      },
    }).body,
    { token: "credential", expiresAtMs: 123 },
  );
});

test("repository landing conflicts carry the current binding", () => {
  const repository = {
    repository: asRepositoryId("forge/repository"),
    boundAt: "2026-09-16T00:00:00.000Z",
    landing: { mode: "Push" },
  } as const;
  const found = projectRepositoryLandingResponse({
    result: "LandingMoved",
    repository,
  });
  assert.equal(found.status, 409);
  assert.deepEqual(
    (found.body as { repository: unknown }).repository,
    repository,
  );
});
