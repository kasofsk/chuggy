import assert from "node:assert/strict";
import { test } from "node:test";

import { nativeHttpClient } from "../../src/adapters/http/client.ts";
import { clientCredentialsTokenSource } from "../../src/adapters/http/clientCredentials.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";

const tokenUrl = "https://auth.example/oauth2/token";

function grantResponse(
  token: string,
  expiresInSeconds: number,
  overrides: Readonly<Record<string, unknown>> = {},
): Response {
  const body = JSON.stringify({
    access_token: token,
    token_type: "bearer",
    expires_in: expiresInSeconds,
    scope: "",
    ...overrides,
  });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body, "utf8")),
    },
  });
}

interface MintedRequest {
  readonly authorization: string | null;
  readonly form: URLSearchParams;
}

function mintingTransport(
  minted: MintedRequest[],
  response: (attempt: number) => Response,
): typeof fetch {
  return async (input, init) => {
    assert.ok(input instanceof URL);
    assert.equal(input.href, tokenUrl);
    assert.equal(init?.method, "POST");
    const form = init?.body;
    assert.equal(typeof form, "string");
    minted.push({
      authorization: new Headers(init?.headers).get("authorization"),
      form: new URLSearchParams(typeof form === "string" ? form : ""),
    });
    return Promise.resolve(response(minted.length));
  };
}

const noAudienceOrScope = { audience: [], scope: [] } as const;

test("the grant is minted with basic authentication, audience and scope", async () => {
  const minted: MintedRequest[] = [];
  const token = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "s3cret",
    audience: ["https://chuggy.example/api"],
    scope: ["offline"],
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    responseReadsMax: 100,
    refreshMarginMs: 1_000,
    fetch: mintingTransport(minted, () => grantResponse("first", 900)),
  });
  assert.equal(await token(AbortSignal.timeout(1_000)), "first");
  assert.equal(minted.length, 1);
  const request = minted[0];
  assert.ok(request !== undefined);
  assert.equal(
    request.authorization,
    `Basic ${Buffer.from("selector:s3cret", "utf8").toString("base64")}`,
  );
  assert.equal(request.form.get("grant_type"), "client_credentials");
  assert.equal(request.form.get("audience"), "https://chuggy.example/api");
  assert.equal(request.form.get("scope"), "offline");
});

test("a held grant is replaced once its refresh margin is reached", async () => {
  const minted: MintedRequest[] = [];
  let nowEpochMs = 1_000_000;
  const token = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "secret",
    ...noAudienceOrScope,
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    responseReadsMax: 100,
    refreshMarginMs: 60_000,
    fetch: mintingTransport(minted, (attempt) =>
      grantResponse(`token-${String(attempt)}`, 900),
    ),
    currentTimeEpochMs: () => nowEpochMs,
  });
  const signal = (): AbortSignal => AbortSignal.timeout(1_000);
  assert.equal(await token(signal()), "token-1");
  nowEpochMs += 839_000;
  assert.equal(await token(signal()), "token-1");
  assert.equal(minted.length, 1);
  nowEpochMs += 2_000;
  assert.equal(await token(signal()), "token-2");
  assert.equal(minted.length, 2);
});

test("a grant shorter than its margin is still held for part of its life", async () => {
  const minted: MintedRequest[] = [];
  let nowEpochMs = 0;
  const token = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "secret",
    ...noAudienceOrScope,
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    responseReadsMax: 100,
    refreshMarginMs: 600_000,
    fetch: mintingTransport(minted, (attempt) =>
      grantResponse(`token-${String(attempt)}`, 10),
    ),
    currentTimeEpochMs: () => nowEpochMs,
  });
  assert.equal(await token(AbortSignal.timeout(1_000)), "token-1");
  nowEpochMs += 4_000;
  assert.equal(await token(AbortSignal.timeout(1_000)), "token-1");
  nowEpochMs += 2_000;
  assert.equal(await token(AbortSignal.timeout(1_000)), "token-2");
  assert.equal(minted.length, 2);
});

test("callers waiting on a replacement share the mint in flight", async () => {
  const minted: MintedRequest[] = [];
  const token = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "secret",
    ...noAudienceOrScope,
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    responseReadsMax: 100,
    refreshMarginMs: 1_000,
    fetch: mintingTransport(minted, (attempt) =>
      grantResponse(`token-${String(attempt)}`, 900),
    ),
  });
  const waiting = [
    token(AbortSignal.timeout(1_000)),
    token(AbortSignal.timeout(1_000)),
    token(AbortSignal.timeout(1_000)),
  ];
  assert.deepEqual(await Promise.all(waiting), [
    "token-1",
    "token-1",
    "token-1",
  ]);
  assert.equal(minted.length, 1);
});

test("a refused mint is not held and the next caller mints again", async () => {
  const minted: MintedRequest[] = [];
  const token = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "secret",
    ...noAudienceOrScope,
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    responseReadsMax: 100,
    refreshMarginMs: 1_000,
    fetch: mintingTransport(minted, (attempt) =>
      attempt === 1
        ? new Response("{}", {
            status: 401,
            headers: { "content-length": "2" },
          })
        : grantResponse("recovered", 900),
    ),
  });
  await assert.rejects(token(AbortSignal.timeout(1_000)), /returned 401/u);
  assert.equal(await token(AbortSignal.timeout(1_000)), "recovered");
  assert.equal(minted.length, 2);
});

test("a grant this client cannot bound or present is refused", async () => {
  const refusals: readonly (readonly [Response, RegExp])[] = [
    [
      new Response(JSON.stringify({ access_token: "t", expires_in: 900 })),
      /token_type|invalid/iu,
    ],
    [grantResponse("t", 900, { token_type: "mac" }), /not a bearer token/u],
    [grantResponse("t", 0), /expires_in|greater/u],
  ];
  for (const [response, expected] of refusals) {
    const token = clientCredentialsTokenSource({
      tokenUrl,
      clientId: "selector",
      clientSecret: "secret",
      ...noAudienceOrScope,
      requestTimeoutMs: 1_000,
      responseBytesMax: 10_000,
      responseReadsMax: 100,
      refreshMarginMs: 1_000,
      fetch: () => Promise.resolve(response),
    });
    await assert.rejects(token(AbortSignal.timeout(1_000)), expected);
  }
});

test("a response longer than the byte bound is refused before it is parsed", async () => {
  const token = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "secret",
    ...noAudienceOrScope,
    requestTimeoutMs: 1_000,
    responseBytesMax: 1,
    responseReadsMax: 100,
    refreshMarginMs: 1_000,
    fetch: () => Promise.resolve(grantResponse("token", 900)),
  });
  await assert.rejects(token(AbortSignal.timeout(1_000)), /byte bound/u);
});

test("an endless empty grant response is refused by the read bound", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array());
    },
  });
  const token = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "secret",
    ...noAudienceOrScope,
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    responseReadsMax: 3,
    refreshMarginMs: 1_000,
    fetch: () => Promise.resolve(new Response(stream)),
  });
  await assert.rejects(token(AbortSignal.timeout(1_000)), /read bound/u);
});

test("the native client presents the replacement token, not the first one", async () => {
  const minted: MintedRequest[] = [];
  let nowEpochMs = 0;
  const presented: (string | null)[] = [];
  const inventory = JSON.stringify({ projects: [] });
  const accessToken = clientCredentialsTokenSource({
    tokenUrl,
    clientId: "selector",
    clientSecret: "secret",
    ...noAudienceOrScope,
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    responseReadsMax: 100,
    refreshMarginMs: 60_000,
    fetch: mintingTransport(minted, (attempt) =>
      grantResponse(`token-${String(attempt)}`, 900),
    ),
    currentTimeEpochMs: () => nowEpochMs,
  });
  const client = nativeHttpClient({
    baseUrl: "https://native.example/",
    accessToken,
    requestTimeoutMs: 1_000,
    responseBytesMax: 10_000,
    fetch: (_input, init) => {
      presented.push(new Headers(init?.headers).get("authorization"));
      return Promise.resolve(
        new Response(inventory, {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    },
  });
  const principal = asPrincipal("selector");
  await client.projectInventory(principal, undefined, 1);
  nowEpochMs += 841_000;
  await client.projectInventory(principal, undefined, 1);
  assert.deepEqual(presented, ["Bearer token-1", "Bearer token-2"]);
});
