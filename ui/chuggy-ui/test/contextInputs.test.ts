/**
 * What a run was handed, as its snapshot kept it: the brief from its own field
 * or the command line's last word, the window `--settings` named in either
 * spelling, and the files grouped and named under the working directory.
 */

import { expect, test } from "vitest";

import {
  contextBriefOf,
  contextInputsOf,
  contextSettingsWindowOf,
} from "../app/core/contextInputs.ts";
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

test("the brief is the snapshot's own field where it has one, and the command line's last word otherwise", () => {
  expect(contextBriefOf(contextSnapshot())).toBe(
    "# Implement the ticket\n\nYou are developing Chuggy itself.",
  );
  expect(contextBriefOf(contextSnapshot({ brief: "The brief." }))).toBe(
    "The brief.",
  );
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
