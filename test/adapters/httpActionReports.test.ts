/**
 * The report route over a double of its service: what of a request reaches the
 * service, what each of its answers is sent as, and what the framework refuses
 * before the service is asked.
 *
 * THE BODY IS BYTES AND NOBODY READS THEM FIRST. A reporter may prove itself
 * by a signature over the body as sent, so a body that is not JSON, or not
 * text, must arrive whole and a body the server's own parser would refuse must
 * not be answered for it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { actionReportResponseSchema } from "../../src/contract/actionReport.ts";
import {
  nativeHttpBodyBytesMax,
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import type {
  ActionReported,
  ActionReportRequest,
} from "../../src/interpreter/actionReport.ts";

const reportsPath = "/api/v1/tenants/acme/projects/atlas/actions/build/reports";

/** A port no case here reaches, failing whatever is asked of it and saying so. */
function unserved(calls: string[], port: string): never {
  return new Proxy(
    {},
    {
      get: (_target, method) => () => {
        calls.push(`${port}.${String(method)}`);
        return Promise.reject(new Error(`${port} is not served here`));
      },
    },
  ) as never;
}

/** The app with the report route over a service answering as told, every request it was asked and every other port reached recorded. */
function reportsApp(
  calls: string[],
  asked: ActionReportRequest[],
  result: ActionReported = { result: "Recorded" },
) {
  return createNativeHttpApp(
    unserved(calls, "web"),
    {
      authenticateBearer: (token) => {
        calls.push(`authentication:${token}`);
        return Promise.resolve({ authenticated: "InvalidToken" as const });
      },
    },
    unserved(calls, "readiness"),
    unserved(calls, "installation"),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    unserved(calls, "workerPools"),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      report: (request) => {
        asked.push(request);
        return Promise.resolve(result);
      },
    },
  );
}

test("the route is the one the route table names", () => {
  assert.equal(
    nativeHttpRoutes.actionReports.replace(/:([a-z]+)/gu, (_whole, name) =>
      name === "tenant" ? "acme" : name === "project" ? "atlas" : "build",
    ),
    reportsPath,
  );
});

test("a report reaches the service as its address, its headers and the bytes of its body, under either media type", async () => {
  const sent = Buffer.concat([
    Buffer.from('{ "not": json,\r\n'),
    Buffer.from([0xff, 0x00, 0xfe]),
  ]);
  for (const media of [
    nativeHttpMediaType,
    "application/json",
    "application/json; charset=utf-8",
    `${nativeHttpMediaType}; charset=utf-8`,
  ]) {
    const calls: string[] = [];
    const asked: ActionReportRequest[] = [];
    await using app = reportsApp(calls, asked);
    const answered = await app.inject({
      method: "POST",
      url: "/api/v1/tenants/ac%6De/projects/atlas/actions/build.api-2/reports",
      headers: {
        "content-type": media,
        authorization: "Bearer presented",
        "x-signature": "sha256=0a1b",
      },
      payload: sent,
    });

    assert.equal(answered.statusCode, 200, media);
    assert.deepEqual(calls, [], media);
    const [request] = asked;
    assert.equal(asked.length, 1, media);
    assert.deepEqual(
      [request?.tenant, request?.project, request?.action],
      ["acme", "atlas", "build.api-2"],
    );
    assert.equal(request?.headers["authorization"], "Bearer presented");
    assert.equal(request?.headers["x-signature"], "sha256=0a1b");
    assert.deepEqual(Buffer.from(request?.body ?? []), sent, media);
  }
});

test("a report carrying no body reaches the service as no bytes", async () => {
  for (const headers of [{}, { "content-type": "application/json" }]) {
    const asked: ActionReportRequest[] = [];
    await using app = reportsApp([], asked);
    const answered = await app.inject({
      method: "POST",
      url: reportsPath,
      headers,
    });
    assert.equal(answered.statusCode, 200, JSON.stringify(headers));
    assert.deepEqual(
      asked.map((request) => request.body.length),
      [0],
    );
  }
});

test("each answer of the service is sent as the status a reporter acts on", async () => {
  for (const [result, status, body, retryAfter] of [
    [{ result: "Recorded" }, 200, { report: "Recorded" }, undefined],
    [{ result: "Repeated" }, 200, { report: "Repeated" }, undefined],
    [
      { result: "NotFound" },
      404,
      { error: { code: "NotFound", message: "Resource not found." } },
      undefined,
    ],
    [
      { result: "Refused" },
      422,
      {
        error: {
          code: "ReportRefused",
          message: "The report could not be read.",
        },
      },
      undefined,
    ],
    [
      { result: "Unavailable" },
      503,
      {
        error: {
          code: "ReportUnavailable",
          message: "The request can be retried.",
        },
      },
      "1",
    ],
  ] as const) {
    await using app = reportsApp([], [], result);
    const answered = await app.inject({
      method: "POST",
      url: reportsPath,
      headers: { "content-type": "application/json" },
      payload: "{}",
    });
    assert.equal(answered.statusCode, status, result.result);
    assert.deepEqual(answered.json(), body, result.result);
    assert.equal(answered.headers["retry-after"], retryAfter, result.result);
    assert.equal(answered.headers["cache-control"], "no-store");
    assert.equal(
      actionReportResponseSchema.safeParse(answered.json()).success,
      status === 200,
      result.result,
    );
  }
});

test("the server reads no bearer of its own on the route, and answers none of its requests as unauthenticated", async () => {
  for (const result of [
    { result: "Recorded" },
    { result: "NotFound" },
  ] as const)
    for (const authorization of [undefined, "Bearer presented", "Basic eA=="]) {
      const calls: string[] = [];
      const asked: ActionReportRequest[] = [];
      await using app = reportsApp(calls, asked, result);
      const answered = await app.inject({
        method: "POST",
        url: reportsPath,
        headers: {
          "content-type": "application/json",
          ...(authorization === undefined ? {} : { authorization }),
        },
        payload: "{}",
      });
      assert.notEqual(answered.statusCode, 401, String(authorization));
      assert.equal(answered.headers["www-authenticate"], undefined);
      assert.deepEqual(calls, [], String(authorization));
      assert.equal(asked.length, 1);
    }
});

test("a media type the route does not read is refused before the service is asked", async () => {
  for (const media of [
    "text/plain",
    "application/x-www-form-urlencoded",
    "application/octet-stream",
    "application/jsonp",
    "application/vnd.chuggy.v2+json",
    undefined,
  ]) {
    const asked: ActionReportRequest[] = [];
    await using app = reportsApp([], asked);
    const answered = await app.inject({
      method: "POST",
      url: reportsPath,
      headers: media === undefined ? {} : { "content-type": media },
      payload: "{}",
    });
    assert.equal(answered.statusCode, 415, String(media));
    assert.deepEqual(asked, [], String(media));
  }
});

test("a body is read to the bound every body is and refused past it, before the service is asked", async () => {
  for (const media of [nativeHttpMediaType, "application/json"]) {
    const asked: ActionReportRequest[] = [];
    await using app = reportsApp([], asked);
    const post = (bytes: number) =>
      app.inject({
        method: "POST",
        url: reportsPath,
        headers: { "content-type": media },
        payload: Buffer.alloc(bytes, "x"),
      });

    assert.equal((await post(nativeHttpBodyBytesMax)).statusCode, 200, media);
    const past = await post(nativeHttpBodyBytesMax + 1);
    assert.equal(past.statusCode, 413, media);
    assert.deepEqual(past.json(), {
      error: {
        code: "BodyTooLarge",
        message: "The request body is too large.",
      },
    });
    assert.deepEqual(
      asked.map((request) => request.body.length),
      [nativeHttpBodyBytesMax],
      media,
    );
  }
});

test("the route's parsers are its own: every other route reads a body as it did", async () => {
  const calls: string[] = [];
  await using app = reportsApp(calls, []);
  const post = (media: string, payload: string) =>
    app.inject({
      method: "POST",
      url: nativeHttpRoutes.workerPoolRegistrations,
      headers: { "content-type": media },
      payload,
    });

  const malformed = await post(nativeHttpMediaType, "{");
  assert.equal(malformed.statusCode, 400);
  assert.equal((await post("application/json", "{}")).statusCode, 415);
  assert.equal((await post("text/plain", "{}")).statusCode, 415);
  assert.deepEqual(calls, []);
  await post(
    nativeHttpMediaType,
    JSON.stringify({
      token: "a-token",
      pool: "pool-one",
      capabilities: ["linux-containers"],
    }),
  );
  assert.deepEqual(
    calls,
    ["workerPools.redeem"],
    "a body the server's own parser reads still reaches its route",
  );
});
