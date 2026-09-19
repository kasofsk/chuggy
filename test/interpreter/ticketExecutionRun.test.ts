import assert from "node:assert/strict";
import { test } from "node:test";

import { ticketExecutionRunMeasured } from "../../src/interpreter/ticketExecutionRun.ts";

const bounds = {
  turnsMax: 4,
  modelCharsMax: 16,
  modelsMax: 2,
  reasonCharsMax: 8,
};

function stream(...frames: readonly unknown[]): string {
  return frames.map((frame) => JSON.stringify(frame)).join("\n");
}

function assistant(model: string, usage: Record<string, number>): unknown {
  return { type: "assistant", message: { model, usage } };
}

test("a turn is measured off every assistant frame and numbered in arrival order", () => {
  const measured = ticketExecutionRunMeasured(
    stream(
      { type: "system" },
      assistant("sonnet", { input_tokens: 10, output_tokens: 2 }),
      { type: "user" },
      assistant("opus", {
        input_tokens: 5,
        cache_read_input_tokens: 7,
      }),
    ),
    bounds,
  );
  assert.deepEqual(measured.turns, [
    {
      ordinal: 1,
      model: "sonnet",
      tokensInput: 10,
      tokensOutput: 2,
      tokensCacheCreation: 0,
      tokensCacheRead: 0,
    },
    {
      ordinal: 2,
      model: "opus",
      tokensInput: 5,
      tokensOutput: 0,
      tokensCacheCreation: 0,
      tokensCacheRead: 7,
    },
  ]);
});

test("a run measured past its bound stops at the bound rather than growing", () => {
  const frames = Array.from({ length: 9 }, () =>
    assistant("sonnet", { input_tokens: 1 }),
  );
  const measured = ticketExecutionRunMeasured(stream(...frames), bounds);
  assert.equal(measured.turns.length, bounds.turnsMax);
  assert.equal(measured.turns.at(-1)?.ordinal, bounds.turnsMax);
});

test("a cost below one dollar survives as micros rather than flooring to nothing", () => {
  const measured = ticketExecutionRunMeasured(
    stream({
      type: "result",
      total_cost_usd: 0.0125,
      modelUsage: { sonnet: { costUSD: 0.002, inputTokens: 4 } },
    }),
    bounds,
  );
  assert.equal(measured.totals.costUsdMicros, 12_500);
  assert.deepEqual(measured.totals.models, [
    {
      model: "sonnet",
      tokensInput: 4,
      tokensOutput: 0,
      tokensCacheCreation: 0,
      tokensCacheRead: 0,
      costUsdMicros: 2_000,
    },
  ]);
});

test("a runtime's own totals are taken over the turns, and bounded text is cut", () => {
  const measured = ticketExecutionRunMeasured(
    stream(assistant("a-very-long-model-identity", { input_tokens: 1 }), {
      type: "result",
      num_turns: 12,
      duration_ms: 900,
      duration_api_ms: 400,
      usage: { input_tokens: 99 },
      permission_denials: [{ tool: "Bash" }, { tool: "Write" }],
      subtype: "error_max_turns",
      stop_reason: "end_turn",
    }),
    bounds,
  );
  assert.equal(measured.turns[0]?.model, "a-very-long-mode");
  assert.equal(measured.totals.turns, 12);
  assert.equal(measured.totals.durationMs, 900);
  assert.equal(measured.totals.durationApiMs, 400);
  assert.equal(measured.totals.tokensInput, 99);
  assert.equal(measured.totals.permissionDenials, 2);
  assert.equal(measured.totals.resultSubtype, "error_ma");
  assert.equal(measured.totals.stopReason, "end_turn");
});

test("a stream that ended before its totals is measured from the turns that arrived", () => {
  const measured = ticketExecutionRunMeasured(
    stream(
      assistant("sonnet", { input_tokens: 3, output_tokens: 1 }),
      assistant("sonnet", { input_tokens: 4 }),
    ),
    bounds,
  );
  assert.equal(measured.totals.turns, 2);
  assert.equal(measured.totals.tokensInput, 7);
  assert.equal(measured.totals.tokensOutput, 1);
  assert.equal(measured.totals.costUsdMicros, 0);
  assert.deepEqual(measured.totals.models, []);
});

test("a line that is not a frame is passed over rather than ending the fold", () => {
  const measured = ticketExecutionRunMeasured(
    ['{"broken', "", "[]", JSON.stringify(assistant("sonnet", {}))].join("\n"),
    bounds,
  );
  assert.equal(measured.turns.length, 1);
});
