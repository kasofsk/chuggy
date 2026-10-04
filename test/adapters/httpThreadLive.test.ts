/**
 * The thread live route over a real socket: what a reader is answered with
 * before a stream exists, and what it reads once one does.
 *
 * The hub is the real one and only its lane is a double, so a case speaks as
 * the lane and reads what the socket carried.
 */

import assert from "node:assert/strict";
import { after, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import { systemStreamTimers } from "../../src/adapters/runtime/systemStreamTimers.ts";
import { nativeHttpRoutes } from "../../src/contract/http.ts";
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
  reaches,
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

  /** What the thread read was asked each time the route asked it. */
  readonly asked: unknown[];
  hear(event: SessionLiveEvent, of?: SessionId): void;
  close(): Promise<void>;
}

interface Serving {
  readonly found?: boolean;
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

async function served(options: Serving = {}): Promise<Served> {
  const asked: unknown[] = [];
  let watcher: ThreadLiveWatcher | undefined;
  const hub = threadLiveHub({
    lane: {
      open: (opened) => {
        watcher = opened;
      },
      close: () => Promise.resolve(),
    },
    timers: systemStreamTimers,
    report: { noted: () => undefined },
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
    hear: (event, of = session) =>
      watcher?.heard({ partition, session: of, turn, event }),
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

/** How many times a case asks again for a place a departed reader held. */
const askAttemptsMax = 100;
const askIntervalMs = 20;

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

test("a thread live stream ends when the bearer that opened it does", async () => {
  const rig = await rigOf({ expiresInMs: 700 });
  const opened = await stream(rig);
  assert.ok(await carried(opened, 1));
  assert.ok(
    await reaches(() => opened.closed()),
    "the stream outlived its bearer",
  );
});

test("closing the hub ends every stream instead of draining behind one", async () => {
  const rig = await served();
  const opened = await held(rig.port, pathOf(), authorized);
  assert.ok(await carried(opened, 1));
  const started = Date.now();
  await rig.close();
  assert.ok(Date.now() - started < 5_000);
  assert.ok(await reaches(() => opened.closed()));
  opened.close();
});

test("an app composed with no hub serves no thread live route", async () => {
  const rig = await rigOf({ composed: false });
  const refused = await stream(rig);
  assert.equal(refused.status, 404);
  assert.deepEqual(rig.asked, []);
});
