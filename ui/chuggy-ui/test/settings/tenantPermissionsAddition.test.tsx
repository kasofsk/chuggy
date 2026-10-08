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

import { tenantPeopleResource } from "../../app/browser/settings/tenantPeopleResource.ts";
import { tenantResourceKey } from "../../app/core/projectQueryKeys.ts";
import {
  answer,
  press,
  sectionOf,
  settled,
  turned,
} from "../screenHarness.tsx";
import type { DrawnStrict } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  additionsSent,
  drawPermissions,
  permissionsAbilitiesNone,
  permissionsAbilitiesPath,
  permissionsAbilitiesSite,
  permissionsAbilitiesTenant,
  permissionsPeopleListed,
  permissionsPeoplePath,
  permissionsTenant,
  readsOf,
  siteAuthoritiesPath,
  siteAuthoritiesStarting,
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

/** The accessible name of every add button a section draws. */
function addButtons(title: string): readonly string[] {
  return within(sectionOf(title))
    .queryAllByRole("button", { name: /^Add to / })
    .map((button) => button.textContent);
}

/** One section's add button pressed, its dialog opened. */
async function opened(title: string, permission: string): Promise<void> {
  await turned(() => {
    fireEvent.click(
      within(sectionOf(title)).getByRole("button", {
        name: `Add to ${permission}`,
      }),
    );
  });
  await settled();
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog", { name: "Add holder" });
}

function choicesOffered(): readonly string[] {
  return within(dialog())
    .queryAllByRole("radio")
    .map((radio) => {
      const label = document.querySelector(`label[for="${radio.id}"]`);
      return label?.textContent ?? "";
    });
}

async function chosen(name: string): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog()).getByRole("radio", { name }));
  });
}

async function added(): Promise<void> {
  await turned(() => {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add" }));
  });
  await settled();
}

/** A reader managing the workspace's permissions and the site's, the People list read. */
function drawManaging(drawing: PermissionsDrawing = {}): Promise<DrawnStrict> {
  return drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
    site: () => answer(siteAuthoritiesStarting),
    people: () => answer(permissionsPeopleListed),
    ...drawing,
  });
}

test("a workspace manager may add to each workspace permission they may change, and not to hosted run grants", async () => {
  await drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
  });
  expect(addButtons("Workspace")).toStrictEqual([
    "Add to Admin grants",
    "Add to Member grants",
    "Add to Permission changes",
  ]);
});

test("a site manager may add to hosted run grants and to the site's permissions", async () => {
  await drawPermissions({
    abilities: () => answer(permissionsAbilitiesSite),
    site: () => answer(siteAuthoritiesStarting),
  });
  expect(addButtons("Workspace")).toStrictEqual(["Add to Hosted run grants"]);
  expect(addButtons("Site")).toStrictEqual([
    "Add to Account creation",
    "Add to Permission changes",
  ]);
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
  await opened("Workspace", "Member grants");
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
  await press("Close");
  await opened("Workspace", "Admin grants");
  expect(choicesOffered()).toStrictEqual(["Site admins", "Person"]);
  await press("Close");
  await opened("Workspace", "Permission changes");
  expect(choicesOffered()).toStrictEqual(["Person"]);
  await press("Close");
  await opened("Site", "Permission changes");
  expect(choicesOffered()).toStrictEqual(["Person"]);
});

test("This workspace's admins is offered on the site's account creation only where they do not hold it", async () => {
  await drawManaging();
  await opened("Site", "Account creation");
  expect(choicesOffered()).toStrictEqual(["Person"]);
  cleanup();
  const drawn = await drawManaging({
    site: () =>
      answer({
        ...siteAuthoritiesStarting,
        authorities: siteAuthoritiesStarting.authorities.map((held) => ({
          ...held,
          groups: [],
          tenants: ["globex"],
        })),
      }),
  });
  await opened("Site", "Account creation");
  expect(choicesOffered()).toStrictEqual([
    "Site admins",
    "This workspace's admins",
    "Person",
  ]);
  await chosen("This workspace's admins");
  await added();
  expect(additionsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `${siteAuthoritiesPath}/AccountCreators/tenants/${permissionsTenant}`,
      body: undefined,
    },
  ]);
  await opened("Site", "Permission changes");
  expect(choicesOffered()).toStrictEqual(["Person"]);
});

test("Workspace members on Member grants draws its line, and sending sends the group's addition", async () => {
  const drawn = await drawManaging();
  await opened("Workspace", "Member grants");
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
  await opened("Workspace", "Admin grants");
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

test("the People list not read, Person is not offered, and a permission with nothing left says so", async () => {
  await drawManaging({ people: () => answer({}, 404) });
  await opened("Workspace", "Member grants");
  expect(choicesOffered()).toStrictEqual(["Site admins", "Workspace members"]);
  await press("Close");
  await opened("Workspace", "Permission changes");
  expect(choicesOffered()).toStrictEqual([]);
  expect(within(dialog()).getByText("Nothing to add")).toBeTruthy();
});

test("sent, the dialog closes and both lists, the abilities and the People list are read again", async () => {
  const drawn = await drawManaging();
  const reads = [
    tenantAuthoritiesPath,
    siteAuthoritiesPath,
    permissionsAbilitiesPath,
    permissionsPeoplePath,
  ];
  const before = reads.map((read) => readsOf(drawn, read));
  const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  await opened("Workspace", "Admin grants");
  await chosen("Site admins");
  await added();
  expect(screen.queryByRole("dialog", { name: "Add holder" })).toBeNull();
  expect(
    reads.map((read, index) => readsOf(drawn, read) > (before[index] ?? 0)),
  ).toStrictEqual([true, true, true, true]);
  expect(invalidated).toHaveBeenCalledWith({
    queryKey: tenantResourceKey(permissionsTenant, tenantPeopleResource),
  });
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
    await opened("Workspace", "Member grants");
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
