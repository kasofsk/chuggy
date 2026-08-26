import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { claudeInvocation } from "./claude.mjs";

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
});

test("ticket configuration cannot replace worker-owned Claude arguments", () => {
  assert.throws(
    () =>
      claudeInvocation({
        worker: { arguments: ["--mcp-config={}"] },
        briefing: { text: "briefing" },
      }),
    /reserves Claude argument --mcp-config=/,
  );
});
