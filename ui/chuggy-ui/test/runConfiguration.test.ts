/**
 * The configuration snapshot a run wrote, as the console reads its prompt.
 *
 * The failures that matter are a snapshot the console refuses whole because one
 * part of it was too large to keep, and a prompt drawn from a command line that
 * was not the prompt's — both leave a reader believing they have seen what the
 * agent was given.
 */

import { expect, test } from "vitest";

import type { RunConfigurationResponse } from "../../../src/contract/responses.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  runPromptHead,
  runPromptHeadCharsMax,
  runPromptHeadLinesMax,
  runPromptOf,
  runPromptOfPanel,
  runPromptRead,
  runConfigurationRead,
} from "../app/core/runConfiguration.ts";
import type { RunConfigurationSnapshot } from "../app/core/runConfiguration.ts";

const marker = { chuggy_truncated: { bytes: 4_096, digest: "d".repeat(64) } };

function snapshotOf(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    argv: ["claude", "--print", "do the thing"],
    claudeVersion: "2.1.247",
    init: {
      type: "system",
      subtype: "init",
      model: "opus",
      permissionMode: "acceptEdits",
      cwd: "/work",
      tools: ["Read", "Bash"],
      skills: [{ name: "one" }, { name: "two" }, { name: "three" }],
      claude_code_version: "2.1.247",
    },
    files: [],
    dropped: [],
    droppedOmitted: 0,
    ...over,
  });
}

function read(content: string): RunConfigurationSnapshot {
  const reading = runConfigurationRead(content);
  if (reading.reading !== "Snapshot") throw new Error("not a snapshot");
  return reading.snapshot;
}

/** The worker replaces an init event that would not fit, so a console that
 * refused the snapshot for it would show nothing at all. */
test("an init event replaced by its own reference still reads", () => {
  expect(runPromptOf(read(snapshotOf({ init: marker })))).toEqual({
    prompt: "Kept",
    text: "do the thing",
  });
});

/** A file past the digest bound is listed with no digest at all, and a schema
 * requiring one would refuse the whole snapshot. */
test("a dropped file without a digest does not refuse the snapshot", () => {
  const snapshot = read(
    snapshotOf({
      dropped: [
        {
          source: "ProjectInstruction",
          path: "/work/huge.md",
          bytes: 9_000_000,
        },
      ],
    }),
  );
  expect(snapshot.dropped[0]?.digest).toBeUndefined();
});

test("bytes that are not a snapshot are unreadable rather than thrown on", () => {
  expect(runConfigurationRead("not json").reading).toBe("Unreadable");
  expect(runConfigurationRead(JSON.stringify({ argv: 3 })).reading).toBe(
    "Unreadable",
  );
});

/**
 * The worker core's `snapshot.mjs` builds its frame as
 * `JSON.parse(scrub(JSON.stringify(init ?? null)))`, so a run taken with no
 * init event writes `init: null` — and a schema that refused it would lose the
 * argv, the files and the dropped list with it.
 */
test("a snapshot whose init the worker wrote as null still draws the rest", () => {
  const snapshot = read(
    snapshotOf({
      init: null,
      files: [
        {
          source: "MemoryPath",
          path: "/home/agent/.claude/CLAUDE.md",
          bytes: 12,
          digest: "a".repeat(64),
          content: "remember",
        },
      ],
      dropped: [
        {
          source: "ProjectInstruction",
          path: "/work/huge.md",
          bytes: 9_000_000,
        },
      ],
    }),
  );
  expect(snapshot.argv).toEqual(["claude", "--print", "do the thing"]);
  expect(snapshot.files.map((file) => file.path)).toEqual([
    "/home/agent/.claude/CLAUDE.md",
  ]);
  expect(snapshot.dropped.map((file) => file.path)).toEqual(["/work/huge.md"]);
});

/** A snapshot from a worker that predates the field reads as it always did. */
test("a snapshot naming no omitted count still reads", () => {
  const older = JSON.parse(snapshotOf()) as Record<string, unknown>;
  delete older["droppedOmitted"];
  const snapshot = read(JSON.stringify(older));
  expect(snapshot.droppedOmitted).toBeUndefined();
});

/** The worker hands Claude and Codex their prompt as the last word of the
 * command line; any other agent's last word is a flag or a path, and drawing
 * it as the prompt would put words in the member's mouth. */
test("the prompt is the command line's last word for an agent that is handed it there", () => {
  for (const agent of ["Claude", "Codex"])
    expect(runPromptOf(read(snapshotOf({ agent })))).toEqual({
      prompt: "Kept",
      text: "do the thing",
    });
  expect(runPromptOf(read(snapshotOf()))).toEqual({
    prompt: "Kept",
    text: "do the thing",
  });
  expect(runPromptOf(read(snapshotOf({ agent: "Aider" })))).toEqual({
    prompt: "NotKept",
  });
  expect(runPromptOf(read(snapshotOf({ claudeVersion: undefined })))).toEqual({
    prompt: "NotKept",
  });
});

/** A command line cut short keeps a digest in place of its words, so its last
 * surviving word is not the prompt. */
test("a command line that did not fit, or holds nothing, kept no prompt", () => {
  const cut = read(
    snapshotOf({ argv: ["claude", "--print"], argvTruncated: marker }),
  );
  expect(runPromptOf(cut)).toEqual({ prompt: "NotKept" });
  expect(runPromptOf(read(snapshotOf({ argv: [] })))).toEqual({
    prompt: "NotKept",
  });
  expect(runPromptOf(read(snapshotOf({ argv: ["claude", ""] })))).toEqual({
    prompt: "NotKept",
  });
});

/** A read that failed says nothing about whether the run kept a prompt, so it
 * must not be drawn as one that kept none. */
test("the prompt follows the snapshot's read, and a failed read is not a missing prompt", () => {
  const ready = (content: string): PanelState<RunConfigurationResponse> => ({
    state: "Ready",
    value: { read: "Content", digest: "d".repeat(64), bytes: 1, content },
    observedAtMs: undefined,
  });
  expect(runPromptOfPanel({ state: "Pending" })).toBeUndefined();
  expect(runPromptOfPanel(ready(snapshotOf()))).toEqual({
    prompt: "Kept",
    text: "do the thing",
  });
  expect(runPromptOfPanel(ready("{"))).toEqual({ prompt: "Unreadable" });
  expect(runPromptOfPanel({ state: "Absent" })).toEqual({
    prompt: "NotKept",
  });
  expect(
    runPromptOfPanel({
      state: "Failed",
      failure: { outcome: "Unreachable", reason: "down" },
    }),
  ).toEqual({
    prompt: "Unreadable",
  });
  expect(runPromptRead("not json")).toEqual({ prompt: "Unreadable" });
});

test("a prompt folds to its opening lines, and one long line to its opening characters", () => {
  expect(runPromptHead("short")).toEqual({ head: "short", cut: false });
  const lines = Array.from(
    { length: runPromptHeadLinesMax + 2 },
    (_, at) => `line ${String(at + 1)}`,
  );
  const folded = runPromptHead(lines.join("\n"));
  expect(folded.cut).toBe(true);
  expect(folded.head).toBe(
    `${lines.slice(0, runPromptHeadLinesMax).join("\n")}…`,
  );
  const long = runPromptHead("x".repeat(runPromptHeadCharsMax + 1));
  expect(long).toEqual({
    head: `${"x".repeat(runPromptHeadCharsMax)}…`,
    cut: true,
  });
  expect(
    runPromptHead(lines.slice(0, runPromptHeadLinesMax).join("\n")).cut,
  ).toBe(false);
});
