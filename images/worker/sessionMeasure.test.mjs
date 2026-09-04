/**
 * What the pod measured of one turn: the envelope it posts beside an answer, and
 * the running totals it reads that envelope out of.
 *
 * IT IS ITS OWN SUITE BECAUSE THE SUBJECT IS ITS OWN. The measurement is read
 * off the runtime's messages at seams the pod's other records share, so a case
 * that fails here names the measurement rather than the pod; the doubles both
 * suites drive are `./sessionHarness.mjs`'s.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  sessionMeasure,
  sessionTurnModelCharsMax,
  sessionTurnToolNameCharsMax,
  sessionTurnToolsMax,
} from "./session.mjs";
import {
  facts,
  planeOf,
  queryOf,
  rejection,
  result,
  run,
  turnOne,
} from "../../test/contract/sessionHarness.mjs";

/**
 * What the runtime reported its query pipeline had spent, taken from the spike's
 * own two-turn run: per-model totals, cumulative across the turns of one query,
 * four counters the measurement sums.
 */
const spentAfter = (
  inputTokens,
  outputTokens,
  cacheCreationInputTokens,
  cacheReadInputTokens,
) => ({
  "claude-haiku-4-5-20251001": {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    webSearchRequests: 0,
  },
});
const spent = spentAfter(948, 349, 16_150, 31_671);
const spentAgain = spentAfter(958, 375, 16_251, 47_821);
const spentTokens = 948 + 349 + 16_150 + 31_671;
const spentAgainTokens = 958 + 375 + 16_251 + 47_821 - spentTokens;

const answerOf = (plane) =>
  plane.calls.find(({ path }) => path === "/v1/session/turn/answer").body;

test("a turn reports the model, the tokens, the cost and the time the runtime spent", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    result("success", {
      result: "ok",
      modelUsage: spent,
      total_cost_usd: 0.038_160_1,
      duration_ms: 5_195,
    }),
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0);
  assert.deepEqual(answerOf(plane).measured, {
    model: "haiku",
    tokens: spentTokens,
    costMicros: 38_160,
    durationMs: 5_195,
    tools: [],
  });
});

test("a turn's cost and tokens are what the running totals moved by, not the totals", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const { query } = queryOf((_asked, index) => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    result("success", {
      result: "ok",
      modelUsage: index === 0 ? spent : spentAgain,
      duration_ms: 1,
      total_cost_usd: index === 0 ? 0.038_160_1 : 0.040_117_1,
    }),
  ]);

  await run({ request: plane.request, query });

  const answered = plane.calls
    .filter(({ path }) => path === "/v1/session/turn/answer")
    .map(({ body }) => body.measured);
  assert.deepEqual(
    answered.map(({ costMicros }) => costMicros),
    [38_160, 1_957],
  );
  assert.deepEqual(
    answered.map(({ tokens }) => tokens),
    [spentTokens, spentAgainTokens],
  );
});

test("the tools a turn reports are the distinct ones its assistant named", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const called = (name) => ({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", name }] },
  });
  const { query } = queryOf((_asked, index) =>
    index === 0
      ? [
          {
            type: "system",
            subtype: "init",
            session_id: "runtime-1",
            model: "haiku",
          },
          called("Bash"),
          {
            type: "user",
            message: {
              role: "user",
              content: [{ type: "tool_use", name: "Write" }],
            },
          },
          called("Read"),
          called("Bash"),
          result("success", {
            result: "ok",
            modelUsage: spent,
            duration_ms: 1,
          }),
        ]
      : [
          result("success", {
            result: "ok",
            modelUsage: spent,
            duration_ms: 1,
          }),
        ],
  );

  await run({ request: plane.request, query });

  const answers = plane.calls
    .filter(({ path }) => path === "/v1/session/turn/answer")
    .map(({ body }) => body.measured.tools);
  assert.deepEqual(answers, [["Bash", "Read"], []]);
});

/** One assistant message calling each of these, and the result for each id. */
const calling = (...calls) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: calls.map(([id, name]) => ({ type: "tool_use", id, name })),
  },
});
const answering = (...results) => ({
  type: "user",
  message: {
    role: "user",
    content: results.map(([id, content, isError]) => ({
      type: "tool_result",
      tool_use_id: id,
      content,
      ...(isError === undefined ? {} : { is_error: isError }),
    })),
  },
});

/** The refusal kasofsk/chuggy#561 was measured on, as the runtime wrote it. */
const notServed =
  "<tool_use_error>Error: No such tool available: ToolSearch. ToolSearch is disabled for this session, in subagents as well as here.</tool_use_error>";

test("a tool the runtime refused to serve is not a tool the turn reports using", async () => {
  for (const content of [notServed, [{ type: "text", text: notServed }]]) {
    const plane = planeOf([turnOne], facts);
    const { query } = queryOf(() => [
      {
        type: "system",
        subtype: "init",
        session_id: "runtime-1",
        model: "haiku",
      },
      calling(["tu-1", "ToolSearch"], ["tu-2", "mcp__chuggy__dispatch"]),
      answering(["tu-1", content, true], ["tu-2", "dispatched", undefined]),
      result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
    ]);

    await run({ request: plane.request, query });

    assert.deepEqual(answerOf(plane).measured.tools, ["mcp__chuggy__dispatch"]);
  }
});

test("a tool that ran and errored is a tool the turn used", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    calling(["tu-1", "Bash"]),
    answering(["tu-1", "bash: chuggy: command not found", true]),
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  assert.deepEqual(answerOf(plane).measured.tools, ["Bash"]);
});

test("a tool refused once and served once is a tool the turn used", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    calling(["tu-1", "Bash"]),
    answering(["tu-1", notServed, true]),
    calling(["tu-2", "Bash"]),
    answering(["tu-2", "ok"]),
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  assert.deepEqual(answerOf(plane).measured.tools, ["Bash"]);
});

test("a call the runtime has not answered yet is a tool the turn used", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    calling(["tu-1", "Bash"]),
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  assert.deepEqual(answerOf(plane).measured.tools, ["Bash"]);
});

test("a turn naming more tools than a row holds reports the bound and no more", async () => {
  const plane = planeOf([turnOne], facts);
  const named = Array.from(
    { length: sessionTurnToolsMax + 4 },
    (_unused, index) => `tool-${String(index)}`,
  );
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: named.map((name) => ({ type: "tool_use", name })),
      },
    },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  const { tools } = answerOf(plane).measured;
  assert.equal(tools.length, sessionTurnToolsMax);
  assert.deepEqual(tools, named.slice(0, sessionTurnToolsMax));
});

test("a tool name longer than a row holds is cut to the bound rather than refused", async () => {
  const plane = planeOf([turnOne], facts);
  const long = `x${"\u{1f600}".repeat(sessionTurnToolNameCharsMax)}`;
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: long }],
      },
    },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  const [only] = answerOf(plane).measured.tools;
  assert.equal(only.length, sessionTurnToolNameCharsMax);
  assert.ok(only.isWellFormed(), "the cut left half a surrogate pair behind");
});

test("a turn the runtime accounted for nothing on is answered with no measurement", async () => {
  for (const ended of [
    result("success", { result: "ok", duration_ms: 1 }),
    result("success", { result: "ok", modelUsage: null, duration_ms: 1 }),
  ]) {
    const plane = planeOf([turnOne], facts);
    const { query } = queryOf(() => [
      {
        type: "system",
        subtype: "init",
        session_id: "runtime-1",
        model: "haiku",
      },
      ended,
    ]);

    const code = await run({ request: plane.request, query });

    assert.equal(code, 0);
    const answered = answerOf(plane);
    assert.ok(
      !("measured" in answered),
      "a turn with nothing to measure carried a measurement of zeroes",
    );
  }
});

test("a turn whose runtime named no model carries no measurement either", async () => {
  const plane = planeOf([turnOne], facts);
  const { query } = queryOf(() => [
    { type: "system", subtype: "init", session_id: "runtime-1" },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  assert.ok(
    !("measured" in answerOf(plane)),
    "four of the five columns were posted as a whole measurement",
  );
});

test("a figure the runtime reported as no number is measured as nothing spent", () => {
  const measure = sessionMeasure();
  measure.saw({ type: "system", subtype: "init", model: "haiku" });
  assert.deepEqual(
    measure.of({
      modelUsage: { haiku: { inputTokens: 7, outputTokens: "many" } },
      total_cost_usd: "free",
      duration_ms: undefined,
    }),
    {
      model: "haiku",
      tokens: 7,
      costMicros: 0,
      durationMs: 0,
      tools: [],
    },
  );
});

/** One measure that has already been told a model, which is all the envelope needs. */
function measureOf(model = "haiku") {
  const measure = sessionMeasure();
  measure.saw({ type: "system", subtype: "init", model });
  return measure;
}

test("a total the runtime did not report leaves the mark, and the next one is a delta from it", () => {
  const measure = measureOf();
  const costs = [0.3, undefined, 0.45].map(
    (total_cost_usd) =>
      measure.of({ modelUsage: spent, total_cost_usd }).costMicros,
  );

  assert.deepEqual(costs, [300_000, 0, 150_000]);
});

test("a total the runtime reported lower than the last charges the turn nothing", () => {
  const measure = measureOf();
  const costs = [0.3, 0.1, 0.25].map(
    (total_cost_usd) =>
      measure.of({ modelUsage: spent, total_cost_usd }).costMicros,
  );

  assert.deepEqual(costs, [300_000, 0, 150_000]);
});

test("what a failed turn spent is charged to the next turn that answers", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const { query } = queryOf((_asked, index) => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    index === 0
      ? result("error_during_execution", {
          modelUsage: spent,
          total_cost_usd: 0.3,
          duration_ms: 1,
        })
      : result("success", {
          result: "ok",
          modelUsage: spentAgain,
          total_cost_usd: 0.45,
          duration_ms: 1,
        }),
  ]);

  await run({ request: plane.request, query });

  const answers = plane.calls.filter(
    ({ path }) => path === "/v1/session/turn/answer",
  );
  assert.equal(answers.length, 1, "a failed turn was answered");
  assert.equal(answers[0].body.measured.costMicros, 450_000);
  assert.equal(
    answers[0].body.measured.tokens,
    spentTokens + spentAgainTokens,
    "the failed turn's tokens were dropped rather than carried",
  );
});

test("the tokens counted are every model's, not the main loop's alone", () => {
  const withSubagent = {
    ...spent,
    "claude-opus-4-5": {
      inputTokens: 11,
      outputTokens: 22,
      cacheCreationInputTokens: 33,
      cacheReadInputTokens: 44,
    },
  };

  assert.equal(
    measureOf().of({ modelUsage: withSubagent }).tokens,
    spentTokens + 11 + 22 + 33 + 44,
  );
});

test("a name carrying the one character no stored row holds is stripped of it", async () => {
  const plane = planeOf([turnOne], facts);
  const named = "Ba\u0000sh";
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "hai\u0000ku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: named }],
      },
    },
    result("success", { result: "ok", modelUsage: spent, duration_ms: 1 }),
  ]);

  await run({ request: plane.request, query });

  const { model, tools } = answerOf(plane).measured;
  assert.deepEqual(tools, ["Bash"]);
  assert.equal(model, "haiku");
});

test("a model identity longer than a row holds is cut to the bound rather than refused", () => {
  const long = `x${"\u{1f600}".repeat(sessionTurnModelCharsMax)}`;
  const measure = measureOf(long);

  const { model } = measure.of({ modelUsage: spent });
  assert.equal(model.length, sessionTurnModelCharsMax);
  assert.ok(model.isWellFormed(), "the cut left half a surrogate pair behind");
});

test("a model the runtime named as nothing a row holds leaves the last one standing", () => {
  const measure = measureOf();
  measure.saw({ type: "system", subtype: "init", model: "\u0000" });
  measure.saw({ type: "system", subtype: "init", model: "" });

  assert.equal(measure.of({ modelUsage: spent }).model, "haiku");
});

test("a record that counts nothing leaves the mark, so the next turn is a delta not a session", () => {
  const uncountable = [
    ["no model at all", {}],
    ["a model with no counters", { "claude-haiku-4-5": {} }],
    ["counters this pod cannot read", spentAfter("many", null, undefined, "0")],
    ["the zeroes a crashed result carries", spentAfter(0, 0, 0, 0)],
  ];
  for (const [what, modelUsage] of uncountable) {
    const measure = measureOf();

    const first = measure.of({ modelUsage: spent, total_cost_usd: 0.3 });
    const counting = measure.of({ modelUsage, total_cost_usd: undefined });
    const next = measure.of({ modelUsage: spentAgain, total_cost_usd: 0.45 });

    assert.equal(first.tokens, spentTokens, what);
    assert.equal(counting, undefined, `${what} was measured`);
    assert.equal(next.tokens, spentAgainTokens, what);
    assert.equal(next.costMicros, 150_000, what);
  }
});

/**
 * The two records the pod keeps of one turn are orthogonal, and the seams they
 * share are where that could stop being true. A hold is not a measurement's
 * business and a measurement is not a hold's: the rate-limit sightings settle
 * whether the account was refused, the measure settles what the turn spent, and
 * both fold every message through the same `observe`.
 */
test("a turn the provider refused is held, and carries no measurement with it", async () => {
  const plane = planeOf([turnOne, turnOne], facts);
  const { query } = queryOf(() => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash" }],
      },
    },
    rejection,
    result("error_during_execution", {
      terminal_reason: "api_error",
      modelUsage: spent,
      total_cost_usd: 0.3,
      duration_ms: 5_195,
    }),
  ]);

  const code = await run({ request: plane.request, query });

  assert.equal(code, 0);
  assert.equal(
    plane.calls.filter(({ path }) => path === "/v1/session/held").length,
    1,
    "a turn the provider refused was not held",
  );
  assert.ok(
    !plane.calls.some(({ path }) => path === "/v1/session/turn/answer"),
    "a held turn was answered, measurement and all",
  );
});

test("a measured turn still records what the runtime said about the account", async () => {
  const plane = planeOf([turnOne, { ...turnOne, turn: "turn-2" }], facts);
  const { query } = queryOf((_asked, index) => [
    {
      type: "system",
      subtype: "init",
      session_id: "runtime-1",
      model: "haiku",
    },
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Bash" }],
      },
    },
    index === 0
      ? { type: "rate_limit_event", rate_limit_info: { status: "allowed" } }
      : rejection,
    result("success", {
      result: "ok",
      modelUsage: index === 0 ? spent : spentAgain,
      total_cost_usd: index === 0 ? 0.3 : 0.45,
      duration_ms: 5_195,
    }),
  ]);

  await run({ request: plane.request, query });

  const answers = plane.calls.filter(
    ({ path }) => path === "/v1/session/turn/answer",
  );
  assert.equal(answers.length, 1, "the refused turn was answered too");
  assert.deepEqual(answers[0].body.measured, {
    model: "haiku",
    tokens: spentTokens,
    costMicros: 300_000,
    durationMs: 5_195,
    tools: ["Bash"],
  });
  assert.equal(
    plane.calls.filter(({ path }) => path === "/v1/session/held").length,
    1,
    "the sightings were not folded on a turn that was also measured",
  );
});
