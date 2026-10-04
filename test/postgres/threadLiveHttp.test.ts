/**
 * A live event the whole way, over a real database: a session posts it to the
 * worker plane under its own bearer, and a member reading that session's thread
 * is sent it as a frame.
 *
 * Every piece is the deployed one. The plane authenticates the bearer against
 * the session's own row and publishes as its role, the API listens as its own
 * role, and the route asks the thread read the member's other routes ask. The
 * turn posted for is one the session's attempt claimed, as a runner's is.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import type pg from "pg";

import { threadLiveFramed } from "../../src/adapters/http/eventStream.ts";
import { createWorkerPlaneApp } from "../../src/adapters/http/workerPlaneServer.ts";
import {
  apiRole,
  workerPlaneRole,
} from "../../src/adapters/postgres/schema.ts";
import {
  postgresSessionLiveLane,
  postgresSessionLivePublisher,
} from "../../src/adapters/postgres/sessionLive.ts";
import { systemStreamTimers } from "../../src/adapters/runtime/systemStreamTimers.ts";
import {
  nativeHttpMediaType,
  nativeHttpRoutes,
} from "../../src/contract/http.ts";
import type { SessionLiveEvent } from "../../src/contract/sessionLive.ts";
import { sessionPlaneRoutes } from "../../src/contract/sessionPlane.ts";
import {
  threadLiveNothing,
  threadLiveVersion,
} from "../../src/contract/threadLive.ts";
import {
  workerContractHeader,
  workerContractRelease,
} from "../../src/contract/workerContract.ts";
import {
  asSessionTurnId,
  type SessionId,
} from "../../src/interpreter/agentSession.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import {
  threadLiveHub,
  type ThreadLiveHub,
  type ThreadLiveNote,
} from "../../src/interpreter/threadLive.ts";
import {
  held,
  identities,
  payloads,
  reaches,
  type Held,
} from "../adapters/heldStream.ts";
import {
  inertSessionPlane,
  inertWorkerPlane,
} from "../adapters/workerPlaneFixtures.ts";
import { postgresHarnessRolePool, postgresHarnessRoleUrl } from "./harness.ts";
import { sessionRigAttempt, type SessionRigAttempt } from "./sessionHarness.ts";
import { sessionStoreDouble } from "./storeDouble.ts";
import {
  threadRigApp,
  threadRigIssuer,
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigThread,
  threadRigTurnId,
  type ThreadRig,
  type ThreadRigMember,
} from "./threadHarness.ts";

let rig: ThreadRig;
let planePool: pg.Pool;
let hub: ThreadLiveHub;
const notes: ThreadLiveNote[] = [];

before(async () => {
  rig = await threadRigOpen();
  planePool = postgresHarnessRolePool(workerPlaneRole);
  hub = threadLiveHub({
    lane: postgresSessionLiveLane(postgresHarnessRoleUrl(apiRole).toString()),
    timers: systemStreamTimers,
    report: { noted: (note) => notes.push(note) },
    framed: threadLiveFramed,
  });
  assert.ok(
    await reaches(() =>
      notes.some((note) => note.note === "Sourced" && note.source === "Live"),
    ),
    "the lane never listened",
  );
});

after(async () => {
  await hub.close();
  await planePool.end();
  await rig.close();
});

const authorized = { authorization: "Bearer valid" };

function livePath(partition: Partition, session: SessionId): string {
  return nativeHttpRoutes.threadLive
    .replace(":tenant", partition.tenant)
    .replace(":project", partition.project)
    .replace(":session", session);
}

/**
 * The API as `principal`, listening, and a way to hold one of its thread live
 * streams open. Disposing it closes every stream it held before the app, which
 * otherwise waits on them.
 */
async function serving(principal: ThreadRigMember["principal"]) {
  const open: Held[] = [];
  const app = threadRigApp({
    rig,
    principal,
    access: rig.sessions.harness.access,
    store: sessionStoreDouble(),
    threadLive: hub,
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address !== null && typeof address !== "string");
  return {
    app,
    reading: async (partition: Partition, session: SessionId) => {
      const found = await held(
        address.port,
        livePath(partition, session),
        authorized,
      );
      open.push(found);
      return found;
    },
    [Symbol.asyncDispose]: async () => {
      for (const found of open) found.close();
      await app.close();
    },
  };
}

/** The worker plane over the rig's own sessions, publishing as the plane's role and reading a turn's stop from its row. */
function plane() {
  return createWorkerPlaneApp({
    ...inertWorkerPlane(1),
    sessions: {
      ...inertSessionPlane(rig.sessions.plane),
      watches: rig.sessions.plane,
      live: postgresSessionLivePublisher(planePool, {
        dropped: () => undefined,
      }),
    },
  });
}

const nothing = { version: threadLiveVersion, held: threadLiveNothing };

const versioned = { ...authorized, "content-type": nativeHttpMediaType };

function threadPath(
  route: string,
  partition: Partition,
  session: SessionId,
): string {
  return route
    .replace(":tenant", partition.tenant)
    .replace(":project", partition.project)
    .replace(":session", session);
}

/** One message sent through the member's door, which is one queued turn. */
async function said(
  api: Awaited<ReturnType<typeof serving>>,
  partition: Partition,
  session: SessionId,
  label: string,
): Promise<string> {
  const turn = threadRigTurnId(label);
  const sent = await api.app.inject({
    method: "POST",
    url: threadPath(nativeHttpRoutes.threadMessages, partition, session),
    headers: versioned,
    payload: { turn, message: "say hello" },
  });
  assert.equal(sent.statusCode, 202, sent.body);
  return turn;
}

/** The turn the attempt's mailbox hands it, which is the turn a runner writes. */
async function claimed(
  attempt: SessionRigAttempt,
): Promise<string | undefined> {
  const turn = await rig.sessions.plane.claim({
    secret: attempt.secret,
    generation: attempt.attempt.generation,
  });
  return turn?.turn;
}

/** What the plane answers one post of live events, under the attempt's own bearer and naming `release` where there is one. */
async function answered(
  workers: ReturnType<typeof plane>,
  secret: string,
  turn: string,
  events: readonly SessionLiveEvent[],
  release?: string,
): Promise<{ readonly status: number; readonly body: string }> {
  const answer = await workers.inject({
    method: sessionPlaneRoutes.turnLive.method,
    url: sessionPlaneRoutes.turnLive.path,
    headers: {
      authorization: `Bearer ${secret}`,
      ...(release === undefined ? {} : { [workerContractHeader]: release }),
    },
    payload: { turn, events },
  });
  return { status: answer.statusCode, body: answer.body };
}

const taken = { status: 204, body: "" };

/** One post of live events the plane takes, from a runner naming no release. */
async function posted(
  workers: ReturnType<typeof plane>,
  secret: string,
  turn: string,
  events: readonly SessionLiveEvent[],
): Promise<void> {
  assert.deepEqual(await answered(workers, secret, turn, events), taken);
}

/** The member's stop of one turn of their thread, through their own door. */
async function stoppedBy(
  api: Awaited<ReturnType<typeof serving>>,
  partition: Partition,
  session: SessionId,
  turn: string,
): Promise<void> {
  const stopped = await api.app.inject({
    method: "POST",
    url: threadPath(
      nativeHttpRoutes.threadTurnStop,
      partition,
      session,
    ).replace(":turn", turn),
    headers: versioned,
    payload: {},
  });
  assert.equal(stopped.statusCode, 200, stopped.body);
  assert.deepEqual(stopped.json(), { stopped: "Stopped" });
}

test("what a session posts to the plane under its own bearer reaches a member reading its thread, and nobody reading another", async () => {
  const partition = await threadRigProject(rig, "live");
  const writer = threadRigMember(rig, partition, "live-writer");
  const other = threadRigMember(rig, partition, "live-other");
  const writing = await threadRigThread(rig, partition, writer);
  const quiet = await threadRigThread(rig, partition, other);
  const events: SessionLiveEvent[] = [
    { live: "Block", message: "message-1", index: 0, kind: "Text" },
    { live: "Text", message: "message-1", index: 0, offset: 0, text: "Hel" },
    { live: "Text", message: "message-1", index: 0, offset: 3, text: "lo" },
  ];

  await using api = await serving(writer.principal);
  await using workers = plane();
  const turn = await said(api, partition, writing.session, "live");
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    writing.session,
    "live",
  );
  assert.equal(await claimed(attempt), turn);
  const reader = await api.reading(partition, writing.session);
  const beside = await api.reading(partition, quiet.session);
  assert.equal(reader.status, 200);
  assert.ok(await reaches(() => payloads(reader).length === 1));
  assert.ok(await reaches(() => payloads(beside).length === 1));

  await posted(workers, attempt.secret, turn, events);

  assert.ok(await reaches(() => payloads(reader).length === 1 + events.length));
  assert.deepEqual(payloads(reader), [
    nothing,
    ...events.map((event) => ({ version: threadLiveVersion, turn, event })),
  ]);
  assert.deepEqual(identities(reader), [
    "event: snapshot",
    ...events.map(() => "event: live"),
  ]);
  assert.deepEqual(payloads(beside), [nothing]);

  const late = await api.reading(partition, writing.session);
  assert.ok(await reaches(() => payloads(late).length === 1));
  assert.deepEqual(payloads(late), [
    {
      version: threadLiveVersion,
      held: {
        turn,
        message: "message-1",
        blocks: [{ index: 0, kind: "Text", text: "Hello", gapped: false }],
      },
    },
  ]);
});

/**
 * A stop the whole way: the member's door ends the turn, every reader of the
 * thread is sent the end of its stream, a reader arriving after is shown
 * nothing of it, and what the runner goes on posting of it reaches neither.
 * The turn sent after is what shows nothing was still on its way.
 */
test("a member's stop ends the turn's stream for every reader, and what its runner posts of it afterwards reaches none", async () => {
  const partition = await threadRigProject(rig, "live-stop");
  const member = threadRigMember(rig, partition, "live-stop");
  const thread = await threadRigThread(rig, partition, member);
  const begun: SessionLiveEvent[] = [
    { live: "Block", message: "message-1", index: 0, kind: "Text" },
    { live: "Text", message: "message-1", index: 0, offset: 0, text: "Hel" },
  ];
  const more: SessionLiveEvent = {
    live: "Text",
    message: "message-1",
    index: 0,
    offset: 3,
    text: "lo",
  };

  await using api = await serving(member.principal);
  await using workers = plane();
  const turn = await said(api, partition, thread.session, "live-stop");
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    thread.session,
    "live-stop",
  );
  assert.equal(await claimed(attempt), turn);
  const reader = await api.reading(partition, thread.session);
  const beside = await api.reading(partition, thread.session);
  await posted(workers, attempt.secret, turn, begun);
  assert.ok(await reaches(() => payloads(reader).length === 3));

  await stoppedBy(api, partition, thread.session, turn);
  const end = { version: threadLiveVersion, turn, event: { live: "End" } };
  for (const each of [reader, beside]) {
    assert.ok(await reaches(() => payloads(each).length === 4));
    assert.deepEqual(payloads(each).at(-1), end);
  }
  const late = await api.reading(partition, thread.session);
  assert.ok(await reaches(() => payloads(late).length === 1));
  assert.deepEqual(payloads(late), [nothing]);

  await posted(workers, attempt.secret, turn, [more]);
  const next = await said(api, partition, thread.session, "live-stop-next");
  assert.equal(await claimed(attempt), next);
  await posted(workers, attempt.secret, next, [begun[0] ?? more]);
  assert.ok(await reaches(() => payloads(late).length === 2));
  assert.deepEqual(payloads(late), [
    nothing,
    { version: threadLiveVersion, turn: next, event: begun[0] },
  ]);
  assert.deepEqual(payloads(reader).slice(4), payloads(late).slice(1));
});

/**
 * A runner that is writing posts as it writes, so the answer to its next post
 * is the soonest it can hear of a stop, and that answer is read from the
 * turn's own row. A runner built before the answer existed is answered as it
 * always was, as is a post of a turn that ended any other way, and of one
 * stopped while it waited, which no runner held.
 */
test("a live post of a turn its member stopped is answered with the turn, to a runner naming a release that reads the answer", async () => {
  const partition = await threadRigProject(rig, "live-told");
  const member = threadRigMember(rig, partition, "live-told");
  const thread = await threadRigThread(rig, partition, member);
  const text: SessionLiveEvent[] = [
    { live: "Block", message: "message-1", index: 0, kind: "Text" },
  ];
  const ended: SessionLiveEvent[] = [{ live: "End" }];

  await using api = await serving(member.principal);
  await using workers = plane();
  const turn = await said(api, partition, thread.session, "live-told");
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    thread.session,
    "live-told",
  );
  const post = (
    of: string,
    events: readonly SessionLiveEvent[],
    release?: string,
  ) => answered(workers, attempt.secret, of, events, release);
  const told = { status: 200, body: JSON.stringify({ turn }) };
  assert.equal(await claimed(attempt), turn);
  assert.deepEqual(await post(turn, text, workerContractRelease), taken);

  await stoppedBy(api, partition, thread.session, turn);

  assert.deepEqual(await post(turn, text, workerContractRelease), told);
  assert.deepEqual(await post(turn, ended, workerContractRelease), told);
  assert.deepEqual(await post(turn, text, "1.4.0"), taken);
  assert.deepEqual(await post(turn, text), taken);

  const next = await said(api, partition, thread.session, "live-told-next");
  assert.deepEqual(await post(next, text, workerContractRelease), taken);
  assert.equal(await claimed(attempt), next);
  assert.deepEqual(await post(next, text, workerContractRelease), taken);
  assert.deepEqual(await post(turn, text, workerContractRelease), told);
  assert.equal(
    await rig.sessions.plane.answer({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      turn: asSessionTurnId(next),
      result: "done",
    }),
    "Answered",
  );
  assert.deepEqual(await post(next, ended, workerContractRelease), taken);

  const waiting = await said(api, partition, thread.session, "live-told-wait");
  await stoppedBy(api, partition, thread.session, waiting);
  assert.deepEqual(await post(waiting, text, workerContractRelease), taken);
  assert.deepEqual(await post(waiting, ended, workerContractRelease), taken);
  assert.deepEqual(await post(turn, text, workerContractRelease), told);
});

test("a principal the project does not admit is answered as the thread read answers it, and is given no stream", async () => {
  const partition = await threadRigProject(rig, "live-stranger");
  const member = threadRigMember(rig, partition, "live-member");
  const thread = await threadRigThread(rig, partition, member);
  await using api = await serving(
    oidcPrincipal(threadRigIssuer, "live-stranger"),
  );
  const refused = await api.reading(partition, thread.session);
  assert.equal(refused.status, 404);
  assert.ok(await reaches(() => refused.body().includes("NotFound")));
  assert.deepEqual(identities(refused), []);
});
