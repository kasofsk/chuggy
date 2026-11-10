/**
 * The landing queues route over its real service and the real project access,
 * with the store beneath them doubled: what a reader is answered, and who is
 * answered nothing.
 *
 * EVERY BODY IS READ THROUGH THE SCHEMA THE ENDPOINT PUBLISHES, and then held
 * whole, so a field the schema would let through and the route should not send
 * fails a case.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { nativeHttpEndpoints } from "../../src/contract/endpoints.ts";
import { nativeHttpRoutes } from "../../src/contract/http.ts";
import { asTicketId } from "../../src/domain/ids.ts";
import {
  landingQueueReads,
  type LandingQueueCandidates,
} from "../../src/interpreter/landingQueues.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import type { SerializedCandidate } from "../../src/interpreter/serializedHolder.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";
import { callerApp } from "./callerAppFixture.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const caller = asPrincipal("issuer geoff");
const url = "/api/v1/tenants/acme/projects/atlas/landing-queues";
const authorized = { authorization: "Bearer valid" };

function candidate(
  ticket: number,
  rank: number,
  target: string | undefined,
): SerializedCandidate {
  return {
    partition,
    ticket: asTicketId(ticket),
    phase: "Finalization",
    finalization: { kind: "GitMerge", mode: "Push", policy: "Serialized" },
    repository: "acme/atlas",
    target,
    rank,
  };
}

/** Two references: one named, held by 3 with 1 behind it, and the default, held by 2. */
const twoReferences: LandingQueueCandidates = {
  candidates: [
    candidate(3, 10, "refs/heads/main"),
    candidate(2, 15, undefined),
    candidate(1, 20, "refs/heads/main"),
  ],
  truncated: false,
};

function appOver(
  access: readonly ProjectAccessKind[],
  answered: LandingQueueCandidates,
  read: string[],
) {
  const project = memoryProjectAccess();
  project.grant({ partition, principal: caller, access: new Set(access) });
  const landingQueues = landingQueueReads({
    access: project,
    store: {
      rankedCandidates: (asked) => {
        read.push(`candidates ${asked.tenant}/${asked.project}`);
        return Promise.resolve(answered);
      },
    },
  });
  return callerApp(caller, { landingQueues });
}

const notFound = {
  error: { code: "NotFound", message: "Resource not found." },
};

test("the route is the one the route table names", () => {
  assert.equal(
    nativeHttpRoutes.landingQueues.replace(/:([a-z]+)/gu, (_whole, name) =>
      name === "tenant" ? "acme" : "atlas",
    ),
    url,
  );
  assert.equal(nativeHttpEndpoints.landingQueues.method, "GET");
  assert.equal(
    nativeHttpEndpoints.landingQueues.path,
    nativeHttpRoutes.landingQueues,
  );
});

test("a reader is answered each queue with its holder and its waiters by number, a target named by none left out", async () => {
  const read: string[] = [];
  await using app = appOver(["Read"], twoReferences, read);
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.statusCode, 200);
  const body: unknown = found.json();
  assert.deepEqual(
    nativeHttpEndpoints.landingQueues.response.parse(body),
    body,
  );
  assert.deepEqual(body, {
    queues: [
      { repository: "acme/atlas", holder: 2, waiting: [] },
      {
        repository: "acme/atlas",
        target: "refs/heads/main",
        holder: 3,
        waiting: [1],
      },
    ],
    truncated: false,
  });
  assert.deepEqual(read, ["candidates acme/atlas"]);
});

test("a project with no queue answers none, and a cut is answered as one", async () => {
  {
    await using app = appOver(
      ["Read"],
      { candidates: [], truncated: false },
      [],
    );
    const found = await app.inject({ url, headers: authorized });
    assert.equal(found.statusCode, 200);
    assert.deepEqual(found.json(), { queues: [], truncated: false });
  }
  await using app = appOver(
    ["Read"],
    { ...twoReferences, truncated: true },
    [],
  );
  const found = await app.inject({ url, headers: authorized });
  assert.equal(found.json<{ readonly truncated: boolean }>().truncated, true);
});

test("a caller who may not read the project is not found, as the ticket list answers one, and nothing is read", async () => {
  for (const held of [
    [],
    ["Administer"],
    ["Mutate", "Execute"],
  ] as readonly ProjectAccessKind[][]) {
    const read: string[] = [];
    await using app = appOver(held, twoReferences, read);
    const found = await app.inject({ url, headers: authorized });
    assert.equal(found.statusCode, 404, held.join());
    assert.deepEqual(found.json(), notFound);
    assert.deepEqual(read, [], held.join());
  }
});

test("a caller who presents no bearer, or one that is not valid, is answered before anything is read", async () => {
  for (const headers of [{}, { authorization: "Bearer other" }]) {
    const read: string[] = [];
    await using app = appOver(["Read"], twoReferences, read);
    const found = await app.inject({ url, headers });
    assert.equal(found.statusCode, 401);
    assert.deepEqual(read, []);
  }
});

test("the route takes no write", async () => {
  await using app = appOver(
    ["Read", "Mutate", "Administer"],
    twoReferences,
    [],
  );
  for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const)
    assert.equal(
      (await app.inject({ method, url, headers: authorized })).statusCode,
      404,
      method,
    );
});
