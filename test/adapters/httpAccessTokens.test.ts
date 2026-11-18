/**
 * A project's access tokens as their routes answer them: what each outcome of
 * the service is sent as, which caller, partition and token each route hands
 * it, and that a mint is read only from a versioned body.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accessTokenMintedResponseSchema,
  accessTokensResponseSchema,
  type AccessTokenMintRequest,
} from "../../src/contract/accessToken.ts";
import { endpointPath } from "../../src/contract/endpoints.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import type {
  AccessTokenDeleted,
  AccessTokenMinted,
  AccessTokenRecord,
  AccessTokenService,
} from "../../src/interpreter/accessToken.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import { callerApp } from "./callerAppFixture.ts";

const caller = asPrincipal("issuer-subject");
const json = { "content-type": nativeHttpMediaType };
const bearer = { authorization: "Bearer valid" };
const partitionParameters = { tenant: "acme", project: "atlas" };
const listUrl = endpointPath(
  nativeHttpRoutes.accessTokens,
  partitionParameters,
);
const secret = `chgp_${"A".repeat(43)}`;

const record: AccessTokenRecord = {
  token: "0190a0c6-0000-7000-8000-000000000001",
  name: "nightly",
  access: "Read",
  maker: caller,
  createdAt: "2026-11-18T00:00:00.000Z",
  expiresAt: "2026-12-18T00:00:00.000Z",
};

const mintBody: AccessTokenMintRequest = {
  name: "nightly",
  access: "Read",
  lifetimeDays: 30,
};

/** A service answering each door as the case sets it, keeping what each was handed. */
function tokens(answers: {
  readonly minted?: AccessTokenMinted;
  readonly deleted?: AccessTokenDeleted;
  readonly listed?: "NotFound";
}): AccessTokenService & { readonly asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    mint: (principal, partition, request) => {
      asked.push(["mint", principal, partition, request]);
      return Promise.resolve(answers.minted ?? { result: "NotFound" });
    },
    listed: (principal, partition) => {
      asked.push(["listed", principal, partition]);
      return Promise.resolve(
        answers.listed === "NotFound"
          ? { result: "NotFound" }
          : { result: "Found", value: [record] },
      );
    },
    deleted: (principal, partition, token) => {
      asked.push(["deleted", principal, partition, token]);
      return Promise.resolve(answers.deleted ?? "NotFound");
    },
  };
}

/** One mint by the caller, of `payload` sent as the API's media type. */
async function minting(
  service: AccessTokenService,
  payload: unknown = mintBody,
) {
  await using app = callerApp(caller, { accessTokens: service });
  return await app.inject({
    method: "POST",
    url: listUrl,
    headers: { ...bearer, ...json },
    payload: JSON.stringify(payload),
  });
}

test("a list answers the reader's tokens, none of them with a secret, after handing the service the caller and the partition", async () => {
  const service = tokens({});
  await using app = callerApp(caller, { accessTokens: service });
  const answered = await app.inject({ url: listUrl, headers: bearer });
  assert.equal(answered.statusCode, 200);
  const body: unknown = answered.json();
  assert.deepEqual(body, { tokens: [record] });
  assert.deepEqual(accessTokensResponseSchema.parse(body), body);
  assert.doesNotMatch(answered.body, /chgp_/u);
  assert.deepEqual(service.asked, [["listed", caller, partitionParameters]]);
});

test("a list the caller may not read is not found", async () => {
  await using app = callerApp(caller, {
    accessTokens: tokens({ listed: "NotFound" }),
  });
  const answered = await app.inject({ url: listUrl, headers: bearer });
  assert.equal(answered.statusCode, 404);
});

test("a mint answers 201 with the token and its secret, the body it read handed to the service", async () => {
  const service = tokens({
    minted: { result: "Minted", value: { ...record, secret } },
  });
  const answered = await minting(service);
  assert.equal(answered.statusCode, 201);
  const body: unknown = answered.json();
  assert.deepEqual(body, { ...record, secret });
  assert.deepEqual(accessTokenMintedResponseSchema.parse(body), body);
  assert.deepEqual(service.asked, [
    ["mint", caller, partitionParameters, mintBody],
  ]);
});

test("each refusal of a mint is its own status and code", async () => {
  for (const [minted, status, code] of [
    [{ result: "NotFound" }, 404, "NotFound"],
    [{ result: "Forbidden" }, 403, "AccessTokenMintForbidden"],
    [{ result: "LimitReached", bound: "Held" }, 409, "AccessTokenLimitReached"],
    [
      { result: "LimitReached", bound: "Project" },
      409,
      "AccessTokenLimitReached",
    ],
    [{ result: "NameTaken" }, 409, "AccessTokenNameTaken"],
  ] as const) {
    const answered = await minting(tokens({ minted }));
    assert.equal(answered.statusCode, status, minted.result);
    assert.equal(
      answered.json<{ error: { code: string } }>().error.code,
      code,
      minted.result,
    );
  }
});

test("a mint whose body is not the API's media type is refused before the service", async () => {
  const service = tokens({});
  await using app = callerApp(caller, { accessTokens: service });
  const answered = await app.inject({
    method: "POST",
    url: listUrl,
    headers: { ...bearer, "content-type": "application/json" },
    payload: JSON.stringify(mintBody),
  });
  assert.equal(answered.statusCode, 415);
  assert.deepEqual(service.asked, []);
});

test("a mint naming a lifetime past its bound, a blank name, a name on two lines or an access no token has is refused before the service", async () => {
  for (const payload of [
    { ...mintBody, lifetimeDays: 367 },
    { ...mintBody, lifetimeDays: 0 },
    { ...mintBody, name: "  " },
    { ...mintBody, name: "one\ntwo" },
    { ...mintBody, name: "n".repeat(65) },
    { ...mintBody, access: "Administer" },
    { ...mintBody, extra: true },
  ]) {
    const service = tokens({});
    const answered = await minting(service, payload);
    assert.equal(answered.statusCode, 400, JSON.stringify(payload));
    assert.deepEqual(service.asked, [], JSON.stringify(payload));
  }
});

test("a delete hands the service the token it names, and answers 204 or not found", async () => {
  for (const [deleted, status] of [
    ["Deleted", 204],
    ["NotFound", 404],
  ] as const) {
    const service = tokens({ deleted });
    await using app = callerApp(caller, { accessTokens: service });
    const answered = await app.inject({
      method: "DELETE",
      url: endpointPath(nativeHttpRoutes.accessToken, {
        ...partitionParameters,
        token: record.token,
      }),
      headers: bearer,
    });
    assert.equal(answered.statusCode, status, deleted);
    assert.deepEqual(service.asked, [
      ["deleted", caller, partitionParameters, record.token],
    ]);
  }
});
