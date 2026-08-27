import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import {
  credentialScrub,
  credentialScrubCharsMin,
  endedEvidence,
  runEvidenceRecorder,
  runTotals,
  runTranscriptBatchBytesMax,
  runTranscriptBatchesMax,
  runModelCharsMax,
  runTranscriptEventBytesMax,
  runTurn,
  runTurnSeriesMax,
  truncatedEvent,
} from "./runEvidence.mjs";

const task = { workerPlane: { url: "http://worker-plane.test:3001" } };
const secret = "sk-ant-oat01-0123456789abcdefghijklmnopqrstuvwxyz";

function harness(options = {}) {
  const calls = [];
  let ticked;
  const recorder = runEvidenceRecorder(
    task,
    "bearer",
    options.scrub ?? ((text) => text),
    {
      request: async (_task, _bearer, path, init) => {
        calls.push({ path, init });
        options.behaviour?.(path);
        if (path !== "/v1/run/turns") return { ok: true, status: 204 };
        return {
          ok: true,
          status: 200,
          json: async () => ({ turnsRecorded: options.turnsRecorded ?? 0 }),
        };
      },
      setInterval: (callback) => {
        ticked = callback;
        return { unref: () => undefined };
      },
      clearInterval: () => undefined,
      warn: () => undefined,
    },
  );
  return { recorder, calls, tick: () => ticked() };
}

function assistantEvent(model, usage) {
  return { type: "assistant", message: { model, usage } };
}

test("a credential the worker was handed is redacted wherever it appears", () => {
  const scrub = credentialScrub([secret]);
  assert.equal(
    scrub(`before ${secret} between ${secret} after`),
    "before [redacted credential] between [redacted credential] after",
  );
});

test("a value one character short of a credential is left alone", () => {
  const scrub = credentialScrub([secret]);
  const nearMiss = secret.slice(0, -1);
  assert.equal(scrub(`before ${nearMiss} after`), `before ${nearMiss} after`);
});

test("a credential too short to be distinctive is not scrubbed", () => {
  const short = "a".repeat(credentialScrubCharsMin - 1);
  assert.equal(credentialScrub([short])(`x ${short} y`), `x ${short} y`);
});

test("an oversized event keeps its type and position and loses its payload", () => {
  const payload = "p".repeat(runTranscriptEventBytesMax * 2);
  const line = JSON.stringify({
    type: "user",
    ordinal: 7,
    message: { content: [{ type: "tool_result", content: payload }] },
  });
  const kept = JSON.parse(truncatedEvent(line));

  assert.ok(
    Buffer.byteLength(truncatedEvent(line)) <= runTranscriptEventBytesMax,
  );
  assert.equal(kept.type, "user");
  assert.equal(kept.ordinal, 7);
  assert.equal(kept.message.content[0].type, "tool_result");
  assert.equal(
    kept.message.content[0].content.chuggy_truncated.bytes,
    payload.length,
  );
  assert.match(
    kept.message.content[0].content.chuggy_truncated.digest,
    /^[0-9a-f]{64}$/u,
  );
});

test("an event within the bound is kept byte for byte", () => {
  const line = JSON.stringify({ type: "system", subtype: "init" });
  assert.equal(truncatedEvent(line), line);
});

test("the run's totals are the runtime's own figures", () => {
  const totals = runTotals(
    {
      type: "result",
      subtype: "success",
      stop_reason: "end_turn",
      num_turns: 4,
      duration_ms: 252_000,
      duration_api_ms: 190_000,
      total_cost_usd: 0.4237185,
      permission_denials: [{ tool_name: "Bash" }],
      usage: {
        input_tokens: 11,
        output_tokens: 22,
        cache_creation_input_tokens: 33,
        cache_read_input_tokens: 44,
      },
      modelUsage: {
        "claude-opus-4": {
          inputTokens: 11,
          outputTokens: 22,
          cacheCreationInputTokens: 33,
          cacheReadInputTokens: 44,
          costUSD: 0.4237185,
        },
      },
    },
    [],
  );

  assert.deepEqual(totals, {
    tokensInput: 11,
    tokensOutput: 22,
    tokensCacheCreation: 33,
    tokensCacheRead: 44,
    turns: 4,
    durationMs: 252_000,
    durationApiMs: 190_000,
    costUsdMicros: 423_719,
    costBasis: "List",
    models: [
      {
        model: "claude-opus-4",
        tokensInput: 11,
        tokensOutput: 22,
        tokensCacheCreation: 33,
        tokensCacheRead: 44,
        costUsdMicros: 423_719,
      },
    ],
    permissionDenials: 1,
    resultSubtype: "success",
    stopReason: "end_turn",
  });
});

test("a run that emitted no result event still states its totals", () => {
  const turns = [
    runTurn(
      assistantEvent("claude-opus-4", {
        input_tokens: 1,
        output_tokens: 2,
        cache_creation_input_tokens: 4,
        cache_read_input_tokens: 8,
      }),
      1,
    ),
    runTurn(
      assistantEvent("claude-opus-4", {
        input_tokens: 16,
        output_tokens: 32,
        cache_creation_input_tokens: 64,
        cache_read_input_tokens: 128,
      }),
      2,
    ),
    runTurn(
      assistantEvent("claude-haiku-4", {
        input_tokens: 256,
        output_tokens: 512,
        cache_creation_input_tokens: 1_024,
        cache_read_input_tokens: 2_048,
      }),
      3,
    ),
  ];
  const totals = runTotals(undefined, turns);

  assert.equal(totals.turns, 3);
  assert.equal(totals.costUsdMicros, 0);
  assert.equal(totals.costBasis, "List");
  assert.equal(totals.tokensInput, 273);
  assert.equal(totals.tokensOutput, 546);
  assert.equal(totals.tokensCacheCreation, 1_092);
  assert.equal(totals.tokensCacheRead, 2_184);
  assert.deepEqual(totals.models, [
    {
      model: "claude-opus-4",
      tokensInput: 17,
      tokensOutput: 34,
      tokensCacheCreation: 68,
      tokensCacheRead: 136,
      costUsdMicros: 0,
    },
    {
      model: "claude-haiku-4",
      tokensInput: 256,
      tokensOutput: 512,
      tokensCacheCreation: 1_024,
      tokensCacheRead: 2_048,
      costUsdMicros: 0,
    },
  ]);
});

test("a turn the runtime left unnamed still names a model the plane takes", () => {
  const turn = runTurn(assistantEvent("", { input_tokens: 3 }), 1);

  assert.ok(turn.model.length >= 1);
  assert.ok(turn.model.length <= runModelCharsMax);
  assert.equal(turn.model, "unknown");
  assert.equal(turn.tokensInput, 3);
});

test("a model identity longer than the plane stores is cut to it", () => {
  const turn = runTurn(assistantEvent("m".repeat(500), {}), 1);

  assert.equal(turn.model.length, runModelCharsMax);
});

test("an unnamed model in the runtime's own breakdown is named too", () => {
  const totals = runTotals(
    { type: "result", modelUsage: { "": { inputTokens: 4, costUSD: 0.5 } } },
    [],
  );

  assert.equal(totals.models[0].model, "unknown");
  assert.equal(totals.models[0].tokensInput, 4);
});

test("an event that is not a charged turn folds to nothing", () => {
  assert.equal(runTurn({ type: "system" }, 1), undefined);
  assert.equal(runTurn({ type: "assistant", message: {} }, 1), undefined);
});

test("an interval that produced no bytes ships nothing", async () => {
  const { calls, tick } = harness();
  await tick();
  await tick();
  assert.deepEqual(calls, []);
});

test("turns are posted before the batch that covers them", async () => {
  const { recorder, calls, tick } = harness();
  const event = assistantEvent("claude-opus-4", {
    input_tokens: 1,
    output_tokens: 2,
  });
  await recorder.record(JSON.stringify(event), event);
  await tick();

  assert.deepEqual(
    calls.map(({ path }) => path),
    ["/v1/run/turns", "/v1/run/transcript/1"],
  );
  assert.deepEqual(JSON.parse(calls[0].init.body).turns, [
    {
      ordinal: 1,
      model: "claude-opus-4",
      tokensInput: 1,
      tokensOutput: 2,
      tokensCacheCreation: 0,
      tokensCacheRead: 0,
    },
  ]);
});

test("a turn row carries what the plane takes and nothing besides", async () => {
  const { recorder, calls, tick } = harness();
  const event = assistantEvent("claude-opus-4", { input_tokens: 1 });
  await recorder.record(JSON.stringify(event), event);
  await tick();

  const [row] = JSON.parse(
    calls.find(({ path }) => path === "/v1/run/turns").init.body,
  ).turns;
  assert.deepEqual(Object.keys(row).sort(), [
    "model",
    "ordinal",
    "tokensCacheCreation",
    "tokensCacheRead",
    "tokensInput",
    "tokensOutput",
  ]);
});

test("a buffer that would exceed one body's worth is shipped first", async () => {
  const { recorder, calls, tick } = harness();
  const line = JSON.stringify({ type: "system", text: "x".repeat(1_000) });
  for (let written = 0; written < 200; written += 1)
    await recorder.record(line, { type: "system" });
  await tick();

  const batches = calls.filter(({ path }) => path.startsWith("/v1/run/tran"));
  assert.deepEqual(
    batches.map(({ path }) => path),
    [
      "/v1/run/transcript/1",
      "/v1/run/transcript/2",
      "/v1/run/transcript/3",
      "/v1/run/transcript/4",
    ],
  );
  for (const batch of batches)
    assert.ok(batch.init.body.byteLength <= runTranscriptBatchBytesMax);
});

test("the transcript stops at its run cap with a line saying so", async () => {
  const { recorder, calls, tick } = harness();
  const line = JSON.stringify({ type: "system" });
  for (let batch = 0; batch < runTranscriptBatchesMax + 2; batch += 1) {
    await recorder.record(line, { type: "system" });
    await tick();
  }

  const batches = calls.filter(({ path }) => path.startsWith("/v1/run/tran"));
  assert.equal(batches.length, runTranscriptBatchesMax);
  assert.equal(
    batches.at(-1).path,
    `/v1/run/transcript/${String(runTranscriptBatchesMax)}`,
  );
  assert.deepEqual(JSON.parse(batches.at(-1).init.body.toString("utf8")), {
    type: "chuggy_transcript_truncated",
    batches: runTranscriptBatchesMax,
  });
});

test("the turn series stops at its bound and the transcript says so", async () => {
  const { recorder, calls, tick } = harness();
  const event = assistantEvent("claude-opus-4", { input_tokens: 1 });
  const line = JSON.stringify(event);
  for (let turn = 0; turn < runTurnSeriesMax + 5; turn += 1)
    await recorder.record(line, event);
  await tick();

  const posted = calls
    .filter(({ path }) => path === "/v1/run/turns")
    .flatMap(({ init }) => JSON.parse(init.body).turns);
  assert.equal(posted.length, runTurnSeriesMax);
  assert.equal(posted.at(-1).ordinal, runTurnSeriesMax);
  const shipped = calls
    .filter(({ path }) => path.startsWith("/v1/run/tran"))
    .map(({ init }) => init.body.toString("utf8"))
    .join("");
  assert.ok(
    shipped.includes(
      JSON.stringify({
        type: "chuggy_turns_truncated",
        turns: runTurnSeriesMax,
      }),
    ),
  );
});

test("a refused evidence call stops the transcript and never fails the run", async () => {
  const { recorder, calls, tick } = harness({
    behaviour: (path) => {
      if (path.startsWith("/v1/run/tran")) throw new Error("plane refused");
    },
  });
  const event = assistantEvent("claude-opus-4", { input_tokens: 1 });
  const line = JSON.stringify(event);
  await recorder.record(line, event);
  await tick();
  const refusedAt = calls.length;
  await recorder.record(line, event);
  await tick();

  assert.deepEqual(
    calls.slice(0, refusedAt).map(({ path }) => path),
    ["/v1/run/turns", "/v1/run/transcript/1"],
  );
  assert.equal(calls.length, refusedAt);
});

test("a run that outlived its evidence still names the plane as the reason", () => {
  assert.equal(
    endedEvidence({ subtype: "error_max_turns" }, false),
    "RunTurnsExhausted",
  );
  assert.equal(
    endedEvidence(
      { subtype: "error_during_execution", stop_reason: "rate_limit" },
      false,
    ),
    "RunRateLimited",
  );
  assert.equal(endedEvidence(undefined, true), "RunUploadRefused");
  assert.equal(endedEvidence(undefined, false), "RunFailed");
  assert.equal(
    endedEvidence({ subtype: "error_during_execution" }, false),
    "RunFailed",
  );
});

test("every transcript byte the worker ships has passed the scrub", async () => {
  const { recorder, calls, tick } = harness({
    scrub: credentialScrub([secret]),
  });
  const event = { type: "user", message: { content: `env printed ${secret}` } };
  await recorder.record(JSON.stringify(event), event);
  await tick();

  const shipped = calls
    .filter(({ path }) => path.startsWith("/v1/run/tran"))
    .map(({ init }) => init.body.toString("utf8"))
    .join("");
  assert.ok(!shipped.includes(secret));
  assert.ok(shipped.includes("[redacted credential]"));
});

test("a refused configuration does not stop the transcript it precedes", async () => {
  const { recorder, calls, tick } = harness({
    behaviour: (path) => {
      if (path === "/v1/run/configuration") throw new Error("plane refused");
    },
  });
  const event = assistantEvent("claude-opus-4", { input_tokens: 1 });
  await recorder.configuration(Buffer.from("{}"));
  await recorder.record(JSON.stringify(event), event);
  await tick();

  assert.deepEqual(
    calls.map(({ path }) => path),
    ["/v1/run/configuration", "/v1/run/turns", "/v1/run/transcript/1"],
  );
});

test("a lost acknowledgement is resynced from the plane's own high-water", async () => {
  const { recorder, calls, tick } = harness({ turnsRecorded: 3 });
  const event = assistantEvent("claude-opus-4", { input_tokens: 1 });
  const line = JSON.stringify(event);
  await recorder.record(line, event);
  await tick();
  await recorder.record(line, event);
  await recorder.record(line, event);
  await tick();
  await recorder.record(line, event);
  await tick();

  const posted = calls.filter(({ path }) => path === "/v1/run/turns");
  assert.equal(posted.length, 2);
  assert.deepEqual(
    JSON.parse(posted[0].init.body).turns.map(({ ordinal }) => ordinal),
    [1],
  );
  assert.deepEqual(
    JSON.parse(posted[1].init.body).turns.map(({ ordinal }) => ordinal),
    [4],
  );
});

test("a run the runtime accounted for is not labelled by an earlier refusal", async () => {
  const refuseTranscript = {
    behaviour: (path) => {
      if (path.startsWith("/v1/run/tran")) throw new Error("plane refused");
    },
  };
  const first = harness(refuseTranscript);
  await first.recorder.record(JSON.stringify({ type: "system" }), {
    type: "system",
  });
  await first.tick();
  first.recorder.observed({
    type: "result",
    subtype: "error_during_execution",
  });
  await first.recorder.ended();

  const second = harness(refuseTranscript);
  second.recorder.observed({
    type: "result",
    subtype: "error_during_execution",
  });
  await second.recorder.record(JSON.stringify({ type: "system" }), {
    type: "system",
  });
  await second.tick();
  await second.recorder.ended();

  for (const { calls } of [first, second])
    assert.equal(
      JSON.parse(calls.at(-1).init.body).evidence,
      "RunFailed",
      "the runtime's own account of the run outranks a refused upload",
    );
});

test("a run nothing else accounts for is labelled by the refusal", async () => {
  const { recorder, calls, tick } = harness({
    behaviour: (path) => {
      if (path.startsWith("/v1/run/tran")) throw new Error("plane refused");
    },
  });
  await recorder.record(JSON.stringify({ type: "system" }), { type: "system" });
  await tick();
  await recorder.ended();

  assert.equal(JSON.parse(calls.at(-1).init.body).evidence, "RunUploadRefused");
});

test("the totals a run ends with are posted once", async () => {
  const { recorder, calls } = harness();
  const event = { type: "result", num_turns: 2, total_cost_usd: 0.5 };
  recorder.observed(event);
  await recorder.finish();
  await recorder.finish();

  const totals = calls.filter(({ path }) => path === "/v1/run/totals");
  assert.equal(totals.length, 1);
  assert.equal(JSON.parse(totals[0].init.body).costUsdMicros, 500_000);
});
