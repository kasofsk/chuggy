/**
 * The workspace's permissions page, mounted: a section a level, a row a
 * permission naming its holders, the workspace's absent list as one line, the
 * site's drawn only where it was answered or failed, and a holder removed where
 * the reader may change its permission.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { tenantPeopleResource } from "../../app/browser/settings/tenantPeopleResource.ts";
import { tenantResourceKey } from "../../app/core/projectQueryKeys.ts";
import { answer, press, sectionOf } from "../screenHarness.tsx";
import type { DrawnStrict } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  drawPermissions,
  permissionCell,
  permissionsAbilitiesNone,
  permissionsAbilitiesPath,
  permissionsAbilitiesSite,
  permissionsAbilitiesTenant,
  permissionsDrawn,
  permissionsTenant,
  readsOf,
  removalsSent,
  removeButtons,
  sectionDrawn,
  siteAuthoritiesPath,
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

test("a site manager sees both sections, the site's admins always managing the site's permissions", async () => {
  await drawPermissions({ site: () => answer(siteAuthoritiesStarting) });
  expect(sectionDrawn("Workspace")).toBe(true);
  expect(permissionsDrawn("Site")).toStrictEqual([
    {
      name: "Account creation",
      holders: ["Site admins", "acme admins", "globex admins"],
    },
    { name: "Permission changes", holders: ["Site admins"] },
  ]);
});

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

test("the site's read draws nothing loading or absent, and its section with the unready line failed", async () => {
  await drawPermissions({ site: unanswered });
  expect(sectionDrawn("Site")).toBe(false);
  cleanup();
  await drawPermissions({ site: () => answer({}, 404) });
  expect(sectionDrawn("Site")).toBe(false);
  cleanup();
  await drawPermissions({ site: () => answer({}, 500) });
  const site = sectionOf("Site");
  expect(
    within(site).getByText(
      "Failed to load · the API failed with InternalError",
    ),
  ).toBeTruthy();
  expect(within(site).queryByRole("table")).toBeNull();
});

test("a list cut short says so, and a whole one does not", async () => {
  await drawPermissions({
    tenant: () => answer({ ...tenantAuthoritiesStarting, truncated: true }),
    site: () => answer(siteAuthoritiesStarting),
  });
  expect(
    within(sectionOf("Workspace")).getByText("List cut short"),
  ).toBeTruthy();
  expect(within(sectionOf("Site")).queryByText("List cut short")).toBeNull();
});

const ada = {
  subject: "s-ada",
  mine: false,
  account: true,
  email: "ada@example.com",
};

/** The site's permission changes held by a workspace's admins, a person and
 * two holders the list does not name, beside its standing admins. */
const siteAuthoritiesHeld = {
  ...siteAuthoritiesStarting,
  authorities: [
    siteAuthoritiesStarting.authorities[0],
    {
      authority: "AuthorityManagers",
      people: [ada],
      groups: [],
      tenants: [permissionsTenant],
      unnamed: 2,
    },
  ],
};

/** The reads a removal reads again that the page itself observes. */
const permissionsReads = [
  tenantAuthoritiesPath,
  siteAuthoritiesPath,
  permissionsAbilitiesPath,
];

function drawManaging(
  abilities = permissionsAbilitiesTenant,
  removed?: () => Response,
): Promise<DrawnStrict> {
  return drawPermissions({
    abilities: () => answer(abilities),
    site: () => answer(siteAuthoritiesHeld),
    ...(removed === undefined ? {} : { removed }),
  });
}

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

test("a site manager may remove hosted run grants' holders and the site's, but no standing admin, unnamed count or workspace's permission managers", async () => {
  await drawManaging(permissionsAbilitiesSite);
  expect(removeButtons("Workspace")).toStrictEqual([
    "Remove Site admins from Hosted run grants",
  ]);
  expect(removeButtons("Site")).toStrictEqual([
    "Remove Site admins from Account creation",
    "Remove acme admins from Account creation",
    "Remove globex admins from Account creation",
    "Remove ada@example.com from Permission changes",
  ]);
});

test("a reader whose abilities are not read, or who may manage nothing, may remove nothing in the workspace", async () => {
  await drawPermissions();
  expect(removeButtons("Workspace")).toStrictEqual([]);
  cleanup();
  await drawPermissions({ abilities: () => answer(permissionsAbilitiesNone) });
  expect(removeButtons("Workspace")).toStrictEqual([]);
});

test("each remove button's name is its own within its section", async () => {
  await drawManaging({
    ...permissionsAbilitiesTenant,
    manageSiteHeldAuthorities: true,
  });
  for (const title of ["Workspace", "Site"]) {
    const names = removeButtons(title);
    expect(new Set(names).size).toBe(names.length);
  }
});

test.each([
  {
    holder: "Remove Workspace admins from Admin grants",
    path: `${tenantAuthoritiesPath}/AdminGranters/groups/TenantAdmins`,
  },
  {
    holder: "Remove ada@example.com from Permission changes",
    path: `${siteAuthoritiesPath}/AuthorityManagers/people/s-ada`,
    confirmed: true,
  },
  {
    holder: "Remove acme admins from Account creation",
    path: `${siteAuthoritiesPath}/AccountCreators/tenants/${permissionsTenant}`,
  },
  {
    holder: "Remove Site admins from Account creation",
    path: `${siteAuthoritiesPath}/AccountCreators/groups/SiteAdmins`,
  },
])(
  "$holder sends its route with no body, then reads both lists, the abilities and the people again",
  async ({ holder, path, confirmed }) => {
    const drawn = await drawManaging();
    const before = permissionsReads.map((read) => readsOf(drawn, read));
    const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    await press(holder);
    if (confirmed === true) await press("Remove");
    expect(removalsSent(drawn)).toStrictEqual([
      { method: "DELETE", url: path, body: undefined },
    ]);
    expect(
      permissionsReads.map(
        (read, index) => readsOf(drawn, read) > (before[index] ?? 0),
      ),
    ).toStrictEqual([true, true, true]);
    expect(invalidated).toHaveBeenCalledWith({
      queryKey: tenantResourceKey(permissionsTenant, tenantPeopleResource),
    });
  },
);

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
