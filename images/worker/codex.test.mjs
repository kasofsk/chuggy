import assert from "node:assert/strict";
import test from "node:test";

import { codexAgent, codexInvocation, codexResult } from "./codex.mjs";

const task = {
  worker: {
    mode: { type: "SingleAgent", agent: "Codex", arguments: [] },
  },
  briefing: { text: "briefing" },
};

test("a Codex invocation is ephemeral and constrained to the result schema", () => {
  assert.deepEqual(
    codexInvocation(task, { resultSchema: "/tmp/result.json" }),
    [
      "exec",
      "--json",
      "--ephemeral",
      "--dangerously-bypass-approvals-and-sandbox",
      "--output-schema",
      "/tmp/result.json",
      "briefing",
    ],
  );
});

test("the final Codex agent message supplies the structured result", () => {
  const output = {
    type: "item.completed",
    item: {
      type: "agent_message",
      text: JSON.stringify({ verdict: "Pass", summary: "done" }),
    },
  };
  assert.deepEqual(codexResult([output]), {
    output,
    result: { verdict: "Pass", summary: "done" },
  });
});

test("Codex must return a structured verdict", () => {
  assert.throws(
    () =>
      codexResult([
        {
          type: "item.completed",
          item: { type: "agent_message", text: "done" },
        },
      ]),
    /Codex returned no structured verdict/u,
  );
});

test("ticket configuration cannot replace worker-owned Codex arguments", () => {
  assert.throws(
    () =>
      codexInvocation(
        {
          ...task,
          worker: {
            mode: {
              type: "SingleAgent",
              agent: "Codex",
              arguments: ["--output-schema=mine.json"],
            },
          },
        },
        { resultSchema: "/tmp/result.json" },
      ),
    /reserves Codex argument --output-schema=/u,
  );
});

test("Codex usage is translated into the run evidence vocabulary", () => {
  assert.deepEqual(
    codexAgent.observed({
      type: "turn.completed",
      usage: { input_tokens: 3, cached_input_tokens: 2, output_tokens: 1 },
    }),
    {
      usage: {
        input_tokens: 3,
        output_tokens: 1,
        cache_read_input_tokens: 2,
      },
      num_turns: 1,
    },
  );
});
