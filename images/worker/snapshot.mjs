/**
 * The effective configuration one run was given: the resolved argv, the
 * runtime's own init event, and the instruction, settings and plugin files it
 * named, gathered once and uploaded whole.
 *
 * THE LIST IS A PRIORITY ORDER, NOT A SEARCH. Memory paths first, then the
 * project's instruction files, then settings, then plugins, then what the
 * platform provisioned; a file whose bytes do not fit the snapshot's cap is
 * listed by path, size and digest instead, so what was left out is still
 * nameable.
 *
 * WHAT THE CAP COSTS IS COUNTED, NOT HIDDEN. A reference is itself bytes, so a
 * cap that binds can leave files the snapshot cannot even name;
 * `droppedOmitted` is how many, and the three figures sum to the files that
 * were there to gather. A candidate path that does not exist was never a file
 * and is counted nowhere.
 *
 * NOTHING HERE READS AN UNBOUNDED FILE OR WALKS AN UNBOUNDED TREE. Every walk,
 * read and total has its own limit, and a file past the largest of them is
 * reported by size alone.
 */

import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";

import { truncationMarker } from "./runEvidence.mjs";

/** The largest snapshot, which is what one console read answers whole. */
export const runConfigurationBytesMax = 1_048_576;

/** The most of one file the snapshot carries; a larger file is not an
 * instruction file. */
export const runConfigurationFileBytesMax = 262_144;

/** The most of one file that is read to digest it. */
export const runConfigurationDigestBytesMax = 4_194_304;

/** How many files the snapshot names, and how far and wide the walk beneath the
 * working directory goes. */
export const runConfigurationFilesMax = 128;
export const runConfigurationWalkDepthMax = 8;
export const runConfigurationWalkEntriesMax = 20_000;

const instructionNames = ["CLAUDE.md", "CLAUDE.local.md", "AGENTS.md"];
const walkSkippedNames = [".git", "node_modules"];
const pluginManifestPath = [".claude-plugin", "plugin.json"];
const listSeparatorBytes = 1;

function digestOf(value) {
  return createHash("sha256").update(value).digest("hex");
}

function textList(values) {
  return Array.isArray(values)
    ? values.filter((value) => typeof value === "string" && value.length > 0)
    : [];
}

/**
 * Every `CLAUDE.md`, `CLAUDE.local.md` and `AGENTS.md` beneath the working
 * directory, found by a walk bounded in depth and in entries read.
 */
export async function walkInstructionFiles(cwd, services) {
  if (typeof cwd !== "string" || cwd.length === 0) return [];
  const found = [];
  const queue = [{ directory: cwd, depth: 0 }];
  let entries = 0;
  while (queue.length > 0 && entries < runConfigurationWalkEntriesMax) {
    const next = queue.shift();
    let listed;
    try {
      listed = await services.readdir(next.directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of listed) {
      entries += 1;
      if (entries > runConfigurationWalkEntriesMax) break;
      const path = join(next.directory, entry.name);
      if (entry.isDirectory()) {
        if (
          !walkSkippedNames.includes(entry.name) &&
          next.depth < runConfigurationWalkDepthMax
        )
          queue.push({ directory: path, depth: next.depth + 1 });
      } else if (
        instructionNames.includes(entry.name) &&
        found.length < runConfigurationFilesMax
      )
        found.push(path);
    }
  }
  return found;
}

function memoryCandidates(init) {
  return textList(init?.memory_paths).map((path) => ({
    source: "MemoryPath",
    path,
  }));
}

function projectCandidates(cwd, walked) {
  const named =
    typeof cwd === "string"
      ? instructionNames.map((name) => join(cwd, name))
      : [];
  return [...named, ...walked].map((path) => ({
    source: "ProjectInstruction",
    path,
  }));
}

function settingsCandidates(cwd, home) {
  const project =
    typeof cwd === "string"
      ? [
          join(cwd, ".claude", "settings.json"),
          join(cwd, ".claude", "settings.local.json"),
          join(cwd, ".mcp.json"),
        ]
      : [];
  const user =
    typeof home === "string"
      ? [
          join(home, ".claude", "settings.json"),
          join(home, ".claude", "CLAUDE.md"),
        ]
      : [];
  return [...project, ...user].map((path) => ({ source: "Settings", path }));
}

function pluginCandidates(init) {
  const paths = textList(
    (Array.isArray(init?.plugins) ? init.plugins : []).map(
      (plugin) => plugin?.path,
    ),
  );
  return paths.flatMap((path) => [
    { source: "Plugin", path },
    { source: "Plugin", path: join(path, ...pluginManifestPath) },
  ]);
}

function provisionedCandidates(task) {
  const files = Array.isArray(task?.worker?.files) ? task.worker.files : [];
  return files
    .filter(
      (file) =>
        typeof file?.path === "string" && typeof file?.content === "string",
    )
    .map((file) => ({
      source: "Provisioned",
      path: file.path,
      content: file.content,
    }));
}

/**
 * The files the snapshot offers to carry, in the priority order it gathers
 * them, each named once.
 */
export function configurationCandidates({ init, cwd, home, task, walked }) {
  const offered = [
    ...memoryCandidates(init),
    ...projectCandidates(cwd, walked ?? []),
    ...settingsCandidates(cwd, home),
    ...pluginCandidates(init),
    ...provisionedCandidates(task),
  ];
  const seen = new Set();
  const kept = [];
  for (const candidate of offered) {
    if (kept.length >= runConfigurationFilesMax) break;
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    kept.push(candidate);
  }
  return kept;
}

async function candidateEntry(candidate, services, scrub) {
  if (candidate.content !== undefined) {
    const provisioned = Buffer.from(candidate.content);
    return {
      file: {
        source: candidate.source,
        path: candidate.path,
        bytes: provisioned.byteLength,
        digest: digestOf(provisioned),
      },
    };
  }
  const reference = { source: candidate.source, path: candidate.path };
  let stats;
  try {
    stats = await services.stat(candidate.path);
  } catch {
    return {};
  }
  if (!stats.isFile()) return {};
  if (stats.size > runConfigurationDigestBytesMax)
    return { dropped: { ...reference, bytes: stats.size } };
  let raw;
  try {
    raw = await services.readFile(candidate.path);
  } catch {
    return {};
  }
  return {
    file: {
      ...reference,
      bytes: raw.byteLength,
      digest: digestOf(raw),
      content: scrub(
        raw.subarray(0, runConfigurationFileBytesMax).toString("utf8"),
      ),
      ...(raw.byteLength > runConfigurationFileBytesMax
        ? { truncated: true }
        : {}),
    },
  };
}

function frameBytes(value) {
  return Buffer.byteLength(JSON.stringify(value));
}

function snapshotFrame(argv, init, agent, scrub) {
  const scrubbedInit = JSON.parse(scrub(JSON.stringify(init ?? null)));
  const version = scrubbedInit?.claude_code_version;
  const frame = {
    argv: (Array.isArray(argv) ? argv : []).map((value) =>
      scrub(String(value)),
    ),
    ...(agent === "Claude" || agent === "Codex" ? { agent } : {}),
    ...(typeof version === "string" ? { claudeVersion: version } : {}),
    init: scrubbedInit,
    files: [],
    dropped: [],
    droppedOmitted: runConfigurationFilesMax,
  };
  if (frameBytes(frame) <= runConfigurationBytesMax) return frame;
  frame.init = truncationMarker(JSON.stringify(scrubbedInit));
  if (frameBytes(frame) <= runConfigurationBytesMax) return frame;
  frame.argvTruncated = truncationMarker(JSON.stringify(frame.argv));
  frame.argv = [];
  return frame;
}

function entryCost(entry) {
  return frameBytes(entry) + listSeparatorBytes;
}

function droppedReference(entry) {
  return {
    source: entry.source,
    path: entry.path,
    bytes: entry.bytes,
    ...(entry.digest === undefined ? {} : { digest: entry.digest }),
  };
}

/**
 * The snapshot as the bytes the worker uploads: every entry it holds, kept or
 * referenced, is charged against the cap, so the body is never over it. A file
 * the cap left no room even to name is counted in `droppedOmitted`, so those
 * three figures sum to the files that were found.
 */
export async function runConfigurationSnapshot(
  { argv, init, task, cwd, home, scrub },
  services = { readFile, readdir, stat },
) {
  const walked = await walkInstructionFiles(cwd, services);
  const snapshot = snapshotFrame(argv, init, task?.worker?.mode?.agent, scrub);
  let used = frameBytes(snapshot);
  let omitted = 0;
  for (const candidate of configurationCandidates({
    init,
    cwd,
    home,
    task,
    walked,
  })) {
    const { file, dropped } = await candidateEntry(candidate, services, scrub);
    const entry = file ?? dropped;
    if (entry === undefined) continue;
    if (
      file !== undefined &&
      used + entryCost(file) <= runConfigurationBytesMax
    ) {
      snapshot.files.push(file);
      used += entryCost(file);
      continue;
    }
    const reference = droppedReference(entry);
    if (used + entryCost(reference) > runConfigurationBytesMax) {
      omitted += 1;
      continue;
    }
    snapshot.dropped.push(reference);
    used += entryCost(reference);
  }
  snapshot.droppedOmitted = omitted;
  return Buffer.from(JSON.stringify(snapshot));
}
