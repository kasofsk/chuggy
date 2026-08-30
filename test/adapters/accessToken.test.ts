import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkedBearerToken,
  presentedAccessToken,
  type AccessTokenSource,
} from "../../src/adapters/http/accessToken.ts";
import { checkedPositiveBound } from "../../src/adapters/http/bounds.ts";
import { nativeHttpClient } from "../../src/adapters/http/client.ts";
import { clientCredentialsTokenSource } from "../../src/adapters/http/clientCredentials.ts";
import { selectorContextHttp } from "../../src/adapters/http/selectorContext.ts";

function countingSource(started: { count: number }): AccessTokenSource {
  return {
    token: (signal) => {
      started.count += 1;
      signal.throwIfAborted();
      return Promise.resolve("token");
    },
    invalidate: () => undefined,
  };
}

test("an already-aborted read never starts the source", async () => {
  const started = { count: 0 };
  await assert.rejects(
    presentedAccessToken(
      countingSource(started),
      AbortSignal.abort(new Error("the caller is gone")),
    ),
    /the caller is gone/u,
  );
  assert.equal(started.count, 0);
});

test("a read the caller can still wait for does start the source", async () => {
  const started = { count: 0 };
  assert.equal(
    await presentedAccessToken(
      countingSource(started),
      AbortSignal.timeout(1_000),
    ),
    "token",
  );
  assert.equal(started.count, 1);
});

test("a bearer token that could not be a header is refused", () => {
  assert.equal(checkedBearerToken("token"), "token");
  for (const refused of ["", "token\r\nx-injected: yes", "token\n"])
    assert.throws(
      () => checkedBearerToken(refused),
      /bearer token is empty or malformed/u,
    );
});

test("a bound that is not a positive safe integer is refused", () => {
  assert.equal(checkedPositiveBound(1, "bound"), 1);
  for (const refused of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 2])
    assert.throws(
      () => checkedPositiveBound(refused, "bound"),
      /bound must be a positive safe integer/u,
    );
});

test("every client here narrows its bounds through that one check", () => {
  const accessToken = countingSource({ count: 0 });
  assert.throws(
    () =>
      nativeHttpClient({
        baseUrl: "https://native.example/",
        accessToken,
        requestTimeoutMs: 0,
        responseBytesMax: 1_000,
      }),
    /must be a positive safe integer/u,
  );
  assert.throws(
    () =>
      selectorContextHttp({
        baseUrl: "https://native.example/",
        accessToken,
        requestTimeoutMs: 1_000,
        responseBytesMax: 1_000,
        responseReadsMax: 0,
      }),
    /must be a positive safe integer/u,
  );
  assert.throws(
    () =>
      clientCredentialsTokenSource({
        tokenUrl: "https://auth.example/oauth2/token",
        clientId: "selector",
        clientSecret: "secret",
        audience: [],
        scope: [],
        requestTimeoutMs: 1_000,
        responseBytesMax: 1_000,
        responseReadsMax: 1_000,
        refreshMarginMs: 1_000,
        refusalFloorMs: 0,
      }),
    /must be a positive safe integer/u,
  );
});
