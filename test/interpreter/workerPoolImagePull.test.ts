import assert from "node:assert/strict";
import test from "node:test";

import { workerImageCharsMax } from "../../src/contract/workerPool.ts";
import {
  workerPoolImageHosted,
  workerPoolImageHostsRead,
  workerPoolImagePullAllowed,
  workerPoolImagePullRequested,
  type WorkerPoolImagePull,
} from "../../src/interpreter/workerPoolImagePull.ts";

const hex = "0123456789abcdef".repeat(4);
const other = "f".repeat(64);
const digest = `sha256:${hex}`;

const hosts = new Map([
  ["registry.chuggy.internal", "chuggy-registry.invalid"],
]);

/** The image one held assignment pinned, on the internal host. */
const pinned = `registry.chuggy.internal/chuggy/worker@${digest}`;

for (const [method, address, parsed] of [
  ["GET", "/v2/", { pull: "Base" }],
  ["HEAD", "/v2/", { pull: "Base" }],
  [
    "GET",
    `/v2/chuggy/worker/manifests/${digest}`,
    { pull: "Manifest", repository: "chuggy/worker", digest },
  ],
  [
    "HEAD",
    `/v2/chuggy/worker/manifests/${digest}`,
    { pull: "Manifest", repository: "chuggy/worker", digest },
  ],
  [
    "GET",
    `/v2/chuggy/worker/blobs/${digest}`,
    { pull: "Blob", repository: "chuggy/worker", digest },
  ],
  [
    "GET",
    `/v2/a.b_c__d--e/f/blobs/${digest}`,
    { pull: "Blob", repository: "a.b_c__d--e/f", digest },
  ],
  [
    "GET",
    `/v2/chuggy/manifests/blobs/${digest}`,
    { pull: "Blob", repository: "chuggy/manifests", digest },
  ],
] as const)
  test(`${method} ${address} is a pull`, () => {
    assert.deepEqual(workerPoolImagePullRequested(method, address), parsed);
  });

for (const [why, method, address] of [
  ["no method", undefined, "/v2/"],
  ["no address", "GET", undefined],
  ["a write", "PUT", `/v2/chuggy/worker/manifests/${digest}`],
  ["an upload", "POST", "/v2/chuggy/worker/blobs/uploads/"],
  ["a delete", "DELETE", `/v2/chuggy/worker/manifests/${digest}`],
  ["a lowercase method", "get", "/v2/"],
  ["the root", "GET", "/"],
  ["the base without its slash", "GET", "/v2"],
  ["the catalog", "GET", "/v2/_catalog"],
  ["a tag list", "GET", "/v2/chuggy/worker/tags/list"],
  ["referrers", "GET", `/v2/chuggy/worker/referrers/${digest}`],
  ["a manifest by tag", "GET", "/v2/chuggy/worker/manifests/latest"],
  ["a blob upload", "GET", "/v2/chuggy/worker/blobs/uploads/one"],
  [
    "uppercase hex",
    "GET",
    `/v2/chuggy/worker/blobs/sha256:${hex.toUpperCase()}`,
  ],
  ["a short digest", "GET", `/v2/chuggy/worker/blobs/sha256:${hex.slice(1)}`],
  ["a long digest", "GET", `/v2/chuggy/worker/blobs/sha256:${hex}0`],
  ["another algorithm", "GET", `/v2/chuggy/worker/blobs/sha512:${hex}${hex}`],
  ["a query", "GET", `/v2/chuggy/worker/manifests/${digest}?ns=docker.io`],
  ["an empty query", "GET", "/v2/?"],
  ["a fragment", "GET", `/v2/chuggy/worker/blobs/${digest}#top`],
  ["an encoded dot", "GET", `/v2/%2e%2e/chuggy/worker/blobs/${digest}`],
  ["an encoded slash", "GET", `/v2/chuggy%2fworker/blobs/${digest}`],
  ["a climb", "GET", `/v2/other/../chuggy/worker/blobs/${digest}`],
  ["a doubled dot", "GET", `/v2/chuggy..worker/blobs/${digest}`],
  ["an uppercase repository", "GET", `/v2/Chuggy/worker/blobs/${digest}`],
  ["an empty component", "GET", `/v2/chuggy//worker/blobs/${digest}`],
  ["a trailing slash", "GET", `/v2/chuggy/worker/blobs/${digest}/`],
  ["no repository", "GET", `/v2/blobs/${digest}`],
] as const)
  test(`${why} is no pull`, () => {
    assert.equal(workerPoolImagePullRequested(method, address), undefined);
  });

function pull(
  kind: "Manifest" | "Blob",
  repository: string,
  named = digest,
): WorkerPoolImagePull {
  return { pull: kind, repository, digest: named };
}

test("the base is allowed to a pool holding nothing", () => {
  assert.equal(workerPoolImagePullAllowed({ pull: "Base" }, [], hosts), true);
});

test("a manifest is allowed only by the digest a held assignment pinned", () => {
  assert.equal(
    workerPoolImagePullAllowed(
      pull("Manifest", "chuggy/worker"),
      [pinned],
      hosts,
    ),
    true,
  );
  assert.equal(
    workerPoolImagePullAllowed(
      pull("Manifest", "chuggy/worker", `sha256:${other}`),
      [pinned],
      hosts,
    ),
    false,
  );
  assert.equal(
    workerPoolImagePullAllowed(pull("Manifest", "chuggy/api"), [pinned], hosts),
    false,
  );
  assert.equal(
    workerPoolImagePullAllowed(pull("Manifest", "chuggy/worker"), [], hosts),
    false,
  );
});

test("a blob is allowed from the repository of a held image, whatever its digest", () => {
  assert.equal(
    workerPoolImagePullAllowed(
      pull("Blob", "chuggy/worker", `sha256:${other}`),
      [pinned],
      hosts,
    ),
    true,
  );
  assert.equal(
    workerPoolImagePullAllowed(pull("Blob", "chuggy/api"), [pinned], hosts),
    false,
  );
  for (const repository of ["chuggy", "chuggy/worker/cache", "chuggy/workers"])
    assert.equal(
      workerPoolImagePullAllowed(pull("Blob", repository), [pinned], hosts),
      false,
      repository,
    );
});

test("a held image counts only on a host the plane publishes", () => {
  for (const image of [
    `docker.io/chuggy/worker@${digest}`,
    `chuggy-registry.invalid/chuggy/worker@${digest}`,
    `chuggy/worker@${digest}`,
  ])
    assert.equal(
      workerPoolImagePullAllowed(
        pull("Manifest", "chuggy/worker"),
        [image],
        hosts,
      ),
      false,
      image,
    );
  assert.equal(
    workerPoolImagePullAllowed(
      pull("Manifest", "chuggy/worker"),
      [pinned],
      new Map(),
    ),
    false,
  );
});

test("a held image counts only where it is pinned by digest, a tag beside the digest being no difference", () => {
  assert.equal(
    workerPoolImagePullAllowed(
      pull("Manifest", "chuggy/worker"),
      [`registry.chuggy.internal/chuggy/worker:v1@${digest}`],
      hosts,
    ),
    true,
  );
  for (const image of [
    "registry.chuggy.internal/chuggy/worker:v1",
    "registry.chuggy.internal/chuggy/worker",
    `registry.chuggy.internal/chuggy/worker@sha256:${hex.toUpperCase()}`,
  ])
    assert.equal(
      workerPoolImagePullAllowed(pull("Blob", "chuggy/worker"), [image], hosts),
      false,
      image,
    );
});

test("an image on a published host is named by its public host, its path and digest unchanged", () => {
  assert.equal(
    workerPoolImageHosted(pinned, hosts),
    `chuggy-registry.invalid/chuggy/worker@${digest}`,
  );
  const ported = new Map([["registry.invalid:5000", "public.invalid"]]);
  assert.equal(
    workerPoolImageHosted(`registry.invalid:5000/worker@${digest}`, ported),
    `public.invalid/worker@${digest}`,
  );
});

test("an image whose public name would pass the bound an assignment carries keeps its internal name", () => {
  const longer = new Map([
    ["short.invalid", "a-much-longer-public-host.invalid"],
  ]);
  const path = `/${"a".repeat(workerImageCharsMax)}`.slice(
    0,
    workerImageCharsMax - "short.invalid".length - `@${digest}`.length,
  );
  const atBound = `short.invalid${path}@${digest}`;
  assert.equal(atBound.length, workerImageCharsMax);
  assert.equal(workerPoolImageHosted(atBound, longer), atBound);
  const within = `short.invalid${path.slice(0, -40)}@${digest}`;
  assert.equal(
    workerPoolImageHosted(within, longer),
    `a-much-longer-public-host.invalid${path.slice(0, -40)}@${digest}`,
  );
});

test("an image on any other host passes untouched", () => {
  for (const image of [
    `docker.io/chuggy/worker@${digest}`,
    "worker:v1",
    `registry.chuggy.internal.evil/chuggy/worker@${digest}`,
    `evil/registry.chuggy.internal/worker@${digest}`,
    "registry.chuggy.internal",
  ])
    assert.equal(workerPoolImageHosted(image, hosts), image);
  assert.equal(workerPoolImageHosted(pinned, new Map()), pinned);
});

test("an unset image-host setting publishes no host", () => {
  assert.deepEqual(workerPoolImageHostsRead(undefined), {
    read: "Hosts",
    hosts: new Map(),
  });
});

test("an image-host setting reads each internal host to its public one", () => {
  assert.deepEqual(
    workerPoolImageHostsRead(
      JSON.stringify({
        "registry.chuggy.internal": "chuggy-registry.invalid",
        "registry.invalid:5000": "localhost:5000",
        localhost: "127.0.0.1:5000",
      }),
    ),
    {
      read: "Hosts",
      hosts: new Map([
        ["registry.chuggy.internal", "chuggy-registry.invalid"],
        ["registry.invalid:5000", "localhost:5000"],
        ["localhost", "127.0.0.1:5000"],
      ]),
    },
  );
  assert.deepEqual(workerPoolImageHostsRead("{}"), {
    read: "Hosts",
    hosts: new Map(),
  });
});

for (const text of [
  "",
  "registry.chuggy.internal=chuggy-registry.invalid",
  "[]",
  "null",
  '"registry.chuggy.internal"',
  '{"registry.chuggy.internal":5000}',
  '{"registry.chuggy.internal":null}',
  '{"registry.chuggy.internal":""}',
  '{"":"chuggy-registry.invalid"}',
  '{"registry":"chuggy-registry.invalid"}',
  '{"registry.chuggy.internal":"chuggy-registry"}',
  '{"registry.chuggy.internal/chuggy":"chuggy-registry.invalid"}',
  '{"registry.chuggy.internal":"https://chuggy-registry.invalid"}',
  '{"registry.chuggy.internal":"chuggy-registry.invalid/"}',
  '{"registry..internal":"chuggy-registry.invalid"}',
  '{"-registry.internal":"chuggy-registry.invalid"}',
  '{"registry.internal:port":"chuggy-registry.invalid"}',
  '{"__proto__":"chuggy-registry.invalid"}',
])
  test(`an image-host setting of ${JSON.stringify(text)} is refused`, () => {
    assert.equal(workerPoolImageHostsRead(text).read, "Refused");
  });
