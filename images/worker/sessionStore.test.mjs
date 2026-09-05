import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  sessionStoreAdapter,
  sessionStoreBatchBytesMax,
  sessionStoreClipBudgetBytes,
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
 * An image read's entry: the payload sits base64 in the block the API is sent
 * and again in the entry's own record, with a text block beside it for whatever
 * the tool said in words.
 */
function readEntry(data, beside = "The image was read.") {
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
            { type: "text", text: beside },
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
 * A tool answering with a media block: the block the API validates, inside the
 * `tool_result` that answers the call, with the entry's own record beside it.
 * What the block carries is the caller's business, which is the point — the
 * store is not allowed to decide by it.
 */
function mediaEntry(block, held = {}) {
  return {
    parentUuid: "8f7e6d5c-4b3a-4291-8180-7f6e5d4c3b2a",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_01ReadTheDocument",
          type: "tool_result",
          content: [block],
        },
      ],
    },
    uuid: "7e6d5c4b-3a29-4180-9f8e-7d6c5b4a3928",
    timestamp: "2026-09-02T22:27:00.000Z",
    toolUseResult: held,
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
  };
}

/**
 * The turn that calls a tool with an image in its arguments, and the line that
 * answers it. Two entries, because what the clip must not break is the pair: the
 * answer names the call by id, and the call is only a call while its block is on
 * the assistant line.
 */
function uploadEntries(data) {
  const call = {
    parentUuid: "c1d2e3f4-a5b6-4708-8192-a3b4c5d6e7f8",
    type: "assistant",
    message: {
      id: "msg_01UploadTheFrame",
      role: "assistant",
      model: "claude-opus-4-6",
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Uploading the failing frame." },
        {
          type: "tool_use",
          id: "toolu_01Upload",
          name: "upload_screenshot",
          input: {
            caption: "the failing frame",
            source: { type: "base64", media_type: "image/png", data },
          },
        },
      ],
    },
    uuid: "d4e5f6a7-b8c9-4a0b-8c1d-2e3f4a5b6c7d",
    timestamp: "2026-09-02T22:26:00.000Z",
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
  };
  const answer = {
    parentUuid: call.uuid,
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_01Upload",
          type: "tool_result",
          content: "uploaded",
        },
      ],
    },
    uuid: "e5f6a7b8-c9d0-4b1c-8d2e-3f4a5b6c7d8e",
    timestamp: "2026-09-02T22:26:01.000Z",
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
  };
  return [call, answer];
}

/**
 * A producer nothing in this tree anticipates: plain text under field names no
 * rule here knows, in the two places a result is written. It is what holds the
 * store to finding a result by weight rather than by a name it was taught.
 */
function unknownEntry(markup) {
  return {
    parentUuid: "2a5c8d31-9e77-4f0b-8b21-7c3d9e0a1b62",
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_01RenderThing",
          type: "tool_result",
          content: [{ rendering: { dialect: "markdown", body: markup } }],
        },
      ],
    },
    uuid: "5e1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
    timestamp: "2026-09-02T22:19:44.000Z",
    toolUseResult: { rendered: { markup } },
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
  };
}

/** Every base64 source the entry still carries, which is what the API is sent. */
function sourceDataIn(value) {
  if (value === null || typeof value !== "object") return [];
  return Object.keys(value).flatMap((key) => {
    const held = value[key];
    if (typeof held === "object") return sourceDataIn(held);
    return key === "data" && value.type === "base64" ? [held] : [];
  });
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
 * The assistant entry of a many-part edit: the bulk is in the call the model
 * made rather than in a result, spread over the strings of every edit, and the
 * message around it carries the names a resume replays. Enough edits and their
 * notes alone outweigh the budget, which is the only shape where nothing goes
 * back whole.
 */
function multiEditEntry(edits, linesEach) {
  return {
    parentUuid: "5c2a1d3e-6b7f-4a08-9c1d-2e3f4a5b6c7d",
    type: "assistant",
    message: {
      id: "msg_01MultiEditTheFile",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [
        {
          type: "tool_use",
          id: "toolu_01MultiEditTheFile",
          name: "MultiEdit",
          input: {
            file_path: "/workspace/repo/src/held.ts",
            edits: Array.from({ length: edits }, (_, edit) => ({
              old_string:
                `  const held${String(edit)} = readTheLine(at);\n`.repeat(
                  linesEach,
                ),
              new_string:
                `  const held${String(edit)} = readTheLine(at, twice);\n`.repeat(
                  linesEach,
                ),
            })),
          },
        },
      ],
    },
    uuid: "1a2b3c4d-5e6f-4708-8192-a3b4c5d6e7f8",
    timestamp: "2026-09-02T22:24:00.000Z",
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

/** The clipped copies of a `Bash` result, in the order the entry writes them. */
function bashCopies(posted) {
  return [
    posted.message.content[0].content,
    posted.toolUseResult.stdout,
    posted.toolUseResult.content[0].text,
  ];
}

/**
 * Plain text rather than a shell's redraws, and that is the point: an entry of
 * ordinary output goes only a little over the bound, so cutting until the line
 * fits would cut one copy and leave the next whole. The copy a resume reads is
 * one of them and it is not the last, so every copy is cut and the heads are
 * shared.
 */
test("every copy of the clipped text carries a head of it and what the original weighed", async () => {
  const { calls, store } = storeOf();
  const stdout = "held ".repeat(6_000);
  const weight = String(Buffer.byteLength(stdout));

  await store.append({ sessionId: "s" }, [bashEntry(stdout, 3)]);

  const [posted] = postedEntries(calls);
  const heads = [];
  for (const copy of bashCopies(posted)) {
    assert.ok(copy.includes("the session store clipped"), "a copy was not cut");
    assert.ok(copy.includes(weight), "a copy does not say what was cut");
    const head = copy.slice(0, copy.indexOf("\n["));
    assert.ok(stdout.startsWith(head), "a copy is not a head of the original");
    assert.ok(head.length > 0, "a copy kept no head at all");
    heads.push(head.length);
  }
  assert.ok(
    Math.max(...heads) - Math.min(...heads) <= 1,
    `the copies kept ${heads.join(", ")} characters, so one was starved for another`,
  );
});

/**
 * The head a clip keeps falls as the entry grows and never jumps back up. A cut
 * that stopped at the first fit did the opposite: the copy a resume reads kept
 * less of a larger entry than of a smaller one, until the entry grew far enough
 * for the cut to reach every copy.
 */
test("the head a clipped copy keeps only falls as the entry it came from grows", async () => {
  const kept = [];
  for (const characters of [23_000, 25_000, 30_000, 40_000, 60_000]) {
    const { calls, store } = storeOf();
    const stdout = "held ".repeat(characters / 5);
    await store.append({ sessionId: "s" }, [bashEntry(stdout, 3)]);
    const [posted] = postedEntries(calls);
    const read = posted.message.content[0].content;
    assert.ok(
      read.includes("the session store clipped"),
      `the fixture of ${String(characters)} characters was posted whole`,
    );
    kept.push(read.slice(0, read.indexOf("\n[")).length);
  }

  for (let at = 1; at < kept.length; at += 1)
    assert.ok(
      kept[at] <= kept[at - 1],
      `the head grew back from ${String(kept[at - 1])} to ${String(kept[at])} characters`,
    );
  assert.ok(Math.min(...kept) > 0, "a copy a resume reads kept nothing");
});

/**
 * The line only a byte count sees as over the bound. Its characters fit; its
 * bytes do not, because the runtime charges a line the escaped UTF-8 of every
 * copy. A store that weighed characters would post this body and the plane would
 * refuse it.
 */
test("a result whose characters fit and whose bytes do not is still clipped", async () => {
  const { calls, store } = storeOf();
  const stdout = "漢".repeat(20_000);
  const given = bashEntry(stdout);

  assert.ok(
    JSON.stringify(given).length <= sessionStoreBatchBytesMax,
    "the fixture is over the bound in characters, so it proves nothing",
  );
  await store.append({ sessionId: "s" }, [given]);

  const [{ body }] = bodies(calls);
  assert.ok(
    Buffer.byteLength(body) <= sessionStoreBatchBytesMax,
    `the body is ${String(Buffer.byteLength(body))} bytes`,
  );
  const [posted] = postedEntries(calls);
  for (const copy of [
    posted.message.content[0].content,
    posted.toolUseResult.stdout,
  ])
    assert.ok(copy.includes("the session store clipped"), "a copy was not cut");
});

/**
 * The bookkeeping entry, whose bulk is in neither a result nor a message: the
 * runtime writes attachments and summaries at the entry's own level, and weight
 * is what finds them there too. Passing a key over by name is an exclusion, not a
 * list of the places a clip is allowed to look.
 */
test("bulk the entry carries outside a result or a message is clipped too", async () => {
  const { calls, store } = storeOf();
  const given = {
    uuid: "a",
    parentUuid: "p",
    type: "attachment",
    timestamp: "2026-09-02T22:21:00.000Z",
    cwd: `/workspace/${"a-long-directory-name/".repeat(10)}repo`,
    attachment: { text: "held ".repeat(20_000) },
  };

  await store.append({ sessionId: "s" }, [given]);

  const [posted] = postedEntries(calls);
  assert.ok(
    posted.attachment.text.includes("the session store clipped"),
    "the entry's own bulk was not cut",
  );
  assert.equal(posted.cwd, given.cwd, "the working directory was clipped");
  assert.equal(posted.uuid, given.uuid);
});

/**
 * The working directory of a deep checkout, on an entry with cut sites enough
 * that no share would have covered it. It weighs more than the note that would
 * replace it, so weight alone would have taken it — but it is not a result, and
 * a resume handed a path the runtime never wrote is a resume in the wrong place.
 * The same word inside the result is that result's own text and is cut, which is
 * the whole of what "at the entry and its message only" means.
 */
test("a long working directory is not a result, whatever it weighs", async () => {
  const { calls, store } = storeOf();
  const deep = `/workspace/${"a-long-directory-name/".repeat(10)}repo`;
  const given = editEntry("held\n".repeat(20), 120, 40);
  given.cwd = deep;
  given.toolUseResult.cwd = "held ".repeat(20_000);

  await store.append({ sessionId: "s" }, [given]);

  const [posted] = postedEntries(calls);
  assert.ok(
    posted.toolUseResult.cwd.includes("the session store clipped"),
    "a result's own text was passed over because of what the entry calls itself",
  );
  assert.equal(posted.cwd, deep, "the working directory was clipped");
  for (const field of ["uuid", "parentUuid", "type", "timestamp", "version"])
    assert.equal(posted[field], given[field], `${field} did not survive`);
});

/**
 * The path a tool reported, on an entry whose bulk is elsewhere: it weighs more
 * than the note that would replace it, so it is cut — and then it fits inside its
 * share, so it goes back whole rather than spending the share on a head of a
 * path. Cutting a value the budget could afford to keep spends the budget on
 * nothing.
 */
test("a value a clip could shorten but does not need to is put back whole", async () => {
  const { calls, store } = storeOf();
  const reported = `/workspace/${"a-long-directory-name/".repeat(10)}repo`;
  const given = bashEntry("held ".repeat(6_000), 3);
  given.toolUseResult.aPathTheToolReported = reported;

  await store.append({ sessionId: "s" }, [given]);

  const [posted] = postedEntries(calls);
  assert.ok(
    posted.toolUseResult.stdout.includes("the session store clipped"),
    "the fixture was posted whole, so nothing was shared and it proves nothing",
  );
  assert.equal(
    posted.toolUseResult.aPathTheToolReported,
    reported,
    "a value that fits its share was left as a note",
  );
});

/**
 * A signed block. The runtime signs a thinking block over its exact text and
 * replays both to resume the turn, so a head of either is a block the API
 * refuses — later, somewhere else, off a line already durable. A redacted
 * thinking block is the same bargain with the text withheld: its payload is
 * signed too. The tool call beside them is an ordinary result and is cut as
 * one. Both payloads here are synthesised rather than taken from a transcript.
 */
test("a signed block is never shortened, and the result beside it still is", async () => {
  const { calls, store } = storeOf();
  const signature = `Er${"UBCkYIBRgCKkC".repeat(1_500)}==`;
  const thinking = "The store is what weighs the line. ".repeat(40);
  const redacted = "EvgBCoYBGAIqYJ".repeat(1_500);
  const given = {
    parentUuid: "3b1f6b6e-1f14-4a4f-9d4a-4d1f1a2b3c4d",
    type: "assistant",
    message: {
      id: "msg_01Thinking",
      role: "assistant",
      model: "claude-opus-4-6",
      content: [
        { type: "thinking", thinking, signature },
        { type: "redacted_thinking", data: redacted },
        {
          type: "tool_use",
          id: "toolu_01WriteTheFile",
          name: "Write",
          input: {
            file_path: "/workspace/repo/held.ts",
            content: "x".repeat(40_000),
          },
        },
      ],
    },
    uuid: "7c2d9f10-58aa-4b2e-9a1c-2f3e4d5a6b7c",
    timestamp: "2026-09-02T22:22:00.000Z",
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
  };

  await store.append({ sessionId: "s" }, [given]);

  const [{ body }] = bodies(calls);
  assert.ok(
    Buffer.byteLength(body) <= sessionStoreBatchBytesMax,
    `the body is ${String(Buffer.byteLength(body))} bytes`,
  );
  const [posted] = postedEntries(calls);
  const [signed, hidden, called] = posted.message.content;
  assert.equal(signed.signature, signature, "the signature was shortened");
  assert.equal(signed.thinking, thinking, "the signed text was shortened");
  assert.equal(signed.type, "thinking");
  assert.equal(hidden.type, "redacted_thinking");
  assert.equal(
    hidden.data,
    redacted,
    "the redacted signed payload was shortened",
  );
  assert.ok(
    called.input.content.includes("the session store clipped"),
    "the call beside the signed block was not cut",
  );
  assert.equal(called.id, "toolu_01WriteTheFile");
  assert.equal(called.name, "Write");
  assert.equal(called.input.file_path, "/workspace/repo/held.ts");
});

/**
 * The signed block that is itself over the bound. There is nothing else to cut
 * and the block may not be, so the store raises where the write is rather than
 * posting a line whose turn the API refuses on some later resume.
 */
test("an entry a signed block alone puts over the bound raises rather than posting", async () => {
  const { calls, store } = storeOf();
  const given = {
    uuid: "a",
    parentUuid: "p",
    type: "assistant",
    timestamp: "2026-09-02T22:23:00.000Z",
    message: {
      role: "assistant",
      content: [
        {
          type: "thinking",
          thinking: "held ",
          signature: `Er${"UBCkYIBRgCKkC".repeat(6_000)}==`,
        },
      ],
    },
  };

  await assert.rejects(
    store.append({ sessionId: "s" }, [given]),
    (raised) =>
      /is a clip's to shorten/u.test(raised.message) &&
      raised.message.includes(String(Buffer.byteLength(JSON.stringify(given)))),
  );

  assert.deepEqual(bodies(calls), [], "the over-long entry was posted anyway");
});

/**
 * A message that is not an object at all. Nothing in the runtime writes one, but
 * the clip's own claim is that weight finds bulk wherever a producer puts it, and
 * a level the walk skips is a place that claim is not true.
 */
test("bulk standing where a message should be is clipped like any other", async () => {
  const { calls, store } = storeOf();
  const given = {
    uuid: "a",
    parentUuid: "p",
    type: "user",
    timestamp: "2026-09-02T22:24:00.000Z",
    message: "held ".repeat(20_000),
  };

  await store.append({ sessionId: "s" }, [given]);

  const [posted] = postedEntries(calls);
  assert.ok(
    posted.message.includes("the session store clipped"),
    "the entry's whole bulk was left uncut",
  );
  assert.equal(posted.uuid, given.uuid);
});

/**
 * The entry with cut sites enough that their notes alone outweigh the budget.
 * There is nothing left to share, so every site keeps its bare note and the line
 * stands over the budget — under the bound, which is the only maximum, and posted
 * rather than raised, because a note-only line is still a line a resume can walk.
 *
 * It is also where nothing is put back, so it is the one shape that separates the
 * two rules that keep a result's own identifiers: the path is long enough that
 * only its name spares it, and the exit status is short enough that only the note
 * floor does.
 */
test("an entry whose notes outweigh the budget is posted over it and under the bound", async () => {
  const { calls, store } = storeOf();
  const given = editEntry("held\n".repeat(4_000), 300, 40);
  given.toolUseResult.exitStatus = "ok";
  given.toolUseResult.filePath = `/workspace/${"a-long-directory-name/".repeat(10)}held.ts`;

  await store.append({ sessionId: "s" }, [given]);

  const [{ body }] = bodies(calls);
  assert.ok(
    Buffer.byteLength(body) > sessionStoreClipBudgetBytes,
    "the fixture leaves spare to share, so it does not drive this at all",
  );
  assert.ok(
    Buffer.byteLength(body) <= sessionStoreBatchBytesMax,
    `the body is ${String(Buffer.byteLength(body))} bytes`,
  );
  const [posted] = postedEntries(calls);
  assert.ok(
    posted.toolUseResult.content.startsWith("[the session store clipped"),
    "a site kept a head there was no budget for",
  );
  assert.equal(
    posted.toolUseResult.exitStatus,
    "ok",
    "a value lighter than its note was replaced by that note",
  );
  assert.equal(
    posted.toolUseResult.filePath,
    given.toolUseResult.filePath,
    "the path the result reported did not survive",
  );
  const block = posted.message.content[0];
  assert.equal(block.tool_use_id, given.message.content[0].tool_use_id);
  assert.equal(block.type, "tool_result");
  assert.equal(posted.uuid, given.uuid);
});

/**
 * Every name a result keeps its identity under, one entry each. They are read at
 * whatever depth they are written, because below a message the shape is the
 * runtime.s and a tool_use_id is a tool_use_id wherever it lands, so each is put
 * a level further down than the store has ever been shown one. Each value is
 * stretched past the note that would replace it, on the fixture that has nothing
 * to share: the note floor cannot be what spares it and a whole restore cannot
 * be either, so the name is all that is left holding.
 */
test("a result keeps its own identifiers at depth, whatever they weigh", async () => {
  for (const key of [
    "file_path",
    "filePath",
    "id",
    "is_error",
    "name",
    "signature",
    "tool_use_id",
    "type",
  ]) {
    const { calls, store } = storeOf();
    const kept = `${key}-${"a-value-nothing-shortens-".repeat(40)}`;
    const given = editEntry("held\n".repeat(4_000), 300, 40);
    given.toolUseResult.theToolAlsoReported = { [key]: kept };
    assert.ok(
      Buffer.byteLength(JSON.stringify(given)) > sessionStoreBatchBytesMax,
      `the ${key} fixture is not over the bound, so no clip runs and it proves nothing`,
    );

    await store.append({ sessionId: "s" }, [given]);

    const [{ body }] = bodies(calls);
    assert.ok(
      Buffer.byteLength(body) > sessionStoreClipBudgetBytes,
      `the ${key} fixture has spare, so a whole restore could be what keeps it`,
    );
    const [posted] = postedEntries(calls);
    assert.ok(
      posted.toolUseResult.content.startsWith("[the session store clipped"),
      `the ${key} fixture was posted with nothing cut`,
    );
    assert.equal(
      posted.toolUseResult.theToolAlsoReported[key],
      kept,
      `${key} was cut`,
    );
  }
});

/**
 * The names the entry calls itself by, one step down. A message carries its own
 * id, role and model, a resume replays them, and none of them is the message’s
 * bulk however long the string happens to be. The model here is stretched past
 * its note on a call with nothing to share, because a real one is short enough
 * that the note floor alone would spare it and that separates nothing.
 */
test("what a message calls itself by is identity, whatever it weighs", async () => {
  const { calls, store } = storeOf();
  const model = `claude-opus-4-6-${"a-long-model-name-".repeat(40)}`;
  const given = multiEditEntry(200, 4);
  given.message.model = model;
  assert.ok(
    Buffer.byteLength(JSON.stringify(given)) > sessionStoreBatchBytesMax,
    "the fixture is not over the bound, so no clip runs and it proves nothing",
  );

  await store.append({ sessionId: "s" }, [given]);

  const [{ body }] = bodies(calls);
  assert.ok(
    Buffer.byteLength(body) > sessionStoreClipBudgetBytes,
    "the fixture has spare, so a whole restore could be what keeps the model",
  );
  assert.ok(
    Buffer.byteLength(body) <= sessionStoreBatchBytesMax,
    `the body is ${String(Buffer.byteLength(body))} bytes`,
  );
  const [posted] = postedEntries(calls);
  const [called] = posted.message.content;
  assert.ok(
    called.input.edits[0].old_string.includes("the session store clipped"),
    "the edits beside the model were not cut, so nothing was at risk",
  );
  assert.equal(
    posted.message.model,
    model,
    "the model the message named was cut",
  );
  assert.equal(posted.message.id, given.message.id);
  assert.equal(posted.message.role, "assistant");
});

/**
 * The budget itself, over the shapes and sizes the suite drives: where a clip
 * has anything to share, whatever it does with it comes back inside the budget.
 * Nothing else weighs what a clip spends, so this is what holds it. The other
 * regime — notes alone outweighing the budget — has its own test, because there
 * is nothing to share there and the bound is the only thing left holding.
 */
test("every clipped entry with spare to share posts within the budget", async () => {
  for (const given of [
    bashEntry(controlOutput(30_000)),
    bashEntry("held ".repeat(6_000), 3),
    bashEntry("漢".repeat(20_000)),
    readEntry("QUJDRA".repeat(20_000)),
    editEntry("held\n".repeat(4_000), 30, 80),
    editEntry("held\n".repeat(20), 120, 40),
    bashEntry("x".repeat(sessionStoreBatchBytesMax)),
  ]) {
    const { calls, store } = storeOf();
    assert.ok(
      Buffer.byteLength(JSON.stringify(given)) > sessionStoreBatchBytesMax,
      "a fixture is not over the bound, so no clip runs and it proves nothing",
    );
    await store.append({ sessionId: "s" }, [given]);
    const [{ body }] = bodies(calls);
    assert.ok(
      Buffer.byteLength(body) <= sessionStoreClipBudgetBytes,
      `a clipped body of ${String(Buffer.byteLength(body))} bytes is over the aim`,
    );
  }
});

/**
 * The producer this image has never seen: it puts its text under field names
 * nothing here knows, and it is cut all the same because weight is what the
 * store looks for.
 */
test("a result under field names nothing anticipated is clipped by weight", async () => {
  const { calls, store } = storeOf();

  await store.append({ sessionId: "s" }, [unknownEntry("held ".repeat(8_000))]);

  const [posted] = postedEntries(calls);
  const rendered = posted.message.content[0].content[0].rendering;
  assert.equal(rendered.dialect, "markdown");
  for (const copy of [rendered.body, posted.toolUseResult.rendered.markup])
    assert.ok(copy.includes("the session store clipped"), "a copy was not cut");
});

/**
 * The image read, which is the commonest over-bound result there is. Base64 is
 * worth what it decodes to and nothing else, so a head of it followed by a note
 * is not a smaller image — it is a block the API refuses, off a line already
 * durable. The block goes instead, replaced by text saying what stood there, so
 * the content array is still one the API takes; and the text beside it is cut
 * the ordinary way, because the entry is not a lost cause, only the image is.
 */
test("an image block is dropped whole and replaced by text, never cut", async () => {
  const { calls, store } = storeOf();
  const data = "QUJDRA".repeat(20_000);
  const beside = "held ".repeat(6_000);

  await store.append({ sessionId: "s" }, [readEntry(data, beside)]);

  const [{ body }] = bodies(calls);
  assert.ok(
    Buffer.byteLength(body) <= sessionStoreBatchBytesMax,
    `the body is ${String(Buffer.byteLength(body))} bytes`,
  );
  const [posted] = postedEntries(calls);
  const blocks = posted.message.content[0].content;
  assert.deepEqual(
    blocks.map(({ type }) => type),
    ["text", "text"],
    "an image block was posted where the store cannot keep one",
  );
  assert.ok(blocks[0].text.includes("the session store dropped"));
  assert.ok(
    blocks[0].text.includes("image/png"),
    "the reader is not told what it was",
  );
  assert.ok(
    beside.startsWith(blocks[1].text.slice(0, blocks[1].text.indexOf("\n["))),
    "the text beside the image lost its head",
  );
  for (const value of sourceDataIn(posted))
    assert.equal(
      value,
      Buffer.from(value, "base64").toString("base64"),
      "a base64 source was posted that no longer decodes",
    );
  assert.ok(
    posted.toolUseResult.file.base64.includes("the session store dropped"),
    "the record's own copy of the payload was cut rather than dropped",
  );
  assert.ok(
    posted.toolUseResult.file.base64.includes(
      `of ${String(Buffer.byteLength(data))} bytes`,
    ),
    "the note names a size that is not the payload's",
  );
});

/**
 * The document block, which is an image by another name: the same rule, the same
 * failure if it is not applied. A `document` source the API cannot decode is a
 * request it refuses on replay, off a line already frozen in a numbered batch.
 */
test("a document block is dropped whole, not left a source nothing can read", async () => {
  const { calls, store } = storeOf();
  const data = "QUJDRA".repeat(20_000);
  const given = mediaEntry({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data },
  });
  assert.ok(
    Buffer.byteLength(JSON.stringify(given)) > sessionStoreBatchBytesMax,
    "the fixture is not over the bound, so no clip runs and it proves nothing",
  );

  await store.append({ sessionId: "s" }, [given]);

  const [posted] = postedEntries(calls);
  const blocks = posted.message.content[0].content;
  assert.deepEqual(
    blocks.map(({ type }) => type),
    ["text"],
    "a document block was posted where the store cannot keep one",
  );
  assert.ok(blocks[0].text.includes("application/pdf"));
  assert.equal(
    posted.message.content[0].tool_use_id,
    "toolu_01ReadTheDocument",
  );
  for (const value of sourceDataIn(posted))
    assert.equal(
      value,
      Buffer.from(value, "base64").toString("base64"),
      "a base64 source was posted that no longer decodes",
    );
});

/**
 * The document whose source is its own pages. What those pages are is not what
 * the document is, so the note names the document rather than the first media
 * type anywhere inside it: a reader told an image went looks for an image.
 */
test("a dropped block is named by what it declares, not by what it contains", async () => {
  const { calls, store } = storeOf();
  const page = {
    type: "image",
    source: {
      type: "base64",
      media_type: "image/png",
      data: "QUJDRA".repeat(4_000),
    },
  };
  const given = mediaEntry({
    type: "document",
    source: { type: "content", content: [page, page, page] },
  });
  assert.ok(
    Buffer.byteLength(JSON.stringify(given)) > sessionStoreBatchBytesMax,
    "the fixture is not over the bound, so no clip runs and it proves nothing",
  );

  await store.append({ sessionId: "s" }, [given]);

  const [posted] = postedEntries(calls);
  const [stood] = posted.message.content[0].content;
  assert.equal(
    stood.type,
    "text",
    "the document was taken apart rather than dropped",
  );
  assert.ok(
    stood.text.includes("the session store dropped a document"),
    "the note does not name what was dropped",
  );
  assert.ok(
    !stood.text.includes("image/png"),
    "the note names a media type the document never declared",
  );
});

/**
 * The media block whose source is a url rather than bytes. Nothing about it is
 * encoded, so weight would take the url as text and leave a head of it — a
 * source that fetches nothing, which is the same block the API refuses. What a
 * block carries decides nothing: it is a block, and a block goes whole. The
 * fixture leaves no share to give back, which is the only state in which a url
 * is short enough to be cut at all.
 */
test("a media block with a url source is dropped whole rather than cut", async () => {
  const { calls, store } = storeOf();
  const url = `https://example.invalid/frames/${"a-long-path-segment/".repeat(15)}held.png`;
  const given = editEntry("held\n".repeat(4_000), 300, 40);
  given.message.content[0].content = [
    { type: "image", source: { type: "url", url } },
  ];
  assert.ok(
    Buffer.byteLength(JSON.stringify(given)) > sessionStoreBatchBytesMax,
    "the fixture is not over the bound, so no clip runs and it proves nothing",
  );

  await store.append({ sessionId: "s" }, [given]);

  const [{ body }] = bodies(calls);
  assert.ok(
    Buffer.byteLength(body) > sessionStoreClipBudgetBytes,
    "the fixture has spare, so the url is never near being cut",
  );
  const [posted] = postedEntries(calls);
  const blocks = posted.message.content[0].content;
  assert.deepEqual(
    blocks.map(({ type }) => type),
    ["text"],
    "an image block was posted with a source the store had cut",
  );
  assert.ok(blocks[0].text.includes("the session store dropped an image"));
  assert.ok(
    !JSON.stringify(posted).includes(url.slice(0, 40)),
    "a head of the url was posted, which fetches nothing",
  );
});

/**
 * The tool called with an encoded argument. A base64 string in a call's input is
 * not a content source — the API never decodes it — and the block around it is
 * the call the turn is built on: its id is what the next line's `tool_result`
 * answers, and a message that stops for a tool call with no tool call in it is a
 * request the API refuses. So the payload is dropped where it sits and the block
 * stays, which is the whole difference between an encoded value and a block whose
 * only worth is one.
 */
test("a call carrying an encoded argument keeps its block and loses the argument", async () => {
  const { calls, store } = storeOf();
  const data = "QUJDRA".repeat(20_000);
  const [call, answer] = uploadEntries(data);
  assert.ok(
    Buffer.byteLength(JSON.stringify(call)) > sessionStoreBatchBytesMax,
    "the fixture is not over the bound, so no clip runs and it proves nothing",
  );

  await store.append({ sessionId: "s" }, [call, answer]);

  const [posted, replied] = postedEntries(calls);
  const called = posted.message.content.find(({ type }) => type === "tool_use");
  assert.ok(called !== undefined, "the call the turn stopped for was deleted");
  assert.equal(called.id, "toolu_01Upload");
  assert.equal(called.name, "upload_screenshot");
  assert.equal(posted.message.stop_reason, "tool_use");
  assert.equal(
    replied.message.content[0].tool_use_id,
    called.id,
    "the answer names a call the posted turn does not make",
  );
  assert.equal(
    called.input.source.type,
    "base64",
    "the source stopped saying how it was encoded",
  );
  assert.ok(
    called.input.source.data.startsWith("[the session store dropped"),
    "the encoded argument was cut rather than dropped",
  );
  assert.ok(
    !JSON.stringify(posted).includes(data.slice(0, 120)),
    "a head of the payload was posted",
  );
});

/**
 * Bulk under a key called `data` that is not a base64 source. Only a `data`
 * beside a `type` saying `base64` is encoded; anything else under the name is
 * text like any other and is cut to a head a reader can read, because telling
 * someone their prose was unreadable is a lie that costs them the head of it.
 */
test("bulk under a data field that is not a base64 source is cut, not dropped", async () => {
  const { calls, store } = storeOf();
  const prose = "The store is what weighs the line. ".repeat(2_000);
  const given = {
    uuid: "0b1c2d3e-4f50-4617-8829-9a0b1c2d3e4f",
    parentUuid: "9a8b7c6d-5e4f-4302-9188-7a6b5c4d3e2f",
    type: "user",
    timestamp: "2026-09-02T22:25:00.000Z",
    cwd: "/workspace/repo",
    sessionId: "fecadcca-7f72-478c-ab53-561e3a17110b",
    version: "2.1.258",
    toolUseResult: { payload: { type: "text", data: prose } },
  };
  assert.ok(
    Buffer.byteLength(JSON.stringify(given)) > sessionStoreBatchBytesMax,
    "the fixture is not over the bound, so no clip runs and it proves nothing",
  );

  await store.append({ sessionId: "s" }, [given]);

  const [posted] = postedEntries(calls);
  const { data } = posted.toolUseResult.payload;
  assert.equal(posted.toolUseResult.payload.type, "text");
  assert.ok(
    prose.startsWith(data.slice(0, data.indexOf("\n["))),
    "the prose lost its head to a drop",
  );
  assert.ok(
    data.includes("the session store clipped"),
    "the prose was not cut at all",
  );
  assert.ok(
    !data.includes("the session store dropped"),
    "readable prose was called an encoded payload and thrown away",
  );
});

/**
 * The entry whose bulk is a list rather than a text: no line of a diff is
 * heavier than the note that would replace it, so a clip that took only single
 * strings would leave this one over the bound and stop the session. A list goes
 * whole or goes entirely: a prefix of it is a shorter list that reads as a
 * complete one, and where the list is a set of legal values — a schema's `enum`
 * — that is a constraint the record states wrongly rather than a text a reader
 * can see is short. So every list here is either what it was, byte for byte, or
 * one element saying it is gone.
 */
test("a result whose bulk is a list of lines goes whole or goes entirely", async () => {
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
  let dropped = 0;
  for (const [at, patch] of patched.entries()) {
    const held = given.toolUseResult.structuredPatch[at].lines;
    assert.ok(Array.isArray(patch.lines), "a patch stopped being a list");
    if (patch.lines.length === held.length && patch.lines[0] === held[0]) {
      assert.deepEqual(
        patch.lines,
        held,
        "a list came back neither whole nor gone",
      );
      continue;
    }
    dropped += 1;
    assert.deepEqual(
      patch.lines.length,
      1,
      "a prefix of a list was posted, which reads as the whole list",
    );
    assert.ok(
      patch.lines[0].includes(
        `the session store dropped the ${String(held.length)} values here, ${String(Buffer.byteLength(JSON.stringify(held)))} bytes`,
      ),
      "the one element left does not say what went, or misstates what it weighed",
    );
  }
  assert.ok(dropped > 0, "no list was clipped, so the fixture proves nothing");
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
 * The residue: an entry whose weight is not in any value a clip could shorten.
 * It still raises, and it still names what the entry weighs, because a body the
 * plane refuses is the one outcome the store may not produce. The message says a
 * clip never reached it rather than that a clip failed, because no clip ran.
 */
test("an entry with nothing to clip raises, naming what it weighs and that nothing was cut", async () => {
  const { calls, store } = storeOf();
  const given = denseEntry("a", 12_000);

  await assert.rejects(
    store.append({ sessionId: "s" }, [given]),
    (raised) =>
      /is a clip's to shorten/u.test(raised.message) &&
      raised.message.includes(String(Buffer.byteLength(JSON.stringify(given)))),
  );

  assert.deepEqual(bodies(calls), [], "the over-long entry was posted anyway");
});

/**
 * The other residue, and the one the message must tell apart: every value in the
 * entry was cut, and the notes alone are still over the bound. Here a clip did
 * run and did not save it.
 */
test("an entry every clip leaves over the bound raises, saying the clip did not save it", async () => {
  const { calls, store } = storeOf();
  const given = { uuid: "a", type: "assistant", toolUseResult: {} };
  for (let field = 0; field < 700; field += 1)
    given.toolUseResult[`field${String(field)}`] = "held ".repeat(60);

  await assert.rejects(
    store.append({ sessionId: "s" }, [given]),
    /clipping every value in it did not bring it under/u,
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
    /is a clip's to shorten/u,
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
