/**
 * The names the setup program tells a person to press, held against the
 * console pages that draw them.
 *
 * The program sends her to a page and names what to press there, and the
 * pages write those names in their own markup, where the program's code
 * cannot reach them. Each page's source is read here for the name the
 * program says, so a page that renames a button fails this and not her.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { setupPressed } from "../../ui/chuggy-ui/app/core/setupNext.ts";

/** The page that draws each name, by its path from the root of this tree. */
const drawnIn: Readonly<Record<keyof typeof setupPressed, string>> = {
  projectPage: "ui/chuggy-ui/app/browser/ProjectCreation.tsx",
  projectCreate: "ui/chuggy-ui/app/browser/ProjectCreation.tsx",
  edit: "ui/chuggy-ui/app/browser/ui/SettingsSection.tsx",
  save: "ui/chuggy-ui/app/browser/ui/SettingsSection.tsx",
  connect: "ui/chuggy-ui/app/browser/repositories/ConnectGithub.tsx",
  add: "ui/chuggy-ui/app/browser/repositories/AddRepository.tsx",
  retry: "ui/chuggy-ui/app/browser/repositories/BindingConfigurations.tsx",
  runner: "ui/chuggy-ui/app/browser/RunnersPage.tsx",
  ticket: "ui/chuggy-ui/app/browser/TicketCreation.tsx",
};

/** Whether a page's source draws `name` as the whole of a text or of a label, and not as part of a longer one. */
function draws(source: string, name: string): boolean {
  assert.match(name, /^[A-Za-z]+(?: [A-Za-z]+)*$/u);
  return new RegExp(`(?:^\\s*|[>"])${name}(?:\\s*$|[<"])`, "mu").test(source);
}

for (const [key, page] of Object.entries(drawnIn))
  test(`the page ${page} draws what the program says is pressed there (${key})`, () => {
    const name = setupPressed[key as keyof typeof setupPressed];
    const source = readFileSync(page, "utf8");
    assert.ok(draws(source, name), `${page} draws no "${name}"`);
  });

test("a name is found only where a page draws all of it and no more", () => {
  const source = '<Button aria-label="Add runner">\n  Add runner\n</Button>';
  assert.ok(draws(source, "Add runner"));
  assert.ok(!draws(source, "Add"));
  assert.ok(!draws(source, "runner"));
  assert.ok(draws("<h1>New project</h1>", "New project"));
  assert.ok(!draws("// the New project page", "New project"));
});
