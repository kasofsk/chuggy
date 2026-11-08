/**
 * The names the setup program tells a person to press, and the section it
 * names beside one, held against the console pages that draw them.
 *
 * The program sends her to a page and names what to press there, and the
 * pages write those names in their own markup, where the program's code
 * cannot reach them. Each page's source is read here for the name the
 * program says, so a page that renames a button fails this and not her.
 *
 * Some names are not written where they are drawn. A page that draws a name
 * from the copy catalog is read for the message's id, and the catalog for the
 * words. A ticket's page draws
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
import { copyTextEn } from "../../ui/chuggy-ui/app/copy/catalog.ts";
import type { Copy, CopyId } from "../../ui/chuggy-ui/app/core/copy.ts";
import { invitePageWords } from "../../ui/chuggy-ui/app/core/invitePage.ts";
import { selectorSettingsSection } from "../../ui/chuggy-ui/app/core/selectorSettingsForm.ts";
import {
  setupPressed,
  setupSeen,
} from "../../ui/chuggy-ui/app/core/setupNext.ts";

type SetupPressed = keyof typeof setupPressed;

/** The names a page draws from the catalog. */
type SetupPressedCatalogued = "edit" | "save" | "projectPage" | "projectCreate";

/** The names the invite page draws from the catalog, as its card's words. */
type SetupPressedInvite = "workspaceCreate";

const settingsSection = "ui/chuggy-ui/app/browser/ui/SettingsSection.tsx";
const projectCreationPage = "ui/chuggy-ui/app/browser/ProjectCreation.tsx";
const invitePage = "ui/chuggy-ui/app/browser/InvitePage.tsx";

/** The page that draws each name the catalog does not, by its path from the
 * root of this tree. */
const drawnIn: Readonly<
  Record<
    Exclude<SetupPressed, SetupPressedCatalogued | SetupPressedInvite>,
    string
  >
> = {
  connect: "ui/chuggy-ui/app/browser/repositories/ConnectGithub.tsx",
  add: "ui/chuggy-ui/app/browser/repositories/AddRepository.tsx",
  retry: "ui/chuggy-ui/app/browser/repositories/BindingConfigurations.tsx",
  runner: "ui/chuggy-ui/app/browser/RunnersPage.tsx",
  chatHost: "ui/chuggy-ui/app/browser/settings/MyChatHost.tsx",
  ticket: "ui/chuggy-ui/app/browser/TicketCreation.tsx",
  dispatch: "ui/chuggy-ui/app/core/ticketActions.ts",
};

/** The page that draws each name the catalog holds, and the message it draws
 * the name as. */
const drawnFromCatalog: Readonly<
  Record<SetupPressedCatalogued, { readonly page: string; readonly id: CopyId }>
> = {
  edit: { page: settingsSection, id: "ui-edit" },
  save: { page: settingsSection, id: "ui-save" },
  projectPage: { page: projectCreationPage, id: "project-creation-new-title" },
  projectCreate: { page: projectCreationPage, id: "project-creation-submit" },
};

const leadTextSection =
  "ui/chuggy-ui/app/browser/settings/lead/SelectorTextSection.tsx";
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
    const name = setupPressed[key as SetupPressed];
    const source = readFileSync(page, "utf8");
    assert.ok(draws(source, name), `${page} draws no "${name}"`);
  });

for (const [key, drawn] of Object.entries(drawnFromCatalog))
  test(`the page ${drawn.page} draws, from the catalog, what the program says is pressed there (${key})`, () => {
    const name = setupPressed[key as SetupPressed];
    const source = readFileSync(drawn.page, "utf8");
    assert.ok(
      source.includes(`{ id: "${drawn.id}" }`),
      `${drawn.page} draws no ${drawn.id}`,
    );
    assert.equal(copyTextEn({ id: drawn.id } as Copy), name);
  });

test("the lead's settings page draws, from the catalog, the section the program says Edit is pressed beside", () => {
  const source = readFileSync(leadTextSection, "utf8");
  assert.match(source, /const title = text\(section\.title\);/u);
  assert.equal(
    copyTextEn(selectorSettingsSection("northStar").title),
    setupSeen.northStar,
  );
});

test("the invite page draws, from the catalog, the card the program says a workspace is named under and what is pressed there", () => {
  const source = readFileSync(invitePage, "utf8");
  assert.match(source, /invitePageWords\.naming\b/u);
  assert.match(source, /\{text\(invitePageWords\.create\)\}/u);
  assert.equal(copyTextEn(invitePageWords.naming), setupSeen.workspaceNaming);
  assert.equal(
    copyTextEn(invitePageWords.create),
    setupPressed.workspaceCreate,
  );
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
