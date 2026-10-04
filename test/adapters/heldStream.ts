/**
 * Ordinary HTTP connections held open and read, which is the only way a suite
 * sees a stream: a stream hijacks its reply and never finishes, so an injected
 * request resolves at neither its head nor its frames.
 */

import assert from "node:assert/strict";
import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";

export interface Held {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  body(): string;
  /** Whether the server has ended the response, which is how a stream ends. */
  closed(): boolean;
  close(): void;
}

export function held(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>>,
): Promise<Held> {
  return new Promise((resolve, reject) => {
    let body = "";
    const request = http.request(
      { host: "127.0.0.1", port, path, headers },
      (response) => {
        let ended = false;
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          body += chunk;
        });
        response.on("end", () => {
          ended = true;
        });
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: () => body,
          closed: () => ended,
          close: () => {
            request.destroy();
          },
        });
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/** A request the case abandons before any head arrives, which is what a flaky link does. */
export function abandoning(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>>,
): http.ClientRequest {
  const request = http.request({ host: "127.0.0.1", port, path, headers });
  request.on("error", () => undefined);
  request.end();
  return request;
}

const pollAttemptsMax = 400;
const pollIntervalMs = 10;

export async function reaches(reading: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < pollAttemptsMax; attempt += 1) {
    if (reading()) return true;
    await delay(pollIntervalMs);
  }
  return false;
}

/** Every `data:` payload the stream carried, in the order it carried them. */
export function payloads(found: Held): unknown[] {
  return found
    .body()
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}

/** Every `event:` and `id:` line the stream carried, in the order it carried them. */
export function identities(found: Held): string[] {
  return found
    .body()
    .split("\n")
    .filter((line) => line.startsWith("event: ") || line.startsWith("id: "))
    .map((line) => line.trim());
}

/** Asserts an answer is the refusal a stream route at capacity gives, which is no stream. */
export async function assertServerBusy(refused: Held): Promise<void> {
  assert.equal(refused.status, 503);
  assert.equal(refused.headers["retry-after"], "1");
  assert.ok(
    (refused.headers["content-type"] ?? "").includes("vnd.chuggy.v1+json"),
  );
  assert.ok(await reaches(() => refused.body().includes("ServerBusy")));
}
