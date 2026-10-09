/**
 * The abilities route over the real boundary: what a member is answered, what
 * a stranger is, and what an authority that cannot answer becomes on the wire.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { nativeWeb } from "../../src/interpreter/nativeWeb.ts";
import {
  ProjectAccessUnavailable,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { unaskedNativeWebPorts } from "../interpreter/nativeWebFixtures.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
/** The principal `servedNativeHttpApp` authenticates the valid bearer as. */
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/abilities";
const authorized = { authorization: "Bearer valid" };

function appOver(access: ProjectAccess) {
  const web = nativeWeb(access, ...unaskedNativeWebPorts);
  return servedNativeHttpApp({
    ...unservedNativeWeb,
    abilities: (principal, partition) => web.abilities(principal, partition),
  });
}

function accessOf(kinds: readonly ProjectAccessKind[]): ProjectAccess {
  const access = memoryProjectAccess();
  access.grant({ partition, principal: caller, access: new Set(kinds) });
  return access;
}

test("a member is answered exactly its abilities", async () => {
  await using app = appOver(accessOf(["Read", "DispatchTicket"]));
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  const body: unknown = found.json();
  assert.deepEqual(body, {
    mutate: false,
    dispatch: true,
    manageSelector: false,
    administer: false,
  });
  assert.deepEqual(nativeHttpEndpoints.abilities.response.parse(body), body);
});

test("a caller who may not read the project is not found", async () => {
  await using app = appOver(accessOf(["Mutate", "Administer"]));
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 404);
});

test("an ability the authority cannot answer is a 503 a reader may retry", async () => {
  const access = accessOf(["Read"]);
  await using app = appOver({
    ...access,
    authorize: (principal, partition, kind) =>
      kind === "Administer"
        ? Promise.reject(new ProjectAccessUnavailable("administer is down"))
        : access.authorize(principal, partition, kind),
  });
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 503);
  assert.equal(found.headers["retry-after"], "1");
});

test("a caller with no bearer is unauthenticated", async () => {
  await using app = appOver(accessOf(["Read"]));
  const found = await app.inject({ url });
  assert.equal(found.statusCode, 401);
});
