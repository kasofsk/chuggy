/**
 * Ordinary HTTP connections held open and read, which is the only way a suite
 * sees a stream: a stream hijacks its reply and never finishes, so an injected
 * request resolves at neither its head nor its frames.
 */

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export interface Held {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  body(): string;
  /** Whether the server has ended the response, which is how a stream ends. */
  closed(): boolean;

  /** Whether the connection failed under the response before it ended, which is what a reset is. */
  failed(): boolean;
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
        let failed = false;
        response.on("error", () => {
          failed = true;
        });
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
          failed: () => failed,
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

/** A connection that asks for a stream and never reads a byte of the answer, which is what a reader that has stopped reading is. */
export function unreading(
  port: number,
  path: string,
  headers: Readonly<Record<string, string>>,
): net.Socket {
  const socket = net.connect({ host: "127.0.0.1", port });
  socket.pause();
  socket.on("error", () => undefined);
  const head = Object.entries({ host: "127.0.0.1", ...headers })
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  socket.write(`GET ${path} HTTP/1.1\r\n${head}\r\n`);
  return socket;
}

/** How many bytes a connection that had read nothing can still read, once it reads until its stream ends or fails. */
export function readOut(socket: net.Socket): Promise<number> {
  return new Promise((resolve) => {
    let bytes = 0;
    socket.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    socket.once("error", () => {
      resolve(bytes);
    });
    socket.once("end", () => {
      resolve(bytes);
    });
    socket.resume();
  });
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

/** The lines the stream has carried whole: the last of what has arrived is a line still arriving, and is not one yet. */
function lines(found: Held): string[] {
  return found.body().split("\n").slice(0, -1);
}

/** Every `data:` payload the stream carried, in the order it carried them. */
export function payloads(found: Held): unknown[] {
  return lines(found)
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice("data: ".length)) as unknown);
}

/** Every `event:` and `id:` line the stream carried, in the order it carried them. */
export function identities(found: Held): string[] {
  return lines(found)
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
