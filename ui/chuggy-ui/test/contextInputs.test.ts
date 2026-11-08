/**
 * What a run was handed, as its snapshot kept it: the brief as the run page
 * reads the prompt, the window `--settings` named in either
 * spelling, and the files grouped and named under the working directory.
 */

import { expect, test } from "vitest";

import {
  contextInputsOf,
  contextPathParts,
  contextSettingsWindowOf,
} from "../app/core/contextInputs.ts";
import { runPromptOf } from "../app/core/runConfiguration.ts";
import type { RunConfigurationSnapshot } from "../app/core/runConfiguration.ts";
import { contextSnapshot, contextWindow } from "./contextFixture.ts";

test("the window is the one --settings names, as one word or as the word after it, and none where it names none", () => {
  expect(
    contextSettingsWindowOf(['--settings={"autoCompactWindow":350000}']),
  ).toBe(350_000);
  expect(
    contextSettingsWindowOf(["--settings", '{"autoCompactWindow":500000}']),
  ).toBe(500_000);
  expect(
    contextSettingsWindowOf(["--settings", "/etc/settings.json"]),
  ).toBeUndefined();
  expect(contextSettingsWindowOf(['--settings={"model":"x"}'])).toBeUndefined();
});

test("the brief is the prompt the run was handed, as the run page reads it", () => {
  const briefOf = (snapshot: RunConfigurationSnapshot) => {
    const prompt = runPromptOf(snapshot);
    return {
      inputs: contextInputsOf(snapshot, undefined).brief,
      prompt: prompt.prompt === "Kept" ? prompt.text : undefined,
    };
  };
  const streamed = contextSnapshot()
    .argv.slice(0, -1)
    .concat(["--input-format", "stream-json"]);
  for (const snapshot of [
    contextSnapshot(),
    contextSnapshot({ brief: "The brief." }),
    contextSnapshot({ argv: streamed }),
    contextSnapshot({ argv: streamed, brief: "The brief." }),
  ]) {
    const read = briefOf(snapshot);
    expect(read.inputs).toBe(read.prompt);
  }
  expect(briefOf(contextSnapshot()).inputs).toBe(
    "# Implement the ticket\n\nYou are developing Chuggy itself.",
  );
  expect(briefOf(contextSnapshot({ argv: streamed })).inputs).toBeUndefined();
});

test("the files are grouped instructions first, named under the working directory, and weighed where a reading named them", () => {
  const inputs = contextInputsOf(contextSnapshot(), contextWindow());
  expect(
    inputs.files.map((file) => [file.group, file.path, file.tokens]),
  ).toStrictEqual([
    ["Instructions", "CLAUDE.md", 2_543],
    ["Settings", ".claude/settings.json", undefined],
  ]);
  expect(inputs.tools?.names).toStrictEqual(["Bash", "Read", "Edit"]);
  expect(inputs.tools?.deferred).toBe(22_455);
  expect(inputs.mcpServers?.names).toStrictEqual([]);
  expect(inputs.agents?.names).toStrictEqual(["Explore"]);
});

test("a file under the runtime's home is named from ~, the home being where a .claude directory outside the working directory sits", () => {
  const settings = (path: string) => ({
    source: "Settings",
    path,
    bytes: 620,
    content: "{}",
  });
  const named = (paths: readonly string[]) =>
    contextInputsOf(
      contextSnapshot({ files: paths.map(settings) }),
      undefined,
    ).files.map((file) => file.path);
  expect(
    named([
      "/work/repo/.claude/settings.json",
      "/home/node/.claude/settings.json",
      "/home/node/notes/plan.md",
      "/etc/claude-code/managed-settings.json",
    ]),
  ).toStrictEqual([
    ".claude/settings.json",
    "~/.claude/settings.json",
    "~/notes/plan.md",
    "/etc/claude-code/managed-settings.json",
  ]);
  expect(named(["/root/.claude/settings.json"])).toStrictEqual([
    "~/.claude/settings.json",
  ]);
  expect(named(["/home/node/notes/plan.md"])).toStrictEqual([
    "/home/node/notes/plan.md",
  ]);
});

test("a path breaks only after a slash, so no name is split", () => {
  expect(contextPathParts("src/adapters/postgres/AGENTS.md")).toStrictEqual([
    "src/",
    "adapters/",
    "postgres/",
    "AGENTS.md",
  ]);
  expect(contextPathParts("/home/node/.claude/settings.json")).toStrictEqual([
    "/",
    "home/",
    "node/",
    ".claude/",
    "settings.json",
  ]);
  expect(contextPathParts("CLAUDE.md")).toStrictEqual(["CLAUDE.md"]);
});

test("an init the snapshot did not keep lists nothing rather than failing", () => {
  const inputs = contextInputsOf(
    contextSnapshot({ init: "garbled" }),
    undefined,
  );
  expect([inputs.tools, inputs.skills, inputs.plugins]).toStrictEqual([
    undefined,
    undefined,
    undefined,
  ]);
});
