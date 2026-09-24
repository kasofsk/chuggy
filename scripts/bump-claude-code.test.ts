import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { dockerfileWithPair, pairOfManifest } from "./bump-claude-code.ts";

const worker = readFileSync("images/worker/Dockerfile", "utf8");

test("the worker Dockerfile's two ARGs move together and nothing else does", () => {
  const moved = dockerfileWithPair(worker, {
    claudeCode: "9.9.9",
    agentSdk: "8.8.8",
  });
  assert.match(moved, /^ARG CLAUDE_CODE_VERSION=9\.9\.9$/m);
  assert.match(moved, /^ARG AGENT_SDK_VERSION=8\.8\.8$/m);
  const untouched = (text: string) =>
    text
      .split("\n")
      .filter((line) => !/^ARG (CLAUDE_CODE|AGENT_SDK)_VERSION=/.test(line));
  assert.deepEqual(untouched(moved), untouched(worker));
});

test("a Dockerfile missing either ARG, or a version that is not one, is refused", () => {
  const pair = { claudeCode: "1.2.3", agentSdk: "0.1.2" };
  assert.throws(() =>
    dockerfileWithPair(worker.replace(/^ARG AGENT_SDK_VERSION=.*$/m, ""), pair),
  );
  assert.throws(() =>
    dockerfileWithPair(worker, { ...pair, claudeCode: "1.2.3\nRUN evil" }),
  );
});

test("the pair is the SDK's version and the Claude Code it names", () => {
  assert.deepEqual(
    pairOfManifest({ version: "0.3.282", claudeCodeVersion: "2.1.282" }),
    { claudeCode: "2.1.282", agentSdk: "0.3.282" },
  );
  assert.throws(() => pairOfManifest({ version: "0.3.282" }));
});
