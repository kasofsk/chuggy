import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  sessionStoreAdapter,
  sessionStoreBatchBytesMax,
  sessionStoreStream,
} from "./sessionStore.mjs";

const task = { workerPlane: { url: "http://worker-plane.test:3001" } };

function planeOf(answer) {
  const calls = [];
  return {
    calls,
    request: async (_task, _bearer, path, init) => {
      calls.push({ path, init });
      const given = answer?.(path, init, calls.length) ?? { status: 204 };
      if (given instanceof Error) throw given;
      return { status: given.status ?? 204, json: async () => given.body };
    },
  };
}

function storeOf(answer) {
  const plane = planeOf(answer);
  return { ...plane, store: sessionStoreAdapter(task, "chgs_b", plane) };
}

function entry(uuid, bytes = 8) {
  return { uuid, type: "assistant", text: "x".repeat(bytes) };
}

function bodies(calls) {
  return calls
    .filter(({ init }) => init.method === "PUT")
    .map(({ path, init }) => ({ path, body: init.body.toString("utf8") }));
}

test("a stream is the session id and its subpath, and the project key is not in it", async () => {
  assert.equal(
    sessionStoreStream({ projectKey: "-tmp-a", sessionId: "s" }),
    "s",
  );
  assert.equal(
    sessionStoreStream({
      projectKey: "-tmp-b",
      sessionId: "s",
      subpath: "sub",
    }),
    "s/sub",
  );

  const { calls, store } = storeOf();
  await store.append({ projectKey: "-tmp-a", sessionId: "s" }, [entry("a")]);
  await store.append({ projectKey: "-tmp-b", sessionId: "s" }, [entry("b")]);

  assert.deepEqual(
    bodies(calls).map(({ path }) => path),
    ["/v1/session/store/s/1", "/v1/session/store/s/2"],
  );
});

test("one append fills contiguous batches at the wire body's bound", async () => {
  const { calls, store } = storeOf();
  const third = Math.floor(sessionStoreBatchBytesMax / 2) - 100;

  await store.append({ sessionId: "s" }, [
    entry("a", third),
    entry("b", third),
    entry("c", third),
  ]);

  const written = bodies(calls);
  assert.deepEqual(
    written.map(({ path }) => path),
    ["/v1/session/store/s/1", "/v1/session/store/s/2"],
  );
  for (const { path, body } of written)
    assert.ok(
      Buffer.byteLength(body) <= sessionStoreBatchBytesMax,
      `${path} is ${String(Buffer.byteLength(body))} bytes`,
    );
  assert.equal(written[0].body.trimEnd().split("\n").length, 2);
  assert.equal(written[1].body.trimEnd().split("\n").length, 1);
});

test("a batch the plane never acknowledged is re-sent as the same bytes under the same number", async () => {
  let refuse = true;
  const { calls, store } = storeOf(() =>
    refuse ? new Error("plane unreachable") : { status: 204 },
  );
  const entries = [entry("a"), entry("b")];

  await assert.rejects(store.append({ sessionId: "s" }, entries));
  refuse = false;
  await store.append({ sessionId: "s" }, entries);

  const written = bodies(calls);
  assert.equal(written.length, 2);
  assert.equal(written[0].path, "/v1/session/store/s/1");
  assert.equal(written[1].path, "/v1/session/store/s/1");
  assert.equal(written[0].body, written[1].body);
});

test("a confirmed entry is dropped on re-delivery and an entry with no uuid never is", async () => {
  const { calls, store } = storeOf();
  const bookkeeping = { type: "ai-title", title: "a session" };
  const entries = [entry("a"), entry("b"), bookkeeping];

  await store.append({ sessionId: "s" }, entries);
  await store.append({ sessionId: "s" }, entries);

  const written = bodies(calls);
  assert.equal(written.length, 2);
  assert.equal(written[0].body.trimEnd().split("\n").length, 3);
  assert.deepEqual(
    written[1].body
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line)),
    [bookkeeping],
  );
});

test("load pages until the plane names no next batch, and seeds what it confirmed", async () => {
  const page = (batches, nextAfter) => ({
    status: 200,
    body: { batches, nextAfter },
  });
  const { calls, store } = storeOf((path) => {
    if (!path.startsWith("/v1/session/store/s?")) return { status: 204 };
    return path.includes("after=0")
      ? page(
          [
            { batch: 1, content: `${JSON.stringify(entry("a"))}\n` },
            { batch: 2, content: `${JSON.stringify(entry("b"))}\n` },
          ],
          2,
        )
      : page(
          [{ batch: 3, content: `${JSON.stringify(entry("c"))}\n` }],
          undefined,
        );
  });

  const loaded = await store.load({ projectKey: "-tmp-a", sessionId: "s" });
  await store.append({ sessionId: "s" }, [entry("a"), entry("d")]);

  assert.equal(loaded.length, 3);
  assert.equal(
    calls.filter(({ path }) => path.startsWith("/v1/session/store/s?")).length,
    2,
  );
  const written = bodies(calls);
  assert.equal(written[0].path, "/v1/session/store/s/4");
  assert.deepEqual(
    written[0].body
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line).uuid),
    ["d"],
  );
});

test("a stream with no batches is no session at all", async () => {
  const { store } = storeOf(() => ({ status: 200, body: { batches: [] } }));

  assert.equal(await store.load({ sessionId: "s" }), null);
});

test("a batch a row names and nothing can read refuses the load rather than holing it", async () => {
  const { store } = storeOf(() => ({
    status: 200,
    body: { batches: [{ batch: 1, read: "Missing" }] },
  }));

  await assert.rejects(store.load({ sessionId: "s" }), /cannot be read/u);
});

test("listSubkeys answers the suffixes the plane holds for the session's own id", async () => {
  const { calls, store } = storeOf(() => ({
    status: 200,
    body: {
      streams: [
        { stream: "s", batches: 14 },
        { stream: "s/subagent-7", batches: 3 },
        { stream: "s/subagent-9", batches: 1 },
      ],
    },
  }));

  const subkeys = await store.listSubkeys({
    projectKey: "-tmp-a",
    sessionId: "s",
  });

  assert.deepEqual(subkeys, ["subagent-7", "subagent-9"]);
  assert.equal(calls[0].path, "/v1/session/store?stream=s");
});

test("the three methods a session pod does not implement raise rather than answer nothing", () => {
  const { store } = storeOf();

  assert.throws(() => store.listSessions(), /enumerate/u);
  assert.throws(() => store.listSessionSummaries(), /summarize/u);
  assert.throws(() => store.delete(), /delete/u);
});

test("the batches one turn wrote are what its answer carries", async () => {
  const { store } = storeOf();

  store.startTurn();
  assert.deepEqual(store.turnBatches(), {});
  await store.append({ sessionId: "s" }, [entry("a")]);
  await store.append({ sessionId: "s" }, [entry("b")]);
  assert.deepEqual(store.turnBatches(), { batchFirst: 1, batchLast: 2 });

  store.startTurn();
  await store.append({ sessionId: "s" }, [entry("c")]);
  assert.deepEqual(store.turnBatches(), { batchFirst: 3, batchLast: 3 });
});

test("a subagent's stream is not the session's own, and is not in the turn's range", async () => {
  const { store } = storeOf();

  store.startTurn();
  await store.append({ sessionId: "s", subpath: "subagent-7" }, [entry("a")]);

  assert.deepEqual(store.turnBatches(), {});
});

test("a stream writes the uuids another stream of the same session already confirmed", async () => {
  const shared = [entry("a"), entry("b"), entry("c")];
  const parentPage = {
    status: 200,
    body: {
      batches: [
        {
          batch: 1,
          content: `${shared.map((held) => JSON.stringify(held)).join("\n")}\n`,
        },
      ],
    },
  };
  const { calls, store } = storeOf((path) =>
    path.startsWith("/v1/session/store/parent?") ? parentPage : { status: 204 },
  );

  await store.load({ projectKey: "-tmp-a", sessionId: "parent" });
  await store.append({ sessionId: "fork" }, [...shared, entry("d")]);
  await store.append({ sessionId: "parent", subpath: "subagent-7" }, shared);
  await store.append({ sessionId: "parent" }, shared);

  const written = bodies(calls);
  assert.deepEqual(
    written.map(({ path }) => path),
    ["/v1/session/store/fork/1", "/v1/session/store/parent%2Fsubagent-7/1"],
    "a stream was denied entries another stream had confirmed",
  );
  assert.deepEqual(
    written[0].body
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line).uuid),
    ["a", "b", "c", "d"],
  );
  assert.deepEqual(
    written[1].body
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line).uuid),
    ["a", "b", "c"],
  );
});

test("a load that reaches its page bound refuses rather than answering a short transcript", async () => {
  const { store } = storeOf(() => ({
    status: 200,
    body: { batches: [], nextAfter: 8 },
  }));

  await assert.rejects(store.load({ sessionId: "s" }), /paged s to its bound/u);
});
