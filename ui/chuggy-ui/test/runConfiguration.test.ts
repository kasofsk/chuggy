/**
 * The configuration snapshot a run wrote, as the pane reads it.
 *
 * The failures that matter are a snapshot the console refuses whole because one
 * file in it was too large to digest, and a file listed without saying that its
 * bytes are not all there — both leave a reader believing they have seen what
 * the agent was given.
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
  runConfigurationArgvSentence,
  runConfigurationCapabilitiesSentence,
  runConfigurationFileSentence,
  runConfigurationOmittedSentence,
  runConfigurationHead,
  runConfigurationOrdered,
  runConfigurationRead,
  runConfigurationSourceSentence,
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
  if (reading.reading !== "Snapshot") throw new Error(reading.reason);
  return reading.snapshot;
}

test("the init event's own account of the run is what the head states", () => {
  const head = runConfigurationHead(read(snapshotOf()));
  expect(head).toEqual({
    claudeVersion: "2.1.247",
    model: "opus",
    permissionMode: "acceptEdits",
    cwd: "/work",
    tools: 2,
    skills: 3,
    initElidedBytes: undefined,
  });
});

/** The worker replaces an init event that would not fit, so a console that
 * refused the snapshot for it would show nothing at all. */
test("an init event replaced by its own reference still reads", () => {
  const head = runConfigurationHead(read(snapshotOf({ init: marker })));
  expect(head.initElidedBytes).toBe(4_096);
  expect(head.model).toBeUndefined();
});

test("a command line that did not fit says so instead of being drawn short", () => {
  expect(runConfigurationArgvSentence(read(snapshotOf()))).toBeUndefined();
  const truncated = read(snapshotOf({ argv: [], argvTruncated: marker }));
  expect(runConfigurationArgvSentence(truncated)).toContain(
    "kept as a digest of itself",
  );
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
  const dropped = snapshot.dropped[0];
  expect(dropped?.digest).toBeUndefined();
  expect(
    runConfigurationFileSentence(dropped ?? { source: "", path: "", bytes: 0 }),
  ).toBe("too large to read, so only its size was recorded");
});

test("a file kept only in part says its digest and size are of the whole", () => {
  expect(
    runConfigurationFileSentence({
      source: "Settings",
      path: "/work/.claude/settings.json",
      bytes: 300_000,
      digest: "a".repeat(64),
      content: "{",
      truncated: true,
    }),
  ).toContain("only the head of this file is kept");
});

test("a file kept whole needs no sentence about what is missing", () => {
  expect(
    runConfigurationFileSentence({
      source: "MemoryPath",
      path: "/home/agent/.claude/CLAUDE.md",
      bytes: 12,
      digest: "a".repeat(64),
      content: "remember",
    }),
  ).toBeUndefined();
});

test("the file list is ordered by where each file came from", () => {
  const files = runConfigurationOrdered([
    { source: "Provisioned", path: "p", bytes: 1 },
    { source: "Elsewhere", path: "x", bytes: 1 },
    { source: "MemoryPath", path: "m", bytes: 1 },
    { source: "Settings", path: "s", bytes: 1 },
  ]);
  expect(files.map((file) => file.path)).toEqual(["m", "s", "p", "x"]);
});

/** Naming an unknown source as unknown is what keeps a reader from taking the
 * console's word for a category it invented. */
test("a source this console does not know names itself as unknown", () => {
  expect(runConfigurationSourceSentence("MemoryPath")).toBe(
    "memory the runtime resolved",
  );
  expect(runConfigurationSourceSentence("Elsewhere")).toContain(
    "does not know (Elsewhere)",
  );
});

test("bytes that are not a snapshot are unreadable rather than thrown on", () => {
  expect(runConfigurationRead("not json").reading).toBe("Unreadable");
  expect(runConfigurationRead(JSON.stringify({ argv: 3 })).reading).toBe(
    "Unreadable",
  );
});

test("what the runtime could reach is counted, and none of it is said as that", () => {
  const head = runConfigurationHead(read(snapshotOf()));
  expect(runConfigurationCapabilitiesSentence(head)).toBe("2 tools, 3 skills");
  expect(runConfigurationCapabilitiesSentence({ ...head, skills: 1 })).toBe(
    "2 tools, 1 skill",
  );
  expect(
    runConfigurationCapabilitiesSentence(
      runConfigurationHead(read(snapshotOf({ init: marker }))),
    ),
  ).toBe("none were reported");
});

/**
 * `snapshot.mjs` builds its frame as `JSON.parse(scrub(JSON.stringify(init ??
 * null)))`, so a run taken with no init event writes `init: null` — and a
 * schema that refused it would lose the argv, the files and the dropped list
 * with it, which is everything the pane exists to show.
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
  expect(runConfigurationHead(snapshot).model).toBeUndefined();
});

/** The init event is the runtime's own vocabulary, and §A.2 declines to close
 * a roster over it for exactly this reason. */
test("an init field this console cannot read costs that field and no other", () => {
  const snapshot = read(
    snapshotOf({
      init: {
        model: "opus",
        cwd: "/work",
        tools: [{ name: "Read" }, { name: "Bash" }],
        skills: { one: true },
      },
      files: [{ source: "Settings", path: "/work/.mcp.json", bytes: 2 }],
    }),
  );
  const head = runConfigurationHead(snapshot);
  expect(head.model).toBe("opus");
  expect(head.cwd).toBe("/work");
  expect(head.tools).toBe(2);
  expect(head.skills).toBeUndefined();
  expect(snapshot.files.map((file) => file.path)).toEqual(["/work/.mcp.json"]);
});

/**
 * A `dropped` reference is itself bytes, so a snapshot that fills its cap can
 * reach files it has no room even to name; a pane that drew nothing would show
 * a file list that looks complete.
 */
test("the files the snapshot had no room to name are said to be there", () => {
  expect(runConfigurationOmittedSentence(read(snapshotOf()))).toBeUndefined();
  expect(
    runConfigurationOmittedSentence(read(snapshotOf({ droppedOmitted: 3 }))),
  ).toBe("3 further files were not named");
  expect(
    runConfigurationOmittedSentence(read(snapshotOf({ droppedOmitted: 1 }))),
  ).toBe("1 further file was not named");
});

/** A snapshot from a worker that predates the field reads as it always did. */
test("a snapshot naming no omitted count says nothing about one", () => {
  const older = JSON.parse(snapshotOf()) as Record<string, unknown>;
  delete older["droppedOmitted"];
  const snapshot = read(JSON.stringify(older));
  expect(snapshot.droppedOmitted).toBeUndefined();
  expect(runConfigurationOmittedSentence(snapshot)).toBeUndefined();
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
  expect(runPromptOfPanel({ state: "Absent", reason: "gone" })).toEqual({
    prompt: "NotKept",
  });
  expect(runPromptOfPanel({ state: "Failed", reason: "down" })).toEqual({
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
