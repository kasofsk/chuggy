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

import type { ApiPorts } from "../app/core/apiRequest.ts";
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
  readonly respond: (body: unknown) => void;
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
            respond: (body) => {
              resolve({
                status: 200,
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
