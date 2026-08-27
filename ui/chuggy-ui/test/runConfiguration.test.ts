/**
 * The configuration snapshot a run wrote, as the pane reads it.
 *
 * The failures that matter are a snapshot the console refuses whole because one
 * file in it was too large to digest, and a file listed without saying that its
 * bytes are not all there — both leave a reader believing they have seen what
 * the agent was given.
 */

import { expect, test } from "vitest";

import {
  runConfigurationArgvSentence,
  runConfigurationCapabilitiesSentence,
  runConfigurationFileSentence,
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
