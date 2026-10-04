/**
 * The live lane against a real server: what the plane's publisher sends is what
 * the API's listener hears, in the order it was sent.
 *
 * Each side runs as the role its process holds, so a privilege either lacked
 * would be a red here. What PostgreSQL does with a payload it will not carry,
 * and with one it is sent twice, is asked of the server rather than assumed.
 *
 * A post is carried for the turn its session holds claimed, so each case's
 * turn is one a real attempt claimed. Which posts are left out for the turn
 * they name is `threadTurnStop.test.ts`'s subject.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import pg from "pg";

import { postgresPool } from "../../src/adapters/postgres/pool.ts";
import {
  apiRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresSessionLiveLane,
  postgresSessionLivePublisher,
  sessionLivePayloadBytesMax,
} from "../../src/adapters/postgres/sessionLive.ts";
import {
  jsonTextBytes,
  nativeHttpPathSegmentCharsMax,
  sessionIdentityCharsMax,
  sessionLiveEventsMax,
  sessionLiveMessageCharsMax,
  sessionLiveTextBytesMax,
} from "../../src/contract/http.ts";
import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";
import {
  asSessionId,
  asSessionTurnId,
  type SessionId,
  type SessionTurnId,
} from "../../src/interpreter/agentSession.ts";
import { asPrincipal } from "../../src/interpreter/principal.ts";
import {
  asProjectId,
  asTenantId,
  type Partition,
} from "../../src/interpreter/projectStore.ts";
import type { SessionLivePublishPort } from "../../src/interpreter/sessionPlane.ts";
import type {
  ThreadLiveCarried,
  ThreadLiveLane,
  ThreadLiveSource,
} from "../../src/interpreter/threadLive.ts";
import {
  postgresHarnessRolePool,
  postgresHarnessRoleUrl,
  postgresHarnessUrl,
} from "./harness.ts";
import {
  sessionRigAttempt,
  sessionRigOpen,
  type SessionRig,
} from "./sessionHarness.ts";

let ownerPool: pg.Pool;
let planePool: pg.Pool;
let rig: SessionRig;

before(async () => {
  ownerPool = postgresPool(postgresHarnessUrl());
  planePool = postgresHarnessRolePool(workerPlaneRole);
  rig = await sessionRigOpen();
});

after(async () => {
  await rig.close();
  await planePool.end();
  await ownerPool.end();
});

/** The cases whose turn has been claimed, by their project. */
const holds = new Set<string>();

/** The one session a case posts as, and its one turn, which no other case's are. */
function sessionOf(partition: Partition): SessionId {
  return asSessionId(`session-${partition.project}`);
}

function turnOf(partition: Partition): SessionTurnId {
  return asSessionTurnId(`turn-${partition.project}`);
}

/**
 * Makes the case's turn the one its session holds claimed, once: the project
 * and the session are opened, the turn is enqueued, and an attempt claims it.
 */
async function holding(partition: Partition): Promise<void> {
  if (holds.has(partition.project)) return;
  const session = sessionOf(partition);
  await rig.harness.store.createProject(partition);
  await rig.sessions.open({
    partition,
    session,
    kind: "Lead",
    principal: asPrincipal("principal-live"),
    capabilities: [],
    credentialSlot: "claude-code",
  });
  await rig.sessions.enqueue({
    partition,
    session,
    turn: turnOf(partition),
    inputKind: "UserMessage",
    input: "write",
  });
  const attempt = await sessionRigAttempt(rig, partition, session, "live");
  const claimed = await rig.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  assert.equal(claimed?.turn, turnOf(partition));
  holds.add(partition.project);
}

/** A publisher over the plane's own role, and the running total it reported each time it reported one. */
function publishing(): {
  readonly publisher: SessionLivePublishPort;
  readonly drops: number[];
} {
  const drops: number[] = [];
  const publisher = postgresSessionLivePublisher(planePool, {
    dropped: (droppedTotal) => drops.push(droppedTotal),
  });
  return { publisher, drops };
}

/** How long a case waits for something it has already sent. */
const waitMsMax = 10_000;
const askMs = 10;

async function reaches(reading: () => boolean, what: string): Promise<void> {
  for (let waited = 0; waited < waitMsMax; waited += askMs) {
    if (reading()) return;
    await delay(askMs);
  }
  throw new Error(`session live lane: ${what} never happened`);
}

interface Listened {
  readonly heard: ThreadLiveCarried[];
  readonly sources: ThreadLiveSource[];
  unread: number;

  /** How many payloads the watcher was asked about, and whether it answers for the next. */
  arrived: number;
  reads: boolean;
}

/** Where the API's listener connects: as the API's role, under a name its backend can be found by. */
function laneUrl(name: string): string {
  const url = postgresHarnessRoleUrl(apiRole);
  url.searchParams.set("application_name", name);
  return url.toString();
}

/** A lane that is listening, and everything it has told its watcher. */
async function listening(
  name: string,
): Promise<{ readonly lane: ThreadLiveLane; readonly listened: Listened }> {
  const listened: Listened = {
    heard: [],
    sources: [],
    unread: 0,
    arrived: 0,
    reads: true,
  };
  const lane = postgresSessionLiveLane(laneUrl(name), {
    reconnectBaseMs: 50,
    reconnectMaxMs: 200,
  });
  lane.open({
    arrived: () => {
      listened.arrived += 1;
      return listened.reads;
    },
    heard: (carried) => listened.heard.push(carried),
    unread: () => {
      listened.unread += 1;
    },
    sourced: (source) => listened.sources.push(source),
  });
  await reaches(() => listened.sources.includes("Live"), "the lane listening");
  return { lane, listened };
}

function partitionOf(label: string): Partition {
  return {
    tenant: asTenantId(`tenant-${label}`),
    project: asProjectId(`project-${label}`),
  };
}

const ended: SessionLiveEvent = { live: "End" };

function textAt(offset: number, text: string): SessionLiveEvent {
  return { live: "Text", message: "message-1", index: 0, offset, text };
}

/** Publishes one post for the case's claimed turn, and waits until the lane has heard `heardTotal` events in all. */
async function published(
  listened: Listened,
  partition: Partition,
  events: readonly SessionLiveEvent[],
  heardTotal: number,
): Promise<void> {
  await holding(partition);
  assert.equal(
    await publishing().publisher.publish({
      partition,
      session: sessionOf(partition),
      turn: turnOf(partition),
      events,
    }),
    "Published",
  );
  await reaches(
    () => listened.heard.length >= heardTotal,
    "a post being heard",
  );
}

test("a post's events are heard one by one, in the order they were handed over, as the session that sent them", async () => {
  const partition = partitionOf("order");
  const { lane, listened } = await listening("chuggy-live-order");
  try {
    const first = Array.from({ length: sessionLiveEventsMax }, (_, at) =>
      textAt(at, String(at % 10)),
    );
    const second: readonly SessionLiveEvent[] = [
      {
        live: "Block",
        message: "message-2",
        index: 0,
        kind: "ToolUse",
        name: "Read",
      },
      ended,
    ];
    await published(listened, partition, first, first.length);
    await published(listened, partition, second, first.length + second.length);
    assert.deepEqual(
      listened.heard,
      [...first, ...second].map((event) => ({
        partition,
        session: sessionOf(partition),
        turn: turnOf(partition),
        event,
      })),
    );
    assert.equal(listened.unread, 0);
  } finally {
    await lane.close();
  }
});

test("PostgreSQL delivers one of two payloads a statement sends alike, and two events of one post are never alike", async () => {
  const partition = partitionOf("alike");
  const { lane, listened } = await listening("chuggy-live-alike");
  try {
    const alike = JSON.stringify({
      ...partition,
      session: sessionOf(partition),
      turn: turnOf(partition),
      ordinal: 0,
      event: ended,
    });
    await planePool.query(
      "SELECT pg_notify('chuggy_session_live', $1) FROM generate_series(1, 2)",
      [alike],
    );
    await published(listened, partition, [textAt(0, "after")], 2);
    assert.deepEqual(
      listened.heard.map((carried) => carried.event),
      [ended, textAt(0, "after")],
    );

    const repeated = [ended, textAt(0, "ab"), ended, textAt(0, "ab")];
    await published(listened, partition, repeated, 2 + repeated.length);
    assert.deepEqual(
      listened.heard.slice(2).map((carried) => carried.event),
      repeated,
    );
  } finally {
    await lane.close();
  }
});

test("a payload that is not one event is counted and dropped, and the lane goes on listening", async () => {
  const partition = partitionOf("unread");
  const { lane, listened } = await listening("chuggy-live-unread");
  try {
    await planePool.query(
      "SELECT pg_notify('chuggy_session_live', unread) FROM unnest($1::text[]) AS unread",
      [
        [
          "",
          "not json",
          JSON.stringify({
            ...partition,
            session: sessionOf(partition),
            turn: turnOf(partition),
          }),
        ],
      ],
    );
    await published(listened, partition, [ended], 1);
    assert.equal(listened.unread, 3);
    assert.deepEqual(
      listened.heard.map((carried) => carried.event),
      [ended],
    );
  } finally {
    await lane.close();
  }
});

test("a payload the watcher does not answer for is neither read nor counted as unread, and the lane goes on asking", async () => {
  const partition = partitionOf("unasked");
  const { lane, listened } = await listening("chuggy-live-unasked");
  try {
    listened.reads = false;
    await planePool.query("SELECT pg_notify('chuggy_session_live', $1)", [
      "not json",
    ]);
    await holding(partition);
    assert.equal(
      await publishing().publisher.publish({
        partition,
        session: sessionOf(partition),
        turn: turnOf(partition),
        events: [textAt(0, "unheard")],
      }),
      "Published",
    );
    await reaches(() => listened.arrived === 2, "both payloads arriving");
    listened.reads = true;
    await published(listened, partition, [ended], 1);
    assert.deepEqual([listened.arrived, listened.unread], [3, 0]);
    assert.deepEqual(
      listened.heard.map((carried) => carried.event),
      [ended],
    );
  } finally {
    await lane.close();
  }
});

/** A text of `chars` characters JSON writes as six bytes each. */
function escaped(chars: number): string {
  return "\u0001".repeat(chars);
}

/** A text of `chars` characters JSON writes as themselves, three bytes each. */
function wide(chars: number): string {
  return "€".repeat(chars);
}

/** An event's text at its weight. */
const textHeaviest = "a".repeat(sessionLiveTextBytesMax - jsonTextBytes(""));

/**
 * A publisher over the plane's own role that keeps every payload it handed
 * the boundary. What the contract admits at its heaviest names identities no
 * project of this database can have, so no turn of them is ever claimed and
 * the boundary carries none of it: what the publisher weighed, left out and
 * handed over is read here, and what the channel carries is asked of the
 * server with the same payload.
 */
function handing(): {
  readonly publisher: SessionLivePublishPort;
  readonly drops: number[];
  readonly handed: string[];
} {
  const drops: number[] = [];
  const handed: string[] = [];
  const recording = {
    query: (asked: pg.QueryConfig) => {
      const payloads: unknown = asked.values?.at(-1);
      if (Array.isArray(payloads)) handed.push(...payloads.map(String));
      return planePool.query(asked);
    },
  } as unknown as pg.Pool;
  const publisher = postgresSessionLivePublisher(recording, {
    dropped: (droppedTotal) => drops.push(droppedTotal),
  });
  return { publisher, drops, handed };
}

/** Sends one payload as the plane's role, as the boundary sends each it carries. */
async function notified(payload: string): Promise<void> {
  await planePool.query("SELECT pg_notify('chuggy_session_live', $1)", [
    payload,
  ]);
}

test("the heaviest event the contract admits is too heavy for the channel only where its identities need escaping, and is then left out, counted at the first and at each doubling, and fails nothing", async () => {
  const { lane, listened } = await listening("chuggy-live-heaviest");
  const { publisher, drops, handed } = handing();
  try {
    const carried = {
      partition: {
        tenant: asTenantId(wide(nativeHttpPathSegmentCharsMax)),
        project: asProjectId(wide(nativeHttpPathSegmentCharsMax)),
      },
      session: asSessionId(wide(sessionIdentityCharsMax)),
      turn: asSessionTurnId(wide(sessionIdentityCharsMax)),
      events: [
        {
          live: "Text",
          message: wide(sessionLiveMessageCharsMax),
          index: 0,
          offset: 0,
          text: textHeaviest,
        },
      ],
    } as const;
    assert.equal(await publisher.publish(carried), "Published");
    assert.equal(handed.length, 1);
    assert.deepEqual(drops, []);
    await notified(handed[0] ?? "");
    await reaches(() => listened.heard.length === 1, "the wide event");
    assert.deepEqual(listened.heard[0]?.event, carried.events[0]);

    const heavy = {
      partition: {
        tenant: asTenantId(escaped(nativeHttpPathSegmentCharsMax)),
        project: asProjectId(escaped(nativeHttpPathSegmentCharsMax)),
      },
      session: asSessionId(escaped(sessionIdentityCharsMax)),
      turn: asSessionTurnId(escaped(sessionIdentityCharsMax)),
      events: [
        { ...carried.events[0], message: escaped(sessionLiveMessageCharsMax) },
        ended,
      ],
    } as const;
    assert.equal(await publisher.publish(heavy), "Published");
    await reaches(() => listened.heard.length === 2, "the event beside it");
    assert.deepEqual(listened.heard[1], {
      partition: heavy.partition,
      session: heavy.session,
      turn: heavy.turn,
      event: ended,
    });
    assert.equal(handed.length, 2, "the event too heavy was handed over");
    assert.deepEqual(drops, [1]);
    for (let again = 0; again < 4; again += 1)
      assert.equal(await publisher.publish(heavy), "Published");
    assert.deepEqual(drops, [1, 2, 4]);
  } finally {
    await lane.close();
  }
});

/** Every raw payload the channel delivers, as a connection of the test's own hears it. */
async function overheard(): Promise<{
  readonly payloads: string[];
  readonly close: () => Promise<void>;
}> {
  const client = new pg.Client({ connectionString: postgresHarnessUrl() });
  const payloads: string[] = [];
  client.on("notification", (message) => payloads.push(message.payload ?? ""));
  await client.connect();
  await client.query("LISTEN chuggy_session_live");
  return { payloads, close: () => client.end() };
}

test("the publisher's bound is the server's: a payload at it is handed over and carried, and one byte past it is left out where the server would refuse it", async () => {
  const listener = await overheard();
  const { publisher, drops, handed } = handing();
  try {
    const post = (turnText: string) =>
      publisher.publish({
        partition: {
          tenant: asTenantId(escaped(nativeHttpPathSegmentCharsMax)),
          project: asProjectId(escaped(nativeHttpPathSegmentCharsMax)),
        },
        session: asSessionId(escaped(sessionIdentityCharsMax)),
        turn: asSessionTurnId(turnText),
        events: [
          {
            live: "Text",
            message: escaped(sessionLiveMessageCharsMax),
            index: 0,
            offset: 0,
            text: textHeaviest,
          },
        ],
      });
    const weightOf = (payload: string | undefined): number =>
      Buffer.byteLength(payload ?? "", "utf8");

    assert.equal(await post("a"), "Published");
    const spare = sessionLivePayloadBytesMax - weightOf(handed[0]);
    const escapedBytes = weightOf(JSON.stringify(escaped(1))) - weightOf('""');
    const atBound = `a${escaped(Math.floor(spare / escapedBytes))}${"a".repeat(spare % escapedBytes)}`;

    assert.equal(await post(atBound), "Published");
    assert.equal(weightOf(handed[1]), sessionLivePayloadBytesMax);
    assert.deepEqual(drops, []);
    await notified(handed[1] ?? "");
    await reaches(
      () => listener.payloads.length === 1,
      "the payload at the bound",
    );
    assert.equal(listener.payloads[0], handed[1]);

    await assert.rejects(
      notified(`${handed[1] ?? ""} `),
      /payload string too long/u,
    );
    assert.equal(await post(`${atBound}a`), "Published");
    assert.deepEqual(drops, [1]);
    assert.equal(handed.length, 2, "a payload past the bound was handed over");
    assert.equal(await post("b"), "Published");
    assert.equal(weightOf(handed[2]), weightOf(handed[0]));
  } finally {
    await listener.close();
  }
});

test("a publish the server could not be asked for is answered as unavailable, never raised", async () => {
  const gone = postgresHarnessRolePool(workerPlaneRole);
  await gone.end();
  const unreachable = postgresSessionLivePublisher(gone, {
    dropped: () => undefined,
  });
  assert.equal(
    await unreachable.publish({
      partition: partitionOf("gone"),
      session: sessionOf(partitionOf("gone")),
      turn: turnOf(partitionOf("gone")),
      events: [ended],
    }),
    "Unavailable",
  );
});

test("a listener whose connection is ended says it is lost, comes back, and hears what is published after", async () => {
  const partition = partitionOf("recovers");
  const name = `chuggy-live-recovers-${String(Date.now())}`;
  const { lane, listened } = await listening(name);
  try {
    await ownerPool.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name=$1",
      [name],
    );
    await reaches(() => listened.sources.includes("Lost"), "the loss");
    await reaches(
      () =>
        listened.sources.lastIndexOf("Live") > listened.sources.indexOf("Lost"),
      "the lane coming back",
    );
    await published(listened, partition, [ended], 1);
    assert.deepEqual(listened.heard, [
      {
        partition,
        session: sessionOf(partition),
        turn: turnOf(partition),
        event: ended,
      },
    ]);
  } finally {
    await lane.close();
  }
});
