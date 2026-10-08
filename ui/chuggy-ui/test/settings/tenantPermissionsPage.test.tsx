/**
 * The workspace's permissions page, mounted: the workspace's section alone, a
 * row a permission naming its holders, its absent list as one line, and a
 * holder removed where the reader may change its permission.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { answer, press, sectionOf } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  drawPermissions,
  expectPermissionsReread,
  permissionCell,
  permissionsAbilitiesNone,
  permissionsAbilitiesPath,
  permissionsAbilitiesSite,
  permissionsAbilitiesTenant,
  permissionsDrawn,
  permissionsPeoplePath,
  permissionsTenant,
  readsOf,
  removalsSent,
  removeButtons,
  sectionDrawn,
  siteAuthoritiesStarting,
  tenantAuthoritiesPath,
  tenantAuthoritiesStarting,
  unanswered,
} from "./permissionsFixture.tsx";

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

test("a workspace manager sees its four permissions in roster order, each naming its holders, and no site section", async () => {
  await drawPermissions();
  expect(permissionsDrawn("Workspace")).toStrictEqual([
    { name: "Admin grants", holders: ["Workspace admins"] },
    { name: "Member grants", holders: ["Workspace admins"] },
    { name: "Hosted run grants", holders: ["Site admins"] },
    { name: "Permission changes", holders: ["Workspace admins"] },
  ]);
  expect(sectionDrawn("Site")).toBe(false);
});

test.each([
  { answered: "its holders", site: () => answer(siteAuthoritiesStarting) },
  { answered: "nothing yet", site: unanswered },
  { answered: "absent", site: () => answer({}, 404) },
  { answered: "a failure", site: () => answer({}, 500) },
])(
  "the site's list answering $answered, the page draws the workspace's section and no site section",
  async ({ site }) => {
    await drawPermissions({ site });
    expect(sectionDrawn("Workspace")).toBe(true);
    expect(sectionDrawn("Site")).toBe(false);
  },
);

test("a person holding a permission is drawn as the People page draws them, after the groups", async () => {
  await drawPermissions({
    tenant: () =>
      answer({
        ...tenantAuthoritiesStarting,
        authorities: [
          {
            ...adminGranters,
            people: [
              {
                subject: "s-ada",
                mine: true,
                account: true,
                email: "ada@example.com",
                githubLogin: "ada",
              },
              { subject: "s-bob", mine: false, account: false },
            ],
          },
          memberGranters,
          hostedRunsGranters,
          authorityManagers,
        ],
      }),
  });
  const [admin] = permissionsDrawn("Workspace");
  expect(admin?.holders).toStrictEqual([
    "Workspace admins",
    "ada@example.comadaYou",
    "s-bobNo account",
  ]);
});

test("unnamed holders are a count, and a permission nobody holds says Nobody", async () => {
  await drawPermissions({
    tenant: () =>
      answer({
        ...tenantAuthoritiesStarting,
        authorities: [
          { ...adminGranters, unnamed: 3 },
          { ...memberGranters, groups: [] },
          hostedRunsGranters,
          authorityManagers,
        ],
      }),
  });
  expect(permissionsDrawn("Workspace")[0]?.holders).toStrictEqual([
    "Workspace admins",
    "3 unnamed",
  ]);
  expect(permissionCell("Workspace", "Member grants")).toBe("Nobody");
});

test("a reader the workspace's list is absent to sees the one line and no table", async () => {
  await drawPermissions({ tenant: () => answer({}, 404) });
  const section = sectionOf("Workspace");
  expect(
    within(section).getByText("A workspace admin manages permissions"),
  ).toBeTruthy();
  expect(within(section).queryByRole("table")).toBeNull();
  expect(screen.queryByText(/^Not available/u)).toBeNull();
});

test("the workspace's read loading or failed is its unready line", async () => {
  await drawPermissions({ tenant: unanswered });
  expect(within(sectionOf("Workspace")).getByText("Loading…")).toBeTruthy();
  cleanup();
  await drawPermissions({ tenant: () => answer({}, 500) });
  expect(
    within(sectionOf("Workspace")).getByText(
      "Failed to load · the API failed with InternalError",
    ),
  ).toBeTruthy();
});

test("a list cut short says so, and a whole one does not", async () => {
  await drawPermissions({
    tenant: () => answer({ ...tenantAuthoritiesStarting, truncated: true }),
  });
  expect(
    within(sectionOf("Workspace")).getByText("List cut short"),
  ).toBeTruthy();
  cleanup();
  await drawPermissions();
  expect(
    within(sectionOf("Workspace")).queryByText("List cut short"),
  ).toBeNull();
});

const ada = {
  subject: "s-ada",
  mine: false,
  account: true,
  email: "ada@example.com",
};

/** The reads a removal reads again that the page itself holds. */
const permissionsReads = [
  tenantAuthoritiesPath,
  permissionsAbilitiesPath,
  permissionsPeoplePath,
];

test("a workspace manager may remove each holder of the workspace's permissions but hosted run grants", async () => {
  await drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
  });
  expect(removeButtons("Workspace")).toStrictEqual([
    "Remove Workspace admins from Admin grants",
    "Remove Workspace admins from Member grants",
    "Remove Workspace admins from Permission changes",
  ]);
});

test("a site manager may remove hosted run grants' holders, and no holder of the workspace's own permissions", async () => {
  await drawPermissions({ abilities: () => answer(permissionsAbilitiesSite) });
  expect(removeButtons("Workspace")).toStrictEqual([
    "Remove Site admins from Hosted run grants",
  ]);
});

test("a reader whose abilities are not read, or who may manage nothing, may remove nothing in the workspace", async () => {
  await drawPermissions();
  expect(removeButtons("Workspace")).toStrictEqual([]);
  cleanup();
  await drawPermissions({ abilities: () => answer(permissionsAbilitiesNone) });
  expect(removeButtons("Workspace")).toStrictEqual([]);
});

test("each remove button's name is its own within the section", async () => {
  await drawPermissions({
    abilities: () =>
      answer({
        ...permissionsAbilitiesTenant,
        manageSiteHeldAuthorities: true,
      }),
  });
  const names = removeButtons("Workspace");
  expect(names).toHaveLength(tenantAuthoritiesStarting.authorities.length);
  expect(new Set(names).size).toBe(names.length);
});

test("a removal sends its route with no body, then reads both lists, the abilities and the people again", async () => {
  const drawn = await drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
  });
  const before = permissionsReads.map((read) => readsOf(drawn, read));
  const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  await press("Remove Workspace admins from Admin grants");
  expect(removalsSent(drawn)).toStrictEqual([
    {
      method: "DELETE",
      url: `${tenantAuthoritiesPath}/AdminGranters/groups/TenantAdmins`,
      body: undefined,
    },
  ]);
  expect(
    permissionsReads.map(
      (read, index) => readsOf(drawn, read) > (before[index] ?? 0),
    ),
  ).toStrictEqual([true, true, true]);
  expectPermissionsReread(invalidated);
});

test("a person removed from a workspace permission is sent with their subject", async () => {
  const drawn = await drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
    tenant: () =>
      answer({
        ...tenantAuthoritiesStarting,
        authorities: [
          { ...adminGranters, people: [ada] },
          memberGranters,
          hostedRunsGranters,
          authorityManagers,
        ],
      }),
  });
  await press("Remove ada@example.com from Admin grants");
  expect(removalsSent(drawn)).toStrictEqual([
    {
      method: "DELETE",
      url: `${tenantAuthoritiesPath}/AdminGranters/people/s-ada`,
      body: undefined,
    },
  ]);
});

test("removing a permission manager asks first, sends nothing until confirmed, and nothing when cancelled", async () => {
  const drawn = await drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
  });
  await press("Remove Workspace admins from Permission changes");
  const asked = screen.getByRole("group", {
    name: "Remove permission manager",
  });
  expect(
    within(asked).getByText("This may lock people out of this page."),
  ).toBeTruthy();
  expect(removalsSent(drawn)).toStrictEqual([]);
  await press("Cancel");
  expect(
    screen.queryByRole("group", { name: "Remove permission manager" }),
  ).toBeNull();
  expect(removalsSent(drawn)).toStrictEqual([]);
  await press("Remove Workspace admins from Permission changes");
  await press("Remove");
  expect(removalsSent(drawn)).toStrictEqual([
    {
      method: "DELETE",
      url: `${tenantAuthoritiesPath}/AuthorityManagers/groups/TenantAdmins`,
      body: undefined,
    },
  ]);
});

test("a refused removal is one line in its permission's row", async () => {
  await drawPermissions({
    abilities: () => answer(permissionsAbilitiesTenant),
    removed: () =>
      answer(
        { error: { code: "AccessNotPermitted", message: "refused" } },
        403,
      ),
  });
  await press("Remove Workspace admins from Member grants");
  const row = within(sectionOf("Workspace"))
    .getByRole("rowheader", { name: /^Member grants/u })
    .closest("tr");
  if (row === null) throw new Error("no row draws Member grants");
  expect(within(row).getByText("Change not permitted")).toBeTruthy();
  expect(screen.getAllByText("Change not permitted")).toHaveLength(1);
});
