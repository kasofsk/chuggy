/**
 * Where a project's threads and its lead run, over the real boundary and the
 * real administration: what a reader and an administrator are answered, and
 * which routes the tenant's hosted grant decides on a write.
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
  type SessionPlacementStore,
  type SessionRoutes,
} from "../../src/interpreter/sessionPlacement.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
/** The principal `servedNativeHttpApp` authenticates the valid bearer as. */
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/session-placement";
const authorized = { authorization: "Bearer valid" };
const json = { "content-type": "application/vnd.chuggy.v1+json" };

/** A store whose lead is the project's own Pool row, asking runners after the member it was asked about. */
function storeRecording(
  written: SessionRoutes[],
  answered: PlacementWrite = "Written",
): SessionPlacementStore {
  return {
    route: (_partition, kind) =>
      Promise.resolve(
        kind === "Thread"
          ? { route: "InCluster", source: "Default" }
          : { route: "Pool", source: "Project" },
      ),
    runners: (_partition, member) =>
      Promise.resolve({
        mine: member === caller ? "Live" : "Unregistered",
        project: "Live",
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
  written: SessionRoutes[] = [],
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

test("a reader reads each kind's route and source and the runners each would run on, and chooses nothing", async () => {
  await using app = appOver(["Read"], true);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(sessionPlacementResponseSchema.parse(found.json()), {
    thread: { route: "InCluster", source: "Default" },
    lead: { route: "Pool", source: "Project" },
    choices: [],
    runners: { mine: "Live", project: "Live" },
  });
});

test("a caller who may not read the project is not found", async () => {
  await using app = appOver([], true);
  assert.equal(
    (await app.inject({ url, headers: authorized })).statusCode,
    404,
  );
});

test("an administrator without the hosted grant places sessions on runners and is refused the cluster by its code", async () => {
  const written: SessionRoutes[] = [];
  await using app = appOver(["Read", "Administer"], false, written);
  const put = (payload: unknown) =>
    app.inject({
      method: "PUT",
      url,
      headers: { ...authorized, ...json },
      payload: JSON.stringify(payload),
    });
  const placed = await put({ thread: "Pool", lead: "Pool" });
  assert.equal(placed.statusCode, 200);
  assert.deepEqual(
    sessionPlacementResponseSchema.parse(placed.json()).choices,
    ["Pool"],
  );
  const refused = await put({ thread: "Pool", lead: "InCluster" });
  assert.equal(refused.statusCode, 403);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    hostedRunsNotGrantedCode,
  );
  assert.equal((await put({ thread: "Pool" })).statusCode, 400);
  assert.deepEqual(written, [{ Thread: "Pool", Lead: "Pool" }]);
});

test("an administrator the tenant grants hosted runs places sessions in cluster", async () => {
  const written: SessionRoutes[] = [];
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
  assert.deepEqual(written, [{ Thread: "InCluster", Lead: "InCluster" }]);
});

test("a reader who does not administer the project writes nothing and is not told it exists", async () => {
  const written: SessionRoutes[] = [];
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
