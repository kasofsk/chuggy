/**
 * The lines a person pastes into Claude Code: each one's whole text for one
 * site, and the address in it held to the path the build emits the setup
 * program at.
 */

import { expect, test } from "vitest";

import {
  claudeCodeChatHostLine,
  claudeCodeLine,
} from "../app/core/claudeCodeLine.ts";
import { setupAsked } from "../app/core/setupArguments.ts";
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

test("the chat host's line fetches the program as the other does and runs chat-host for the site and the workspace, carrying no token", () => {
  expect(claudeCodeChatHostLine(origin, "acme")).toBe(
    'Make this machine my chuggy chat host: run "curl -fsS https://chuggy.example/chuggy-setup.mjs -o ~/.chuggy-setup.mjs && node ~/.chuggy-setup.mjs chat-host --site https://chuggy.example --workspace acme" and do what its output says.',
  );
});

test("what the chat host's line runs the program with is read as chat-host for that site and workspace", () => {
  const run = / ~\/\.chuggy-setup\.mjs (chat-host [^"]+)"/u.exec(
    claudeCodeChatHostLine(origin, "acme"),
  )?.[1];
  expect(setupAsked(run?.split(" ") ?? [])).toMatchObject({
    asked: "ChatHost",
    site: origin,
    workspace: "acme",
  });
});
