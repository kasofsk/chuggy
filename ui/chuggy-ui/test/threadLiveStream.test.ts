/**
 * A thread's live client, driven against a server made of strings.
 *
 * What is checked is that the address is the contract's own, that a refusal
 * no later open would be answered differently ends it without another ask,
 * and that everything else — a drop, a frame the contract rejects — is opened
 * again on the transport's ladder and begins from a snapshot.
 */

import { expect, test } from "vitest";

import { nativeHttpRoutes } from "../../../src/contract/http.ts";
import type { ThreadLiveStreamEvent } from "../../../src/contract/threadLive.ts";
import {
  streamDelayMs,
  streamOpenFailuresMax,
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

test("a frame the contract rejects ends that connection and hands nothing over", async () => {
  const run = heard([
    {
      status: 200,
      chunks: [
        snapshot,
        frame("live", undefined, { version: 2, turn: "turn-1", event: {} }),
        live({ live: "End" }),
      ],
    },
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
