/**
 * A project's access tokens as the service decides them: who may mint, list
 * and delete, that the maker is the caller, and that the secret leaves only in
 * the mint's answer while the store keeps its digest.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  accessTokenSecretDigest,
  accessTokenSecrets,
} from "../../src/adapters/crypto/accessTokenMint.ts";
import {
  accessTokenPattern,
  accessTokenPrefix,
  type AccessTokenMintRequest,
} from "../../src/contract/accessToken.ts";
import {
  accessTokenService,
  type AccessTokenMinting,
  type AccessTokenRecord,
  type AccessTokenStore,
} from "../../src/interpreter/accessToken.ts";
import type { ProjectAccessKind } from "../../src/interpreter/projectAccess.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { memoryProjectAccess } from "../postgres/projectAccessMemory.ts";

const partition = { tenant: asTenantId("acme"), project: asProjectId("atlas") };
const administrator = asPrincipal("issuer-administrator");
const reader = asPrincipal("issuer-reader");
const stranger = asPrincipal("issuer-stranger");
const request: AccessTokenMintRequest = {
  name: "nightly",
  access: "Read",
  lifetimeDays: 30,
};

/** A store keeping every row it was given, digest included, in mint order. */
function memoryStore(): AccessTokenStore & {
  readonly minted: AccessTokenMinting[];
} {
  const minted: AccessTokenMinting[] = [];
  const recordOf = (row: AccessTokenMinting): AccessTokenRecord => ({
    token: row.token,
    name: row.name,
    access: row.access,
    maker: row.maker,
    createdAt: "2026-11-18T00:00:00.000Z",
    expiresAt: "2026-12-18T00:00:00.000Z",
  });
  const reached = (row: AccessTokenMinting, maker: string | undefined) =>
    maker === undefined || row.maker === maker;
  return {
    minted,
    mint: (_partition, minting) => {
      minted.push(minting);
      return Promise.resolve({ written: "Minted", record: recordOf(minting) });
    },
    listed: (_partition, maker) =>
      Promise.resolve(
        minted
          .filter((row) => reached(row, maker))
          .reverse()
          .map(recordOf),
      ),
    deleted: (_partition, token, maker) => {
      const at = minted.findIndex(
        (row) => row.token === token && reached(row, maker),
      );
      if (at >= 0) minted.splice(at, 1);
      return Promise.resolve(at >= 0);
    },
  };
}

/** The service over `store`, the administrator holding every kind and the reader `readerKinds`. */
function service(
  store: AccessTokenStore,
  readerKinds: readonly ProjectAccessKind[] = ["Read", "MakeAccessTokens"],
) {
  const access = memoryProjectAccess();
  access.grant({
    partition,
    principal: administrator,
    access: new Set(["Read", "Administer", "MakeAccessTokens"]),
  });
  access.grant({ partition, principal: reader, access: new Set(readerKinds) });
  return accessTokenService({ access, store, secrets: accessTokenSecrets() });
}

test("a reader without the permit is refused a mint and nothing is written, and a caller who may not read the project is not told it exists", async () => {
  const store = memoryStore();
  const tokens = service(store, ["Read"]);
  assert.deepEqual(await tokens.mint(reader, partition, request), {
    result: "Forbidden",
  });
  assert.deepEqual(await tokens.mint(stranger, partition, request), {
    result: "NotFound",
  });
  assert.deepEqual(store.minted, []);
});

test("only the mint's answer holds the secret, the store keeps its digest, and the maker is the caller", async () => {
  const store = memoryStore();
  const tokens = service(store);
  const minted = await tokens.mint(reader, partition, request);
  assert.equal(minted.result, "Minted");
  if (minted.result !== "Minted") return;
  assert.match(minted.value.secret, accessTokenPattern);
  assert.equal(minted.value.maker, reader);
  const [kept] = store.minted;
  assert.ok(kept !== undefined);
  assert.equal(kept.maker, reader);
  assert.equal(kept.secretDigest, accessTokenSecretDigest(minted.value.secret));
  assert.equal(JSON.stringify(kept).includes(minted.value.secret), false);
  const listed = JSON.stringify([
    await tokens.listed(reader, partition),
    await tokens.listed(administrator, partition),
  ]);
  assert.equal(listed.includes(minted.value.secret), false);
  assert.equal(listed.includes(kept.secretDigest), false);
});

test("a reader lists only their own tokens, and an administrator every one with its maker", async () => {
  const store = memoryStore();
  const tokens = service(store);
  await tokens.mint(reader, partition, request);
  await tokens.mint(administrator, partition, request);
  const own = await tokens.listed(reader, partition);
  assert.equal(own.result, "Found");
  if (own.result !== "Found") return;
  assert.deepEqual(
    own.value.map((token) => token.maker),
    [reader],
  );
  const every = await tokens.listed(administrator, partition);
  assert.equal(every.result, "Found");
  if (every.result !== "Found") return;
  assert.deepEqual(
    every.value.map((token) => token.maker),
    [administrator, reader],
  );
  assert.deepEqual(await tokens.listed(stranger, partition), {
    result: "NotFound",
  });
});

test("a stranger's delete and a reader's of another's token are not found and delete nothing, and the maker's and an administrator's delete", async () => {
  const store = memoryStore();
  const tokens = service(store);
  await tokens.mint(administrator, partition, request);
  await tokens.mint(reader, partition, request);
  const [administrators, readers] = store.minted.map((row) => row.token);
  assert.ok(administrators !== undefined && readers !== undefined);
  assert.equal(await tokens.deleted(stranger, partition, readers), "NotFound");
  assert.equal(
    await tokens.deleted(reader, partition, administrators),
    "NotFound",
  );
  assert.equal(store.minted.length, 2);
  assert.equal(await tokens.deleted(reader, partition, readers), "Deleted");
  assert.equal(
    await tokens.deleted(administrator, partition, administrators),
    "Deleted",
  );
  assert.deepEqual(store.minted, []);
});

test("a mint naming a lifetime or a name past its bound is refused before anything is asked", async () => {
  const store = memoryStore();
  const tokens = service(store);
  for (const refused of [
    { ...request, lifetimeDays: 367 },
    { ...request, lifetimeDays: 0 },
    { ...request, name: "one\ntwo" },
  ])
    await assert.rejects(tokens.mint(reader, partition, refused), RangeError);
  assert.deepEqual(store.minted, []);
});

test("the digest covers the whole secret, its prefix included", () => {
  const { secret, secretDigest } = accessTokenSecrets().mint();
  assert.ok(secret.startsWith(accessTokenPrefix));
  assert.equal(secretDigest, createHash("sha256").update(secret).digest("hex"));
  assert.notEqual(
    secretDigest,
    createHash("sha256")
      .update(secret.slice(accessTokenPrefix.length))
      .digest("hex"),
  );
  assert.equal(accessTokenSecretDigest(secret), secretDigest);
});

test("two draws share neither identity nor secret", () => {
  const secrets = accessTokenSecrets();
  const first = secrets.mint();
  const second = secrets.mint();
  assert.notEqual(first.token, second.token);
  assert.notEqual(first.secret, second.secret);
});
