/**
 * The names the setup program tells a person to press, held against the
 * console pages that draw them.
 *
 * The program sends her to a page and names what to press there, and the
 * pages write those names in their own markup, where the program's code
 * cannot reach them. Each page's source is read here for the name the
 * program says, so a page that renames a button fails this and not her.
 *
 * Some names are not written where they are drawn. A page that draws a name
 * from the copy catalog is read for the message's id, and the catalog for the
 * words. A ticket's page draws
 * each action under its label, so the page is read for drawing the label and
 * the label is held to the word the program says.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { copyTextEn } from "../../ui/chuggy-ui/app/copy/catalog.ts";
import { ticketActionLabel } from "../../ui/chuggy-ui/app/core/codeLabels.ts";
import type { CopyId } from "../../ui/chuggy-ui/app/core/copy.ts";
import { setupPressed } from "../../ui/chuggy-ui/app/core/setupNext.ts";

type SetupPressed = keyof typeof setupPressed;

/** The names a page draws from the catalog. */
type SetupPressedCatalogued = "ticket" | "runner" | "fallback";

const myRunnerPage = "ui/chuggy-ui/app/browser/settings/MyRunnerPage.tsx";

/** The page that draws each name the catalog does not, by its path from the
 * root of this tree. */
const drawnIn: Readonly<
  Record<Exclude<SetupPressed, SetupPressedCatalogued>, string>
> = {
  dispatch: "ui/chuggy-ui/app/core/ticketActions.ts",
};

/** The page that draws each name the catalog holds, and the message it draws
 * the name as. */
const drawnFromCatalog: Readonly<
  Record<SetupPressedCatalogued, { readonly page: string; readonly id: CopyId }>
> = {
  ticket: {
    page: "ui/chuggy-ui/app/browser/TicketCreation.tsx",
    id: "ticket-authoring-create-ticket",
  },
  runner: { page: myRunnerPage, id: "runners-register" },
  fallback: {
    page: "ui/chuggy-ui/app/browser/settings/OwnerFallbackSection.tsx",
    id: "runners-fallback-title",
  },
};

const ticketPage = "ui/chuggy-ui/app/browser/TicketActions.tsx";

/** Whether a page's source draws `name` as the whole of a text or of a label, and not as part of a longer one. */
function draws(source: string, name: string): boolean {
  assert.match(name, /^[A-Za-z]+(?: [A-Za-z]+)*$/u);
  return new RegExp(`(?:^\\s*|[>"])${name}(?:\\s*$|[<"])`, "mu").test(source);
}

for (const [key, page] of Object.entries(drawnIn))
  test(`the page ${page} draws what the program says is pressed there (${key})`, () => {
    const name = copyTextEn(setupPressed[key as SetupPressed]);
    const source = readFileSync(page, "utf8");
    assert.ok(draws(source, name), `${page} draws no "${name}"`);
  });

for (const [key, drawn] of Object.entries(drawnFromCatalog))
  test(`the page ${drawn.page} draws, from the catalog, what the program says is pressed there (${key})`, () => {
    const source = readFileSync(drawn.page, "utf8");
    assert.ok(
      source.includes(`{ id: "${drawn.id}" }`),
      `${drawn.page} draws no ${drawn.id}`,
    );
    assert.deepEqual(setupPressed[key as SetupPressed], { id: drawn.id });
  });

test("a ticket's page draws each action it offers as a button under the action's label, Dispatch's being the program's word, and has a line of its own for a project with no runner", () => {
  const source = readFileSync(ticketPage, "utf8");
  assert.match(
    source,
    /<OfferedAction\s+key=\{nativeActionAnswerKey\(action\)\}\s+action=\{text\(ticketActionLabel\(action\.action\)\)\}/u,
  );
  assert.equal(
    copyTextEn(ticketActionLabel("Dispatch")),
    copyTextEn(setupPressed.dispatch),
  );
  assert.match(source, /props\.noRunner \? <NoRunnerLine /u);
});

test("a name is found only where a page draws all of it and no more", () => {
  const source = '<Button aria-label="Add runner">\n  Add runner\n</Button>';
  assert.ok(draws(source, "Add runner"));
  assert.ok(!draws(source, "Add"));
  assert.ok(!draws(source, "runner"));
  assert.ok(draws("<h1>New project</h1>", "New project"));
  assert.ok(!draws("// the New project page", "New project"));
});
