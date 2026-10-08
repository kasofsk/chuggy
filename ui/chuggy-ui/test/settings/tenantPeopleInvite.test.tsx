/**
 * Inviting a person from the workspace's people page: the fields sent as the
 * contract states them, a field's fault under it before anything is sent, each
 * refusal's line with the dialog left as it was, and a created or found person
 * closing it.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  accessInvitationCodes,
  accessInvitationProjectsMax,
} from "../../../../src/contract/accessPlane.ts";
import { answer, press, settled, turned } from "../screenHarness.tsx";
import type { DrawnStrict } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  changesSent,
  drawPeople,
  invitationPath,
  listReads,
  peopleListed,
  peopleTenant,
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
  return screen.getByRole("dialog", { name: "Invite" });
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
  const beacon = within(dialog()).getByRole("group", { name: "beacon" });
  fireEvent.click(within(beacon).getByRole("button", { name: "Developer" }));
  fireEvent.click(within(beacon).getByRole("button", { name: "Dispatcher" }));
  await sent();
  expect(changesSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: invitationPath,
      body: {
        github: "ada",
        email: "ada@example.com",
        role: "Admin",
        projects: [{ project: "beacon", roles: ["Developer", "Dispatcher"] }],
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
  });
  for (const project of projects)
    fireEvent.click(
      within(within(dialog()).getByRole("group", { name: project })).getByRole(
        "button",
        { name: "Admin" },
      ),
    );
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
