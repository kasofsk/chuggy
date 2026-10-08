/**
 * The workspace's permissions page, mounted: a section a level, a row a
 * permission naming its holders, the workspace's absent list as one line, and
 * the site's drawn only where it was answered or failed.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { answer, sectionOf } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  drawPermissions,
  permissionCell,
  permissionsDrawn,
  permissionsTenant,
  sectionDrawn,
  siteAuthoritiesStarting,
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
