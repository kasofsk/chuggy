/**
 * Requests a Flux notification controller sent, kept in
 * `test/fixtures/fluxDeliveries/` as the bytes that arrived, for the suites
 * that read a Flux event as a report.
 *
 * A DELIVERY IS A WHOLE REQUEST, AND ITS HEADERS AND BODY ARE NEVER WRITTEN
 * AGAIN. The signature is of the body as sent, so a suite hands on the bytes
 * the file holds. Its first line names the receiver that captured it, which
 * is the one thing a suite replaces to send it to the report route.
 *
 * TWO ARE CONSTRUCTED, AND NAMED SO. No capture holds a byte Go writes as an
 * escape and none holds an outcome with no origin revision, so each of the
 * two is a captured event changed, written by Go's own encoder and signed as
 * Flux signs.
 *
 * THE KEY NEVER GUARDED ANYTHING. Every signed delivery is signed with the one
 * key of the receiver that captured them, and it is written here.
 *
 * A DELIVERY IS READ AT THE TIME IT ARRIVED. Each is listed with every instant
 * it arrived at by its receiver's clock, a constructed one with its event's
 * own, and a suite sets the scheme's clock from that and never from this
 * machine's.
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";

import type { ActionReportRequest } from "../../src/interpreter/actionReport.ts";

/** The key each signed delivery is signed with. */
export const fluxDeliveryKey = "phase3-experiment-token";

/** Each delivery, and each instant it arrived at: one Flux retried arrived more than once. */
const fluxDeliveryArrivals = {
  "dependency-not-ready": ["2026-10-05T22:45:08.872Z"],
  progressing: ["2026-10-05T22:45:50.761Z"],
  "reconciliation-succeeded": ["2026-10-05T22:45:50.778Z"],
  "health-check-failed": ["2026-10-05T22:49:41.562Z"],
  retried: [
    "2026-10-05T22:36:19.240Z",
    "2026-10-05T22:36:21.241Z",
    "2026-10-05T22:36:25.243Z",
    "2026-10-05T22:36:33.243Z",
  ],
  unsigned: ["2026-10-05T22:45:50.776Z"],
  "unsigned-new-artifact": ["2026-10-05T22:22:42.654Z"],
  "constructed-escaped": ["2026-10-05T22:49:41.000Z"],
  "constructed-no-origin": ["2026-10-05T22:45:50.000Z"],
} as const;

export type FluxDeliveryName = keyof typeof fluxDeliveryArrivals;

export const allFluxDeliveryNames = Object.keys(
  fluxDeliveryArrivals,
) as readonly FluxDeliveryName[];

/** A file holding what a case writes as a key, in a directory of the case's own. */
export function fluxKeyFile(t: TestContext, held: string | Uint8Array): string {
  const root = mkdtempSync(join(tmpdir(), "chuggy-flux-key-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });
  const path = join(root, "token");
  writeFileSync(path, held);
  return path;
}

/** One request as it arrived: its header lines as bytes, the same read as a server reads them, and its body. */
export interface FluxDelivery {
  readonly head: Buffer;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Buffer;
  readonly arrivedAtMs: readonly number[];
}

const lineEnd = "\r\n";

/** Reads one delivery from its file, holding the file to the length its own header states. */
export function fluxDelivery(name: FluxDeliveryName): FluxDelivery {
  const written = readFileSync(
    new URL(`../fixtures/fluxDeliveries/${name}.http`, import.meta.url),
  );
  const headStart = written.indexOf(lineEnd) + lineEnd.length;
  const headEnd = written.indexOf(lineEnd + lineEnd);
  assert.ok(headEnd > headStart, `${name} holds a head and a body`);
  const head = written.subarray(headStart, headEnd);
  const body = written.subarray(headEnd + 2 * lineEnd.length);
  const headers = Object.fromEntries(
    head
      .toString("latin1")
      .split(lineEnd)
      .map((line) => {
        const colon = line.indexOf(": ");
        return [line.slice(0, colon).toLowerCase(), line.slice(colon + 2)];
      }),
  );
  assert.equal(headers["content-length"], String(body.length), name);
  return {
    head,
    headers,
    body,
    arrivedAtMs: fluxDeliveryArrivals[name].map((instant) =>
      Date.parse(instant),
    ),
  };
}

/** The signature Flux sends with a body, under the deliveries' key unless a case names another. */
export function fluxDeliverySignature(
  body: Uint8Array,
  key: string | Uint8Array = fluxDeliveryKey,
): string {
  return `sha256=${createHmac("sha256", key).update(body).digest("hex")}`;
}

/** A delivery that arrived unsigned, under the signature Flux would have sent with it. */
export function fluxDeliverySigned(delivery: FluxDelivery): FluxDelivery {
  const signature = fluxDeliverySignature(delivery.body);
  return {
    ...delivery,
    head: Buffer.concat([
      delivery.head,
      Buffer.from(`${lineEnd}X-Signature: ${signature}`),
    ]),
    headers: { ...delivery.headers, "x-signature": signature },
  };
}

/** A delivery as a scheme is asked of it, addressed to the action a case names. */
export function fluxDeliveryRequest(
  delivery: FluxDelivery,
  address: Pick<ActionReportRequest, "tenant" | "project" | "action">,
): ActionReportRequest {
  return { ...address, headers: delivery.headers, body: delivery.body };
}

/** How long an answer is waited on: a cap on a hang, not a measure of speed. */
const fluxDeliveryAnswerWaitMs = 10_000;

/** What one delivery was answered with. */
export interface FluxDeliveryAnswered {
  readonly status: number;
  readonly body: unknown;
}

/** The answer the bytes received so far hold, once they hold the whole of one. */
function fluxDeliveryAnswer(
  received: Buffer,
): FluxDeliveryAnswered | undefined {
  const headEnd = received.indexOf(lineEnd + lineEnd);
  if (headEnd < 0) return undefined;
  const head = received.subarray(0, headEnd).toString("latin1");
  const length = Number(/^content-length: (\d+)$/imu.exec(head)?.[1]);
  const answered = received.subarray(headEnd + 2 * lineEnd.length);
  if (!(answered.length >= length)) return undefined;
  return {
    status: Number(/^HTTP\/1\.1 (\d+)/u.exec(head)?.[1]),
    body: JSON.parse(answered.subarray(0, length).toString("utf8")),
  };
}

/** Sends a delivery over a connection of its own to `path` of the server at `port`, its header lines and its body as they arrived, and answers what came back. */
export function fluxDeliveryAnswered(
  port: number,
  path: string,
  delivery: FluxDelivery,
): Promise<FluxDeliveryAnswered> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let received = Buffer.alloc(0);
    socket.setTimeout(fluxDeliveryAnswerWaitMs, () => {
      socket.destroy(new Error(`${path} did not answer a delivery`));
    });
    socket.on("error", reject);
    socket.on("data", (chunk: Buffer) => {
      received = Buffer.concat([received, chunk]);
      const answered = fluxDeliveryAnswer(received);
      if (answered === undefined) return;
      socket.destroy();
      resolve(answered);
    });
    socket.write(
      Buffer.concat([
        Buffer.from(`POST ${path} HTTP/1.1${lineEnd}`),
        delivery.head,
        Buffer.from(lineEnd + lineEnd),
        delivery.body,
      ]),
    );
  });
}
