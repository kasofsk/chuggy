/**
 * The deletion routes as the API answers them: what holds a project or a
 * workspace, a deletion answered 204, one refused 409 naming what holds it,
 * and the same miss for a caller who may not delete.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  errorEnvelopeSchema,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import {
  deletionHeldCode,
  projectDeletionResponseSchema,
  tenantDeletionResponseSchema,
} from "../../src/contract/responses.ts";
import type { UnrunDeletions } from "../../src/adapters/http/server.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type {
  ProjectDeletionHolding,
  TenantDeletionHolding,
} from "../../src/interpreter/unrunDeletion.ts";
import { callerApp } from "./callerAppFixture.ts";

const bearer = { authorization: "Bearer valid" };
const administrator = asPrincipal("administrator");
const stranger = asPrincipal("stranger");

/** Deletions answering `administrator` with what `held` names, every other caller absent. */
function deletions(
  projectHeld: readonly ProjectDeletionHolding[],
  tenantHeld: readonly TenantDeletionHolding[],
  asked: string[],
): UnrunDeletions {
  return {
    projects: {
      standing: (principal, partition) => {
        asked.push(`project standing ${partition.tenant}/${partition.project}`);
        return Promise.resolve(
          principal === administrator
            ? { result: "Found", held: projectHeld }
            : { result: "NotFound" },
        );
      },
      delete: (principal, partition) => {
        asked.push(`project delete ${partition.tenant}/${partition.project}`);
        if (principal !== administrator)
          return Promise.resolve({ result: "NotFound" });
        return Promise.resolve(
          projectHeld.length > 0
            ? { result: "Held", held: projectHeld }
            : { result: "Deleted" },
        );
      },
    },
    tenants: {
      standing: (principal, tenant) => {
        asked.push(`tenant standing ${tenant}`);
        return Promise.resolve(
          principal === administrator
            ? { result: "Found", held: tenantHeld }
            : { result: "NotFound" },
        );
      },
      delete: (principal, tenant) => {
        asked.push(`tenant delete ${tenant}`);
        if (principal !== administrator)
          return Promise.resolve({ result: "NotFound" });
        return Promise.resolve(
          tenantHeld.length > 0
            ? { result: "Held", held: tenantHeld }
            : { result: "Deleted" },
        );
      },
    },
  };
}

/** A refusal's envelope, beside the holding it names. */
const projectRefusalSchema = errorEnvelopeSchema.extend({
  held: projectDeletionResponseSchema.shape.held,
});
const tenantRefusalSchema = errorEnvelopeSchema.extend({
  held: tenantDeletionResponseSchema.shape.held,
});

const projectPath = nativeHttpRoutes.projectDeletion
  .replace(":tenant", "acme")
  .replace(":project", "atlas");
const tenantPath = nativeHttpRoutes.tenantDeletion.replace(":tenant", "acme");

test("a project and a workspace nothing holds read as deletable and are deleted", async () => {
  const asked: string[] = [];
  await using app = callerApp(administrator, {
    deletions: deletions([], [], asked),
  });
  const project = await app.inject({ url: projectPath, headers: bearer });
  assert.equal(project.statusCode, 200);
  assert.deepEqual(projectDeletionResponseSchema.parse(project.json()), {
    held: [],
  });
  const tenant = await app.inject({ url: tenantPath, headers: bearer });
  assert.deepEqual(tenantDeletionResponseSchema.parse(tenant.json()), {
    held: [],
  });
  for (const url of [projectPath, tenantPath]) {
    const deleted = await app.inject({
      method: "DELETE",
      url,
      headers: bearer,
    });
    assert.equal(deleted.statusCode, 204, url);
  }
  assert.deepEqual(asked, [
    "project standing acme/atlas",
    "tenant standing acme",
    "project delete acme/atlas",
    "tenant delete acme",
  ]);
});

test("a deletion refused is a conflict naming what holds it", async () => {
  await using app = callerApp(administrator, {
    deletions: deletions(["ReleasedTicket"], ["Project"], []),
  });
  const project = await app.inject({
    method: "DELETE",
    url: projectPath,
    headers: bearer,
  });
  assert.equal(project.statusCode, 409);
  const projectRefused = projectRefusalSchema.parse(project.json());
  assert.equal(projectRefused.error.code, deletionHeldCode);
  assert.deepEqual(projectRefused.held, ["ReleasedTicket"]);
  const tenant = await app.inject({
    method: "DELETE",
    url: tenantPath,
    headers: bearer,
  });
  assert.equal(tenant.statusCode, 409);
  const tenantRefused = tenantRefusalSchema.parse(tenant.json());
  assert.equal(tenantRefused.error.code, deletionHeldCode);
  assert.deepEqual(tenantRefused.held, ["Project"]);
});

test("a caller who may not delete is told neither is there", async () => {
  await using app = callerApp(stranger, {
    deletions: deletions([], [], []),
  });
  for (const url of [projectPath, tenantPath]) {
    const read = await app.inject({ url, headers: bearer });
    assert.equal(read.statusCode, 404, url);
    const deleted = await app.inject({
      method: "DELETE",
      url,
      headers: bearer,
    });
    assert.equal(deleted.statusCode, 404, url);
  }
});
