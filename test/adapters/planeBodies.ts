/**
 * Bodies the job, session and pool plane suites send to ask how a route reads
 * one: a body that never ends, which only a route answering before it reads
 * the body can answer at all, one sent chunked with no media type, and the
 * heaviest JSON a bounded body can be.
 */

import assert from "node:assert/strict";
import http from "node:http";

import type { FastifyInstance } from "fastify";

import type { WorkerPlaneRoute } from "../../src/contract/workerPlane.ts";

/** How long a route's answer is waited on: a cap on a hang, not a measure of speed. */
const planeAnswerWaitMs = 10_000;

/** How often the body that never ends is written another chunk. */
const planeUnendingChunkMs = 10;

const planeUnendingChunk = Buffer.alloc(1_024, "{");

/** One character past the basic plane, which JSON can write as two escapes. */
const planeCharHeaviest = "\u{1F600}";

/** A call carrying the heaviest body a route's caller may send it, and what the route answers once its ports have it. */
export interface PlaneHeaviest {
  readonly rest?: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly payload: string | Buffer;
  readonly status: number;
}

/** What one request was answered with. */
export interface PlaneAnswered {
  readonly status: number;
  readonly body: string;
}

/** Listens `app` on a port of its own, for a case that must reach it over a socket. */
export async function planeListening(app: FastifyInstance): Promise<number> {
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address !== null && typeof address !== "string");
  return address.port;
}

/** What the plane listening at `port` answers a request whose body is still arriving when the answer comes. */
export function planeUnendingAnswered(
  port: number,
  method: string,
  path: string,
  headers: Readonly<Record<string, string>>,
): Promise<PlaneAnswered> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: { ...headers, "transfer-encoding": "chunked" },
      signal: AbortSignal.timeout(planeAnswerWaitMs),
    });
    const writing = setInterval(
      () => request.write(planeUnendingChunk),
      planeUnendingChunkMs,
    );
    request.on("close", () => {
      clearInterval(writing);
    });
    request.on("error", (error) => {
      reject(
        new Error(`${method} ${path} was not answered while its body arrived`, {
          cause: error,
        }),
      );
    });
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString(),
        });
        request.destroy();
      });
    });
  });
}

/** What the plane listening at `port` answers a request with no media type whose body, empty unless `body` names one, is sent chunked, as a proxy may re-send one it was given with a length. */
export function planeChunkedAnswered(
  port: number,
  method: string,
  path: string,
  headers: Readonly<Record<string, string>>,
  body = "",
): Promise<PlaneAnswered> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port,
      method,
      path,
      headers: { ...headers, "transfer-encoding": "chunked" },
      signal: AbortSignal.timeout(planeAnswerWaitMs),
    });
    request.on("error", reject);
    request.on("response", (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });
    request.end(body);
  });
}

/** A text of `chars` characters, each the heaviest JSON can write one as. */
export function planeTextHeaviest(chars: number): string {
  return planeCharHeaviest.repeat(chars);
}

/** `value` as JSON with every character past the basic plane escaped, which is the most a JSON writer can make it weigh. */
export function planeJsonHeaviest(value: unknown): string {
  return JSON.stringify(value).replace(/[\u{10000}-\u{10FFFF}]/gu, (char) =>
    [...Array(char.length).keys()]
      .map((unit) => `\\u${char.charCodeAt(unit).toString(16)}`)
      .join(""),
  );
}

/**
 * Offers each route `heaviest` gives a body its heaviest one as `caller`, which
 * must be answered as the entry says, and then one byte past the route's bound
 * in `served`, which must be refused as too large.
 */
export async function planeHeaviestTaken<Name extends string>(
  app: Pick<FastifyInstance, "inject">,
  routes: Readonly<Record<Name, WorkerPlaneRoute>>,
  served: Readonly<Record<Name, { readonly bodyBytesMax: number }>>,
  heaviest: Readonly<Record<Name, PlaneHeaviest | undefined>>,
  caller: Readonly<Record<string, string>>,
): Promise<void> {
  for (const name of Object.keys(heaviest) as Name[]) {
    const call = heaviest[name];
    if (call === undefined) continue;
    const { method, path } = routes[name];
    const url = path.replace("*", call.rest ?? "");
    const headers = { ...caller, ...call.headers };
    const taken = await app.inject({
      method,
      url,
      headers,
      payload: call.payload,
    });
    assert.equal(taken.statusCode, call.status, `${name}: ${taken.body}`);
    const past = await app.inject({
      method,
      url,
      headers,
      payload: Buffer.alloc(served[name].bodyBytesMax + 1, " "),
    });
    assert.equal(past.statusCode, 413, name);
  }
}
