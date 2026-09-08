/**
 * The walk `useLeadTranscript` drives: what it fetches, and what a cleanup it
 * runs for a reason other than unmount must still hand the pane.
 *
 * `abandoned` USED TO MEAN TWO THINGS AT ONCE. The effect's cleanup runs both
 * on unmount and on every rise of `highWaterBatch`, since that dependency is
 * what carries the walk on past a stalled cursor; a page already answered when
 * the second reason fires is still good for the same stream under the same
 * cut, and discarding it on the strength of one flag is what left a fast-moving
 * session's reader watching network traffic that never became an entry.
 */

import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { sessionStorePageBatchesMax } from "../../../src/contract/http.ts";
import type { ApiPorts } from "../app/core/apiRequest.ts";
import { leadTranscriptReadsInFlightMax } from "../app/core/leadTranscript.ts";
import {
  useLeadTranscript,
  type LeadTranscriptRead,
} from "../app/browser/lead/LeadTranscript.tsx";
import {
  leadPartition,
  leadStream,
  leadTranscriptPage,
} from "./leadFixture.ts";

const portsHeld = vi.hoisted(() => ({
  current: undefined as unknown as ApiPorts,
}));

vi.mock("../app/browser/api.ts", () => ({
  useApiPorts: () => portsHeld.current,
}));

function afterAsked(url: string): number {
  return Number(new URL(url, "https://console").searchParams.get("after"));
}

/** Every request answered as soon as it is asked, from the same fixture store
 * the model's own suite walks. */
function settledPorts(batches: number): ApiPorts {
  return {
    fetch: (url) =>
      Promise.resolve({
        status: 200,
        headers: { get: () => null },
        text: () =>
          Promise.resolve(
            JSON.stringify(leadTranscriptPage(afterAsked(url), batches)),
          ),
      } as unknown as Response),
    bearer: () => Promise.resolve("token"),
    sleepMs: () => Promise.resolve(),
  };
}

interface FetchCall {
  readonly url: string;
  readonly respond: (body: unknown, status?: number) => void;
}

/** A store that answers nothing until a case releases the call it names, so a
 * case can hold one round trip open while the hook is driven past it. */
function heldPorts(): {
  readonly ports: ApiPorts;
  readonly calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  return {
    calls,
    ports: {
      fetch: (url) =>
        new Promise<Response>((resolve) => {
          calls.push({
            url,
            respond: (body, status = 200) => {
              resolve({
                status,
                headers: { get: () => null },
                text: () => Promise.resolve(JSON.stringify(body)),
              } as unknown as Response);
            },
          });
        }),
      bearer: () => Promise.resolve("token"),
      sleepMs: () => Promise.resolve(),
    },
  };
}

/** The newest read asked at one cursor, which is the re-walk's where a reset
 * has sent the walk over that cursor again. */
function askedAt(
  calls: readonly FetchCall[],
  after: number,
): FetchCall | undefined {
  return [...calls].reverse().find((call) => afterAsked(call.url) === after);
}

/** One page of a store a case is scripting, carrying one entry. */
function pageAt(
  uuid: string,
  said: { readonly cut?: number; readonly nextAfter?: number },
): unknown {
  return {
    stream: leadStream,
    entries: [{ uuid, type: "assistant", message: { content: [] } }],
    held: [uuid],
    cut: said.cut ?? 1,
    elided: 0,
    truncated: false,
    ...(said.nextAfter === undefined ? {} : { nextAfter: said.nextAfter }),
  };
}

/** An answer moves the walk a step at a time, so the tree is flushed a bounded
 * number of times rather than once. */
const flushesPerAnswer = 6;

/** One held call answered, and the walk let run as far as that answer takes it. */
async function answering(
  call: FetchCall | undefined,
  body: unknown,
  status = 200,
): Promise<void> {
  await act(async () => {
    call?.respond(body, status);
    for (let flush = 0; flush < flushesPerAnswer; flush += 1)
      await Promise.resolve();
  });
}

function readAt(highWaterBatch: number): LeadTranscriptRead {
  return {
    partition: leadPartition,
    session: undefined,
    stream: leadStream,
    highWaterBatch,
  };
}

async function flushed(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

test("a walk pages to the end of the store", async () => {
  portsHeld.current = settledPorts(2);
  const { result } = renderHook(() => useLeadTranscript(readAt(2)));
  await flushed();
  expect(result.current.entries.map((entry) => entry.uuid)).toEqual([
    "uuid-p",
    "uuid-q",
    "uuid-a",
    "uuid-b",
    "uuid-c",
  ]);
});

test("a rise of highWaterBatch mid-page keeps the page the walk already fetched", async () => {
  const held = heldPorts();
  portsHeld.current = held.ports;
  const { result, rerender } = renderHook(
    (read: LeadTranscriptRead) => useLeadTranscript(read),
    { initialProps: readAt(1) },
  );
  await flushed();
  expect(held.calls.length).toBe(1);
  rerender(readAt(2));
  await flushed();
  expect(held.calls.length).toBe(2);
  await act(async () => {
    held.calls[0]?.respond(leadTranscriptPage(0, 2));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(
    result.current.entries.map((entry) => entry.uuid),
    "a page the superseded walk had already fetched was dropped",
  ).toEqual(["uuid-p", "uuid-q"]);
  expect(
    held.calls.length,
    "the superseded walk asked for a further page after being told to stop",
  ).toBe(2);
});

/** A store of many pages, which is the walk this is about: read one after
 * another it is a page's round trip times its length. */
const walkedStoreBatches = 202;

/**
 * The cursors below the mark are the route's own pages, so the walk asks for
 * them at once instead of learning each from the answer before it.
 */
test("a walk asks the cursors below the mark at once", async () => {
  const held = heldPorts();
  portsHeld.current = held.ports;
  renderHook(() => useLeadTranscript(readAt(walkedStoreBatches)));
  await flushed();
  expect(held.calls.length).toBe(leadTranscriptReadsInFlightMax);
  expect(held.calls.map((call) => afterAsked(call.url))).toStrictEqual(
    held.calls.map((_call, at) => at * sessionStorePageBatchesMax),
  );
});

/** A store paging a batch at a time sends the walk to cursors the reads ahead
 * did not predict, and what those reads answered is dropped rather than folded
 * where the walk never asked for it. */
test("a page read ahead at a cursor the walk does not ask is not folded", async () => {
  const held = heldPorts();
  portsHeld.current = held.ports;
  const { result } = renderHook(() =>
    useLeadTranscript(readAt(walkedStoreBatches)),
  );
  await flushed();
  await answering(
    askedAt(held.calls, sessionStorePageBatchesMax),
    pageAt("uuid-ahead", { nextAfter: sessionStorePageBatchesMax * 2 }),
  );
  await answering(
    askedAt(held.calls, 0),
    pageAt("uuid-here", { nextAfter: 1 }),
  );
  await answering(
    askedAt(held.calls, 1),
    pageAt("uuid-next", { nextAfter: 1 }),
  );
  expect(
    result.current.entries.map((entry) => entry.uuid),
    "a page at a cursor the walk never asked for was folded into the pane",
  ).toStrictEqual(["uuid-here", "uuid-next"]);
});

/**
 * A page answered under a cut this pane has not been reading under sends the
 * walk back to the start of the stream, and everything read ahead of it was
 * read under the cut the pane has just abandoned.
 */
test("a reset drops what the walk had read ahead of it", async () => {
  const held = heldPorts();
  portsHeld.current = held.ports;
  const { result } = renderHook(() =>
    useLeadTranscript(readAt(walkedStoreBatches)),
  );
  await flushed();
  const beyond = sessionStorePageBatchesMax * 2;
  const ahead = askedAt(held.calls, beyond);
  await answering(
    askedAt(held.calls, 0),
    pageAt("uuid-first", { nextAfter: sessionStorePageBatchesMax }),
  );
  await answering(
    askedAt(held.calls, sessionStorePageBatchesMax),
    pageAt("uuid-moved", { cut: 9, nextAfter: beyond }),
  );
  await answering(
    ahead,
    pageAt("uuid-stale", { cut: 9, nextAfter: sessionStorePageBatchesMax * 3 }),
  );
  await answering(
    askedAt(held.calls, 0),
    pageAt("uuid-again", { cut: 9, nextAfter: sessionStorePageBatchesMax }),
  );
  await answering(
    askedAt(held.calls, sessionStorePageBatchesMax),
    pageAt("uuid-more", { cut: 9, nextAfter: beyond }),
  );
  await answering(
    askedAt(held.calls, beyond),
    pageAt("uuid-fresh", { cut: 9, nextAfter: beyond }),
  );
  expect(
    held.calls.filter((call) => afterAsked(call.url) === beyond).length,
    "the re-walk took an answer read under the cut the pane had abandoned",
  ).toBe(2);
  expect(
    result.current.entries.map((entry) => entry.uuid),
    "a page read under the cut the pane abandoned was folded into the re-walk",
  ).toStrictEqual(["uuid-again", "uuid-more", "uuid-fresh"]);
});

/** A read ahead that did not answer is the walk's failure when the walk reaches
 * that cursor, and not before: the walk may never ask for it. */
test("a read that failed ahead of the walk is the walk's failure at that cursor", async () => {
  const held = heldPorts();
  portsHeld.current = held.ports;
  const { result } = renderHook(() =>
    useLeadTranscript(readAt(walkedStoreBatches)),
  );
  await flushed();
  await answering(
    askedAt(held.calls, sessionStorePageBatchesMax),
    { error: { code: "InternalError", message: "no" } },
    500,
  );
  expect(
    result.current.failure,
    "a cursor the walk had not reached failed the walk",
  ).toBeUndefined();
  await answering(
    askedAt(held.calls, 0),
    pageAt("uuid-here", { nextAfter: sessionStorePageBatchesMax }),
  );
  expect(result.current.failure).toBeDefined();
  expect(
    held.calls.filter(
      (call) => afterAsked(call.url) === sessionStorePageBatchesMax,
    ).length,
    "the walk read again at a cursor whose answer it already had",
  ).toBe(1);
});

test("an unmount mid-page writes no further state and asks nothing more", async () => {
  const held = heldPorts();
  portsHeld.current = held.ports;
  const { result, unmount } = renderHook(() => useLeadTranscript(readAt(1)));
  await flushed();
  expect(held.calls.length).toBe(1);
  const before = result.current;
  unmount();
  await act(async () => {
    held.calls[0]?.respond(leadTranscriptPage(0, 2));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(
    result.current,
    "a read that answered after unmount changed what the hook had returned",
  ).toBe(before);
  expect(held.calls.length, "an unmounted walk asked for a further page").toBe(
    1,
  );
});
