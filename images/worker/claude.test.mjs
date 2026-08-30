import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { claudeInvocation, claudeResult } from "./claude.mjs";

test("the development configuration composes a valid default Claude invocation", async () => {
  const checkedIn = JSON.parse(
    await readFile(".chug/configurations/chuggy-development.json", "utf8"),
  );
  const task = {
    ...checkedIn.configuration,
    briefing: { text: "briefing" },
  };

  assert.deepEqual(claudeInvocation(task).slice(-4), [
    "--mcp-config",
    '{"mcpServers":{}}',
    "--allowedTools=Bash,Edit,Read,Write,Glob,Grep",
    "briefing",
  ]);
  assert.deepEqual(claudeInvocation(task).slice(0, 5), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--json-schema",
  ]);
});

test("the final structured event is retained after streamed progress", () => {
  const final = {
    type: "result",
    structured_output: { verdict: "Pass", summary: "done" },
  };
  assert.deepEqual(
    claudeResult([{ type: "assistant", message: "working" }, final]),
    { output: final, result: final.structured_output },
  );
});

test("ticket configuration cannot replace worker-owned Claude arguments", () => {
  assert.throws(
    () =>
      claudeInvocation({
        worker: {
          mode: {
            type: "SingleAgent",
            agent: "Claude",
            arguments: ["--mcp-config={}"],
          },
        },
        briefing: { text: "briefing" },
      }),
    /reserves Claude argument --mcp-config=/,
  );
});
