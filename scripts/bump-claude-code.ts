#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Moves the worker image to the newest Claude Code by moving its Agent SDK, and
 * takes the CLI version from the SDK's own `claudeCodeVersion`, because the
 * image fails its build unless the two are the same Claude Code.
 */

/** The two versions the worker Dockerfile has to move together. */
export interface ClaudeCodePair {
  readonly claudeCode: string;
  readonly agentSdk: string;
}

const dockerfile = fileURLToPath(
  new URL("../images/worker/Dockerfile", import.meta.url),
);

const latestSdk =
  "https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/latest";

const versionShape = /^\d+\.\d+\.\d+$/;

/** The Dockerfile with both ARGs set to the pair, refusing one that lacks either. */
export function dockerfileWithPair(text: string, pair: ClaudeCodePair): string {
  let result = text;
  for (const [name, version] of [
    ["CLAUDE_CODE_VERSION", pair.claudeCode],
    ["AGENT_SDK_VERSION", pair.agentSdk],
  ] as const) {
    if (!versionShape.test(version))
      throw new Error(`${name} would be ${JSON.stringify(version)}`);
    const line = new RegExp(`^ARG ${name}=.*$`, "m");
    if (!line.test(result)) throw new Error(`no ARG ${name} to move`);
    result = result.replace(line, `ARG ${name}=${version}`);
  }
  return result;
}

/** The pair npm's latest Agent SDK names, read off the registry's own manifest. */
export function pairOfManifest(manifest: unknown): ClaudeCodePair {
  const { version, claudeCodeVersion } = (manifest ?? {}) as Record<
    string,
    unknown
  >;
  if (typeof version !== "string" || typeof claudeCodeVersion !== "string")
    throw new Error(
      "the SDK manifest names no version or no claudeCodeVersion",
    );
  return { claudeCode: claudeCodeVersion, agentSdk: version };
}

async function main(): Promise<void> {
  const response = await fetch(latestSdk);
  if (!response.ok) throw new Error(`${latestSdk}: ${response.status}`);
  const pair = pairOfManifest(await response.json());
  const before = readFileSync(dockerfile, "utf8");
  const after = dockerfileWithPair(before, pair);
  if (after === before) {
    console.log(`already at Claude Code ${pair.claudeCode}`);
    return;
  }
  writeFileSync(dockerfile, after);
  console.log(
    `Claude Code ${pair.claudeCode}, Agent SDK ${pair.agentSdk}; the worker image needs a build and a rollout`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
