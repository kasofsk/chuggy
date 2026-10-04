/**
 * The thread live route over a real socket: what a reader is answered with
 * before a stream exists, and what it reads once one does.
 *
 * The hub is the real one and only its lane is a double, so a case speaks as
 * the lane and reads what the socket carried.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { threadLiveFramed } from "../../src/adapters/http/eventStream.ts";
import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { systemStreamTimers } from "../../src/adapters/runtime/systemStreamTimers.ts";
import {
  nativeHttpRoutes,
  sessionLiveBlockCharsMax,
  sessionLiveBlocksMax,
} from "../../src/contract/http.ts";
import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";
import {
  parseThreadLiveEvent,
  threadLiveNothing,
  threadLiveVersion,
  type ThreadLiveStreamEvent,
} from "../../src/contract/threadLive.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import { asPublicInstant } from "../../src/interpreter/publicResource.ts";
import {
  threadLiveHub,
  threadLiveLimitsDefault,
  type ThreadLiveHub,
  type ThreadLiveLimits,
  type ThreadLiveWatcher,
} from "../../src/interpreter/threadLive.ts";
import { partitionOf } from "../interpreter/projectStreamHarness.ts";
import {
  abandoning,
  assertServerBusy,
  held,
  identities,
  payloads,
  reaches,
  readOut,
  unreading,
  type Held,
} from "./heldStream.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

const partition = partitionOf("project");
const session = asSessionId("thread-1");
const turn = asSessionTurnId("turn-1");
const authorized = { authorization: "Bearer valid" };
const principal = asPrincipal("issuer-subject");

function pathOf(of: SessionId = session, tenant = "tenant"): string {
  return nativeHttpRoutes.threadLive
    .replace(":tenant", tenant)
    .replace(":project", "project")
    .replace(":session", of);
}

const begun: SessionLiveEvent = {
  live: "Block",
  message: "message-1",
  index: 0,
  kind: "Text",
};

function text(offset: number, written: string): SessionLiveEvent {
  return {
    live: "Text",
    message: "message-1",
    index: 0,
    offset,
    text: written,
  };
}

interface Served {
  readonly port: number;

  /** What the thread read was asked each time it was asked. */
  readonly asked: unknown[];

  /** What the hub noted, by name, in the order it noted it. */
  readonly noted: string[];
  hear(event: SessionLiveEvent, of?: SessionId): void;

  /** Makes every later thread read answer that the thread is not the caller's to read. */
  refuses(): void;

  /** How many sockets the server holds open. */
  connections(): Promise<number>;

  /** Closes the hub and leaves the server serving, which is the first thing a stopping root does. */
  stops(): Promise<void>;
  close(): Promise<void>;
}

interface Serving {
  found?: boolean;
  readonly limits?: Partial<ThreadLiveLimits>;
  readonly expiresInMs?: number;
  readonly concurrentRequestsMax?: number;

  /** Holds every thread read until it settles. */
  readonly reading?: Promise<void>;
  readonly composed?: boolean;
}

type ServedWeb = Parameters<typeof createNativeHttpApp>[0];

/** A boundary serving the thread read alone, recording what it was asked. */
function threadWeb(options: Serving, asked: unknown[]): ServedWeb {
  return {
    ...unservedNativeWeb,
    thread: async (reader, read, of, query) => {
      asked.push({ reader, read, of, query });
      await options.reading;
      return options.found === false
        ? { result: "NotFound" }
        : {
            result: "Found",
            thread: {
              state: "Open",
              session: of,
              hidden: false,
              turns: 0,
              mine: true,
              lastActivityAt: asPublicInstant("2026-10-03T10:00:00Z"),
              openedAt: asPublicInstant("2026-10-03T09:00:00Z"),
            },
            turns: [],
            streams: [],
          };
    },
  };
}

/** The app over `web`, admitting one bearer, with `hub` as its thread live hub where a case composes one. */
function servedApp(options: Serving, web: ServedWeb, hub?: ThreadLiveHub) {
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: {
                  principal,
                  ...(options.expiresInMs === undefined
                    ? {}
                    : { expiresAtMs: Date.now() + options.expiresInMs }),
                },
              }
            : { authenticated: "InvalidToken" as const },
        ),
    },
    { ready: () => Promise.resolve(true) },
    {
      installationAuthority: () =>
        Promise.resolve(
          asInstallationId("018f84a1-4c2b-7def-8abc-0123456789ab"),
        ),
    },
    {
      concurrentRequestsMax: options.concurrentRequestsMax ?? 64,
      requestTimeoutMs: 15_000,
    },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    hub,
  );
}

async function served(serving: Serving = {}): Promise<Served> {
  const options = { ...serving };
  const asked: unknown[] = [];
  const noted: string[] = [];
  let watcher: ThreadLiveWatcher | undefined;
  const hub = threadLiveHub({
    lane: {
      open: (opened) => {
        watcher = opened;
      },
      close: () => Promise.resolve(),
    },
    timers: systemStreamTimers,
    report: { noted: (note) => noted.push(note.note) },
    framed: threadLiveFramed,
    limits: { ...threadLiveLimitsDefault, ...options.limits },
  });
  const app = servedApp(
    options,
    threadWeb(options, asked),
    options.composed === false ? undefined : hub,
  );
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {
    port: address.port,
    asked,
    noted,
    hear: (event, of = session) =>
      watcher?.heard({ partition, session: of, turn, event }),
    refuses: () => {
      options.found = false;
    },
    connections: () =>
      new Promise((resolve, reject) => {
        app.server.getConnections((failure, count) => {
          if (failure === null) resolve(count);
          else reject(failure);
        });
      }),
    stops: () => hub.close(),
    close: async () => {
      await hub.close();
      await app.close();
    },
  };
}

const open: Held[] = [];
const running: Served[] = [];

async function rigOf(options: Serving = {}): Promise<Served> {
  const rig = await served(options);
  running.push(rig);
  return rig;
}

async function stream(
  rig: Served,
  path = pathOf(),
  headers: Readonly<Record<string, string>> = authorized,
): Promise<Held> {
  const found = await held(rig.port, path, headers);
  open.push(found);
  return found;
}

after(async () => {
  for (const found of open) found.close();
  for (const rig of running) await rig.close();
});

/** Every whole frame the stream carried, each read as the contract reads one. */
function frames(found: Held): ThreadLiveStreamEvent[] {
  return found
    .body()
    .split("\n\n")
    .slice(0, -1)
    .filter((frame) => frame.startsWith("event: "))
    .map((frame) => {
      const [named = "", data = ""] = frame.split("\n");
      return parseThreadLiveEvent({
        event: named.slice("event: ".length),
        data: JSON.parse(data.slice("data: ".length)) as unknown,
      });
    });
}

function carried(found: Held, count: number): Promise<boolean> {
  return reaches(() => frames(found).length >= count);
}

const nothing: ThreadLiveStreamEvent = {
  event: "snapshot",
  data: { version: threadLiveVersion, held: threadLiveNothing },
};

test("a thread live stream without a bearer is refused before a stream exists", async () => {
  const rig = await rigOf();
  const refused = await stream(rig, pathOf(), {});
  assert.equal(refused.status, 401);
  assert.ok(!(refused.headers["content-type"] ?? "").includes("event-stream"));
  assert.deepEqual(rig.asked, []);
});

test("who may listen is who may read: the thread read is asked as the caller, and its refusal is the route's", async () => {
  const rig = await rigOf({ found: false });
  const refused = await stream(rig);
  assert.equal(refused.status, 404);
  assert.ok(
    (refused.headers["content-type"] ?? "").includes("vnd.chuggy.v1+json"),
  );
  assert.ok(await reaches(() => refused.body().includes("NotFound")));
  assert.deepEqual(rig.asked, [
    { reader: principal, read: partition, of: session, query: { limit: 1 } },
  ]);
});

test("a reader is answered with an unbuffered event stream head, and its first frame is a snapshot of what is held", async () => {
  const rig = await rigOf();
  rig.hear(begun);
  rig.hear(text(0, "Hel"));
  const opened = await stream(rig);
  assert.equal(opened.status, 200);
  assert.equal(opened.headers["content-type"], "text/event-stream");
  assert.equal(opened.headers["cache-control"], "no-store");
  assert.equal(opened.headers["x-accel-buffering"], "no");
  assert.ok(await carried(opened, 1));
  assert.deepEqual(frames(opened), [
    {
      event: "snapshot",
      data: {
        version: threadLiveVersion,
        held: {
          turn,
          message: "message-1",
          blocks: [{ index: 0, kind: "Text", text: "Hel", gapped: false }],
        },
      },
    },
  ]);
});

test("a live event arrives as a frame the contract reads, and no frame carries an identity", async () => {
  const rig = await rigOf();
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  rig.hear(begun);
  rig.hear(text(0, "line one\nline two"));
  assert.ok(await carried(opened, 3));
  assert.deepEqual(frames(opened), [
    nothing,
    { event: "live", data: { version: threadLiveVersion, turn, event: begun } },
    {
      event: "live",
      data: {
        version: threadLiveVersion,
        turn,
        event: text(0, "line one\nline two"),
      },
    },
  ]);
  assert.deepEqual(identities(opened), [
    "event: snapshot",
    "event: live",
    "event: live",
  ]);
});

test("a reader hears the thread its path names, under the tenant its path names", async () => {
  const other = asSessionId("thread-2");
  const rig = await rigOf();
  const mine = await stream(rig);
  const theirs = await stream(rig, pathOf(other));
  const elsewhere = await stream(rig, pathOf(session, "other-tenant"));
  assert.ok(await carried(theirs, 1));
  assert.ok(await carried(elsewhere, 1));
  rig.hear(begun, other);
  rig.hear(begun);
  assert.ok(await carried(mine, 2));
  assert.ok(await carried(theirs, 2));
  await delay(100);
  assert.equal(frames(mine).length, 2);
  assert.equal(frames(theirs).length, 2);
  assert.deepEqual(frames(elsewhere), [nothing]);
});

test("a thread live stream takes none of the slots an ordinary request queues for, and is beaten while it is quiet", async () => {
  const rig = await rigOf({
    concurrentRequestsMax: 1,
    limits: { heartbeatMs: 50 },
  });
  const first = await stream(rig);
  const second = await stream(rig);
  assert.ok(await carried(second, 1));
  assert.equal(first.status, 200);
  const live = await fetch(`http://127.0.0.1:${String(rig.port)}/health/live`);
  await live.arrayBuffer();
  assert.equal(live.status, 200);
  assert.ok(await reaches(() => first.body().includes(":\n\n")));
});

test("past the connections the hub may hold the answer is a refusal and not a stream", async () => {
  const rig = await rigOf({ limits: { connectionsMax: 1 } });
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  await assertServerBusy(await stream(rig));
});

test("past the readers one thread may have the answer is the same refusal, and another thread's reader is given a stream", async () => {
  const rig = await rigOf({ limits: { sessionReadersMax: 1 } });
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  await assertServerBusy(await stream(rig));
  const another = await stream(rig, pathOf(asSessionId("thread-2")));
  assert.equal(another.status, 200);
});

/** A session holding every block a message may have, each as long as one may be, of characters a frame writes at their heaviest. */
function filled(rig: Served): void {
  const written = "\u0001".repeat(sessionLiveBlockCharsMax);
  for (let index = 0; index < sessionLiveBlocksMax; index += 1) {
    rig.hear({ live: "Block", message: "message-1", index, kind: "Text" });
    rig.hear({
      live: "Text",
      message: "message-1",
      index,
      offset: 0,
      text: written,
    });
  }
}

/** Bounds a case sets past what `filled` holds, so that the hub keeps all of it and its snapshot is more than a socket's buffers take. */
const holdingEverything = {
  heldBytesMax: Number.MAX_SAFE_INTEGER,
  sessionTextBytesMax: Number.MAX_SAFE_INTEGER,
  pendingBytesMax: Number.MAX_SAFE_INTEGER,
  sentBytesMax: Number.MAX_SAFE_INTEGER,
};

/** How many times a case asks again for what a server does a moment after a reader leaves. */
const askAttemptsMax = 100;
const askIntervalMs = 20;

/** Waits for the server to hold no socket, which is a moment after it closes its last. */
async function holdsNoSocket(rig: Served): Promise<boolean> {
  for (let attempt = 0; attempt < askAttemptsMax; attempt += 1) {
    if ((await rig.connections()) === 0) return true;
    await delay(askIntervalMs);
  }
  return false;
}

test("a reader that stops reading is cut when the wait runs out, and the server holds no socket for it", async () => {
  const rig = await rigOf({
    limits: { ...holdingEverything, slowClientWaitMs: 200 },
  });
  filled(rig);
  const reader = unreading(rig.port, pathOf(), authorized);
  try {
    assert.ok(await reaches(() => rig.noted.includes("SlowClientClosed")));
    assert.ok(await holdsNoSocket(rig));
  } finally {
    reader.destroy();
  }
});

test("a reader past what the readers behind may hold unwritten between them is cut at once, and the server holds no socket for it", async () => {
  const rig = await rigOf({
    limits: {
      ...holdingEverything,
      pendingBytesMax: sessionLiveBlockCharsMax,
      slowClientWaitMs: 60_000,
    },
  });
  filled(rig);
  const reader = unreading(rig.port, pathOf(), authorized);
  try {
    assert.ok(await reaches(() => rig.noted.includes("PendingClosed")));
    assert.ok(await holdsNoSocket(rig));
  } finally {
    reader.destroy();
  }
});

const other = asSessionId("thread-2");

/** How long a case gives the kernel to take what a reader that is not reading was written. */
const takenWithinMs = 200;

test("a stream a stopping hub ends while its reader holds bytes unwritten leaves the server no socket for it", async () => {
  const rig = await rigOf({
    limits: { ...holdingEverything, slowClientWaitMs: 60_000 },
  });
  filled(rig);
  const reader = unreading(rig.port, pathOf(), authorized);
  try {
    assert.ok(await reaches(() => rig.asked.length === 1));
    await delay(takenWithinMs);
    assert.equal(await rig.connections(), 1);
    await rig.stops();
    assert.ok(await holdsNoSocket(rig));
    assert.deepEqual(rig.noted, []);
  } finally {
    reader.destroy();
  }
});

/** A session holding four blocks as long as one may be, of characters a frame writes at their heaviest: less than a kernel takes for a socket nobody reads. */
function fourHeld(rig: Served): number {
  const written = "\u0001".repeat(sessionLiveBlockCharsMax);
  for (let index = 0; index < 4; index += 1) {
    rig.hear({ live: "Block", message: "message-1", index, kind: "Text" });
    rig.hear({
      live: "Text",
      message: "message-1",
      index,
      offset: 0,
      text: written,
    });
  }
  return 4 * JSON.stringify(written).length;
}

test("a reader at its connection's greatest age is reset, and can read no more than had already reached it", async () => {
  const rig = await rigOf({
    limits: { ...holdingEverything, maxAgeMs: 300, slowClientWaitMs: 60_000 },
  });
  const heldBytes = fourHeld(rig);
  const reader = unreading(rig.port, pathOf(), authorized);
  try {
    assert.ok(await reaches(() => rig.asked.length === 1));
    assert.ok(await holdsNoSocket(rig));
    assert.deepEqual(rig.noted, []);
    assert.ok((await readOut(reader)) < heldBytes);
  } finally {
    reader.destroy();
  }
});

test("a reader that says it will send no more, having read nothing, is reset and can read no more than had already reached it", async () => {
  const rig = await rigOf({
    limits: { ...holdingEverything, slowClientWaitMs: 60_000 },
  });
  const heldBytes = fourHeld(rig);
  const reader = unreading(rig.port, pathOf(), authorized);
  try {
    assert.ok(await reaches(() => rig.asked.length === 1));
    await delay(takenWithinMs);
    reader.end();
    assert.ok(await holdsNoSocket(rig));
    assert.ok((await readOut(reader)) < heldBytes);
  } finally {
    reader.destroy();
  }
});

test("the reader written the most, once the open readers were written more than they may be between them, has its connection reset though it read everything", async () => {
  const rig = await rigOf({ limits: { sentBytesMax: 1_024 } });
  const reader = await stream(rig);
  assert.ok(await carried(reader, 1));
  rig.hear(text(0, "a".repeat(1_024)));
  assert.ok(await reaches(() => reader.failed()));
  assert.equal(reader.closed(), false);
  assert.deepEqual(frames(reader), [nothing]);
  assert.deepEqual(rig.noted, ["SentClosed"]);
  assert.ok(await holdsNoSocket(rig));
});

test("a reader that is cut can read no more than had already reached it: what was written for it and not read is dropped with its connection", async () => {
  const written = "\u0001".repeat(sessionLiveBlockCharsMax);
  const heaviest = JSON.stringify(written).length;
  const rig = await rigOf({
    limits: {
      ...holdingEverything,
      sentBytesMax: 5 * heaviest,
      slowClientWaitMs: 60_000,
    },
  });
  fourHeld(rig);
  const reader = unreading(rig.port, pathOf(), authorized);
  try {
    await delay(takenWithinMs);
    const keeping = await stream(rig, pathOf(other));
    rig.hear(begun, other);
    rig.hear(text(0, written), other);
    rig.hear(text(0, `${written}.`), other);
    assert.ok(await reaches(() => rig.noted.includes("SentClosed")));
    assert.ok(await reaches(() => payloads(keeping).length === 4));
    assert.deepEqual(rig.noted, ["SentClosed"]);
    assert.equal(keeping.failed(), false);
    assert.ok((await readOut(reader)) < 4 * heaviest);
  } finally {
    reader.destroy();
  }
});

const execute = promisify(execFile);

/** A server of one stream to a reader that reads nothing, which shuts the stream's socket down and then cuts it, and says so once that socket has closed. */
const shutThenCutProgram = `
  import http from 'node:http';
  import net from 'node:net';
  const { threadLiveSocket } = await import('./src/adapters/http/eventStream.ts');
  const server = http.createServer((request, response) => {
    const sink = threadLiveSocket({ raw: response });
    sink.send('event: snapshot\\ndata: {}\\n\\n');
    setImmediate(() => {
      response.socket.once('close', () => {
        process.stdout.write('closed');
        process.exit(0);
      });
      response.socket.end();
      sink.cut();
    });
  });
  server.listen(0, '127.0.0.1', () => {
    const reader = net.connect({ host: '127.0.0.1', port: server.address().port });
    reader.pause();
    reader.on('error', () => undefined);
    reader.write('GET / HTTP/1.1\\r\\nhost: 127.0.0.1\\r\\n\\r\\n');
  });
`;

/** How long the program above is given, which it needs none of unless its socket is never closed. */
const shutThenCutWithinMs = 20_000;

test("a socket already being shut down when it is cut is closed, where one asked to reset is never closed at all", async () => {
  const ran = await execute(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "--eval",
      shutThenCutProgram,
    ],
    { cwd: process.cwd(), timeout: shutThenCutWithinMs, killSignal: "SIGKILL" },
  ).catch(() => ({ stdout: "the program was killed" }));
  assert.equal(ran.stdout, "closed");
});

test("a reader keeping up is sent a snapshot far past what a socket buffers at once, whole, and is not closed for it", async () => {
  const rig = await rigOf({ limits: holdingEverything });
  filled(rig);
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  const [first] = frames(opened);
  assert.ok(first?.event === "snapshot");
  assert.equal(first.data.held.blocks.length, sessionLiveBlocksMax);
  assert.ok(
    first.data.held.blocks.every(
      (block) => block.text.length === sessionLiveBlockCharsMax,
    ),
  );
  rig.hear({ live: "End" });
  assert.ok(await carried(opened, 2));
  assert.deepEqual(rig.noted, []);
});

/** Asks for a stream until one is given, because a server hears that a reader left a moment after it leaves. */
async function opensWithin(rig: Served): Promise<boolean> {
  for (let attempt = 0; attempt < askAttemptsMax; attempt += 1) {
    const next = await stream(rig);
    if (next.status === 200) return true;
    await delay(askIntervalMs);
  }
  return false;
}

test("a reader that goes away gives its place back", async () => {
  const rig = await rigOf({ limits: { connectionsMax: 1 } });
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  opened.close();
  assert.ok(await opensWithin(rig), "the place was never given back");
});

test("a reader that goes away while its thread is being read takes no place", async () => {
  let release: () => void = () => undefined;
  const reading = new Promise<void>((resolve) => {
    release = resolve;
  });
  const rig = await rigOf({ limits: { connectionsMax: 1 }, reading });
  const abandoned = abandoning(rig.port, pathOf(), authorized);
  assert.ok(await reaches(() => rig.asked.length === 1));
  abandoned.destroy();
  await delay(100);
  release();
  await delay(100);
  const next = await stream(rig);
  assert.equal(next.status, 200);
  assert.ok(await carried(next, 1));
});

test("a thread live stream is reset when the bearer that opened it expires", async () => {
  const rig = await rigOf({ expiresInMs: 700 });
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  assert.ok(
    await reaches(() => opened.failed()),
    "the stream outlived its bearer",
  );
  assert.equal(opened.closed(), false);
  assert.ok(await holdsNoSocket(rig));
});

test("whether a reader may still read its thread is asked again as it was first asked, and a reader refused is reset", async () => {
  const rig = await rigOf({ limits: { heartbeatMs: 50 } });
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  assert.ok(await reaches(() => rig.asked.length >= 3));
  assert.equal(opened.closed(), false);
  rig.refuses();
  assert.ok(
    await reaches(() => opened.failed()),
    "the stream outlived its reader's standing",
  );
  assert.equal(opened.closed(), false);
  const first = {
    reader: principal,
    read: partition,
    of: session,
    query: { limit: 1 },
  };
  assert.deepEqual(
    rig.asked,
    rig.asked.map(() => first),
  );
});

test("closing the hub ends every stream instead of draining behind one, and a reader keeping up reads its stream to its end", async () => {
  const rig = await served();
  const opened = await held(rig.port, pathOf(), authorized);
  assert.ok(await carried(opened, 1));
  const started = Date.now();
  await rig.close();
  assert.ok(Date.now() - started < 5_000);
  assert.ok(await reaches(() => opened.closed()));
  assert.equal(opened.failed(), false);
  opened.close();
});

test("an app composed with no hub serves no thread live route", async () => {
  const rig = await rigOf({ composed: false });
  const refused = await stream(rig);
  assert.equal(refused.status, 404);
  assert.deepEqual(rig.asked, []);
});
