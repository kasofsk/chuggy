/**
 * The site's permissions page, mounted: the site's section alone, a row a
 * permission naming its holders, its absent list as one line, a holder
 * removed and `Add` on each permission, the workspace the page was reached
 * through the one whose admins it offers, and every list a change may have
 * moved read again.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { answer, press, sectionOf } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  addButtons,
  added,
  additionsSent,
  choicesOffered,
  chosen,
  drawSitePermissions,
  expectPermissionsReread,
  opened,
  permissionsDrawn,
  permissionsPeopleListed,
  permissionsPeoplePath,
  permissionsTenant,
  readsOf,
  removalsSent,
  removeButtons,
  sectionDrawn,
  siteAuthoritiesHeld,
  siteAuthoritiesPath,
  siteAuthoritiesStarting,
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

/** The reads a change reads again that the page itself holds. */
const siteReads = [siteAuthoritiesPath, permissionsPeoplePath];

test("a site manager sees the site's two permissions and no workspace section, the site's admins always managing its permissions", async () => {
  await drawSitePermissions();
  expect(permissionsDrawn("Site")).toStrictEqual([
    {
      name: "Create accounts",
      holders: ["Site admins", "acme admins", "globex admins"],
    },
    { name: "Change permissions", holders: ["Site admins"] },
  ]);
  expect(sectionDrawn("Workspace")).toBe(false);
});

test("a reader the site's list is absent to sees the one line and no table", async () => {
  await drawSitePermissions({ site: () => answer({}, 404) });
  const section = sectionOf("Site");
  expect(
    within(section).getByText("A site admin manages permissions"),
  ).toBeTruthy();
  expect(within(section).queryByRole("table")).toBeNull();
  expect(screen.queryByText(/^Not available/u)).toBeNull();
});

test("the site's read loading or failed is its unready line, with no table", async () => {
  await drawSitePermissions({ site: unanswered });
  expect(within(sectionOf("Site")).getByText("Loading…")).toBeTruthy();
  cleanup();
  await drawSitePermissions({ site: () => answer({}, 500) });
  const site = sectionOf("Site");
  expect(
    within(site).getByText(
      "Failed to load · the API failed with InternalError",
    ),
  ).toBeTruthy();
  expect(within(site).queryByRole("table")).toBeNull();
});

test("a list cut short says so, and a whole one does not", async () => {
  await drawSitePermissions();
  expect(within(sectionOf("Site")).queryByText("List cut short")).toBeNull();
  cleanup();
  await drawSitePermissions({
    site: () => answer({ ...siteAuthoritiesStarting, truncated: true }),
  });
  expect(within(sectionOf("Site")).getByText("List cut short")).toBeTruthy();
});

test("a site manager may remove the site's holders, but no standing admin or unnamed count, each button's name its own", async () => {
  await drawSitePermissions({ site: () => answer(siteAuthoritiesHeld) });
  const names = removeButtons("Site");
  expect(names).toStrictEqual([
    "Remove Site admins from Create accounts",
    "Remove acme admins from Create accounts",
    "Remove globex admins from Create accounts",
    "Remove ada@example.com from Change permissions",
  ]);
  expect(new Set(names).size).toBe(names.length);
});

test.each([
  {
    holder: "Remove ada@example.com from Change permissions",
    path: `${siteAuthoritiesPath}/AuthorityManagers/people/s-ada`,
    confirmed: true,
  },
  {
    holder: "Remove acme admins from Create accounts",
    path: `${siteAuthoritiesPath}/AccountCreators/tenants/${permissionsTenant}`,
  },
  {
    holder: "Remove Site admins from Create accounts",
    path: `${siteAuthoritiesPath}/AccountCreators/groups/SiteAdmins`,
  },
])(
  "$holder sends its route with no body, then reads both lists, the abilities and the people again",
  async ({ holder, path, confirmed }) => {
    const drawn = await drawSitePermissions({
      site: () => answer(siteAuthoritiesHeld),
    });
    const before = siteReads.map((read) => readsOf(drawn, read));
    const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    await press(holder);
    if (confirmed === true) await press("Remove");
    expect(removalsSent(drawn)).toStrictEqual([
      { method: "DELETE", url: path, body: undefined },
    ]);
    expect(
      siteReads.map(
        (read, index) => readsOf(drawn, read) > (before[index] ?? 0),
      ),
    ).toStrictEqual([true, true]);
    expectPermissionsReread(invalidated);
  },
);

test("a site manager may add to each of the site's permissions", async () => {
  await drawSitePermissions();
  expect(addButtons("Site")).toStrictEqual([
    "Add to Create accounts",
    "Add to Change permissions",
  ]);
});

test("This workspace's admins is offered on Create accounts only where they do not hold it, and Change permissions offers a person alone", async () => {
  await drawSitePermissions({ people: () => answer(permissionsPeopleListed) });
  await opened("Site", "Create accounts");
  expect(choicesOffered()).toStrictEqual(["Person"]);
  await press("Close");
  await opened("Site", "Change permissions");
  expect(choicesOffered()).toStrictEqual(["Person"]);
  cleanup();
  const drawn = await drawSitePermissions({
    people: () => answer(permissionsPeopleListed),
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
  await opened("Site", "Create accounts");
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
  await opened("Site", "Change permissions");
  expect(choicesOffered()).toStrictEqual(["Person"]);
});

test("sent, the dialog closes and both lists, the abilities and the People list are read again", async () => {
  const drawn = await drawSitePermissions({
    people: () => answer(permissionsPeopleListed),
    site: () => answer(siteAuthoritiesHeld),
  });
  const before = siteReads.map((read) => readsOf(drawn, read));
  const invalidated = vi.spyOn(QueryClient.prototype, "invalidateQueries");
  await opened("Site", "Create accounts");
  await chosen("Person");
  await press("Choose ada@example.com");
  await added();
  expect(screen.queryByRole("dialog", { name: "Add holder" })).toBeNull();
  expect(
    siteReads.map((read, index) => readsOf(drawn, read) > (before[index] ?? 0)),
  ).toStrictEqual([true, true]);
  expectPermissionsReread(invalidated);
});
