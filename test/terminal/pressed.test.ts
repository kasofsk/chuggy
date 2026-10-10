/**
 * The names the setup program tells a person to press, held against the
 * console pages that draw them.
 *
 * The program sends her to a page and names what to press there, and the
 * pages write those names in their own markup, where the program's code
 * cannot reach them. Each page's source is read here for the name the
 * program says, so a page that renames a button fails this and not her.
 *
 * Some names are not written where they are drawn. A ticket's page draws
 * each action under the action's own name, so that name is read where the
 * action is made; the workspace's accounts page draws the connect button as
 * the one component that writes it, so the page is read for the component;
 * and the Add picker draws the line for an app not granted a repository from
 * the roster the program's own sentence is made from, so the picker is read
 * for drawing that roster, and the roster for the words.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  repositoryGrantLines,
  repositoryWorkerLine,
} from "../../ui/chuggy-ui/app/core/projectRepositories.ts";
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
  dispatch: "ui/chuggy-ui/app/core/ticketActions.ts",
};

const ticketPage = "ui/chuggy-ui/app/browser/TicketActions.tsx";
const accountsPage = "ui/chuggy-ui/app/browser/settings/TenantAccountsPage.tsx";
const connectButton = "ui/chuggy-ui/app/browser/repositories/ConnectGithub.tsx";

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

test("a ticket's page draws each action it offers as a button under the action's own name, and has a line of its own for a project with no runner", () => {
  const source = readFileSync(ticketPage, "utf8");
  assert.match(
    source,
    /<OfferedAction\s+key=\{action\.action\}\s+action=\{action\.action\}/u,
  );
  assert.match(source, /props\.noRunner \? <NoRunnerLine /u);
});

test("the workspace's accounts page, where the program sends a person whose account lacks the portal app, draws the connect button", () => {
  assert.equal(drawnIn.connect, connectButton);
  const source = readFileSync(accountsPage, "utf8");
  assert.match(
    source,
    /^import \{ ConnectGithub \} from "\.\.\/repositories\/ConnectGithub\.tsx";$/mu,
  );
  assert.match(source, /<ConnectGithub tenant=\{tenant\} /u);
});

test("the Add picker draws, under its list, the line and the link the program sends a person to for an app not granted her repository: the portal app's always, the worker app's where a row lacks it", () => {
  assert.deepEqual(repositoryGrantLines, {
    portal: { status: "Not listed · grant it on GitHub", label: "Portal app" },
    worker: {
      status: "Worker app missing · grant it on GitHub",
      label: "Worker app",
    },
  });
  const source = readFileSync(drawnIn.add, "utf8");
  assert.match(source, /const line = repositoryGrantLines\[props\.app\];/u);
  assert.match(source, /<Notice[^>]*\bdetail=\{line\.status\}/u);
  assert.match(source, /<InstallLink[^>]*\blabel=\{line\.label\}/u);
  assert.match(
    source,
    /state\.state === "Ready" \? \(\s*<RepositoryGrant tenant=\{partition\.tenant\} app="portal" \/>/u,
  );
  assert.match(
    source,
    /state\.state === "Ready" \? \(\s*<RepositoryWorkerGrant\s+tenant=\{partition\.tenant\}\s+workerless=\{state\.value\.workerless\}/u,
  );
  assert.match(
    source,
    /switch \(repositoryWorkerLine\(props\.workerless, props\.chosen\)\) \{[\s\S]*?case "Missing":\s*return <RepositoryGrant tenant=\{props\.tenant\} app="worker" \/>;/u,
  );
  assert.equal(repositoryWorkerLine(["acme-org/widgets"], false), "Missing");
  assert.equal(repositoryWorkerLine([], false), undefined);
  assert.match(
    source,
    /worker === undefined \? undefined : repositoriesWorkerless\(portal, worker\),/u,
  );
});

test("a name is found only where a page draws all of it and no more", () => {
  const source = '<Button aria-label="Add runner">\n  Add runner\n</Button>';
  assert.ok(draws(source, "Add runner"));
  assert.ok(!draws(source, "Add"));
  assert.ok(!draws(source, "runner"));
  assert.ok(draws("<h1>New project</h1>", "New project"));
  assert.ok(!draws("// the New project page", "New project"));
});
