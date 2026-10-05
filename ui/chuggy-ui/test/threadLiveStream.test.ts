/**
 * A thread's live client, driven against a server made of strings.
 *
 * What is checked is that the address is the contract's own, that a refusal
 * no later open would be answered differently ends it without another ask,
 * and that everything else — a drop, a frame the contract rejects — is opened
 * again on the transport's ladder and begins from a snapshot.
 *
 * And that the ladder is the one a stream its server cuts needs: a read that
 * fails is a close and throws nothing, an open that handed a frame over is
 * never counted however often it is cut and is asked for more rarely the more
 * of them end soon, and a server with no room is asked again no sooner than
 * it said.
 */

import { expect, test } from "vitest";

import { nativeHttpRoutes } from "../../../src/contract/http.ts";
import type { ThreadLiveStreamEvent } from "../../../src/contract/threadLive.ts";
import {
  openStream,
  streamBusyOpensMax,
  streamDelayMs,
  streamHeaders,
  streamOpenFailuresMax,
  streamReopenDelayMsMax,
  streamReopenDelayMsMin,
  streamStableMs,
} from "../app/core/streamConnection.ts";
import {
  openThreadLiveStream,
  threadLiveUrl,
} from "../app/core/threadLiveStream.ts";
import { frame, streamServer } from "./streamDouble.ts";

const partition = { tenant: "acme", project: "at las" };
const session = "thread/1";

const snapshot = frame("snapshot", undefined, {
  version: 1,
  held: { blocks: [] },
});

function live(event: unknown): string {
  return frame("live", undefined, { version: 1, turn: "turn-1", event });
}

function heard(liveOpenings: Parameters<typeof streamServer>[2]): {
  readonly server: ReturnType<typeof streamServer>;
  readonly events: ThreadLiveStreamEvent[];
  readonly finished: Promise<void>;
} {
  const server = streamServer([], "token", liveOpenings);
  const events: ThreadLiveStreamEvent[] = [];
  const opened = openThreadLiveStream(
    server.ports,
    partition,
    session,
    (event) => events.push(event),
  );
  return { server, events, finished: opened.finished };
}

test("the stream is asked for at the contract's own route", () => {
  const route = nativeHttpRoutes.threadLive
    .replace(":tenant", encodeURIComponent(partition.tenant))
    .replace(":project", encodeURIComponent(partition.project))
    .replace(":session", encodeURIComponent(session));
  expect(threadLiveUrl(partition, session)).toBe(route);
});

test("an open carries the bearer and asks for an event stream", async () => {
  const run = heard([{ status: 200, chunks: [snapshot] }, { status: 404 }]);
  await run.finished;
  expect(run.server.liveSeen[0]).toEqual({
    url: threadLiveUrl(partition, session),
    headers: { accept: "text/event-stream", authorization: "Bearer token" },
  });
});

test("frames are handed over as the contract reads them, in order", async () => {
  const block = { live: "Block", message: "msg_1", index: 0, kind: "Text" };
  const text = {
    live: "Text",
    message: "msg_1",
    index: 0,
    offset: 0,
    text: "Hello",
  };
  const run = heard([
    { status: 200, chunks: [snapshot, live(block), live(text)] },
    { status: 404 },
  ]);
  await run.finished;
  expect(run.events).toEqual([
    { event: "snapshot", data: { version: 1, held: { blocks: [] } } },
    { event: "live", data: { version: 1, turn: "turn-1", event: block } },
    { event: "live", data: { version: 1, turn: "turn-1", event: text } },
  ]);
});

test.each([401, 403, 404])(
  "a %i ends the stream without another ask",
  async (status) => {
    const run = heard([{ status }, { status: 200, chunks: [snapshot] }]);
    await run.finished;
    expect(run.server.liveSeen).toHaveLength(1);
    expect(run.server.delaysMs).toEqual([]);
    expect(run.events).toEqual([]);
  },
);

test("a connection that drops is opened again, and begins from a snapshot", async () => {
  const run = heard([
    { status: 200, chunks: [snapshot] },
    { status: 200, chunks: [snapshot] },
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(3);
  expect(run.server.delaysMs).toEqual([streamDelayMs(1), streamDelayMs(2)]);
  expect(run.events.map((event) => event.event)).toEqual([
    "snapshot",
    "snapshot",
  ]);
});

const text = {
  live: "Text",
  message: "msg_1",
  index: 0,
  offset: 0,
  text: "Hi",
};

test("a read that fails in the middle of a stream is a close: nothing is thrown, and the next open begins from a snapshot", async () => {
  const run = heard([
    { status: 200, chunks: [snapshot, live(text)], cut: true },
    { status: 200, chunks: [snapshot] },
    { status: 404 },
  ]);
  await expect(run.finished).resolves.toBeUndefined();
  expect(run.server.liveSeen).toHaveLength(3);
  expect(run.events.map((event) => event.event)).toEqual([
    "snapshot",
    "live",
    "snapshot",
  ]);
});

test("a stream cut every time soon after its frames is opened again every time, more rarely each time up to the ceiling, and never given up on", async () => {
  const cuts = streamOpenFailuresMax * 3;
  const run = heard([
    ...Array.from({ length: cuts }, () => ({
      status: 200,
      chunks: [snapshot, live(text)],
      cut: true,
    })),
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(cuts + 1);
  expect(run.server.delaysMs).toEqual(
    Array.from({ length: cuts }, (_unused, at) => streamDelayMs(at + 1)),
  );
  expect(run.server.delaysMs[0]).toBe(streamReopenDelayMsMin);
  expect(run.server.delaysMs.at(-1)).toBe(streamReopenDelayMsMax);
  expect(run.events).toHaveLength(cuts * 2);
});

const rejected = frame("live", undefined, {
  version: 2,
  turn: "turn-1",
  event: {},
});

test("a frame the contract rejects after a good snapshot, every time, is asked for on the same ladder and never given up on", async () => {
  const opens = streamOpenFailuresMax + 2;
  const run = heard([
    ...Array.from({ length: opens }, () => ({
      status: 200,
      chunks: [snapshot, rejected],
      hold: true,
    })),
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(opens + 1);
  expect(run.server.delaysMs).toEqual(
    Array.from({ length: opens }, (_unused, at) => streamDelayMs(at + 1)),
  );
});

test("an open whose first frame the contract rejects handed nothing over: a stream whose every snapshot is unreadable is given up on", async () => {
  const run = heard(
    Array.from({ length: streamOpenFailuresMax + 1 }, () => ({
      status: 200,
      chunks: [rejected, snapshot],
      hold: true,
    })),
  );
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(streamOpenFailuresMax);
  expect(run.events).toEqual([]);
});

test("an open that stayed open puts the next that ends soon back on the ladder's floor", async () => {
  const brief = { status: 200, chunks: [snapshot], cut: true };
  const run = heard([
    brief,
    brief,
    { ...brief, lastsMs: streamStableMs },
    brief,
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.delaysMs).toEqual([
    streamDelayMs(1),
    streamDelayMs(2),
    0,
    streamDelayMs(1),
  ]);
});

test("an open that failed between two that ended soon takes no rung from them", async () => {
  const brief = { status: 200, chunks: [snapshot], cut: true };
  const run = heard([brief, { status: 500 }, brief, { status: 404 }]);
  await run.finished;
  expect(run.server.delaysMs).toEqual([
    streamDelayMs(1),
    streamDelayMs(1),
    streamDelayMs(2),
  ]);
});

test("a stream cut once it had stayed open is opened again at once", async () => {
  const run = heard([
    {
      status: 200,
      chunks: [snapshot, live(text)],
      cut: true,
      lastsMs: streamStableMs,
    },
    { status: 200, chunks: [snapshot], lastsMs: streamStableMs },
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.delaysMs).toEqual([0, 0]);
  expect(run.server.liveSeen).toHaveLength(3);
});

test("an open that handed a frame over forgets the opens that failed before it", async () => {
  const failing = Array.from({ length: streamOpenFailuresMax - 1 }, () => ({
    status: 500,
  }));
  const run = heard([
    ...failing,
    { status: 200, chunks: [snapshot], cut: true },
    ...failing,
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(failing.length * 2 + 2);
  expect(run.server.delaysMs.at(-1)).toBe(streamDelayMs(failing.length));
});

test("an open cut before it handed anything over is one that failed", async () => {
  const run = heard(
    Array.from({ length: streamOpenFailuresMax + 1 }, () => ({
      status: 200,
      chunks: [],
      cut: true,
    })),
  );
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(streamOpenFailuresMax);
  expect(run.events).toEqual([]);
});

const noRoom = { status: 503, retryAfter: "7" };

test("a server with no room is asked again no sooner than it said, and the stream it then opens is heard", async () => {
  const run = heard([
    noRoom,
    { status: 200, chunks: [snapshot, live(text)], cut: true },
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.delaysMs).toEqual([7_000, streamReopenDelayMsMin]);
  expect(run.events.map((event) => event.event)).toEqual(["snapshot", "live"]);
});

test("a server with no room is not counted with the opens that failed, and is asked more slowly the longer it has none", async () => {
  const full = streamOpenFailuresMax + 2;
  const run = heard([
    ...Array.from({ length: full }, () => ({ status: 503, retryAfter: "1" })),
    { status: 200, chunks: [snapshot] },
    { status: 404 },
  ]);
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(full + 2);
  expect(run.server.delaysMs.slice(0, full)).toEqual(
    Array.from({ length: full }, (_unused, at) => streamDelayMs(at + 1)),
  );
  expect(run.events.map((event) => event.event)).toEqual(["snapshot"]);
});

test("a wait named past the ladder's ceiling is waited to the ceiling", async () => {
  const run = heard([{ status: 503, retryAfter: "86400" }, { status: 404 }]);
  await run.finished;
  expect(run.server.delaysMs).toEqual([streamReopenDelayMsMax]);
});

test("a server that has no room for long enough is given up on", async () => {
  const run = heard(
    Array.from({ length: streamBusyOpensMax + 1 }, () => noRoom),
  );
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(streamBusyOpensMax);
  expect(run.server.delaysMs).toHaveLength(streamBusyOpensMax - 1);
});

test.each(["soon", "-1", "1.5", ""])(
  "a 503 naming no wait in whole seconds (%j) is an open that failed",
  async (retryAfter) => {
    const run = heard(
      Array.from({ length: streamOpenFailuresMax + 1 }, () => ({
        status: 503,
        retryAfter,
      })),
    );
    await run.finished;
    expect(run.server.liveSeen).toHaveLength(streamOpenFailuresMax);
  },
);

test("a frame the contract rejects ends that connection and hands nothing over", async () => {
  const run = heard([
    { status: 200, chunks: [snapshot, rejected, live({ live: "End" })] },
    { status: 404 },
  ]);
  await run.finished;
  expect(run.events.map((event) => event.event)).toEqual(["snapshot"]);
  expect(run.server.liveSeen).toHaveLength(2);
});

test("a server that will not hold the stream open is given up on", async () => {
  const run = heard(
    Array.from({ length: streamOpenFailuresMax + 1 }, () => ({ status: 503 })),
  );
  await run.finished;
  expect(run.server.liveSeen).toHaveLength(streamOpenFailuresMax);
});

/** The wait a 503 names is read only for a stream that says its server cuts
 * it, which the transport is told and does not assume. */
test("a stream that does not say its server cuts it reads no wait from a 503", async () => {
  const server = streamServer(
    [],
    "token",
    Array.from({ length: streamOpenFailuresMax + 1 }, () => noRoom),
  );
  const opened = openStream(
    server.ports,
    {
      url: threadLiveUrl(partition, session),
      headers: streamHeaders,
      refused: () => undefined,
      opened: () => undefined,
      frame: () => undefined,
    },
    {
      opening: () => undefined,
      waiting: () => undefined,
      stopped: () => undefined,
    },
  );
  await opened.finished;
  expect(server.liveSeen).toHaveLength(streamOpenFailuresMax);
  expect(server.delaysMs[0]).toBe(streamDelayMs(1));
});

test("stopping abandons the request it is reading", async () => {
  const server = streamServer([], "token", [
    { status: 200, chunks: [snapshot], hold: true },
  ]);
  const events: ThreadLiveStreamEvent[] = [];
  const opened = openThreadLiveStream(
    server.ports,
    partition,
    session,
    (event) => events.push(event),
  );
  await expect.poll(() => events.length).toBe(1);
  opened.stop();
  await opened.finished;
  expect(server.aborts).toHaveLength(1);
  expect(server.liveSeen).toHaveLength(1);
});
