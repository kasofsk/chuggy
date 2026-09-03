/**
 * The five thread routes over a real database, through the ports the ROOT
 * composes: the API's own role, 062's definers, and the HTTP boundary above
 * them.
 *
 * WHAT A DOUBLE CANNOT ANSWER. `test/adapters/httpThreads.test.ts` settles the
 * transport against a fake boundary and `test/postgres/threadDurable.test.ts`
 * settles the definers against a real server; neither can say the two were ever
 * joined. Until this suite there was no case in which `NativeThreadPorts` was
 * composed at all, so every route raised "no thread ports were composed" in a
 * deployment while every gate stayed green.
 *
 * THE BUNDLE IS THE ROOT'S OWN. `nativeThreadPorts` in `src/roots/nativeHttp.ts`
 * differs from what is built here in one thing — where the credential slot comes
 * from — because a root reads an environment and a case names a value.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  nativeHttpMediaType,
  sessionStorePageBatchesMax,
  sessionStoreStreamsAnswered,
  threadMessageCharsMax,
} from "../../src/contract/http.ts";
import type { HttpErrorEnvelope } from "../../src/contract/http.ts";
import {
  threadEntryResponseSchema,
  threadMessageAcceptedSchema,
  threadResponseSchema,
  threadTranscriptResponseSchema,
  threadsResponseSchema,
} from "../../src/contract/responses.ts";
import { threadSessionMint } from "../../src/adapters/crypto/threadSessionMint.ts";
import { postgresAgenticRefusalReads } from "../../src/adapters/postgres/agenticRefusal.ts";
import { postgresInstallationAuthority } from "../../src/adapters/postgres/installationAuthority.ts";
import { postgresLeadReads } from "../../src/adapters/postgres/leadReads.ts";
import { postgresProjectAccess } from "../../src/adapters/postgres/projectAccess.ts";
import { postgresExecutionBacklogGuard } from "../../src/adapters/postgres/schedulerContext.ts";
import { postgresSessionStoreRows } from "../../src/adapters/postgres/sessionStoreReads.ts";
import {
  postgresThreadSeeding,
  postgresThreads,
} from "../../src/adapters/postgres/thread.ts";
import { composeNativeWeb } from "../../src/compose.ts";
import {
  asSessionId,
  asSessionStoreStream,
} from "../../src/interpreter/agentSession.ts";
import { oidcPrincipal } from "../../src/interpreter/principal.ts";
import type { Partition } from "../../src/interpreter/projectStore.ts";
import { postgresHarnessKeying } from "./harness.ts";
import { sessionStoreDouble, sessionStoreEntryLine } from "./storeDouble.ts";
import { sessionRigAttempt } from "./sessionHarness.ts";
import {
  threadRigIssuer,
  threadRigMember,
  threadRigOpen,
  threadRigProject,
  threadRigRevoke,
  threadRigSlot,
  type ThreadRig,
  type ThreadRigMember,
} from "./threadHarness.ts";

let rig: ThreadRig;

before(async () => {
  rig = await threadRigOpen();
});

after(async () => {
  await rig.close();
});

/** The volume the batch rows point at, filled by the cases that record one. */
const storeReads = sessionStoreDouble();

const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };

/** The app the routes are driven through, with the bundle the root composes. */
function threadApp(principal: ThreadRigMember["principal"]) {
  const pool = rig.apiPool;
  const leads = postgresLeadReads(pool);
  const web = composeNativeWeb(
    pool,
    postgresHarnessKeying(),
    postgresProjectAccess(pool),
    postgresExecutionBacklogGuard(pool),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      leads,
      store: storeReads,
      refusals: postgresAgenticRefusalReads(pool),
      history: leads,
    },
    {
      threads: postgresThreads(pool, {
        streamsMax: sessionStoreStreamsAnswered,
      }),
      sessions: threadSessionMint(),
      seeding: postgresThreadSeeding(pool),
      rows: postgresSessionStoreRows(pool),
      store: storeReads,
      credentialSlot: threadRigSlot,
    },
  );
  return createNativeHttpApp(
    web,
    {
      authenticateBearer: () =>
        Promise.resolve({
          authenticated: "Bearer" as const,
          bearer: { principal },
        }),
    },
    { ready: () => Promise.resolve(true) },
    postgresInstallationAuthority(pool),
  );
}

function pathOf(partition: Partition): string {
  return `/api/v1/tenants/${partition.tenant}/projects/${partition.project}/threads`;
}

/** One member of a project no other case is holding, under the derived principal. */
async function readableMember(
  label: string,
): Promise<{ partition: Partition; member: ThreadRigMember }> {
  const partition = await threadRigProject(rig, `http-${label}`);
  const member = await threadRigMember(rig, partition, `http-${label}`);
  assert.equal(
    member.principal,
    oidcPrincipal(threadRigIssuer, member.authority.subject),
    "the principal the app authenticates as is the membership's own",
  );
  return { partition, member };
}

/** Opens the caller's thread through the door, refusing anything but the entry. */
async function openedThread(
  app: ReturnType<typeof threadApp>,
  partition: Partition,
) {
  const opened = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {},
  });
  assert.equal(opened.statusCode, 201, opened.body);
  return threadEntryResponseSchema.parse(opened.json());
}

test("opening my thread answers the entry, and opening again answers the same one", async () => {
  const { partition, member } = await readableMember("open");
  await using app = threadApp(member.principal);

  const entry = await openedThread(app, partition);
  assert.equal(entry.mine, true);
  assert.equal(entry.owner, member.authority.subject);
  assert.equal(entry.state, "Open");
  assert.equal(entry.turns, 0);

  const again = await app.inject({
    method: "POST",
    url: pathOf(partition),
    headers: versioned,
    payload: {},
  });
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(
    threadEntryResponseSchema.parse(again.json()).session,
    entry.session,
  );
});

test("the listing answers every thread the project holds, mine marked", async () => {
  const { partition, member } = await readableMember("list");
  const other = await threadRigMember(rig, partition, "http-list-other");
  await using app = threadApp(member.principal);
  const entry = await openedThread(app, partition);
  const theirs = await rig.threads.open({
    partition,
    principal: other.principal,
    session: rig.minting.session(),
    systemPrompt: "theirs",
    credentialSlot: threadRigSlot,
  });

  const listed = await app.inject({
    url: pathOf(partition),
    headers: authorized,
  });
  assert.equal(listed.statusCode, 200, listed.body);
  const body = threadsResponseSchema.parse(listed.json());
  assert.deepEqual(
    body.threads
      .map((thread) => [thread.session, thread.mine, thread.owner])
      .sort(),
    [
      [entry.session, true, member.authority.subject],
      [theirs.thread.session, false, other.authority.subject],
    ].sort(),
  );
});

test("a message reaches my own mailbox, and the thread read answers the turn", async () => {
  const { partition, member } = await readableMember("message");
  await using app = threadApp(member.principal);
  const opened = await openedThread(app, partition);

  const turn = `thread-turn-${randomUUID()}`;
  const sent = await app.inject({
    method: "POST",
    url: `${pathOf(partition)}/${opened.session}/messages`,
    headers: versioned,
    payload: { turn, message: "have a look at the footer" },
  });
  assert.equal(sent.statusCode, 202, sent.body);
  assert.deepEqual(threadMessageAcceptedSchema.parse(sent.json()), {
    turn,
    ordinal: 1,
  });

  const read = await app.inject({
    url: `${pathOf(partition)}/${opened.session}`,
    headers: authorized,
  });
  assert.equal(read.statusCode, 200, read.body);
  const body = threadResponseSchema.parse(read.json());
  assert.equal(body.session, opened.session);
  assert.equal(body.turns.length, 1);
  assert.equal(body.turns[0]?.turn, turn);
  assert.equal(body.turns[0]?.inputKind, "UserMessage");
  assert.equal(body.turns[0]?.state, "Queued");
  assert.ok(
    body.turns[0]?.input.includes("have a look at the footer"),
    "the first turn carries the member's message behind its seeding block",
  );
});

test("the transcript route walks the thread's own store", async () => {
  const { partition, member } = await readableMember("transcript");
  await using app = threadApp(member.principal);
  const opened = await openedThread(app, partition);
  await app.inject({
    method: "POST",
    url: `${pathOf(partition)}/${opened.session}/messages`,
    headers: versioned,
    payload: {
      turn: `thread-turn-${randomUUID()}`,
      message: "what is the footer for",
    },
  });
  const stream = asSessionStoreStream(`stream-${randomUUID()}`);
  const attempt = await sessionRigAttempt(
    rig.sessions,
    partition,
    asSessionId(opened.session),
    "http-transcript",
  );
  storeReads.put(
    {
      partition,
      session: asSessionId(opened.session),
      stream,
      batch: 1,
    },
    sessionStoreEntryLine(1),
  );
  assert.equal(
    await rig.sessions.plane.record({
      secret: attempt.secret,
      generation: attempt.attempt.generation,
      stream,
      batch: 1,
      digest: "d".repeat(64),
      bytes: 12,
      events: 1,
    }),
    "Stored",
  );

  const walked = await app.inject({
    url: `${pathOf(partition)}/${opened.session}/transcript?stream=${stream}&limit=${String(sessionStorePageBatchesMax)}`,
    headers: authorized,
  });
  assert.equal(walked.statusCode, 200, walked.body);
  const page = threadTranscriptResponseSchema.parse(walked.json());
  assert.equal(page.stream, stream);
  assert.equal(page.entries.length, 1);
  assert.equal(page.elided, 0);
});

/**
 * The two refusals the composed stack decides rather than the transport: the URL
 * naming a thread that is not the caller's, and a message to a thread whose
 * owner has no membership left.
 */
test("the door refuses another member's mailbox and an ownerless one", async () => {
  const { partition, member } = await readableMember("refused");
  const other = await threadRigMember(rig, partition, "http-refused-other");
  const theirs = await rig.threads.open({
    partition,
    principal: other.principal,
    session: rig.minting.session(),
    systemPrompt: "theirs",
    credentialSlot: threadRigSlot,
  });
  await using app = threadApp(member.principal);
  const mine = await openedThread(app, partition);

  const elsewhere = await app.inject({
    method: "POST",
    url: `${pathOf(partition)}/${theirs.thread.session}/messages`,
    headers: versioned,
    payload: { turn: `thread-turn-${randomUUID()}`, message: "not mine" },
  });
  assert.equal(elsewhere.statusCode, 403, elsewhere.body);
  assert.equal(elsewhere.json<HttpErrorEnvelope>().error.code, "NotYourThread");

  await threadRigRevoke(rig, partition, member);
  const orphaned = await app.inject({
    method: "POST",
    url: `${pathOf(partition)}/${mine.session}/messages`,
    headers: versioned,
    payload: { turn: `thread-turn-${randomUUID()}`, message: "still here?" },
  });
  assert.equal(orphaned.statusCode, 404, orphaned.body);
});

/** A caller with no membership at all reads nothing, which is what gates every route. */
test("a project the caller is not a member of answers nothing on any route", async () => {
  const { partition } = await readableMember("gated");
  const stranger = oidcPrincipal(threadRigIssuer, `stranger-${randomUUID()}`);
  await using app = threadApp(stranger);

  for (const [method, url] of [
    ["GET", pathOf(partition)],
    ["POST", pathOf(partition)],
    ["GET", `${pathOf(partition)}/thread-absent`],
    ["GET", `${pathOf(partition)}/thread-absent/transcript`],
  ] as const) {
    const refused = await app.inject({
      method,
      url,
      headers: method === "POST" ? versioned : authorized,
      ...(method === "POST" ? { payload: {} } : {}),
    });
    assert.equal(refused.statusCode, 404, `${method} ${url}`);
  }
  const message = await app.inject({
    method: "POST",
    url: `${pathOf(partition)}/thread-absent/messages`,
    headers: versioned,
    payload: { turn: `thread-turn-${randomUUID()}`, message: "hello" },
  });
  assert.equal(message.statusCode, 404, message.body);
});

/** The bound the door checks before anything reaches a mailbox. */
test("a message over the door's own bound never reaches the database", async () => {
  const { partition, member } = await readableMember("bound");
  await using app = threadApp(member.principal);
  const opened = await openedThread(app, partition);

  const refused = await app.inject({
    method: "POST",
    url: `${pathOf(partition)}/${opened.session}/messages`,
    headers: versioned,
    payload: {
      turn: `thread-turn-${randomUUID()}`,
      message: "x".repeat(threadMessageCharsMax + 1),
    },
  });
  assert.equal(refused.statusCode, 400, refused.body);
  const read = await app.inject({
    url: `${pathOf(partition)}/${opened.session}`,
    headers: authorized,
  });
  assert.deepEqual(threadResponseSchema.parse(read.json()).turns, []);
});
