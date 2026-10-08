/**
 * The site's workspaces page, mounted: the one card and its form for a reader
 * who may make a workspace and one line for any other, the fields sent as the
 * contract states them, a field's fault under it before anything is sent, the
 * line each answer leaves at the card's foot, and a form that takes no press
 * while its request is unanswered.
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
import type { AccessSiteAbilities } from "../../../../src/contract/accessPlane.ts";
import { SiteWorkspacesPage } from "../../app/browser/settings/SiteWorkspacesPage.tsx";
import {
  answer,
  drawnStrict,
  heldAnswer,
  press,
  sectionOf,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import { styleless } from "../styleless.ts";
import {
  permissionsTenant,
  siteAbilitiesNone,
  siteAbilitiesPath,
  unanswered,
} from "./permissionsFixture.tsx";
import { refused } from "./tenantPeopleFixture.tsx";

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

const workspacesPath = "/access/v1/site/workspaces";

const withheld = "A site admin creates workspaces";

const box = "Owner can invite new people";

/** A reader who may make a workspace and hand account creation on with it. */
const abilitiesEvery: AccessSiteAbilities = {
  administer: true,
  createAccount: true,
  createTenant: true,
  manageAuthorities: true,
};

/** A reader who may make a workspace and nothing else. */
const abilitiesCreator: AccessSiteAbilities = {
  ...siteAbilitiesNone,
  createTenant: true,
};

const owner = {
  Workspace: "northwind",
  "GitHub username": "octocat",
  Email: "owner@example.com",
};

function created(status = 201): Response {
  return answer(
    { tenant: "northwind", subject: "s-owner", created: status === 201 },
    status,
  );
}

interface WorkspacesDrawing {
  readonly abilities?: () => Response | Promise<Response>;
  /** What a creation is answered with. */
  readonly sent?: () => Response | Promise<Response>;
}

function drawWorkspaces(drawing: WorkspacesDrawing = {}): Promise<DrawnStrict> {
  const abilities = drawing.abilities ?? (() => answer(abilitiesEvery));
  const sent = drawing.sent ?? (() => created());
  return drawnStrict(<SiteWorkspacesPage />, (request: SentRequest) => {
    if (request.method !== "GET") return sent();
    if (request.url === siteAbilitiesPath) return abilities();
    return answer({}, 404);
  });
}

function card(): HTMLElement {
  return sectionOf("New workspace");
}

function field(label: string): HTMLInputElement {
  return within(card()).getByRole<HTMLInputElement>("textbox", {
    name: label,
  });
}

function checkbox(): HTMLButtonElement {
  return within(card()).getByRole<HTMLButtonElement>("checkbox", {
    name: box,
  });
}

function create(): HTMLButtonElement {
  return within(card()).getByRole<HTMLButtonElement>("button", {
    name: /^Creat/u,
  });
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

async function filled(drawing: WorkspacesDrawing = {}): Promise<DrawnStrict> {
  const drawn = await drawWorkspaces(drawing);
  await typed(owner);
  return drawn;
}

function creationsSent(drawn: DrawnStrict): readonly SentRequest[] {
  return drawn.sent.filter((request) => request.method !== "GET");
}

test("a reader who may make a workspace is drawn the one card, its three fields in order, its box and Create, and nothing listed", async () => {
  await drawWorkspaces();
  expect(
    within(card())
      .getAllByRole("textbox")
      .map((input) => input.getAttribute("aria-label")),
  ).toStrictEqual(Object.keys(owner));
  expect(formDrawn()).toStrictEqual(["", "", "", true]);
  expect(create().textContent).toBe("Create");
  expect(create().disabled).toBe(true);
  expect(within(card()).queryByRole("status")).toBeNull();
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryByText(withheld)).toBeNull();
  styleless();
});

test("Create sends the four fields the contract states, as typed, to the site's route", async () => {
  const drawn = await filled();
  expect(create().disabled).toBe(false);
  await press("Create");
  expect(creationsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: workspacesPath,
      body: {
        tenant: "northwind",
        github: "octocat",
        email: "owner@example.com",
        createAccounts: true,
      },
    },
  ]);
});

test.each([[201], [200]])(
  "a %i creation says who signs in, in the passing tone, and leaves the form as it started",
  async (status) => {
    await filled({ sent: () => created(status) });
    fireEvent.click(checkbox());
    await turned();
    expect(formDrawn()).toStrictEqual([...Object.values(owner), false]);
    await press("Create");
    const said = within(card()).getByRole("status");
    expect(said.textContent).toBe(
      "northwind created · octocat signs in with GitHub",
    );
    expect(said.classList.contains("notice-pass")).toBe(true);
    expect(formDrawn()).toStrictEqual(["", "", "", true]);
    expect(create().disabled).toBe(true);
  },
);

test("a creation's line stands until the form is changed", async () => {
  await filled();
  await press("Create");
  expect(within(card()).getByRole("status")).toBeTruthy();
  await typed({ Workspace: "n" });
  expect(within(card()).queryByRole("status")).toBeNull();
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
  "a %i %s draws its own line in the refusing tone and leaves the form as typed",
  async (status, code, line) => {
    await filled({ sent: () => refused(status, code) });
    await press("Create");
    const said = within(card()).getByRole("status");
    expect(said.textContent).toBe(line);
    expect(said.classList.contains("notice-danger")).toBe(true);
    expect(formDrawn()).toStrictEqual([...Object.values(owner), true]);
    expect(create().disabled).toBe(false);
  },
);

test("a refusal's line goes when the form is sent again, and the next answer's replaces it", async () => {
  const held = heldAnswer();
  const answers = [() => refused(409, accessTenantTakenCode)];
  const drawn = await filled({
    sent: () => answers.shift()?.() ?? held.answered,
  });
  await press("Create");
  expect(within(card()).getByRole("status").textContent).toBe("Name taken");
  await press("Create");
  expect(creationsSent(drawn)).toHaveLength(2);
  expect(within(card()).queryByRole("status")).toBeNull();
  await turned(() => {
    held.release(created());
  });
  await settled();
  expect(within(card()).getByRole("status").textContent).toBe(
    "northwind created · octocat signs in with GitHub",
  );
});

test.each([
  ["North Wind", "Lowercase letters, digits, inner hyphens"],
  ["api", "Reserved"],
])(
  "the name %s draws its fault under the field and sends nothing",
  async (name, fault) => {
    const drawn = await filled();
    await typed({ Workspace: name });
    expect(within(card()).getByText(fault)).toBeTruthy();
    expect(field("Workspace").getAttribute("aria-invalid")).toBe("true");
    expect(create().disabled).toBe(true);
    fireEvent.click(create());
    await settled();
    expect(creationsSent(drawn)).toStrictEqual([]);
  },
);

test("a username or an email the schema refuses draws the invitation's own fault and sends nothing", async () => {
  const drawn = await filled();
  await typed({ "GitHub username": "-octocat", Email: "owner@" });
  expect(within(card()).getByText("Not a GitHub username")).toBeTruthy();
  expect(within(card()).getByText("Not an email")).toBeTruthy();
  expect(create().disabled).toBe(true);
  fireEvent.click(create());
  await settled();
  expect(creationsSent(drawn)).toStrictEqual([]);
});

test("a reader who manages the site's permissions starts with the box checked, and unchecking it is what is sent", async () => {
  const drawn = await filled();
  expect(checkbox().disabled).toBe(false);
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
  const drawn = await filled({ abilities: () => answer(abilitiesCreator) });
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
  await drawWorkspaces();
  expect(within(card()).queryByText("Existing accounts only")).toBeNull();
  cleanup();
  await drawWorkspaces({ abilities: () => answer(abilitiesCreator) });
  expect(within(card()).getByText("Existing accounts only")).toBeTruthy();
});

test("a creation unanswered, no field, box or action takes a press, and its answer gives them back", async () => {
  const held = heldAnswer();
  const drawn = await filled({ sent: () => held.answered });
  await press("Create");
  expect(create().textContent).toBe("Creating…");
  expect(create().disabled).toBe(true);
  for (const label of Object.keys(owner))
    expect(field(label).disabled, label).toBe(true);
  expect(checkbox().disabled).toBe(true);
  expect(formDrawn()).toStrictEqual([...Object.values(owner), true]);
  fireEvent.click(create());
  await settled();
  expect(creationsSent(drawn)).toHaveLength(1);
  await turned(() => {
    held.release(refused(409, accessTenantTakenCode));
  });
  await settled();
  expect(create().textContent).toBe("Create");
  expect(create().disabled).toBe(false);
  for (const label of Object.keys(owner))
    expect(field(label).disabled, label).toBe(false);
  expect(checkbox().disabled).toBe(false);
});

test.each([
  {
    reader: "who may do everything on the site but make a workspace",
    abilities: () => answer({ ...abilitiesEvery, createTenant: false }),
  },
  {
    reader: "the site's abilities are absent to",
    abilities: () => answer({}, 404),
  },
])(
  "a reader $reader is told who creates workspaces and drawn no form",
  async ({ abilities }) => {
    await drawWorkspaces({ abilities });
    expect(screen.getByText(withheld)).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(screen.queryByText(/^Not available/u)).toBeNull();
  },
);

test("the abilities loading or failed is the page's unready line, with no form and no word on who creates", async () => {
  await drawWorkspaces({ abilities: unanswered });
  expect(screen.getByText("Loading…")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(withheld)).toBeNull();
  cleanup();
  await drawWorkspaces({ abilities: () => answer({}, 500) });
  expect(
    screen.getByText("Failed to load · the API failed with InternalError"),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText(withheld)).toBeNull();
});
