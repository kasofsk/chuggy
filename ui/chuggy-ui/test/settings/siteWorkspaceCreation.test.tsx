/**
 * Making a workspace from the site's workspaces page: a dialog at a form's
 * width, the fields sent as the contract states them, a field's fault under
 * it before anything is sent, each refusal's line in the foot with the dialog
 * left as it was, nothing closing it while its request is unanswered, and a
 * creation closing it, reading the list again and leaving its line over the
 * table until the dialog is opened again.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessInvitationCodes,
  accessNotPermittedCode,
  accessTenantTakenCode,
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
import { permissionsTenant } from "./permissionsFixture.tsx";
import {
  creationsSent,
  drawWorkspaces,
  siteWorkspacesPath,
  workspaceCreated,
  workspaceListReads,
  workspacesAbilitiesCreator,
  workspacesDrawn,
  workspacesListed,
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

const createdLine = "northwind created · octocat signs in with GitHub";

const owner = {
  Name: "northwind",
  "GitHub username": "octocat",
  Email: "owner@example.com",
};

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: opener });
}

function field(label: string): HTMLInputElement {
  return within(dialog()).getByRole<HTMLInputElement>("textbox", {
    name: label,
  });
}

function checkbox(): HTMLButtonElement {
  return within(dialog()).getByRole<HTMLButtonElement>("checkbox", {
    name: "Can invite new people",
  });
}

function action(name: RegExp): HTMLButtonElement {
  return within(dialog()).getByRole<HTMLButtonElement>("button", { name });
}

function create(): HTMLButtonElement {
  return action(/^Creat/u);
}

/** What the dialog's foot draws: a refusal's line, then its actions. */
function foot(): Element | null {
  return dialog().lastElementChild;
}

/** The line a refusal left, which stands nowhere but in the foot. */
function refusal(): HTMLElement | null {
  const said = within(dialog()).queryByRole("status");
  if (said !== null && foot()?.contains(said) !== true)
    throw new Error("a refusal's line is drawn outside the foot");
  return said;
}

/** What the three fields hold and whether the box is checked, as a case reads a form. */
function formDrawn(): readonly (string | boolean)[] {
  return [
    ...Object.keys(owner).map((label) => field(label).value),
    checkbox().getAttribute("aria-checked") === "true",
  ];
}

async function typed(fields: Readonly<Record<string, string>>): Promise<void> {
  for (const [label, value] of Object.entries(fields))
    fireEvent.change(field(label), { target: { value } });
  await turned();
}

async function opened(drawing: WorkspacesDrawing = {}): Promise<DrawnStrict> {
  const drawn = await drawWorkspaces(drawing);
  await press(opener);
  return drawn;
}

async function filled(drawing: WorkspacesDrawing = {}): Promise<DrawnStrict> {
  const drawn = await opened(drawing);
  await typed(owner);
  return drawn;
}

/** A press outside the dialog, which Radix counts at the click the press ends in. */
function pressedOutside(): void {
  fireEvent.pointerDown(document.body);
  fireEvent.click(document.body);
}

test("New workspace opens a dialog of that name at a form's width: the name, the owner's fields under their word, the box, and Cancel then Create", async () => {
  await opened();
  expect(dialog().classList.contains("max-w-measure")).toBe(true);
  expect(
    within(dialog())
      .getAllByRole("textbox")
      .map((input) => input.getAttribute("aria-label")),
  ).toStrictEqual(Object.keys(owner));
  const owned = within(dialog()).getByRole("group", { name: "Owner" });
  expect(
    within(owned)
      .getAllByRole("textbox")
      .map((input) => input.getAttribute("aria-label")),
  ).toStrictEqual(["GitHub username", "Email"]);
  expect(owned.contains(checkbox())).toBe(true);
  expect(formDrawn()).toStrictEqual(["", "", "", true]);
  expect(
    within(dialog())
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toStrictEqual(["Cancel", "Create"]);
  expect(create().disabled).toBe(true);
  expect(refusal()).toBeNull();
  styleless();
});

test("Create sends the four fields the contract states, as typed, to the site's route", async () => {
  const drawn = await filled();
  expect(create().disabled).toBe(false);
  await press("Create");
  expect(creationsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: siteWorkspacesPath,
      body: {
        tenant: "northwind",
        github: "octocat",
        email: "owner@example.com",
        createAccounts: true,
      },
    },
  ]);
});

test("Cancel closes the dialog with nothing sent and nothing said", async () => {
  const drawn = await filled();
  await press("Cancel");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(creationsSent(drawn)).toStrictEqual([]);
  expect(screen.queryByRole("status")).toBeNull();
});

/** A plane whose list answers `after` once a creation has been sent, however
 * often the page read it before. */
function listedAfterCreation(
  after: () => Response,
  status = 201,
): WorkspacesDrawing {
  let made = false;
  return {
    listing: () => (made ? after() : answer(workspacesListed)),
    sent: () => {
      made = true;
      return workspaceCreated(status);
    },
  };
}

test.each([[201], [200]])(
  "a %i creation closes the dialog, reads the list again, and says who signs in over the table in the passing tone",
  async (status) => {
    const grown = [
      ...workspacesListed.tenants,
      { ...workspacesListed.tenants[3], tenant: "northwind" },
    ];
    const drawn = await filled(
      listedAfterCreation(
        () => answer({ ...workspacesListed, tenants: grown }),
        status,
      ),
    );
    expect(screen.getByRole("heading", { name: "4 workspaces" })).toBeTruthy();
    const read = workspaceListReads(drawn);
    await press("Create");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(workspaceListReads(drawn)).toBe(read + 1);
    expect(workspacesDrawn().map(([name]) => name)).toContain("northwind");
    expect(screen.getByRole("heading", { name: "5 workspaces" })).toBeTruthy();
    const said = screen.getByRole("status");
    expect(said.textContent).toBe(createdLine);
    expect(said.classList.contains("notice-pass")).toBe(true);
    expect(
      said.compareDocumentPosition(screen.getByRole("table")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
);

test("a creation's line stands until the dialog is opened again, which starts as it first did", async () => {
  const drawn = await filled();
  fireEvent.click(checkbox());
  await turned();
  expect(formDrawn()).toStrictEqual([...Object.values(owner), false]);
  await press("Create");
  drawn.redraw();
  expect(screen.getByRole("status").textContent).toBe(createdLine);
  await press(opener);
  expect(screen.queryByRole("status")).toBeNull();
  expect(formDrawn()).toStrictEqual(["", "", "", true]);
  expect(create().disabled).toBe(true);
});

test("a creation whose reread fails still leaves its line, over the read's own", async () => {
  await filled(listedAfterCreation(() => answer({}, 500)));
  expect(screen.getByRole("table")).toBeTruthy();
  await press("Create");
  expect(screen.getByRole("status").textContent).toBe(createdLine);
  expect(
    screen.getByText("Failed to load · the API failed with InternalError"),
  ).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
});

const refusals = [
  [409, accessTenantTakenCode, "Name taken"],
  [403, accessNotPermittedCode, "Not permitted"],
  [
    403,
    accessInvitationCodes.AccountNotPermitted,
    "Account creation not permitted",
  ],
  [422, accessInvitationCodes.GithubAccountUnknown, "No such GitHub user"],
  [
    409,
    accessInvitationCodes.EmailHeld,
    "Email held by another account · use another address",
  ],
  [503, accessInvitationCodes.GithubUnavailable, "GitHub unavailable"],
  [404, "NotFound", "Not available"],
  [500, "InternalError", "Failed"],
] as const;

test.each(refusals)(
  "a %i %s draws its own line in the foot, in the refusing tone, and leaves the dialog as typed",
  async (status, code, line) => {
    const drawn = await filled({ sent: () => refused(status, code) });
    const read = workspaceListReads(drawn);
    await press("Create");
    expect(refusal()?.textContent).toBe(line);
    expect(refusal()?.classList.contains("notice-danger")).toBe(true);
    expect(foot()?.textContent).toBe(`${line}CancelCreate`);
    expect(formDrawn()).toStrictEqual([...Object.values(owner), true]);
    expect(create().disabled).toBe(false);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(workspaceListReads(drawn)).toBe(read);
  },
);

test("a refusal's line goes when the form is sent again, and the next answer's replaces it", async () => {
  const held = heldAnswer();
  const answers = [() => refused(409, accessTenantTakenCode)];
  const drawn = await filled({
    sent: () => answers.shift()?.() ?? held.answered,
  });
  await press("Create");
  expect(refusal()?.textContent).toBe("Name taken");
  await press("Create");
  expect(creationsSent(drawn)).toHaveLength(2);
  expect(refusal()).toBeNull();
  await turned(() => {
    held.release(workspaceCreated());
  });
  await settled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("status").textContent).toBe(createdLine);
});

test("a refusal's line goes when the form is changed", async () => {
  await filled({ sent: () => refused(409, accessTenantTakenCode) });
  await press("Create");
  expect(refusal()?.textContent).toBe("Name taken");
  await typed({ Name: "northwind-two" });
  expect(refusal()).toBeNull();
});

test("a dialog opened again starts from nothing typed and nothing said", async () => {
  await filled({ sent: () => refused(409, accessTenantTakenCode) });
  fireEvent.click(checkbox());
  await press("Create");
  expect(refusal()?.textContent).toBe("Name taken");
  expect(formDrawn()).toStrictEqual([...Object.values(owner), false]);
  await press("Cancel");
  await press(opener);
  expect(formDrawn()).toStrictEqual(["", "", "", true]);
  expect(refusal()).toBeNull();
});

test.each([
  ["North Wind", "Lowercase letters, digits, inner hyphens"],
  ["api", "Reserved"],
])(
  "the name %s draws its fault under the field and sends nothing",
  async (name, fault) => {
    const drawn = await filled();
    await typed({ Name: name });
    expect(within(dialog()).getByText(fault)).toBeTruthy();
    expect(field("Name").getAttribute("aria-invalid")).toBe("true");
    expect(create().disabled).toBe(true);
    fireEvent.click(create());
    await settled();
    expect(creationsSent(drawn)).toStrictEqual([]);
  },
);

test("a username or an email the schema refuses draws the invitation's own fault and sends nothing", async () => {
  const drawn = await filled();
  await typed({ "GitHub username": "-octocat", Email: "owner@" });
  expect(within(dialog()).getByText("Not a GitHub username")).toBeTruthy();
  expect(within(dialog()).getByText("Not an email")).toBeTruthy();
  expect(create().disabled).toBe(true);
  fireEvent.click(create());
  await settled();
  expect(creationsSent(drawn)).toStrictEqual([]);
});

test("a reader who manages the site's permissions starts with the box checked, and unchecking it is what is sent", async () => {
  const drawn = await filled();
  expect(boxStill(checkbox())).toBe(false);
  fireEvent.click(checkbox());
  await turned();
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
  await press("Create");
  expect(creationsSent(drawn).map((request) => request.body)).toStrictEqual([
    {
      tenant: "northwind",
      github: "octocat",
      email: "owner@example.com",
      createAccounts: false,
    },
  ]);
});

test("a reader who does not manage the site's permissions has the box unchecked, taking no press, and sends it so", async () => {
  const drawn = await filled({
    abilities: () => answer(workspacesAbilitiesCreator),
  });
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
  expect(checkbox().disabled).toBe(true);
  fireEvent.click(checkbox());
  await turned();
  expect(checkbox().getAttribute("aria-checked")).toBe("false");
  await press("Create");
  expect(creationsSent(drawn).map((request) => request.body)).toMatchObject([
    { createAccounts: false },
  ]);
});

test("a reader who may make no account is told so under the username, and one who may is not", async () => {
  await opened();
  expect(within(dialog()).queryByText("Existing accounts only")).toBeNull();
  cleanup();
  await opened({ abilities: () => answer(workspacesAbilitiesCreator) });
  expect(within(dialog()).getByText("Existing accounts only")).toBeTruthy();
});

test("a creation unanswered, no field, box or action takes a press and nothing closes the dialog, and its answer gives them back", async () => {
  const held = heldAnswer();
  const drawn = await filled({ sent: () => held.answered });
  await press("Create");
  const shown = dialog();
  expect(create().textContent).toBe("Creating…");
  expect(create().disabled).toBe(true);
  expect(action(/^Cancel$/u).disabled).toBe(true);
  for (const label of Object.keys(owner))
    expect(field(label).disabled, label).toBe(true);
  expect(checkbox().disabled).toBe(false);
  expect(checkbox().getAttribute("aria-disabled")).toBe("true");
  await turned(() => {
    fireEvent.click(checkbox());
    fireEvent.click(create());
    pressedOutside();
    fireEvent.keyDown(shown, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: opener }));
  });
  await settled();
  expect(dialog()).toBe(shown);
  expect(formDrawn()).toStrictEqual([...Object.values(owner), true]);
  expect(creationsSent(drawn)).toHaveLength(1);
  await turned(() => {
    held.release(refused(409, accessTenantTakenCode));
  });
  await settled();
  expect(refusal()?.textContent).toBe("Name taken");
  expect(create().textContent).toBe("Create");
  expect(create().disabled).toBe(false);
  expect(action(/^Cancel$/u).disabled).toBe(false);
  for (const label of Object.keys(owner))
    expect(field(label).disabled, label).toBe(false);
  expect(boxStill(checkbox())).toBe(false);
});

test("a press outside closes a dialog that awaits nothing, with nothing sent", async () => {
  const drawn = await filled();
  await turned(pressedOutside);
  await settled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(creationsSent(drawn)).toStrictEqual([]);
});
