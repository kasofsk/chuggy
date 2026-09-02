/**
 * The build's verdict on what the session mode can resolve, read off the image
 * rather than off the Dockerfile.
 *
 * `zod` IS A PEER DEPENDENCY OF THE AGENT SDK AND A GLOBAL INSTALL DOES NOT
 * PLACE IT. The SDK declares `zod` under `peerDependencies`, npm's global
 * install resolves no peers, and nothing about a missing one is visible until a
 * lead takes a turn: the tool shapes are zod raw shapes, so a pod without it
 * starts, claims a turn and then fails every one of them. So the image installs
 * `zod` beside the SDK at a pinned version, and this checks the two agree.
 *
 * THE AGREEMENT IS READ, NOT ASSERTED. The SDK's own `peerDependencies.zod`
 * range is read off the installed package and the installed `zod` is checked
 * against it, which is the device the two Claude Code pins already use: a bump
 * of `AGENT_SDK_VERSION` that moved the range fails the build instead of the
 * rig.
 *
 * THE OTHER TWO PEERS ARE DELIBERATELY NOT INSTALLED. `@anthropic-ai/sdk` and
 * `@modelcontextprotocol/sdk` are declared peers too and neither resolves in
 * this image; `toolProbe.mjs` stands the in-process MCP server up and lists all
 * of its tools without them, because the SDK bundles what it uses. A peer that
 * is genuinely needed shows up as a probe that fails, which is the point of
 * running both here.
 *
 * RESOLUTION IS THE RUNTIME'S OWN. This runs from the directory the pod's
 * scripts live in and imports through the same specifiers `session.mjs` does,
 * because `NODE_PATH` is honoured by `require` and ignored by `import`, and
 * what actually finds a package is the `node_modules` walk up from here.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { sessionSdk } from "./session.mjs";

const sdkPackage = "@anthropic-ai/claude-agent-sdk";

const resolved = await sessionSdk();
for (const [name, held] of Object.entries(resolved))
  if (held === undefined || held === null)
    throw new Error(`the session mode cannot resolve ${name}`);
for (const name of ["query", "tool", "createSdkMcpServer"])
  if (typeof resolved[name] !== "function")
    throw new Error(`the agent runtime exports no ${name}`);

const range = packageManifest(sdkPackage).peerDependencies?.zod;
const installed = packageManifest("zod").version;
if (typeof range !== "string")
  throw new Error("the agent runtime declares no zod peer to check against");
if (!satisfiesCaret(range, installed))
  throw new Error(
    `the agent runtime wants zod ${range} and this image installs ${installed}`,
  );

/**
 * One installed package's own manifest, found by walking up from where the
 * runtime's resolution lands. A package's `exports` map need not publish
 * `./package.json` — the agent runtime's does not — so it is read as a file
 * rather than imported as a subpath, and the walk starts from the specifier so
 * the manifest belongs to the copy that actually resolves here.
 */
function packageManifest(specifier) {
  let held = dirname(fileURLToPath(import.meta.resolve(specifier)));
  for (;;) {
    const candidate = join(held, "package.json");
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, "utf8"));
      if (manifest.name === specifier) return manifest;
    }
    const parent = dirname(held);
    if (parent === held)
      throw new Error(`${specifier} resolves to no package manifest`);
    held = parent;
  }
}

/**
 * Whether a version satisfies a caret range, which is the only form this has
 * ever had to read. Anything else raises rather than passing: a range shape
 * nobody checked is a check that says nothing.
 */
function satisfiesCaret(wanted, version) {
  if (!wanted.startsWith("^"))
    throw new Error(`the zod peer range ${wanted} is not one this probe reads`);
  const [major, minor, patch] = numbers(wanted.slice(1));
  const [heldMajor, heldMinor, heldPatch] = numbers(version);
  if (heldMajor !== major) return false;
  if (heldMinor !== minor) return heldMinor > minor;
  return heldPatch >= patch;
}

function numbers(version) {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isSafeInteger(part)))
    throw new Error(`${version} is not a version this probe reads`);
  return parts;
}

process.stdout.write(
  `the session mode resolves the agent runtime and zod ${installed} for its peer ${range}\n`,
);
