/**
 * Making a workspace link from the site's workspaces page: the New workspace
 * dialog gains the choice only where the site keeps links, a link's form
 * names no workspace and no person, a refusal is the dialog's one line, and a
 * link made is the whole body until it is put away, after which nothing holds
 * its token.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessInviteLinkLimitReachedCode,
  accessNotPermittedCode,
  accessWorkspaceLinkNoteCharsMax,
  type AccessInviteLinkMinted,
} from "../../../../src/contract/accessPlane.ts";
import {
  answer,
  heldAnswer,
  press,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import { styleless } from "../styleless.ts";
import {
  dialogActions,
  dialogFields,
  inviteModeChosen,
  inviteModesDrawn,
  pressedOutside,
  tokenHeldOutside,
} from "./inviteDialogDrawn.ts";
import { permissionsTenant } from "./permissionsFixture.tsx";
import {
  creationsSent,
  drawWorkspaces,
  siteWorkspaceLinksPath,
  workspaceLinksListed,
  workspaceLinksReads,
  workspaceListReads,
  workspacesAbilitiesCreator,
} from "./siteWorkspacesFixture.tsx";
import type { WorkspacesDrawing } from "./siteWorkspacesFixture.tsx";
import { boxStill, refused } from "./tenantPeopleFixture.tsx";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
  useNavigate: () => (to: unknown) => Promise.resolve(to),
  useParams: () => ({ tenant: permissionsTenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const opener = "New workspace";

const person = ["Name", "GitHub username", "Email"];

const minted: AccessInviteLinkMinted = {
  link: "w-new",
  token: "t0ken-made_2",
  expiresAtMs: Date.UTC(2026, 7, 27, 9, 0),
  newAccounts: true,
};

const address = `${location.origin}/invite#${minted.token}`;

const kept: WorkspacesDrawing = { links: () => answer({ links: [] }) };

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: opener });
}

function note(): HTMLInputElement {
  return within(dialog()).getByRole<HTMLInputElement>("textbox", {
    name: "Note",
  });
}

function box(): HTMLElement {
  return within(dialog()).getByRole("checkbox", {
    name: "Can invite new people",
  });
}

function createLink(): HTMLButtonElement {
  return within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: /^Creat/u,
  });
}

/** What a link's form holds as a case reads it: its note, and whether its box is checked. */
function linkDrawn(): readonly (string | boolean)[] {
  return [note().value, box().getAttribute("aria-checked") === "true"];
}

async function noted(value: string): Promise<void> {
  fireEvent.change(note(), { target: { value } });
  await turned();
}

/** The dialog opened on a site that keeps links, and `Link` chosen. */
async function linking(drawing: WorkspacesDrawing = {}): Promise<DrawnStrict> {
  const drawn = await drawWorkspaces({
    ...kept,
    linked: () => answer(minted, 201),
    ...drawing,
  });
  await press(opener);
  await inviteModeChosen(dialog(), "Link");
  return drawn;
}

async function made(drawing: WorkspacesDrawing = {}): Promise<DrawnStrict> {
  const drawn = await linking(drawing);
  await press("Create link");
  return drawn;
}

test("where the site keeps links the dialog opens on Person, its form as it was, with Link beside it", async () => {
  await drawWorkspaces(kept);
  await press(opener);
  expect(inviteModesDrawn(dialog())).toStrictEqual(["Person+", "Link"]);
  expect(dialogFields(dialog())).toStrictEqual(person);
  expect(dialogActions(dialog())).toStrictEqual(["Cancel", "Create"]);
  styleless();
});

test("a link's form names no workspace and no person: the box, a note that may be left empty, and Cancel then Create link", async () => {
  await linking();
  expect(inviteModesDrawn(dialog())).toStrictEqual(["Person", "Link+"]);
  expect(dialogFields(dialog())).toStrictEqual(["Note"]);
  expect(within(dialog()).queryByRole("group", { name: "Owner" })).toBeNull();
  expect(linkDrawn()).toStrictEqual(["", true]);
  expect(dialogActions(dialog())).toStrictEqual(["Cancel", "Create link"]);
  expect(createLink().disabled).toBe(false);
  styleless();
});

test("the box is a link's as it is a person's: what one form held the other holds, and a reader who does not manage the site's permissions is not offered it", async () => {
  await drawWorkspaces(kept);
  await press(opener);
  fireEvent.click(box());
  await inviteModeChosen(dialog(), "Link");
  expect(linkDrawn()).toStrictEqual(["", false]);
  expect(boxStill(box())).toBe(false);
  cleanup();
  await linking({ abilities: () => answer(workspacesAbilitiesCreator) });
  expect(linkDrawn()).toStrictEqual(["", false]);
  expect(boxStill(box())).toBe(true);
});

test("Create link sends the box alone where no note was typed, to the site's route", async () => {
  const drawn = await made();
  expect(creationsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: siteWorkspaceLinksPath,
      body: { createAccounts: true },
    },
  ]);
});

test("a note is sent as typed beside the box, and nothing typed for a person with it", async () => {
  const drawn = await drawWorkspaces({
    ...kept,
    linked: () => answer(minted, 201),
  });
  await press(opener);
  fireEvent.change(within(dialog()).getByRole("textbox", { name: "Name" }), {
    target: { value: "northwind" },
  });
  await inviteModeChosen(dialog(), "Link");
  fireEvent.click(box());
  await noted("For the Lisbon team");
  await press("Create link");
  expect(creationsSent(drawn).map((request) => request.body)).toStrictEqual([
    { createAccounts: false, note: "For the Lisbon team" },
  ]);
});

test("a reader who does not manage the site's permissions sends the box unchecked", async () => {
  const drawn = await made({
    abilities: () => answer(workspacesAbilitiesCreator),
  });
  expect(creationsSent(drawn).map((request) => request.body)).toStrictEqual([
    { createAccounts: false },
  ]);
});

test("a note past its bound says so under it and holds Create link, and one at the bound does neither", async () => {
  await linking();
  await noted("n".repeat(accessWorkspaceLinkNoteCharsMax));
  expect(within(dialog()).queryByText("Too long")).toBeNull();
  expect(createLink().disabled).toBe(false);
  await noted("n".repeat(accessWorkspaceLinkNoteCharsMax + 1));
  expect(within(dialog()).getByText("Too long")).toBeTruthy();
  expect(note().getAttribute("aria-invalid")).toBe("true");
  expect(createLink().disabled).toBe(true);
});

test("a site at its limit of open links says so in the dialog's one line, everything chosen still there", async () => {
  await linking({
    linked: () => refused(409, accessInviteLinkLimitReachedCode),
  });
  fireEvent.click(box());
  await noted("For the Lisbon team");
  await press("Create link");
  expect(within(dialog()).getByRole("status").textContent).toBe(
    "Link limit reached",
  );
  expect(inviteModesDrawn(dialog())).toStrictEqual(["Person", "Link+"]);
  expect(linkDrawn()).toStrictEqual(["For the Lisbon team", false]);
  expect(dialogActions(dialog())).toStrictEqual(["Cancel", "Create link"]);
  await inviteModeChosen(dialog(), "Person");
  expect(within(dialog()).queryByRole("status")).toBeNull();
});

test("a refusal's line stands until the note is changed", async () => {
  await linking({ linked: () => refused(403, accessNotPermittedCode) });
  await press("Create link");
  expect(within(dialog()).getByRole("status").textContent).toBe(
    "Not permitted",
  );
  await noted("again");
  expect(within(dialog()).queryByRole("status")).toBeNull();
});

test("a link made is the dialog's whole body: its address in a field no typing changes, the control that copies it, Shown once, and Done", async () => {
  const copied: string[] = [];
  await made({ copied });
  const field = within(dialog()).getByRole<HTMLInputElement>("textbox", {
    name: "Invite link",
  });
  expect(field.value).toBe(address);
  expect(field.readOnly).toBe(true);
  expect(dialogFields(dialog())).toStrictEqual(["Invite link"]);
  expect(inviteModesDrawn(dialog())).toStrictEqual([]);
  expect(within(dialog()).queryAllByRole("checkbox")).toStrictEqual([]);
  expect(within(dialog()).getByText("Shown once")).toBeTruthy();
  expect(within(dialog()).queryByText("Existing accounts only")).toBeNull();
  expect(dialogActions(dialog()).filter((words) => words !== "")).toStrictEqual(
    ["Done"],
  );
  await press("Copy link");
  expect(copied).toStrictEqual([address]);
  styleless();
});

test("a workspace link that admits no new account says Existing accounts only under its address", async () => {
  await made({ linked: () => answer({ ...minted, newAccounts: false }, 201) });
  expect(within(dialog()).getByText("Shown once")).toBeTruthy();
  expect(within(dialog()).getByText("Existing accounts only")).toBeTruthy();
});

test("a press outside leaves a made workspace link where it is, and Escape puts it away", async () => {
  await made();
  await turned(pressedOutside);
  await turned();
  expect(dialogFields(dialog())).toStrictEqual(["Invite link"]);
  await turned(() => {
    fireEvent.keyDown(dialog(), { key: "Escape" });
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a press outside closes the dialog while it holds a link's form and no link", async () => {
  await linking();
  await turned(pressedOutside);
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a made workspace link is gone once the dialog is closed, and opened again the dialog holds a person's form and no link", async () => {
  const drawn = await made();
  await press("Done");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(tokenHeldOutside(minted.token, drawn.sent)).toStrictEqual([]);
  await press(opener);
  expect(inviteModesDrawn(dialog())).toStrictEqual(["Person+", "Link"]);
  expect(dialogFields(dialog())).toStrictEqual(person);
  expect(dialogActions(dialog())).toStrictEqual(["Cancel", "Create"]);
});

test("a note typed is gone when the dialog is opened again", async () => {
  await linking();
  await noted("For the Lisbon team");
  await press("Cancel");
  await press(opener);
  await inviteModeChosen(dialog(), "Link");
  expect(linkDrawn()).toStrictEqual(["", true]);
});

test("a link made reads the site's links again, and the workspaces not at all", async () => {
  const drawn = await linking();
  const before = {
    links: workspaceLinksReads(drawn),
    workspaces: workspaceListReads(drawn),
  };
  await press("Create link");
  expect(workspaceLinksReads(drawn)).toBe(before.links + 1);
  expect(workspaceListReads(drawn)).toBe(before.workspaces);
});

test("a workspace link unanswered, nothing closes the dialog, its form takes nothing and the choice takes no press", async () => {
  const held = heldAnswer();
  await linking({ linked: () => held.answered });
  await turned(() => {
    fireEvent.click(createLink());
  });
  expect(dialogActions(dialog())).toStrictEqual(["Cancel", "Creating…"]);
  expect(note().disabled).toBe(true);
  expect(boxStill(box())).toBe(true);
  await inviteModeChosen(dialog(), "Person");
  expect(inviteModesDrawn(dialog())).toStrictEqual(["Person", "Link+"]);
  await turned(pressedOutside);
  await turned(() => {
    held.release(answer(minted, 201));
  });
  await settled();
  expect(dialogFields(dialog())).toStrictEqual(["Invite link"]);
});

test.each([
  ["keeps no links", { links: () => answer({}, 404) }],
  ["has not answered", { links: () => heldAnswer().answered }],
  ["failed to answer", { links: () => answer({}, 500) }],
] satisfies readonly (readonly [string, WorkspacesDrawing])[])(
  "a site whose links read %s draws the dialog as it was, and no links",
  async (_named, drawing) => {
    await drawWorkspaces(drawing);
    expect(screen.queryByText("Invite links")).toBeNull();
    await press(opener);
    expect(inviteModesDrawn(dialog())).toStrictEqual([]);
    expect(dialogFields(dialog())).toStrictEqual(person);
    expect(dialogActions(dialog())).toStrictEqual(["Cancel", "Create"]);
  },
);

test("a site with links draws the choice", async () => {
  await drawWorkspaces({ links: () => answer(workspaceLinksListed) });
  await press(opener);
  expect(inviteModesDrawn(dialog())).toStrictEqual(["Person+", "Link"]);
});
