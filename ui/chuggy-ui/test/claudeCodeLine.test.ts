/**
 * The line a person pastes into Claude Code: its whole text for one site, and
 * the address in it held to the path the build emits the setup program at.
 */

import { expect, test } from "vitest";

import { claudeCodeLine } from "../app/core/claudeCodeLine.ts";
import { setupProgramPath } from "../app/core/setupProgram.ts";

const origin = "https://chuggy.example";

test("the line for a site is one fixed text around that site's address", () => {
  expect(claudeCodeLine(origin)).toBe(
    'Set up chuggy for the repository in this folder: run "curl -fsS https://chuggy.example/chuggy-setup.mjs -o ~/.chuggy-setup.mjs && node ~/.chuggy-setup.mjs --site https://chuggy.example" and do what its output says.',
  );
});

test("the address the line fetches is the site's own, at the path the build emits the program at", () => {
  const fetched = /curl -fsS (\S+) /u.exec(claudeCodeLine(origin))?.[1];
  expect(fetched).toBe(`${origin}${setupProgramPath}`);
});
