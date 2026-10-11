/**
 * Making an invite link from the workspace's people page: the Invite dialog
 * gains the choice only where the workspace keeps links, a link's form names
 * no person, a refusal is the dialog's one line, and a link made is the whole
 * body until it is put away, after which nothing holds its token.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessInviteLinkLimitReachedCode,
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
import {
  boxesIn,
  changesSent,
  drawPeople,
  linksListed,
  linksPath,
  linksReads,
  peopleTenant,
  projectsOffered,
  refused,
} from "./tenantPeopleFixture.tsx";
import type { PeopleDrawing } from "./tenantPeopleFixture.tsx";

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
  useParams: () => ({ tenant: peopleTenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const minted: AccessInviteLinkMinted = {
  link: "l-new",
  token: "t0ken-made_1",
  expiresAtMs: Date.UTC(2026, 7, 27, 9, 0),
  newAccounts: true,
};

const address = `${location.origin}/invite#${minted.token}`;

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: `Invite to ${peopleTenant}` });
}

function modes(): readonly string[] {
  return inviteModesDrawn(dialog());
}

function fields(): readonly (string | null)[] {
  return dialogFields(dialog());
}

function actions(): readonly (string | null)[] {
  return dialogActions(dialog());
}

function chose(mode: string): Promise<void> {
  return inviteModeChosen(dialog(), mode);
}

/** The dialog opened on a workspace that keeps links, and `Link` chosen. */
async function linking(drawing: PeopleDrawing = {}): Promise<DrawnStrict> {
  const drawn = await drawPeople({
    links: () => answer({ links: [] }),
    changed: () => answer(minted, 201),
    ...drawing,
  });
  await press("Invite");
  await chose("Link");
  return drawn;
}

async function made(drawing: PeopleDrawing = {}): Promise<DrawnStrict> {
  const drawn = await linking(drawing);
  await press("Create link");
  return drawn;
}

test("where the workspace keeps links the dialog opens on Person, its form as it was, with Link beside it", async () => {
  await drawPeople({ links: () => answer({ links: [] }) });
  await press("Invite");
  expect(modes()).toStrictEqual(["Person+", "Link"]);
  expect(fields()).toStrictEqual(["Email", "GitHub username"]);
  expect(actions()).toStrictEqual(["Cancel", "Invite"]);
  styleless();
});

test("a link's form names no person, and offers the roles and projects a person's does", async () => {
  await drawPeople({ links: () => answer({ links: [] }) });
  await press("Invite");
  const offered = {
    roles: within(dialog())
      .getAllByRole("radio")
      .map((radio) => radio.textContent),
    projects: projectsOffered(dialog()),
    boxes: boxesIn(dialog(), "beacon"),
  };
  await chose("Link");
  expect(modes()).toStrictEqual(["Person", "Link+"]);
  expect(fields()).toStrictEqual([]);
  expect({
    roles: within(dialog())
      .getAllByRole("radio")
      .map((radio) => radio.textContent),
    projects: projectsOffered(dialog()),
    boxes: boxesIn(dialog(), "beacon"),
  }).toStrictEqual(offered);
  expect(actions()).toStrictEqual(["Cancel", "Create link"]);
  styleless();
});

test("Create link sends what the link grants and nothing of a person", async () => {
  const drawn = await drawPeople({
    links: () => answer({ links: [] }),
    changed: () => answer(minted, 201),
  });
  await press("Invite");
  fireEvent.change(within(dialog()).getByRole("textbox", { name: "Email" }), {
    target: { value: "ada@example.com" },
  });
  await chose("Link");
  fireEvent.click(within(dialog()).getByRole("radio", { name: "Admin" }));
  fireEvent.click(
    within(dialog()).getByRole("checkbox", { name: "beacon Viewer" }),
  );
  await press("Create link");
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: linksPath,
      body: {
        role: "Admin",
        projects: [{ project: "beacon", roles: ["Viewer"] }],
      },
    },
  ]);
});

test("a workspace at its limit of open links says so in the dialog's one line, everything chosen still there", async () => {
  await linking({
    changed: () => refused(409, accessInviteLinkLimitReachedCode),
  });
  fireEvent.click(
    within(dialog()).getByRole("checkbox", { name: "beacon Viewer" }),
  );
  await press("Create link");
  expect(within(dialog()).getByText("Link limit reached")).toBeTruthy();
  expect(modes()).toStrictEqual(["Person", "Link+"]);
  expect(boxesIn(dialog(), "beacon")).toContain("beacon Viewer+");
  expect(actions()).toStrictEqual(["Cancel", "Create link"]);
  await chose("Person");
  expect(within(dialog()).queryByText("Link limit reached")).toBeNull();
});

test("a link made is the dialog's whole body: its address in a field no typing changes, Shown once, and Done", async () => {
  await made();
  const field = within(dialog()).getByRole<HTMLInputElement>("textbox", {
    name: "Invite link",
  });
  expect(field.value).toBe(address);
  expect(field.readOnly).toBe(true);
  expect(fields()).toStrictEqual(["Invite link"]);
  expect(modes()).toStrictEqual([]);
  expect(within(dialog()).queryAllByRole("checkbox")).toStrictEqual([]);
  expect(within(dialog()).getByText("Shown once")).toBeTruthy();
  expect(within(dialog()).queryByText("Existing accounts only")).toBeNull();
  expect(actions()).toStrictEqual(["Done"]);
  styleless();
});

test("a link that admits no new account says Existing accounts only under its address", async () => {
  await made({
    changed: () => answer({ ...minted, newAccounts: false }, 201),
  });
  expect(within(dialog()).getByText("Shown once")).toBeTruthy();
  expect(within(dialog()).getByText("Existing accounts only")).toBeTruthy();
});

test("a press outside leaves a made link where it is, and Escape puts it away", async () => {
  await made();
  await turned(pressedOutside);
  await turned();
  expect(
    within(dialog()).getByRole<HTMLInputElement>("textbox", {
      name: "Invite link",
    }).value,
  ).toBe(address);
  await turned(() => {
    fireEvent.keyDown(dialog(), { key: "Escape" });
  });
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a press outside closes the dialog while it holds a form and no link", async () => {
  await linking();
  await turned(pressedOutside);
  await turned();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("a made link is gone once the dialog is closed and opened again, and nothing else holds its token", async () => {
  const drawn = await made();
  await press("Done");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(tokenHeldOutside(minted.token, drawn.sent)).toStrictEqual([]);
  await press("Invite");
  expect(modes()).toStrictEqual(["Person+", "Link"]);
  expect(fields()).toStrictEqual(["Email", "GitHub username"]);
  expect(dialog().textContent).not.toContain(minted.token);
});

test("a link made reads the workspace's links again, and the people not at all", async () => {
  const drawn = await linking();
  const before = { links: linksReads(drawn), sent: drawn.sent.length };
  await press("Create link");
  expect(linksReads(drawn)).toBe(before.links + 1);
  expect(drawn.sent.length).toBe(before.sent + 2);
});

test("a link unanswered, nothing closes the dialog and the choice takes no press", async () => {
  const held = heldAnswer();
  await linking({ changed: () => held.answered });
  await turned(() => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Create link" }),
    );
  });
  expect(actions()).toStrictEqual(["Cancel", "Creating…"]);
  await chose("Person");
  expect(modes()).toStrictEqual(["Person", "Link+"]);
  await turned(pressedOutside);
  await turned(() => {
    held.release(answer(minted, 201));
  });
  await settled();
  expect(fields()).toStrictEqual(["Invite link"]);
});

test.each([
  ["keeps no links", { links: () => answer({}, 404) }],
  ["has not answered", { links: () => heldAnswer().answered }],
  ["failed to answer", { links: () => answer({}, 500) }],
] satisfies readonly (readonly [string, PeopleDrawing])[])(
  "a workspace whose links read %s draws the dialog as it was, and no links",
  async (_named, drawing) => {
    await drawPeople(drawing);
    expect(screen.queryByRole("table", { name: "Invite links" })).toBeNull();
    expect(screen.queryByText("Invite links")).toBeNull();
    await press("Invite");
    expect(modes()).toStrictEqual([]);
    expect(fields()).toStrictEqual(["Email", "GitHub username"]);
    expect(actions()).toStrictEqual(["Cancel", "Invite"]);
  },
);

test("a workspace that keeps links and has none draws the choice and no section", async () => {
  await drawPeople({ links: () => answer({ links: [] }) });
  expect(screen.queryByText("Invite links")).toBeNull();
  await press("Invite");
  expect(modes()).toStrictEqual(["Person+", "Link"]);
});

test("a workspace with links draws them and the choice", async () => {
  await drawPeople({ links: () => answer(linksListed) });
  expect(screen.getByRole("table", { name: "Invite links" })).toBeTruthy();
  await press("Invite");
  expect(modes()).toStrictEqual(["Person+", "Link"]);
});
