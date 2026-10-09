/**
 * Inviting a person from the workspace's people page: a dialog named for the
 * workspace, the roles and projects the reader may grant offered, the fields
 * sent as the contract states them, a field's fault under it before anything
 * is sent, each refusal's line with the dialog left as it was, and a created
 * or found person closing it.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessInvitationCodes,
  accessInvitationProjectsMax,
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
  boxesIn,
  changesSent,
  drawPeople,
  invitationPath,
  listReads,
  peopleAbilitiesAll,
  peopleAbilitiesNone,
  peopleListed,
  peopleTenant,
  projectsOffered,
  refused,
} from "./tenantPeopleFixture.tsx";
import type { PeopleDrawing } from "./tenantPeopleFixture.tsx";

const held = vi.hoisted((): { slept: () => Promise<void> } => ({
  slept: () => Promise.resolve(),
}));

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => held.slept(),
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
  held.slept = () => Promise.resolve();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: `Invite to ${peopleTenant}` });
}

function chosen(box: string): void {
  fireEvent.click(within(dialog()).getByRole("checkbox", { name: box }));
}

function typed(label: string, value: string): void {
  fireEvent.change(within(dialog()).getByRole("textbox", { name: label }), {
    target: { value },
  });
}

async function invitedWith(drawing: PeopleDrawing): Promise<DrawnStrict> {
  const drawn = await drawPeople(drawing);
  await press("Invite");
  typed("GitHub username", "ada");
  typed("Email", "ada@example.com");
  await turned();
  return drawn;
}

async function sent(): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Invite" }));
  });
  await settled();
}

test("an invitation sends the fields the contract states, as it states them", async () => {
  const drawn = await invitedWith({
    changed: () => answer({ subject: "s-new", created: true }, 201),
  });
  fireEvent.click(within(dialog()).getByRole("radio", { name: "Admin" }));
  chosen("beacon Developer");
  chosen("beacon Dispatcher");
  chosen("beacon Viewer");
  await turned();
  expect(boxesIn(dialog(), "beacon")).toStrictEqual([
    "beacon Admin",
    "beacon Developer+",
    "beacon Dispatcher+",
    "beacon Viewer+",
  ]);
  await sent();
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: invitationPath,
      body: {
        github: "ada",
        email: "ada@example.com",
        role: "Admin",
        projects: [
          { project: "beacon", roles: ["Developer", "Dispatcher", "Viewer"] },
        ],
      },
    },
  ]);
});

test("a username or an email the schema refuses sends nothing and draws its fault", async () => {
  const drawn = await invitedWith({});
  typed("GitHub username", "-ada");
  typed("Email", "ada");
  await turned();
  expect(within(dialog()).getByText("Not a GitHub username")).toBeTruthy();
  expect(within(dialog()).getByText("Not an email")).toBeTruthy();
  const invite = within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: "Invite",
  });
  expect(invite.disabled).toBe(true);
  await sent();
  expect(changesSent(drawn)).toStrictEqual([]);
});

test("more projects than the schema admits sends nothing and draws its fault", async () => {
  const projects = Array.from(
    { length: accessInvitationProjectsMax + 1 },
    (_, index) => `p${String(index)}`,
  );
  const drawn = await invitedWith({
    listing: () => answer({ ...peopleListed, projects }),
    abilities: () => answer(peopleAbilitiesAll(projects)),
  });
  for (const project of projects) chosen(`${project} Admin`);
  await turned();
  expect(
    within(dialog()).getByText(
      `At most ${String(accessInvitationProjectsMax)} projects`,
    ),
  ).toBeTruthy();
  await sent();
  expect(changesSent(drawn)).toStrictEqual([]);
});

const namedRefusals = [
  [422, accessInvitationCodes.GithubAccountUnknown, "No such GitHub user"],
  [
    422,
    accessInvitationCodes.GithubAccountNotUser,
    "Not a person's GitHub account",
  ],
  [
    409,
    accessInvitationCodes.EmailHeld,
    "Email held by another account · use another address",
  ],
] as const;

test.each(namedRefusals)(
  "a %i %s draws its own line and leaves the dialog as it was",
  async (status, code, line) => {
    await invitedWith({ changed: () => refused(status, code) });
    await sent();
    expect(within(dialog()).getByText(line)).toBeTruthy();
    expect(
      within(dialog()).getByRole<HTMLInputElement>("textbox", { name: "Email" })
        .value,
    ).toBe("ada@example.com");
  },
);

test("an absent answer draws its line and reads the list again", async () => {
  const drawn = await invitedWith({ changed: () => answer({}, 404) });
  const read = listReads(drawn);
  await sent();
  expect(within(dialog()).getByText("Not available")).toBeTruthy();
  expect(listReads(drawn)).toBeGreaterThan(read);
});

test.each([
  [201, true],
  [200, false],
])(
  "a %i invitation closes the dialog and reads the list again",
  async (status, created) => {
    const drawn = await invitedWith({
      changed: () => answer({ subject: "s-new", created }, status),
    });
    const read = listReads(drawn);
    await sent();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(listReads(drawn)).toBeGreaterThan(read);
  },
);

test("a retryable answer is sent three times at most, the action writing throughout", async () => {
  let wake = (): void => undefined;
  held.slept = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  const drawn = await invitedWith({
    changed: () => refused(503, accessInvitationCodes.GithubUnavailable),
  });
  await sent();
  expect(
    within(dialog()).getByRole("button", { name: "Inviting…" }),
  ).toBeTruthy();
  for (let woken = 0; woken < 2; woken += 1) {
    await turned(() => {
      wake();
    });
    await settled();
  }
  expect(changesSent(drawn)).toHaveLength(3);
  expect(within(dialog()).getByText("GitHub unavailable")).toBeTruthy();
  expect(within(dialog()).getByRole("button", { name: "Invite" })).toBeTruthy();
});

function radios(): readonly string[] {
  return within(dialog())
    .getAllByRole("radio")
    .map(
      (radio) =>
        `${radio.getAttribute("value") ?? ""}${radio.getAttribute("aria-checked") === "true" ? "+" : ""}`,
    );
}

test("a reader who may grant every role and invite anyone is offered every role, opening on Member", async () => {
  await invitedWith({});
  expect(radios()).toStrictEqual(["Admin", "Member+"]);
  expect(projectsOffered(dialog())).toStrictEqual(peopleListed.projects);
  for (const project of peopleListed.projects)
    expect(boxesIn(dialog(), project)).toStrictEqual([
      `${project} Admin`,
      `${project} Developer`,
      `${project} Dispatcher`,
      `${project} Viewer`,
    ]);
  expect(within(dialog()).queryByText("Existing accounts only")).toBeNull();
  styleless();
});

test("a reader who may grant Member alone is offered Member and no project", async () => {
  await invitedWith({
    abilities: () =>
      answer({ ...peopleAbilitiesAll(), roles: ["Member"], projects: [] }),
  });
  expect(radios()).toStrictEqual(["Member+"]);
  expect(projectsOffered(dialog())).toStrictEqual([]);
  expect(within(dialog()).queryAllByRole("checkbox")).toStrictEqual([]);
});

test("a reader who may grant Admin and not Member opens on Admin, and sends it", async () => {
  const drawn = await invitedWith({
    abilities: () => answer({ ...peopleAbilitiesAll(), roles: ["Admin"] }),
    changed: () => answer({ subject: "s-new", created: true }, 201),
  });
  expect(radios()).toStrictEqual(["Admin+"]);
  await sent();
  expect(changesSent(drawn).map((request) => request.body)).toStrictEqual([
    { github: "ada", email: "ada@example.com", role: "Admin" },
  ]);
});

test("a reader who may not make an account is told so in the form", async () => {
  await invitedWith({
    abilities: () => answer({ ...peopleAbilitiesAll(), createAccount: false }),
  });
  expect(within(dialog()).getByText("Existing accounts only")).toBeTruthy();
});

test("a reader who may grant no workspace role is offered no invitation", async () => {
  await drawPeople({ abilities: () => answer(peopleAbilitiesNone) });
  expect(screen.queryByRole("button", { name: "Invite" })).toBeNull();
});

test("a reader who may grant on one project of two is offered that project alone", async () => {
  await invitedWith({
    abilities: () =>
      answer({
        ...peopleAbilitiesAll(),
        projects: peopleAbilitiesAll(["beacon"]).projects,
      }),
  });
  expect(projectsOffered(dialog())).toStrictEqual(["beacon"]);
});

/** What each role's cell of a project's row draws as text, in the roles' order. */
function roleWords(project: string): readonly string[] {
  const row = within(dialog()).getByRole("row", {
    name: new RegExp(`^${project}`, "u"),
  });
  return within(row)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);
}

/** The reader may grant Viewer alone on atlas and every role on beacon. */
function invitedGrantingViewerOnAtlas(): Promise<DrawnStrict> {
  const every = peopleAbilitiesAll();
  return invitedWith({
    abilities: () =>
      answer({
        ...every,
        projects: every.projects.map((offered) =>
          offered.project === "atlas"
            ? { ...offered, roles: ["Viewer"] }
            : offered,
        ),
      }),
  });
}

test("a box stands with its role's word, and a role the reader may not grant draws neither", async () => {
  await invitedGrantingViewerOnAtlas();
  expect(roleWords("atlas")).toStrictEqual(["", "", "", "Viewer"]);
  expect(boxesIn(dialog(), "atlas")).toStrictEqual(["atlas Viewer"]);
  expect(roleWords("beacon")).toStrictEqual([
    "Admin",
    "Developer",
    "Dispatcher",
    "Viewer",
  ]);
});

test("a role's word is not read out beside its box's own name", async () => {
  await invitedGrantingViewerOnAtlas();
  expect(
    within(dialog()).getAllByRole("cell", { name: "atlas Viewer" }),
  ).toHaveLength(1);
});

test("a press on a role's word is a press on its box", async () => {
  await invitedGrantingViewerOnAtlas();
  const box = within(dialog()).getByRole("checkbox", { name: "atlas Viewer" });
  expect(box.getAttribute("aria-checked")).toBe("false");
  await turned(() => {
    fireEvent.click(within(box.closest("td") ?? box).getByText("Viewer"));
  });
  expect(box.getAttribute("aria-checked")).toBe("true");
});

test("the dialog's actions are Cancel then Invite, and Cancel closes it with nothing sent", async () => {
  const drawn = await invitedWith({});
  const actions = within(dialog())
    .getAllByRole("button")
    .map((button) => button.textContent);
  expect(actions).toStrictEqual(["Cancel", "Invite"]);
  await press("Cancel");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(changesSent(drawn)).toStrictEqual([]);
});

test("an invitation unanswered, Cancel takes no press and nothing closes the dialog, so its refusal is drawn there", async () => {
  const held = heldAnswer();
  await invitedWith({ changed: () => held.answered });
  await sent();
  const cancel = within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: "Cancel",
  });
  expect(cancel.disabled).toBe(true);
  await turned(() => {
    fireEvent.keyDown(dialog(), { key: "Escape" });
  });
  await turned(() => {
    held.release(refused(422, accessInvitationCodes.GithubAccountUnknown));
  });
  await settled();
  expect(within(dialog()).getByText("No such GitHub user")).toBeTruthy();
  expect(cancel.disabled).toBe(false);
});

test("a dialog opened again starts from nothing typed and nothing said", async () => {
  await invitedWith({
    changed: () => refused(422, accessInvitationCodes.GithubAccountUnknown),
  });
  chosen("beacon Developer");
  await sent();
  expect(within(dialog()).getByText("No such GitHub user")).toBeTruthy();
  await press("Cancel");
  await press("Invite");
  expect(
    within(dialog()).getByRole<HTMLInputElement>("textbox", { name: "Email" })
      .value,
  ).toBe("");
  expect(within(dialog()).queryByText("No such GitHub user")).toBeNull();
  expect(boxesIn(dialog(), "beacon")).not.toContain("beacon Developer+");
});
