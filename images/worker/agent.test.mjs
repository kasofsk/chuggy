import assert from "node:assert/strict";
import test from "node:test";

import { workerAgent } from "./agent.mjs";

function task(agent) {
  return {
    worker: { mode: { type: "SingleAgent", agent, arguments: [] } },
  };
}

test("the single-agent mode selects its provider adapter", () => {
  assert.equal(workerAgent(task("Claude")).name, "Claude");
  assert.equal(workerAgent(task("Codex")).name, "Codex");
});

test("an immutable worker configuration from before modes remains Claude", () => {
  assert.equal(
    workerAgent({ worker: { arguments: [], setup: [], files: [] } }).name,
    "Claude",
  );
});

test("an unknown worker mode is refused", () => {
  assert.throws(
    () => workerAgent({ worker: { mode: { type: "ParallelAgents" } } }),
    /worker mode is not SingleAgent/u,
  );
});
