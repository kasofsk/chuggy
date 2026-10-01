/**
 * The hosted-runs route over the real boundary: what a member is answered, what
 * a stranger is, and what an authority that cannot answer becomes on the wire.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import { ProjectAccessUnavailable } from "../../src/interpreter/projectAccess.ts";
import type { ProjectAccess } from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { unaskedNativeWebPorts } from "../interpreter/nativeWebFixtures.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
/** The principal `servedNativeHttpApp` authenticates the valid bearer as. */
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/hosted-runs";
const authorized = { authorization: "Bearer valid" };

function appOver(access: ProjectAccess) {
  const web = nativeWeb(access, ...unaskedNativeWebPorts);
  return servedNativeHttpApp({
    ...unservedNativeWeb,
    hostedRuns: (principal, partition) => web.hostedRuns(principal, partition),
  });
}

function accessOf(standing: {
  readonly reads: boolean;
  readonly hosted: boolean;
}): ProjectAccess {
  const access = memoryProjectAccess();
  if (standing.reads)
    access.grant({ partition, principal: caller, access: new Set(["Read"]) });
  if (standing.hosted)
    access.grantTenant({
      tenant: partition.tenant,
      principal: caller,
      access: new Set(["ExecuteHosted"]),
    });
  return access;
}

test("a member is answered whether their tenant grants them hosted runs", async () => {
  for (const hosted of [true, false]) {
    await using app = appOver(accessOf({ reads: true, hosted }));
    const found = await app.inject({ url, headers: authorized });
    assert.equal(found.statusCode, 200);
    assert.deepEqual(
      nativeHttpEndpoints.hostedRuns.response.parse(found.json()),
      { granted: hosted },
    );
  }
});

test("a caller who may not read the project is not found", async () => {
  await using app = appOver(accessOf({ reads: false, hosted: true }));
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 404);
});

test("a tenant question the authority cannot answer is a 503 a reader may retry", async () => {
  const access = accessOf({ reads: true, hosted: true });
  await using app = appOver({
    ...access,
    authorizeTenant: () =>
      Promise.reject(new ProjectAccessUnavailable("the tenant did not answer")),
  });
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 503);
  assert.equal(found.headers["retry-after"], "1");
});

test("a caller with no bearer is unauthenticated", async () => {
  await using app = appOver(accessOf({ reads: true, hosted: true }));
  const found = await app.inject({ url });
  assert.equal(found.statusCode, 401);
});
