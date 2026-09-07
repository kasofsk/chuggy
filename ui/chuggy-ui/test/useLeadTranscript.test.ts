/**
 * The lead transcript walk as a hook: what it asks for, and what a rise of the
 * store's own batch count does to a page already in flight.
 *
 * The walk's effect closes over an `abandoned` flag its cleanup sets, and that
 * cleanup runs on every rise of `highWaterBatch` and not only on unmount — a
 * live session writes to the store, which is exactly what raises it, while the
 * walk is still awaiting a page. The case with teeth is the middle one: the
 * page a stale walk was awaiting must still land in the pane, because `pane` is
 * a ref that survives the effect being replaced, and only a real unmount must
 * stop `setHeld` from following it.
 */

import { renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import type { ApiPorts } from "../app/core/apiRequest.ts";
import type { LeadTranscriptResponse } from "../../../src/contract/responses.ts";
import { useLeadTranscript } from "../app/browser/lead/LeadTranscript.tsx";
import type { LeadTranscriptRead } from "../app/browser/lead/LeadTranscript.tsx";
import { settled, turned } from "./screenHarness.tsx";

let currentPorts: ApiPorts = {
  fetch: () => Promise.reject(new Error("no test has scripted a port yet")),
  bearer: () => Promise.resolve("token"),
  sleepMs: () => Promise.resolve(),
};

vi.mock("../app/browser/api.ts", () => ({
  useApiPorts: () => currentPorts,
}));

const partition = { tenant: "acme", project: "atlas" };

function read(stream: string, highWaterBatch: number): LeadTranscriptRead {
  return { partition, session: undefined, stream, highWaterBatch };
}

/** One batch's entry, so a page can be told from an empty one by its uuid. */
function page(
  after: number,
  batches: number,
  stream: string,
): LeadTranscriptResponse {
  const has = after < batches;
  return {
    stream,
    entries: has
      ? [
          {
            uuid: `e${String(after)}`,
            type: "assistant",
            timestamp: "2026-09-01T10:00:00Z",
            message: {
              content: [{ type: "text", text: `entry ${String(after)}` }],
            },
          },
        ]
      : [],
    elided: 0,
    truncated: false,
    ...(has ? { nextAfter: after + 1 } : {}),
  };
}

function fakeResponse(body: unknown): Response {
  return {
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** A server that answers every read the moment it is asked. */
function autoPorts(respond: (after: number) => LeadTranscriptResponse): {
  readonly ports: ApiPorts;
  readonly askedAfters: readonly number[];
} {
  const askedAfters: number[] = [];
  const ports: ApiPorts = {
    fetch: (url: string) => {
      const after = Number(
        new URL(url, "https://console").searchParams.get("after") ?? "0",
      );
      askedAfters.push(after);
      return Promise.resolve(fakeResponse(respond(after)));
    },
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
  return { ports, askedAfters };
}

interface PendingRead {
  readonly after: number;
  readonly settle: (body: LeadTranscriptResponse) => void;
}

/** A server that holds every read open until a case settles it by hand, so a
 * case can move `highWaterBatch` or unmount while one is still in flight. */
function deferredPorts(): {
  readonly ports: ApiPorts;
  readonly pending: readonly PendingRead[];
} {
  const pending: PendingRead[] = [];
  const ports: ApiPorts = {
    fetch: (url: string) => {
      const after = Number(
        new URL(url, "https://console").searchParams.get("after") ?? "0",
      );
      return new Promise<Response>((resolve) => {
        pending.push({
          after,
          settle: (body) => {
            resolve(fakeResponse(body));
          },
        });
      });
    },
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
  return { ports, pending };
}

test("a walk pages to the end of the store and stops", async () => {
  const stream = "stream-full";
  const { ports, askedAfters } = autoPorts((after) => page(after, 3, stream));
  currentPorts = ports;
  const { result, unmount } = renderHook(
    (props: LeadTranscriptRead) => useLeadTranscript(props),
    { initialProps: read(stream, 3) },
  );
  await settled();
  expect(askedAfters).toEqual([0, 1, 2, 3]);
  expect(result.current.entries.map((entry) => entry.uuid)).toEqual([
    "e0",
    "e1",
    "e2",
  ]);
  expect(result.current.failure).toBeUndefined();
  unmount();
});

test("a rise of highWaterBatch mid-page keeps the page the stale walk already fetched, and the walk resumes", async () => {
  const stream = "stream-rise";
  const { ports, pending } = deferredPorts();
  currentPorts = ports;
  const { result, rerender, unmount } = renderHook(
    (props: LeadTranscriptRead) => useLeadTranscript(props),
    { initialProps: read(stream, 2) },
  );
  await settled();
  expect(pending.map((one) => one.after)).toEqual([0]);

  // the store being written mid-page is exactly this: highWaterBatch rises
  // while the first page is still in flight, tearing the walk's effect down
  // and starting a fresh one before the first page has answered. The fresh
  // effect asking again — rather than the walk sitting on the first fetch
  // forever — is the resumption `highWaterBatch` in the dependency list buys.
  rerender(read(stream, 4));
  await settled();
  expect(pending.map((one) => one.after)).toEqual([0, 0]);

  // The stale walk's own fetch answers after its effect was already torn
  // down. Its page is still valid for this stream under this cut, and must
  // land in the pane rather than being discarded.
  await turned(() => pending[0]?.settle(page(0, 4, stream)));
  await settled();

  expect(result.current.entries.map((entry) => entry.uuid)).toEqual(["e0"]);
  expect(result.current.failure).toBeUndefined();

  unmount();
});

test("an unmount mid-page writes no state", async () => {
  const stream = "stream-unmount";
  const { ports, pending } = deferredPorts();
  currentPorts = ports;
  const { result, unmount } = renderHook(
    (props: LeadTranscriptRead) => useLeadTranscript(props),
    { initialProps: read(stream, 2) },
  );
  await settled();
  expect(pending.map((one) => one.after)).toEqual([0]);
  const drawnBeforeUnmount = result.current;

  unmount();
  await turned(() => pending[0]?.settle(page(0, 2, stream)));
  await settled();

  expect(result.current).toBe(drawnBeforeUnmount);
  expect(pending.map((one) => one.after)).toEqual([0]);
});
