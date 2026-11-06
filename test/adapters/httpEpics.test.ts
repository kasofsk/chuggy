/**
 * The epic routes through the real app: the status each outcome reaches the
 * wire as, the media type and the size the write requires, and the body each
 * answers.
 *
 * THE BOUNDARY IS A DOUBLE AND THE APP IS REAL, because what is settled here
 * is the transport. What the boundary decides — who may write, and what the
 * domain refuses — is settled in `test/interpreter/epics.test.ts`.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { createNativeHttpApp } from "../../src/adapters/http/server.ts";
import {
  epicContentBytesMax,
  epicWriteBodyBytesMax,
} from "../../src/contract/epics.ts";
import { nativeHttpMediaType } from "../../src/contract/http.ts";
import {
  epicGraphResponseSchema,
  epicHistoryResponseSchema,
  epicListResponseSchema,
  epicRefusalResponseSchema,
  epicViewResponseSchema,
  epicWriteResponseSchema,
} from "../../src/contract/responses.ts";
import type { EpicRefusal } from "../../src/domain/epics.ts";
import type { EpicWritten } from "../../src/interpreter/epics.ts";
import { servedNativeHttpApp, unservedNativeWeb } from "./threadFixtures.ts";

type EpicWeb = Parameters<typeof createNativeHttpApp>[0];

const root = "/api/v1/tenants/acme/projects/atlas/epics";
const authorized = { authorization: "Bearer valid" };
const versioned = { ...authorized, "content-type": nativeHttpMediaType };

const progress = {
  byPhase: {
    Pending: 1,
    Work: 0,
    Evaluation: 0,
    Finalization: 0,
    Done: 1,
    Escalated: 0,
    Revoked: 0,
  },
  done: 1,
  total: 2,
};

const summary = {
  number: 1,
  revision: 2,
  title: "the footer",
  visibility: "Active",
  progress,
  status: "in_progress",
  waitingOnOutside: [7],
} as const;

const content = {
  title: "the footer",
  description: "all of it",
  visibility: "Active",
  tickets: [3, 1],
};

interface EpicCase {
  readonly calls: string[];
  written?: EpicWritten;
  found?: boolean;
}

function epicWeb(held: EpicCase): EpicWeb {
  const read = <Value>(value: Value) =>
    Promise.resolve(
      held.found === false
        ? ({ result: "NotFound" } as const)
        : ({ result: "Found", value } as const),
    );
  return {
    ...unservedNativeWeb,
    epics: (_principal, _partition, query) => {
      held.calls.push(
        `list:${query.sort ?? ""}:${query.visibility ?? ""}:${String(query.limit)}:${String(query.after ?? "")}`,
      );
      return read({ epics: [summary], nextAfter: 1 });
    },
    epic: (_principal, _partition, epic) => {
      held.calls.push(`view:${String(epic)}`);
      return read({ ...summary, description: "all of it", tickets: [1, 3] });
    },
    epicHistory: (_principal, _partition, epic, query) => {
      held.calls.push(`history:${String(epic)}:${String(query.limit)}`);
      return read({
        revisions: [
          {
            revision: 2,
            changedAt: "2026-11-05T09:00:00.000Z",
            actor: { kind: "User", subject: "geoff" },
            title: "the footer",
          },
        ],
      });
    },
    epicGraph: (_principal, _partition, epic) => {
      held.calls.push(`graph:${String(epic)}`);
      return read({
        nodes: [
          { ticket: 1, title: "one", phase: "Done", member: true },
          { ticket: 7, phase: "Work", member: false },
        ],
        edges: [{ from: 7, to: 1 }],
      });
    },
    writeEpic: (_principal, _partition, command) => {
      held.calls.push(`write:${command.kind}`);
      return Promise.resolve(
        held.written ?? {
          result: "Decided",
          outcome: { kind: "Saved", epic: 1, revision: 1 },
        },
      );
    },
  };
}

function appOf(held: EpicCase) {
  return servedNativeHttpApp(epicWeb(held));
}

function refused(reason: EpicRefusal["reason"]): EpicWritten {
  const outcome: EpicRefusal =
    reason === "StaleRevision"
      ? { kind: "Refused", reason, current: 4 }
      : reason === "UnknownTickets"
        ? { kind: "Refused", reason, tickets: [9] }
        : { kind: "Refused", reason };
  return { result: "Decided", outcome };
}

test("the list, the view, the history and the graph answer what their schemas name", async () => {
  const held: EpicCase = { calls: [] };
  await using app = appOf(held);

  const list = await app.inject({
    url: `${root}?sort=title&visibility=All&limit=5&after=2`,
    headers: authorized,
  });
  const view = await app.inject({ url: `${root}/1`, headers: authorized });
  const history = await app.inject({
    url: `${root}/1/history?limit=3`,
    headers: authorized,
  });
  const graph = await app.inject({
    url: `${root}/1/graph`,
    headers: authorized,
  });

  assert.equal(list.statusCode, 200);
  assert.deepEqual(epicListResponseSchema.parse(list.json()).epics, [summary]);
  assert.equal(view.statusCode, 200);
  assert.deepEqual(epicViewResponseSchema.parse(view.json()).tickets, [1, 3]);
  assert.equal(history.statusCode, 200);
  assert.equal(
    epicHistoryResponseSchema.parse(history.json()).revisions.length,
    1,
  );
  assert.equal(graph.statusCode, 200);
  assert.equal(epicGraphResponseSchema.parse(graph.json()).edges.length, 1);
  assert.deepEqual(held.calls, [
    "list:title:All:5:2",
    "view:1",
    "history:1:3",
    "graph:1",
  ]);
});

test("a list with no query is asked for its defaults, and an unknown field is a bad request", async () => {
  const held: EpicCase = { calls: [] };
  await using app = appOf(held);

  const plain = await app.inject({ url: root, headers: authorized });
  const odd = await app.inject({
    url: `${root}?color=red`,
    headers: authorized,
  });

  assert.equal(plain.statusCode, 200);
  assert.equal(odd.statusCode, 400);
  assert.deepEqual(held.calls, ["list:::20:"]);
});

test("a project or epic the caller cannot see is not found on every read", async () => {
  const held: EpicCase = { calls: [], found: false };
  await using app = appOf(held);

  for (const url of [root, `${root}/1`, `${root}/1/history`, `${root}/1/graph`])
    assert.equal(
      (await app.inject({ url, headers: authorized })).statusCode,
      404,
      url,
    );
});

test("a write is saved and answers the epic and its revision", async () => {
  const held: EpicCase = { calls: [] };
  await using app = appOf(held);

  const created = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: { kind: "Create", content },
  });
  const revised = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: { kind: "Revise", epic: 1, expected: 1, content },
  });

  assert.equal(created.statusCode, 200);
  assert.deepEqual(epicWriteResponseSchema.parse(created.json()), {
    epic: 1,
    revision: 1,
  });
  assert.equal(revised.statusCode, 200);
  assert.deepEqual(held.calls, ["write:Create", "write:Revise"]);
});

test("a write needs the versioned media type, and a body the schema takes", async () => {
  const held: EpicCase = { calls: [] };
  await using app = appOf(held);

  const plain = await app.inject({
    method: "POST",
    url: root,
    headers: { ...authorized, "content-type": "application/json" },
    payload: { kind: "Create", content },
  });
  const odd = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: { kind: "Create", content, why: "because" },
  });

  assert.equal(plain.statusCode, 415);
  assert.equal(odd.statusCode, 400);
  assert.deepEqual(held.calls, []);
});

test("a write is admitted up to the content bound and its envelope, and refused past it", async () => {
  const held: EpicCase = { calls: [] };
  await using app = appOf(held);
  const body = (description: string) =>
    JSON.stringify({ kind: "Create", content: { ...content, description } });
  const filler = epicContentBytesMax;

  const admitted = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: body("x".repeat(filler)),
  });
  const over = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: body("x".repeat(epicWriteBodyBytesMax)),
  });

  assert.equal(admitted.statusCode, 200);
  assert.equal(over.statusCode, 413);
  assert.deepEqual(held.calls, ["write:Create"]);
});

test("a caller who may read and not mutate is forbidden, and one who may not read is not found", async () => {
  const forbidden: EpicCase = {
    calls: [],
    written: { result: "Forbidden" },
  };
  const hidden: EpicCase = { calls: [], written: { result: "NotFound" } };
  const send = (app: ReturnType<typeof appOf>) =>
    app.inject({
      method: "POST",
      url: root,
      headers: versioned,
      payload: { kind: "Create", content },
    });
  await using forbiddenApp = appOf(forbidden);
  await using hiddenApp = appOf(hidden);

  assert.equal((await send(forbiddenApp)).statusCode, 403);
  assert.equal((await send(hiddenApp)).statusCode, 404);
});

test("a refusal with a reason is a conflict carrying what the reason names, and a missing epic is not found", async () => {
  const reasons = [
    "ArchivedEpic",
    "EmptyTitle",
    "LongTitle",
    "LongSummary",
    "LargeContent",
    "StaleRevision",
    "UnknownTickets",
  ] as const;
  for (const reason of reasons) {
    const held: EpicCase = { calls: [], written: refused(reason) };
    await using app = appOf(held);

    const response = await app.inject({
      method: "POST",
      url: root,
      headers: versioned,
      payload: { kind: "Create", content },
    });
    const body = epicRefusalResponseSchema.parse(response.json());

    assert.equal(response.statusCode, 409, reason);
    assert.equal(body.error.code, reason);
    assert.equal(body.current, reason === "StaleRevision" ? 4 : undefined);
    assert.deepEqual(
      body.tickets,
      reason === "UnknownTickets" ? [9] : undefined,
    );
  }

  const held: EpicCase = { calls: [], written: refused("MissingEpic") };
  await using app = appOf(held);
  const missing = await app.inject({
    method: "POST",
    url: root,
    headers: versioned,
    payload: { kind: "Revise", epic: 9, expected: 1, content },
  });
  assert.equal(missing.statusCode, 404);
  assert.equal(
    epicRefusalResponseSchema.parse(missing.json()).error.code,
    "MissingEpic",
  );
});
