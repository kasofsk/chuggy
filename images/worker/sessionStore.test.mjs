import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  sessionStoreAdapter,
  sessionStoreBatchBytesMax,
  sessionStoreStream,
} from "./sessionStore.mjs";

/**
 * A `Bash` result entry of the shape the runtime writes: the identity a
 * transcript is walked by, and the output in the message's `tool_result` block
 * and again in the entry's own `toolUseResult`. How many times a producer
 * repeats its result is the runtime's business rather than this image's, so the
 * count is a parameter and the third copy goes where a block of content parts
 * would put it.
 */
function bashEntry(stdout, copies = 2) {
  const result = { stdout, stderr: "", interrupted: false, isImage: false };
  if (copies > 2) result.content = [{ type: "text", text: stdout }];
  return {
    parentUuid: "0d58b3dd-4b2f-42b9-9af5-bc1c23f8e254",
    isSidechain: false,
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_019XZRLcSZRv7FHunqneCm3d",
          type: "tool_result",
          content: stdout,
          is_error: false,
        },
      ],
    },
    uuid: "8becba21-e445-496f-bf38-c1fc7fb11506",
    timestamp: "2026-09-02T22:18:44.130Z",
    toolUseResult: result,
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
    gitBranch: "HEAD",
  };
}

/**
 * An image read's entry, whose bulk sits under field names nothing here knows:
 * it is the second producer the suite drives, so what finds a result's text is
 * held to being its weight rather than a tool this image anticipated.
 */
function readEntry(data) {
  return {
    parentUuid: "6f9b6b17-6a26-4b4f-9a86-16a1ef7a1a0d",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_01ReadImage",
          type: "tool_result",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data },
            },
          ],
        },
      ],
    },
    uuid: "d3a7d0d7-6b0f-4f7c-9d3e-2c0e2b1f7a55",
    timestamp: "2026-09-02T22:19:02.010Z",
    toolUseResult: { type: "image", file: { base64: data, type: "image/png" } },
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
  };
}

/**
 * An `Edit` result entry: its bulk is the file it wrote and a structured patch
 * whose lines are each far lighter than the note that would replace one. It is
 * the shape a clip that only knew single strings cannot bring under the bound.
 */
function editEntry(content, patches, linesEach) {
  return {
    parentUuid: "b1f0a0e2-1a55-4f2a-8f27-5f2a6b3c9e10",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_01EditTheFile",
          type: "tool_result",
          content: "The file was updated.",
        },
      ],
    },
    uuid: "9f21b6c4-4c5a-42f0-9a3e-70b1c2d3e4f5",
    timestamp: "2026-09-02T22:20:11.500Z",
    toolUseResult: {
      filePath: "/workspace/repo/src/held.ts",
      content,
      structuredPatch: Array.from({ length: patches }, (_, patch) => ({
        oldStart: patch * linesEach,
        newStart: patch * linesEach,
        oldLines: linesEach,
        newLines: linesEach,
        lines: Array.from(
          { length: linesEach },
          (_, line) =>
            `+  const held${String(patch)}x${String(line)} = readTheLine(at);`,
        ),
      })),
    },
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
  };
}

/**
 * Output a line is charged several bytes for every character of, as a shell
 * redrawing its own progress writes: a control character has no short escape,
 * so the line carries it as an escaped code point.
 */
function controlOutput(characters) {
  const unit = String.fromCharCode(0, 1, 2, 3, 4, 5, 6, 7);
  return unit.repeat(Math.ceil(characters / unit.length)).slice(0, characters);
}

/** The lines of every body a run posted, parsed. */
function postedEntries(calls) {
  return bodies(calls).flatMap(({ body }) =>
    body
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line)),
  );
}

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

function storeOf(answer, mode = {}) {
  const plane = planeOf(answer);
  return {
    ...plane,
    store: sessionStoreAdapter(task, "chgs_b", { ...plane, ...mode }),
  };
}

function entry(uuid, bytes = 8) {
  return { uuid, type: "assistant", text: "x".repeat(bytes) };
}

function bodies(calls) {
  return calls
    .filter(({ init }) => init.method === "PUT")
    .map(({ path, init }) => ({ path, body: init.body.toString("utf8") }));
}

/**
 * The entry a clip cannot save: its weight is in numbers, so there is no string
 * in it heavier than the note that would replace one. It is the residue the
 * store still raises on, and the store's own suite is the only place it exists.
 */
function denseEntry(uuid, numbers) {
  return {
    uuid,
    type: "assistant",
    data: Array.from({ length: numbers }, (_, at) => 1_000_000 + at),
  };
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

/**
 * The line nothing can split, several times over the body the plane accepts
 * because the runtime charged it escaped bytes for every character of a shell's
 * redraws and then wrote the result twice. It goes as a clipped entry: posting
 * it whole is a refusal the session reads as `StoreRefused`, and raising on it
 * is the same stop under another name.
 */
test("an entry no batch holds is clipped into one batch and keeps what walks the transcript", async () => {
  const { calls, store } = storeOf();
  const given = bashEntry(controlOutput(30_000));
  const asGiven = JSON.stringify(given);

  await store.append({ sessionId: "s" }, [given]);

  assert.equal(
    JSON.stringify(given),
    asGiven,
    "the clip reached the entry the runtime is still writing to its own file",
  );

  const written = bodies(calls);
  assert.equal(written.length, 1, "the clipped entry did not go as one batch");
  assert.ok(
    Buffer.byteLength(written[0].body) <= sessionStoreBatchBytesMax,
    `the clipped body is ${String(Buffer.byteLength(written[0].body))} bytes`,
  );
  const posted = postedEntries(calls);
  assert.equal(posted.length, 1);
  for (const field of [
    "uuid",
    "parentUuid",
    "type",
    "timestamp",
    "sessionId",
    "cwd",
    "version",
  ])
    assert.equal(posted[0][field], given[field], `${field} did not survive`);
  assert.equal(posted[0].message.role, given.message.role);
  assert.equal(
    posted[0].message.content[0].tool_use_id,
    given.message.content[0].tool_use_id,
  );
  assert.equal(posted[0].message.content[0].type, "tool_result");
});

test("every copy of the clipped text carries a head of it and what the original weighed", async () => {
  const { calls, store } = storeOf();
  const stdout = controlOutput(30_000);
  const weight = String(Buffer.byteLength(stdout));

  await store.append({ sessionId: "s" }, [bashEntry(stdout, 3)]);

  const [posted] = postedEntries(calls);
  const copies = [
    posted.message.content[0].content,
    posted.toolUseResult.stdout,
    posted.toolUseResult.content[0].text,
  ];
  for (const copy of copies) {
    assert.ok(copy.includes("the session store clipped"), "a copy was not cut");
    assert.ok(copy.includes(weight), "a copy does not say what was cut");
    assert.ok(
      stdout.startsWith(copy.slice(0, copy.indexOf("\n["))),
      "a copy is not a head of the original",
    );
    assert.ok(copy.indexOf("\n[") > 0, "a copy kept no head at all");
  }
});

/**
 * The producer this image has never seen: an image read puts its bulk under
 * field names nothing here knows, and it is clipped all the same because weight
 * is what the store looks for.
 */
test("a result under field names nothing anticipated is clipped by weight", async () => {
  const { calls, store } = storeOf();

  await store.append({ sessionId: "s" }, [readEntry("QUJDRA".repeat(20_000))]);

  const [posted] = postedEntries(calls);
  const source = posted.message.content[0].content[0].source;
  assert.equal(source.media_type, "image/png");
  for (const copy of [source.data, posted.toolUseResult.file.base64])
    assert.ok(copy.includes("the session store clipped"), "a copy was not cut");
});

/**
 * The entry whose bulk is a list rather than a text: no line of a diff is
 * heavier than the note that would replace it, so a clip that took only single
 * strings would leave this one over the bound and stop the session.
 */
test("a result whose bulk is a list of lines is clipped as a list", async () => {
  const { calls, store } = storeOf();
  const given = editEntry("held\n".repeat(4_000), 30, 80);

  await store.append({ sessionId: "s" }, [given]);

  const written = bodies(calls);
  assert.equal(written.length, 1);
  assert.ok(
    Buffer.byteLength(written[0].body) <= sessionStoreBatchBytesMax,
    `the clipped body is ${String(Buffer.byteLength(written[0].body))} bytes`,
  );
  const [posted] = postedEntries(calls);
  assert.equal(posted.uuid, given.uuid);
  assert.equal(
    posted.toolUseResult.filePath,
    given.toolUseResult.filePath,
    "the path the edit named did not survive",
  );
  const patched = posted.toolUseResult.structuredPatch;
  assert.equal(patched.length, given.toolUseResult.structuredPatch.length);
  for (const patch of patched)
    assert.ok(Array.isArray(patch.lines), "a patch stopped being a list");
  assert.ok(
    patched.some(({ lines }) =>
      lines.at(-1).includes("the session store clipped"),
    ),
    "no list of lines was cut, so nothing but the file's text was",
  );
});

test("an entry at the bound is posted as the bytes it arrived as", async () => {
  const { calls, store } = storeOf();
  const envelope = Buffer.byteLength(JSON.stringify(entry("a", 0)));
  const given = entry("a", sessionStoreBatchBytesMax - envelope - 1);

  await store.append({ sessionId: "s" }, [given]);

  const written = bodies(calls);
  assert.equal(
    Buffer.byteLength(written[0].body),
    sessionStoreBatchBytesMax,
    "the entry at the bound was not the batch",
  );
  assert.equal(written[0].body, `${JSON.stringify(given)}\n`);
});

test("a clipped entry loads back off the store as an entry", async () => {
  const { calls, store } = storeOf();
  await store.append({ sessionId: "s" }, [bashEntry(controlOutput(30_000))]);
  const [{ body }] = bodies(calls);

  const reader = storeOf((path) =>
    path.startsWith("/v1/session/store/s?")
      ? { status: 200, body: { batches: [{ batch: 1, content: body }] } }
      : { status: 204 },
  );
  const loaded = await reader.store.load({ sessionId: "s" });

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].uuid, bashEntry("").uuid);
  assert.equal(loaded[0].parentUuid, bashEntry("").parentUuid);
  assert.ok(loaded[0].toolUseResult.stdout.includes("clipped"));
});

test("two entries no batch holds both land, in order, with the entries around them", async () => {
  const { calls, store } = storeOf();
  const big = (uuid) => ({
    ...bashEntry(controlOutput(30_000)),
    uuid,
  });

  await store.append({ sessionId: "s" }, [
    entry("a"),
    big("b"),
    entry("c"),
    big("d"),
    entry("e"),
  ]);

  for (const { path, body } of bodies(calls))
    assert.ok(
      Buffer.byteLength(body) <= sessionStoreBatchBytesMax,
      `${path} is ${String(Buffer.byteLength(body))} bytes`,
    );
  assert.deepEqual(
    postedEntries(calls).map(({ uuid }) => uuid),
    ["a", "b", "c", "d", "e"],
  );
});

/**
 * The residue: an entry whose weight is not in any string a clip could shorten.
 * It still raises, and it still names what the entry weighs, because a body the
 * plane refuses is the one outcome the store may not produce.
 */
test("an entry no clip brings under the bound raises, naming what it weighs", async () => {
  const { calls, store } = storeOf();
  const given = denseEntry("a", 12_000);

  await assert.rejects(
    store.append({ sessionId: "s" }, [given]),
    (raised) =>
      /clipping does not bring under/u.test(raised.message) &&
      raised.message.includes(String(Buffer.byteLength(JSON.stringify(given)))),
  );

  assert.deepEqual(bodies(calls), [], "the over-long entry was posted anyway");
});

/**
 * The entry nothing can post, arriving in the same call as a batch the plane
 * never acknowledged. The resend is what closes the hole the unacknowledged
 * batch is; a raise that ran first would open it in the one case where the
 * transcript is already losing an entry.
 */
test("an entry no clip can save still lets the unacknowledged batch be re-sent", async () => {
  let refuse = true;
  const { calls, store } = storeOf(() =>
    refuse ? new Error("plane unreachable") : { status: 204 },
  );

  await assert.rejects(store.append({ sessionId: "s" }, [entry("a")]));
  refuse = false;
  await assert.rejects(
    store.append({ sessionId: "s" }, [entry("a"), denseEntry("b", 12_000)]),
    /clipping does not bring under/u,
  );

  const written = bodies(calls);
  assert.equal(written.length, 2, "the unacknowledged batch was not re-sent");
  assert.equal(written[1].path, "/v1/session/store/s/1");
  assert.equal(written[0].body, written[1].body);
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

test("an ephemeral store sends no batch however much a turn appends, and names none", async () => {
  const { calls, store } = storeOf(undefined, { retain: false });

  store.startTurn();
  for (let append = 0; append < 4; append += 1)
    await store.append({ sessionId: "s" }, [
      entry(`a${String(append)}`),
      entry(`b${String(append)}`, sessionStoreBatchBytesMax / 2),
    ]);
  await store.append({ sessionId: "s", subpath: "subagent-7" }, [entry("c")]);

  assert.equal(calls.length, 0, "an ephemeral store reached the plane");
  assert.deepEqual(store.turnBatches(), {});
});

test("an ephemeral store still reads the transcript it was forked from", async () => {
  const { calls, store } = storeOf(
    (path) =>
      path.startsWith("/v1/session/store/lead-1?")
        ? {
            status: 200,
            body: {
              batches: [
                { batch: 1, content: `${JSON.stringify(entry("a"))}\n` },
              ],
            },
          }
        : { status: 200, body: { streams: [{ stream: "lead-1/subagent-7" }] } },
    { retain: false },
  );

  const loaded = await store.load({ sessionId: "lead-1" });

  assert.deepEqual(
    loaded.map(({ uuid }) => uuid),
    ["a"],
  );
  assert.deepEqual(await store.listSubkeys({ sessionId: "lead-1" }), [
    "subagent-7",
  ]);
  assert.deepEqual(
    calls.map(({ path }) => path),
    [
      "/v1/session/store/lead-1?after=0&limit=8",
      "/v1/session/store?stream=lead-1",
    ],
  );
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
