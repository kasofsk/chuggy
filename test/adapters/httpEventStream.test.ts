/**
 * The stream's edge: that every refusal is answered before the reply is
 * hijacked, that the response head is written by the first frame and not by the
 * handler, and that a read the route would not answer with a 200 is a tombstone.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyReply } from "fastify";

import { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  projectResourceReader,
  projectStreamSocket,
  type ProjectStreamReads,
} from "../../src/adapters/http/eventStream.ts";
import { asInstallationId } from "../../src/domain/ids.ts";
import { asPrincipal } from "../../src/interpreter/nativeWeb.ts";
import type {
  ProjectStreamHub,
  ProjectStreamOpened,
} from "../../src/interpreter/projectStream.ts";
import { asProjectId, asTenantId } from "../../src/interpreter/projectStore.ts";
import { asSessionId } from "../../src/interpreter/agentSession.ts";
import { nativeHttpRoutes } from "../../src/contract/http.ts";
import { unservedNativeWeb } from "./threadFixtures.ts";

const partition = {
  tenant: asTenantId("tenant"),
  project: asProjectId("project"),
};
const principal = asPrincipal("issuer geoff");

const eventsPath = "/api/v1/tenants/tenant/projects/project/events";

function appOverHub(hub: ProjectStreamHub) {
  return createNativeHttpApp(
    unservedNativeWeb,
    {
      authenticateBearer: (token) =>
        Promise.resolve(
          token === "valid"
            ? {
                authenticated: "Bearer" as const,
                bearer: { principal },
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
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    hub,
  );
}

function refusingHub(opened: ProjectStreamOpened): ProjectStreamHub & {
  readonly openings: readonly unknown[];
} {
  const openings: unknown[] = [];
  return {
    openings,
    open: (opening) => {
      openings.push(opening);
      return Promise.resolve(opened);
    },
    close: () => Promise.resolve(),
  };
}

test("the events route is on the contract's own route table", () => {
  assert.equal(
    nativeHttpRoutes.events,
    "/api/v1/tenants/:tenant/projects/:project/events",
  );
});

test("a stream with no bearer is refused before the hub is asked", async () => {
  const hub = refusingHub({ opened: "AtCapacity" });
  await using app = appOverHub(hub);
  const answered = await app.inject({ method: "GET", url: eventsPath });
  assert.equal(answered.statusCode, 401);
  assert.notEqual(
    answered.headers["content-type"],
    "text/event-stream",
    "an unauthenticated caller must not be handed a stream",
  );
  assert.deepEqual(
    hub.openings,
    [],
    "a stream nobody authenticated is never opened",
  );
});

test("a stream past capacity is answered 503 rather than an empty stream", async () => {
  const hub = refusingHub({ opened: "AtCapacity" });
  await using app = appOverHub(hub);
  const answered = await app.inject({
    method: "GET",
    url: eventsPath,
    headers: { authorization: "Bearer valid" },
  });
  assert.equal(answered.statusCode, 503);
  assert.equal(answered.headers["retry-after"], "1");
  assert.equal(hub.openings.length, 1);
});

test("a consumer's cursor is the one the stream is opened on", async () => {
  const hub = refusingHub({ opened: "AtCapacity" });
  await using app = appOverHub(hub);
  await app.inject({
    method: "GET",
    url: eventsPath,
    headers: { authorization: "Bearer valid", "last-event-id": "41" },
  });
  assert.equal(
    (hub.openings[0] as { after?: number }).after,
    41,
    "Last-Event-ID is the cursor the hub resumes from",
  );
});

test("a cursor that is not a whole count opens a fresh stream", async () => {
  const hub = refusingHub({ opened: "AtCapacity" });
  await using app = appOverHub(hub);
  await app.inject({
    method: "GET",
    url: eventsPath,
    headers: { authorization: "Bearer valid", "last-event-id": "not-a-number" },
  });
  assert.equal(
    (hub.openings[0] as { after?: number }).after,
    undefined,
    "a cursor this server did not write is no cursor at all",
  );
});

/** The reads a case names, every other one raising if a row reaches it. */
function reads(over: Partial<ProjectStreamReads>): ProjectStreamReads {
  const unserved = (name: string) => () => {
    throw new Error(`${name}: this case does not serve it`);
  };
  return {
    ticket: unserved("ticket"),
    execution: unserved("execution"),
    lead: unserved("lead"),
    thread: unserved("thread"),
    inquiry: unserved("inquiry"),
    ...over,
  };
}

test("a read the route would not answer with a 200 is a tombstone", async () => {
  const reader = projectResourceReader(
    reads({
      ticket: () =>
        Promise.resolve({
          status: 404,
          headers: {},
          body: { error: "NotFound" },
        }),
      execution: () =>
        Promise.resolve({
          status: 200,
          headers: {},
          body: { task: "work:1:1" },
        }),
    }),
  );
  assert.equal(
    await reader.read(principal, partition, "Ticket", "7"),
    null,
    "a resource the route no longer answers is dropped from the cache",
  );
  assert.deepEqual(
    await reader.read(principal, partition, "Execution", "work:1:1"),
    { task: "work:1:1" },
    "a 200 is carried as the route's own body",
  );
});

test("a session row is read through the route its own kind names", async () => {
  const asked: string[] = [];
  const answer = (name: string) => () => {
    asked.push(name);
    return Promise.resolve({ status: 200, headers: {}, body: { name } });
  };
  const reader = projectResourceReader(
    reads({
      lead: answer("lead"),
      thread: answer("thread"),
      inquiry: answer("inquiry"),
    }),
  );
  for (const kind of ["Lead", "Thread", "Inquiry"])
    await reader.read(
      principal,
      partition,
      "Session",
      JSON.stringify({ session: "s-1", kind, state: "Open" }),
    );
  assert.deepEqual(
    asked,
    ["lead", "thread", "inquiry"],
    "the three session kinds are three separate resources",
  );
});

test("a ticket row naming something that is not a number is a fault", async () => {
  const reader = projectResourceReader(reads({}));
  await assert.rejects(
    () => reader.read(principal, partition, "Ticket", "seven"),
    RangeError,
    "an unreadable identity resets the stream rather than tombstoning a ticket",
  );
});

/** A reply whose raw socket records what was written to it, and when. */
function recordingReply() {
  const written: string[] = [];
  let head: number | undefined;
  const raw = {
    writableEnded: false,
    writeHead: (status: number) => {
      head = status;
    },
    write: (text: string) => {
      written.push(text);
      return true;
    },
    once: () => undefined,
    end: () => undefined,
  };
  return {
    written,
    headOf: () => head,
    reply: { raw } as unknown as FastifyReply,
  };
}

test("the response head is written by the first frame and not before", () => {
  const held = recordingReply();
  const sink = projectStreamSocket(held.reply);
  assert.equal(
    held.headOf(),
    undefined,
    "a socket that has sent nothing has answered nothing",
  );
  sink.send({ event: "ready", data: { version: 1 } });
  assert.equal(held.headOf(), 200);
  assert.deepEqual(held.written, ['event: ready\ndata: {"version":1}\n\n']);
});

test("a change frame carries its kind, its sequence and its data", () => {
  const held = recordingReply();
  const sink = projectStreamSocket(held.reply);
  sink.send({
    event: "Execution",
    sequence: 42,
    data: { version: 1, resource: "work:1:1", representation: null },
  });
  sink.beat();
  assert.deepEqual(held.written, [
    'event: Execution\nid: 42\ndata: {"version":1,"resource":"work:1:1","representation":null}\n\n',
    ":\n\n",
  ]);
});

test("a session identity is the one the read is given", async () => {
  const seen: string[] = [];
  const reader = projectResourceReader(
    reads({
      thread: (_principal, _partition, session) => {
        seen.push(session);
        return Promise.resolve({ status: 200, headers: {}, body: {} });
      },
    }),
  );
  await reader.read(
    principal,
    partition,
    "Session",
    JSON.stringify({ session: "s-9", kind: "Thread", turn: "t-1" }),
  );
  assert.deepEqual(seen, [asSessionId("s-9")]);
});
