/**
 * Where a project's threads and its lead run, over the real boundary and the
 * real administration: what a reader and an administrator are answered, which
 * routes the tenant's hosted grant decides on a write, and which lead
 * offerings the deployment admits.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import { sessionPlacementResponseSchema } from "../../src/contract/responses.ts";
import {
  hostedRunsNotGrantedCode,
  leadOfferingNotAdmittedCode,
  type LeadOffering,
} from "../../src/contract/rosters.ts";
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

/** What the deployment offers, what the project's row keeps, and what its lead offering resolves to. */
interface StoreOffering {
  readonly offered: boolean;
  readonly stored: LeadOffering;
  readonly resolved: LeadOffering;
}

/** A store whose lead is the project's own Pool row, asking runners after the member it was asked about, each standing apart from the others. */
function storeRecording(
  written: SessionPlacementChoice[],
  answered: PlacementWrite = "Written",
  offering: StoreOffering = { offered: false, stored: "Own", resolved: "Own" },
): SessionPlacementStore {
  return {
    leadOffering: () => Promise.resolve(offering.resolved),
    storedLeadOffering: () => Promise.resolve(offering.stored),
    subsidizedLeadOffered: () => Promise.resolve(offering.offered),
    route: (_partition, kind) =>
      Promise.resolve(
        kind === "Thread"
          ? { route: "InCluster", source: "Default" }
          : { route: "Pool", source: "Project" },
      ),
    runners: (_partition, member) =>
      Promise.resolve({
        mine: member === caller ? "Live" : "Unregistered",
        inquiry: member === caller ? "Offline" : "Unregistered",
        project: "Unregistered",
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
  offering?: StoreOffering,
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
    sessionPlacementAdministration(
      access,
      storeRecording(written, "Written", offering),
    ),
  );
}

test("a reader reads each kind's route and source and the runners each would run on, their inquiry's pool apart from their own runner, and chooses nothing", async () => {
  await using app = appOver(["Read"], true);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  assert.deepEqual(sessionPlacementResponseSchema.parse(found.json()), {
    thread: { route: "InCluster", source: "Default" },
    lead: { route: "Pool", source: "Project" },
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

test("an administrator without the hosted grant places sessions on runners and is refused the cluster by its code", async () => {
  const written: SessionPlacementChoice[] = [];
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
  assert.deepEqual(written, [{ Thread: "InCluster", Lead: "InCluster" }]);
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

/** A PUT of one session placement to `app`. */
async function putPlacement(app: ReturnType<typeof appOver>, payload: unknown) {
  return await app.inject({
    method: "PUT",
    url,
    headers: { ...authorized, ...json },
    payload: JSON.stringify(payload),
  });
}

const subsidizedPublished: StoreOffering = {
  offered: true,
  stored: "Own",
  resolved: "Own",
};

test("while the deployment publishes a subsidized lead, an administrator without the hosted grant places the lead on it, and is told the deployment admits it", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(
    ["Read", "Administer"],
    false,
    written,
    subsidizedPublished,
  );
  const placed = await putPlacement(app, {
    thread: "Pool",
    lead: "InCluster",
    leadOffering: "Subsidized",
  });
  assert.equal(placed.statusCode, 200);
  assert.deepEqual(
    sessionPlacementResponseSchema.parse(placed.json()).leadOfferings,
    ["Own", "Subsidized"],
  );
  const hostedThread = await putPlacement(app, {
    thread: "InCluster",
    lead: "InCluster",
    leadOffering: "Subsidized",
  });
  assert.equal(hostedThread.statusCode, 403);
  assert.equal(
    hostedThread.json<HttpErrorEnvelope>().error.code,
    hostedRunsNotGrantedCode,
  );
  assert.deepEqual(written, [
    { Thread: "Pool", Lead: "InCluster", leadOffering: "Subsidized" },
  ]);
});

test("while the deployment publishes none, a subsidized lead is refused by its code, even to an administrator holding the hosted grant, and is not listed", async () => {
  for (const hosted of [false, true]) {
    const written: SessionPlacementChoice[] = [];
    await using app = appOver(["Read", "Administer"], hosted, written);
    const refused = await putPlacement(app, {
      thread: "Pool",
      lead: "InCluster",
      leadOffering: "Subsidized",
    });
    assert.equal(refused.statusCode, 422);
    assert.equal(
      refused.json<HttpErrorEnvelope>().error.code,
      leadOfferingNotAdmittedCode,
    );
    assert.deepEqual(written, []);
    const read = await app.inject({ url, headers: authorized });
    assert.deepEqual(
      sessionPlacementResponseSchema.parse(read.json()).leadOfferings,
      ["Own"],
    );
  }
});

test("a subsidized lead on runners is refused by its code, however the deployment offers it", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(
    ["Read", "Administer"],
    true,
    written,
    subsidizedPublished,
  );
  const refused = await putPlacement(app, {
    thread: "Pool",
    lead: "Pool",
    leadOffering: "Subsidized",
  });
  assert.equal(refused.statusCode, 422);
  assert.equal(
    refused.json<HttpErrorEnvelope>().error.code,
    leadOfferingNotAdmittedCode,
  );
  assert.deepEqual(written, []);
});

test("a write naming no offering keeps a stored subsidized lead without the hosted grant, and moving it to runners needs none either", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(["Read", "Administer"], false, written, {
    offered: true,
    stored: "Subsidized",
    resolved: "Subsidized",
  });
  assert.equal(
    (await putPlacement(app, { thread: "Pool", lead: "InCluster" })).statusCode,
    200,
  );
  assert.equal(
    (await putPlacement(app, { thread: "Pool", lead: "Pool" })).statusCode,
    200,
  );
  assert.deepEqual(written, [
    { Thread: "Pool", Lead: "InCluster" },
    { Thread: "Pool", Lead: "Pool" },
  ]);
});

test("a write naming no offering keeps a stored subsidized lead without the hosted grant while an override resolves it as its own", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(["Read", "Administer"], false, written, {
    offered: true,
    stored: "Subsidized",
    resolved: "Own",
  });
  assert.equal(
    (await putPlacement(app, { thread: "Pool", lead: "InCluster" })).statusCode,
    200,
  );
  assert.deepEqual(written, [{ Thread: "Pool", Lead: "InCluster" }]);
});

test("a write naming no offering keeps a stored subsidized lead only while the deployment publishes one, and is refused by its code otherwise", async () => {
  for (const hosted of [false, true]) {
    const written: SessionPlacementChoice[] = [];
    await using app = appOver(["Read", "Administer"], hosted, written, {
      offered: false,
      stored: "Subsidized",
      resolved: "Own",
    });
    const refused = await putPlacement(app, {
      thread: "Pool",
      lead: "InCluster",
    });
    assert.equal(refused.statusCode, 422);
    assert.equal(
      refused.json<HttpErrorEnvelope>().error.code,
      leadOfferingNotAdmittedCode,
    );
    assert.deepEqual(written, []);
  }
});

test("a write naming no offering for an in-cluster lead its row keeps as its own still needs the hosted grant", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(
    ["Read", "Administer"],
    false,
    written,
    subsidizedPublished,
  );
  const refused = await putPlacement(app, {
    thread: "Pool",
    lead: "InCluster",
  });
  assert.equal(refused.statusCode, 403);
  assert.deepEqual(written, []);
});

test("a reader who does not administer the project is not told it exists by an offering it names", async () => {
  const written: SessionPlacementChoice[] = [];
  await using app = appOver(["Read"], true, written);
  const refused = await putPlacement(app, {
    thread: "Pool",
    lead: "Pool",
    leadOffering: "Subsidized",
  });
  assert.equal(refused.statusCode, 404);
  assert.deepEqual(written, []);
});
