/**
 * Where a project's threads run, over the real boundary and the real
 * administration: what a reader and an administrator are answered, which
 * routes the tenant's hosted grant decides on a write, and that the lead and
 * offering an older client reads and writes are fixed and ignored.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import { sessionPlacementResponseSchema } from "../../src/contract/responses.ts";
import { hostedRunsNotGrantedCode } from "../../src/contract/rosters.ts";
import type { PlacementWrite } from "../../src/interpreter/placementRoute.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import {
  sessionPlacementAdministration,
  type SessionPlacementChoice,
  type SessionPlacementStore,
} from "../../src/interpreter/sessionPlacement.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
/** The principal `servedNativeHttpApp` authenticates the valid bearer as. */
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/session-placement";
const authorized = { authorization: "Bearer valid" };
const json = { "content-type": "application/vnd.chuggy.v1+json" };

/** A store whose thread routes on the project's own Pool row, asking runners after the member it was asked about, each standing apart from the others. */
function storeRecording(
  written: SessionPlacementChoice[],
  answered: PlacementWrite = "Written",
): SessionPlacementStore {
  return {
    route: () => Promise.resolve({ route: "Pool", source: "Project" }),
    runners: (_partition, member) =>
      Promise.resolve({
        mine: member === caller ? "Live" : "Unregistered",
        inquiry: member === caller ? "Offline" : "Unregistered",
      }),
    write: (_partition, placement) => {
      written.push(placement);
      return Promise.resolve(answered);
    },
  };
}

function appOver(
  project: readonly ProjectAccessKind[],
  hosted: boolean,
  written: SessionPlacementChoice[] = [],
) {
  const access = memoryProjectAccess();
  access.grant({ partition, principal: caller, access: new Set(project) });
  if (hosted)
    access.grantTenant({
      tenant: partition.tenant,
      principal: caller,
      access: new Set(["ExecuteHosted"]),
    });
  return servedNativeHttpApp(
    unservedNativeWeb,
    undefined,
    undefined,
    sessionPlacementAdministration(access, storeRecording(written)),
  );
}

test("a reader reads the thread's route and source, the runners it would run on, the fixed project runners, lead and offering, and chooses nothing", async () => {
  await using app = appOver(["Read"], true);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(sessionPlacementResponseSchema.parse(found.json()), {
    thread: { route: "Pool", source: "Project" },
    lead: { route: "InCluster", source: "Default" },
    leadOffering: "Own",
    leadOfferings: ["Own"],
    choices: [],
    runners: { mine: "Live", inquiry: "Offline", project: "Unregistered" },
  });
});

test("a caller who may not read the project is not found", async () => {
  await using app = appOver([], true);
  assert.equal(
    (await app.inject({ url, headers: authorized })).statusCode,
    404,
  );
});

test("an administrator without the hosted grant places threads on runners, whatever lead it names, and is refused the cluster by its code", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(["Read", "Administer"], false, written);
  const put = (payload: unknown) =>
    app.inject({
      method: "PUT",
      url,
      headers: { ...authorized, ...json },
      payload: JSON.stringify(payload),
    });
  const placed = await put({ thread: "Pool", lead: "InCluster" });
  assert.equal(placed.statusCode, 200);
  assert.deepEqual(
    sessionPlacementResponseSchema.parse(placed.json()).choices,
    ["Pool"],
  );
  const refused = await put({ thread: "InCluster", lead: "Pool" });
  assert.equal(refused.statusCode, 403);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    hostedRunsNotGrantedCode,
  );
  assert.equal((await put({ thread: "Pool" })).statusCode, 400);
  assert.deepEqual(written, [{ Thread: "Pool" }]);
});

test("an administrator the tenant grants hosted runs places threads in cluster", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(["Read", "Administer"], true, written);
  const placed = await app.inject({
    method: "PUT",
    url,
    headers: { ...authorized, ...json },
    payload: JSON.stringify({ thread: "InCluster", lead: "InCluster" }),
  });
  assert.equal(placed.statusCode, 200);
  assert.deepEqual(
    sessionPlacementResponseSchema.parse(placed.json()).choices,
    ["InCluster", "Pool"],
  );
  assert.deepEqual(written, [{ Thread: "InCluster" }]);
});

test("a reader who does not administer the project writes nothing and is not told it exists", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(["Read"], true, written);
  const refused = await app.inject({
    method: "PUT",
    url,
    headers: { ...authorized, ...json },
    payload: JSON.stringify({ thread: "Pool", lead: "Pool" }),
  });
  assert.equal(refused.statusCode, 404);
  assert.deepEqual(written, []);
});

test("a write naming a lead on Pool or a subsidized offering is written, storing only the thread's route, and the read still answers the fixed lead", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(["Read", "Administer"], false, written);
  for (const payload of [
    { thread: "Pool", lead: "Pool" },
    { thread: "Pool", lead: "InCluster", leadOffering: "Subsidized" },
    { thread: "Pool", lead: "Pool", leadOffering: "Subsidized" },
  ]) {
    const placed = await app.inject({
      method: "PUT",
      url,
      headers: { ...authorized, ...json },
      payload: JSON.stringify(payload),
    });
    assert.equal(placed.statusCode, 200, JSON.stringify(payload));
    const body = sessionPlacementResponseSchema.parse(placed.json());
    assert.deepEqual(
      [body.lead, body.leadOffering, body.leadOfferings],
      [{ route: "InCluster", source: "Default" }, "Own", ["Own"]],
    );
  }
  assert.deepEqual(written, [
    { Thread: "Pool" },
    { Thread: "Pool" },
    { Thread: "Pool" },
  ]);
});
