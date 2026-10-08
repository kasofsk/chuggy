/**
 * Adding a holder on the workspace's permissions page: `Add` on each
 * permission the reader may change, offering what it admits and has not got,
 * the addition sent for the holder's kind with no body, the dialog closed and
 * every list read again, and a refusal one line beside what was chosen.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import {
  answer,
  heldAnswer,
  press,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  addButtons,
  added,
  additionsSent,
  choicesOffered,
  chosen,
  dialog,
  drawPermissions,
  expectPermissionsReread,
  opened,
  permissionsAbilitiesNone,
  permissionsAbilitiesPath,
  permissionsAbilitiesSite,
  permissionsAbilitiesTenant,
  permissionsPeopleListed,
  permissionsPeoplePath,
  permissionsTenant,
  readsOf,
  tenantAuthoritiesPath,
  tenantAuthoritiesStarting,
} from "./permissionsFixture.tsx";
import type { PermissionsDrawing } from "./permissionsFixture.tsx";

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

const [adminGranters, memberGranters, hostedRunsGranters, authorityManagers] =
  tenantAuthoritiesStarting.authorities;

/** A reader managing the workspace's permissions, the People list read. */
function drawManaging(drawing: PermissionsDrawing = {}): Promise<DrawnStrict> {
  return drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
    people: () => answer(permissionsPeopleListed),
    ...drawing,
  });
}

test("a workspace manager may add to each workspace permission they may change, and not to Grant hosted runs", async () => {
  await drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
  });
  expect(addButtons("Workspace")).toStrictEqual([
    "Add to Grant Admin",
    "Add to Grant Member",
    "Add to Change permissions",
  ]);
});

test("a site manager may add to Grant hosted runs, and to no other of the workspace's permissions", async () => {
  await drawPermissions({
    abilities: () => answer(permissionsAbilitiesSite),
  });
  expect(addButtons("Workspace")).toStrictEqual(["Add to Grant hosted runs"]);
});

test("a reader who may change nothing may add nothing", async () => {
  await drawPermissions({ abilities: () => answer(permissionsAbilitiesNone) });
  expect(addButtons("Workspace")).toStrictEqual([]);
  cleanup();
  await drawPermissions();
  expect(addButtons("Workspace")).toStrictEqual([]);
});

test("each permission offers its record's groups less those it holds, then a person, nothing chosen", async () => {
  await drawManaging();
  await opened("Workspace", "Grant Member");
  expect(choicesOffered()).toStrictEqual([
    "Site admins",
    "Workspace members",
    "Person",
  ]);
  expect(
    within(dialog())
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-checked")),
  ).toStrictEqual(["false", "false", "false"]);
  await press("Cancel");
  await opened("Workspace", "Grant Admin");
  expect(choicesOffered()).toStrictEqual(["Site admins", "Person"]);
  await press("Cancel");
  await opened("Workspace", "Change permissions");
  expect(choicesOffered()).toStrictEqual(["Person"]);
});

test("Workspace members on Grant Member draws its line, and sending sends the group's addition", async () => {
  const drawn = await drawManaging();
  await opened("Workspace", "Grant Member");
  const line = within(dialog()).getByText(
    "Members will see people and can remove other members.",
  );
  const members = within(dialog()).getByRole("radio", {
    name: "Workspace members",
  });
  expect(members.getAttribute("aria-describedby")).toBe(line.id);
  expect(within(dialog()).getByText("From the People list")).toBeTruthy();
  const add = within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: "Add",
  });
  expect(add.disabled).toBe(true);
  await chosen("Workspace members");
  await added();
  expect(additionsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `${tenantAuthoritiesPath}/MemberGranters/groups/TenantMembers`,
      body: undefined,
    },
  ]);
});

test("a person is chosen from the People list's people less those holding the permission, and sent with their subject", async () => {
  const drawn = await drawManaging({
    tenant: () =>
      answer({
        ...tenantAuthoritiesStarting,
        authorities: [
          {
            ...adminGranters,
            people: [{ subject: "s-ada", mine: false, account: true }],
          },
          memberGranters,
          hostedRunsGranters,
          authorityManagers,
        ],
      }),
  });
  await opened("Workspace", "Grant Admin");
  await chosen("Person");
  const add = within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: "Add",
  });
  expect(add.disabled).toBe(true);
  const roster = within(dialog()).getAllByRole("listitem");
  expect(roster.map((item) => item.textContent)).toStrictEqual([
    "s-bobNo accountChoose s-bob",
  ]);
  await turned(() => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Choose s-bob" }),
    );
  });
  await added();
  expect(additionsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `${tenantAuthoritiesPath}/AdminGranters/people/s-bob`,
      body: undefined,
    },
  ]);
});

test("the roster draws each person on a line: their address or subject, their login, what they are, and Choose", async () => {
  await drawManaging();
  await opened("Workspace", "Grant Member");
  await chosen("Person");
  expect(
    within(dialog())
      .getAllByRole("listitem")
      .map((item) => item.textContent),
  ).toStrictEqual([
    "ada@example.comadaChoose ada@example.com",
    "s-bobNo accountChoose s-bob",
  ]);
});

function notPermitted(): Response {
  return answer(
    { error: { code: "AccessNotPermitted", message: "refused" } },
    403,
  );
}

function addButton(): HTMLButtonElement {
  return within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: "Add",
  });
}

test("a holder chosen and cancelled is forgotten when the dialog opens again, the person with the choice", async () => {
  await drawManaging();
  await opened("Workspace", "Grant Member");
  await chosen("Person");
  await press("Choose ada@example.com");
  expect(addButton().disabled).toBe(false);
  await press("Cancel");
  await opened("Workspace", "Grant Member");
  expect(
    within(dialog())
      .getAllByRole("radio")
      .map((radio) => radio.getAttribute("aria-checked")),
  ).toStrictEqual(["false", "false", "false"]);
  expect(addButton().disabled).toBe(true);
  await chosen("Person");
  expect(addButton().disabled).toBe(true);
});

test("a refusal's line is gone when the dialog opens again", async () => {
  await drawManaging({ added: notPermitted });
  await opened("Workspace", "Grant Member");
  await chosen("Workspace members");
  await added();
  expect(within(dialog()).getByRole("status")).toBeTruthy();
  await press("Cancel");
  await opened("Workspace", "Grant Member");
  expect(within(dialog()).queryByRole("status")).toBeNull();
});

test("an addition unanswered, Cancel takes no press and nothing closes the dialog, so its refusal is drawn there", async () => {
  const held = heldAnswer();
  await drawManaging({ added: () => held.answered });
  await opened("Workspace", "Grant Member");
  await chosen("Workspace members");
  await added();
  const cancel = within(dialog()).getByRole<HTMLButtonElement>("button", {
    name: "Cancel",
  });
  expect(cancel.disabled).toBe(true);
  await turned(() => {
    fireEvent.keyDown(dialog(), { key: "Escape" });
  });
  await turned(() => {
    held.release(notPermitted());
  });
  await settled();
  expect(within(dialog()).getByRole("status")).toBeTruthy();
  expect(cancel.disabled).toBe(false);
});

test("the People list not read, Person is not offered, and a permission with nothing left says so", async () => {
  await drawManaging({ people: () => answer({}, 404) });
  await opened("Workspace", "Grant Member");
  expect(choicesOffered()).toStrictEqual(["Site admins", "Workspace members"]);
  await press("Cancel");
  await opened("Workspace", "Change permissions");
  expect(choicesOffered()).toStrictEqual([]);
  expect(within(dialog()).getByText("Nothing to add")).toBeTruthy();
});

test("sent, the dialog closes and both lists, the abilities and the People list are read again", async () => {
  const drawn = await drawManaging();
  const reads = [
    tenantAuthoritiesPath,
    permissionsAbilitiesPath,
    permissionsPeoplePath,
  ];
  const before = reads.map((read) => readsOf(drawn, read));
  const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  await opened("Workspace", "Grant Admin");
  await chosen("Site admins");
  await added();
  expect(screen.queryByRole("dialog", { name: "Add holder" })).toBeNull();
  expect(
    reads.map((read, index) => readsOf(drawn, read) > (before[index] ?? 0)),
  ).toStrictEqual([true, true, true]);
  expectPermissionsReread(invalidated);
});

test.each([
  {
    refusal: () =>
      answer(
        { error: { code: "AccessHolderNotAdmitted", message: "refused" } },
        409,
      ),
    line: "Holder not admitted",
  },
  {
    refusal: () =>
      answer(
        { error: { code: "AccessNotPermitted", message: "refused" } },
        403,
      ),
    line: "Change not permitted",
  },
])(
  "a refusal is $line, one line in the dialog with the choice still made",
  async ({ refusal, line }) => {
    await drawManaging({ added: refusal });
    await opened("Workspace", "Grant Member");
    await chosen("Workspace members");
    await added();
    expect(within(dialog()).getByText(line)).toBeTruthy();
    expect(screen.getAllByText(line)).toHaveLength(1);
    expect(
      within(dialog())
        .getByRole("radio", { name: "Workspace members" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  },
);
