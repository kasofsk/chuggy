/**
 * A project's owner fallback as its route answers it, over the administration
 * the API composes: read by anyone who may read the project, written whole by
 * an administrator, and the same miss for a caller who may do neither.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import { projectOwnerFallbackResponseSchema } from "../../src/contract/responses.ts";
import {
  asPrincipal,
  type Principal,
} from "../../src/interpreter/principal.ts";
import {
  memberAuthority,
  type ProjectAccess,
  type ProjectAccessKind,
} from "../../src/interpreter/projectAccess.ts";
import {
  projectOwnerFallbackAdministration,
  type ProjectOwnerFallbackStore,
  type WorkerPoolOwnerFallback,
} from "../../src/interpreter/projectOwnerFallback.ts";
import { projectAccessSiteRefused } from "../interpreter/projectAccessFixture.ts";
import { callerApp } from "./callerAppFixture.ts";

const json = { "content-type": nativeHttpMediaType };
const bearer = { authorization: "Bearer valid" };
const reader = asPrincipal("reader");
const administrator = asPrincipal("administrator");
const stranger = asPrincipal("stranger");

/** The kinds each caller holds on `acme/atlas`, and on no other project. */
const held: ReadonlyMap<Principal, readonly ProjectAccessKind[]> = new Map([
  [reader, ["Read"]],
  [administrator, ["Read", "Administer"]],
]);

const access: ProjectAccess = {
  authorize: (principal, partition, kind) =>
    Promise.resolve(
      partition.tenant === "acme" &&
        partition.project === "atlas" &&
        (held.get(principal) ?? []).includes(kind)
        ? memberAuthority(principal)
        : undefined,
    ),
  authorizeTenant: () => Promise.resolve(undefined),
  authorizeSite: projectAccessSiteRefused,
};

/** One project's row in memory, and every write that reached it. */
function stored(): {
  readonly store: ProjectOwnerFallbackStore;
  readonly writes: (WorkerPoolOwnerFallback | undefined)[];
} {
  let current: WorkerPoolOwnerFallback | undefined;
  const writes: (WorkerPoolOwnerFallback | undefined)[] = [];
  return {
    writes,
    store: {
      fallback: () => Promise.resolve(current),
      write: (_partition, fallback) => {
        writes.push(fallback);
        const unchanged = fallback === current;
        current = fallback;
        return Promise.resolve(unchanged ? "Unchanged" : "Written");
      },
    },
  };
}

function fallbackApp(caller: Principal, store: ProjectOwnerFallbackStore) {
  return callerApp(caller, {
    ownerFallback: projectOwnerFallbackAdministration(access, store),
  });
}

const fallbackPath = nativeHttpRoutes.ownerFallback
  .replace(":tenant", "acme")
  .replace(":project", "atlas");

test("an administrator names a fallback and takes it away, each answer the setting as it now stands", async () => {
  const { store, writes } = stored();
  await using app = fallbackApp(administrator, store);
  const put = (body: object) =>
    app.inject({
      method: "PUT",
      url: fallbackPath,
      headers: { ...bearer, ...json },
      payload: JSON.stringify(body),
    });
  const strict = await put({ fallback: "Strict" });
  assert.equal(strict.statusCode, 200);
  assert.deepEqual(projectOwnerFallbackResponseSchema.parse(strict.json()), {
    fallback: "Strict",
    administers: true,
  });
  const read = await app.inject({ url: fallbackPath, headers: bearer });
  assert.deepEqual(read.json(), { fallback: "Strict", administers: true });
  const absent = await put({});
  assert.equal(absent.statusCode, 200);
  assert.deepEqual(absent.json(), { administers: true });
  assert.deepEqual(writes, ["Strict", undefined]);
});

test("a reader reads the fallback and may not change it", async () => {
  const { store, writes } = stored();
  await using app = fallbackApp(reader, store);
  const read = await app.inject({ url: fallbackPath, headers: bearer });
  assert.equal(read.statusCode, 200);
  assert.deepEqual(read.json(), { administers: false });
  const written = await app.inject({
    method: "PUT",
    url: fallbackPath,
    headers: { ...bearer, ...json },
    payload: JSON.stringify({ fallback: "Preferred" }),
  });
  assert.equal(written.statusCode, 404);
  assert.deepEqual(writes, []);
});

test("a caller who may not read the project is told it is not there, either way", async () => {
  const { store, writes } = stored();
  await using app = fallbackApp(stranger, store);
  const read = await app.inject({ url: fallbackPath, headers: bearer });
  assert.equal(read.statusCode, 404);
  const written = await app.inject({
    method: "PUT",
    url: fallbackPath,
    headers: { ...bearer, ...json },
    payload: JSON.stringify({ fallback: "Strict" }),
  });
  assert.equal(written.statusCode, 404);
  assert.deepEqual(writes, []);
});

test("a fallback the wire does not name, and a caller with no bearer, write nothing", async () => {
  const { store, writes } = stored();
  await using app = fallbackApp(administrator, store);
  const unknown = await app.inject({
    method: "PUT",
    url: fallbackPath,
    headers: { ...bearer, ...json },
    payload: JSON.stringify({ fallback: "Lenient" }),
  });
  assert.equal(unknown.statusCode, 400);
  const unauthenticated = await app.inject({
    method: "PUT",
    url: fallbackPath,
    headers: json,
    payload: JSON.stringify({ fallback: "Strict" }),
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(writes, []);
});
