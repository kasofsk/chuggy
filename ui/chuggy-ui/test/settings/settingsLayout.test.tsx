/**
 * The settings' frame over the routes the console registers for it: each
 * bare address replaced by its first page, a group a level with every link in
 * the frame it is drawn in, the page's own link the current one, the site's
 * group only for a reader who manages the site, and a workspace's page reading
 * the workspace its address names in either frame.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  useParams,
} from "@tanstack/react-router";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import type { AccessSiteAbilities } from "../../../../src/contract/accessPlane.ts";
import { SessionProvider } from "../../app/browser/session.tsx";
import {
  projectSettingsRoutes,
  workspaceSettingsRoutes,
} from "../../app/browser/settings/settingsRoutes.tsx";
import { SettingsPage } from "../../app/browser/settings/SettingsPage.tsx";
import {
  ShellSlots,
  useShellSlotHolder,
} from "../../app/browser/shell/slots.tsx";
import { ProjectStreamProvider } from "../../app/browser/stream.tsx";
import {
  answer,
  holderDouble,
  openedStream,
  scriptedFetch,
  settled,
} from "../screenHarness.tsx";
import type { SentRequest } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import {
  added,
  additionsSent,
  chosen,
  opened,
  permissionsPeopleListed,
  permissionsPeoplePath,
  readsOf,
  siteAuthoritiesPath,
  siteAuthoritiesStarting,
  tenantAuthoritiesPath,
} from "./permissionsFixture.tsx";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

/** The router restores a scroll position on every load, and jsdom scrolls nothing. */
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const siteAbilitiesPath = "/access/v1/site/abilities";

const siteAbilitiesNone: AccessSiteAbilities = {
  administer: false,
  createAccount: false,
  manageAuthorities: false,
};

/** The shell's two slots under landmarks, so a case can say where a title landed. */
function ShellSlotLandmarks(props: {
  readonly children: ReactNode;
}): ReactNode {
  const holdTopBar = useShellSlotHolder("topBar");
  const holdDetails = useShellSlotHolder("details");
  return (
    <>
      <header ref={holdTopBar} />
      <div ref={holdDetails} />
      <main>{props.children}</main>
    </>
  );
}

function ProjectFrame(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  return (
    <ProjectStreamProvider
      partition={partition}
      transport={openedStream().ports.fetch}
    >
      <ShellSlots>
        <ShellSlotLandmarks>
          <Outlet />
        </ShellSlotLandmarks>
      </ShellSlots>
    </ProjectStreamProvider>
  );
}

/** The console's settings routes, hung as the console hangs them, at the last of the addresses given. */
function settingsRouter(visited: readonly string[]) {
  const root = createRootRoute({ component: Outlet });
  const partition = createRoute({
    getParentRoute: () => root,
    path: "/$tenant/$project",
    component: ProjectFrame,
  });
  return createRouter({
    history: createMemoryHistory({ initialEntries: [...visited] }),
    routeTree: root.addChildren([
      workspaceSettingsRoutes(root),
      partition.addChildren([projectSettingsRoutes(partition)]),
    ]),
  });
}

/** Every read is absent but the ones a case answers and the bar's own of the projects, which is what a reader with no standing is answered. */
async function drawnSettings(
  address: string,
  answered: (request: SentRequest) => Response | undefined = () => undefined,
): Promise<{ readonly sent: readonly SentRequest[] }> {
  const scripted = scriptedFetch(
    (request) =>
      answered(request) ??
      (request.url.startsWith("/api/v1/projects")
        ? answer({ projects: [] })
        : answer({}, 404)),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const router = settingsRouter([address]);
  await router.load();
  render(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </SessionProvider>,
  );
  await settled();
  return { sent: scripted.sent };
}

function siteAbilitiesAnswered(
  abilities: AccessSiteAbilities,
): (request: SentRequest) => Response | undefined {
  return (request) =>
    request.url === siteAbilitiesPath ? answer(abilities) : undefined;
}

function navigation(): HTMLElement {
  return screen.getByRole("navigation", { name: "Settings" });
}

/** Each group the navigation draws, by its name, and where each of its links leads. */
function groupsDrawn(): readonly (readonly [string, readonly string[]])[] {
  return within(navigation())
    .getAllByRole("group")
    .map((group) => [
      document.getElementById(group.getAttribute("aria-labelledby") ?? "")
        ?.textContent ?? "",
      within(group)
        .getAllByRole("link")
        .map(
          (link) => `${link.textContent} ${link.getAttribute("href") ?? ""}`,
        ),
    ]);
}

const projectGroups = [
  [
    "Project atlas",
    [
      "Lead /acme/atlas/settings/lead",
      "Placement /acme/atlas/settings/placement",
      "Permissions /acme/atlas/settings/permissions",
    ],
  ],
  [
    "Workspace acme",
    [
      "People /acme/atlas/settings/workspace/people",
      "Accounts /acme/atlas/settings/workspace/accounts",
      "Permissions /acme/atlas/settings/workspace/permissions",
    ],
  ],
];

const workspaceGroups = [
  [
    "Workspace acme",
    [
      "People /tenants/acme/settings/people",
      "Accounts /tenants/acme/settings/accounts",
      "Permissions /tenants/acme/settings/permissions",
    ],
  ],
];

test.each([
  {
    bare: "/acme/atlas/settings",
    first: "/acme/atlas/settings/lead",
  },
  {
    bare: "/tenants/acme/settings",
    first: "/tenants/acme/settings/people",
  },
])(
  "$bare is replaced by $first, so going back leaves the settings",
  async ({ bare, first }) => {
    const router = settingsRouter(["/elsewhere", bare]);
    await router.load();
    expect(router.state.location.pathname).toBe(first);
    expect(router.history.length).toBe(2);
  },
);

test("in a project the navigation draws the project's group then the workspace's, every link at its address in the project", async () => {
  await drawnSettings("/acme/atlas/settings/permissions");
  expect(groupsDrawn()).toStrictEqual(projectGroups);
});

test("outside a project the navigation draws the workspace's group alone, every link at the workspace's own address", async () => {
  await drawnSettings("/tenants/acme/settings/permissions");
  expect(groupsDrawn()).toStrictEqual(workspaceGroups);
});

test.each([
  { address: "/acme/atlas/settings/lead", group: "Project atlas" },
  { address: "/acme/atlas/settings/placement", group: "Project atlas" },
  { address: "/acme/atlas/settings/permissions", group: "Project atlas" },
  {
    address: "/acme/atlas/settings/workspace/people",
    group: "Workspace acme",
  },
  {
    address: "/acme/atlas/settings/workspace/accounts",
    group: "Workspace acme",
  },
  {
    address: "/acme/atlas/settings/workspace/permissions",
    group: "Workspace acme",
  },
  { address: "/acme/atlas/settings/site/permissions", group: "Site" },
  { address: "/tenants/acme/settings/people", group: "Workspace acme" },
  { address: "/tenants/acme/settings/accounts", group: "Workspace acme" },
  { address: "/tenants/acme/settings/permissions", group: "Workspace acme" },
  { address: "/tenants/acme/settings/site/permissions", group: "Site" },
])(
  "at $address the page's own link in $group is the current one and no other is",
  async ({ address, group }) => {
    await drawnSettings(
      address,
      siteAbilitiesAnswered({ ...siteAbilitiesNone, administer: true }),
    );
    const current = within(navigation())
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "page");
    expect(current.map((link) => link.getAttribute("href"))).toStrictEqual([
      address,
    ]);
    expect(
      within(screen.getByRole("group", { name: group })).getAllByRole("link"),
    ).toContain(current[0]);
  },
);

test.each([
  { ability: "administer" as const },
  { ability: "manageAuthorities" as const },
])(
  "a reader whose site abilities say $ability is drawn the site's group last, in either frame",
  async ({ ability }) => {
    const answered = siteAbilitiesAnswered({
      ...siteAbilitiesNone,
      [ability]: true,
    });
    await drawnSettings("/acme/atlas/settings/permissions", answered);
    expect(groupsDrawn()).toStrictEqual([
      ...projectGroups,
      ["Site", ["Permissions /acme/atlas/settings/site/permissions"]],
    ]);
    cleanup();
    await drawnSettings("/tenants/acme/settings/permissions", answered);
    expect(groupsDrawn()).toStrictEqual([
      ...workspaceGroups,
      ["Site", ["Permissions /tenants/acme/settings/site/permissions"]],
    ]);
  },
);

test.each([
  {
    answered: "neither ability",
    abilities: () => answer({ ...siteAbilitiesNone, createAccount: true }),
  },
  { answered: "nothing", abilities: () => answer({}, 404) },
  { answered: "a failure", abilities: () => answer({}, 500) },
])(
  "site abilities answering $answered draw no site group and no fault",
  async ({ abilities }) => {
    const drawn = await drawnSettings(
      "/acme/atlas/settings/permissions",
      (request) =>
        request.url === siteAbilitiesPath ? abilities() : undefined,
    );
    expect(readsOf(drawn, siteAbilitiesPath)).toBeGreaterThan(0);
    expect(groupsDrawn()).toStrictEqual(projectGroups);
    expect(screen.queryByText(/^Failed to load/u)).toBeNull();
  },
);

test.each([
  {
    address: "/acme/atlas/settings/workspace/people",
    reads: permissionsPeoplePath,
  },
  {
    address: "/acme/atlas/settings/workspace/accounts",
    reads: "/api/v1/tenants/acme/forge-installations",
  },
  {
    address: "/acme/atlas/settings/workspace/permissions",
    reads: tenantAuthoritiesPath,
  },
  { address: "/tenants/acme/settings/people", reads: permissionsPeoplePath },
])(
  "the page at $address reads the workspace its address names",
  async ({ address, reads }) => {
    const drawn = await drawnSettings(address);
    expect(readsOf(drawn, reads)).toBeGreaterThan(0);
  },
);

test("the site's page in a project offers the address's workspace, sends it, and reads the site's abilities again", async () => {
  const drawn = await drawnSettings(
    "/acme/atlas/settings/site/permissions",
    (request) => {
      if (request.method === "POST") return new Response(null, { status: 204 });
      if (request.url === siteAbilitiesPath)
        return answer({ ...siteAbilitiesNone, manageAuthorities: true });
      if (request.url === permissionsPeoplePath)
        return answer(permissionsPeopleListed);
      if (request.url === siteAuthoritiesPath)
        return answer({
          ...siteAuthoritiesStarting,
          authorities: siteAuthoritiesStarting.authorities.map((held) => ({
            ...held,
            tenants: [],
          })),
        });
      return undefined;
    },
  );
  const before = readsOf(drawn, siteAbilitiesPath);
  await opened("Site", "Account creation");
  await chosen("This workspace's admins");
  await added();
  expect(additionsSent(drawn)).toStrictEqual([
    {
      method: "POST",
      url: `${siteAuthoritiesPath}/AccountCreators/tenants/acme`,
      body: undefined,
    },
  ]);
  expect(readsOf(drawn, siteAbilitiesPath)).toBeGreaterThan(before);
});

test("a page's title is drawn in the top bar where the shell is around it, and over its sections where it is not", () => {
  render(
    <ShellSlots>
      <ShellSlotLandmarks>
        <SettingsPage title="People" chips={<span>Five</span>}>
          <p>the sections</p>
        </SettingsPage>
      </ShellSlotLandmarks>
    </ShellSlots>,
  );
  const bar = within(screen.getByRole("banner"));
  expect(bar.getByRole("heading", { level: 1, name: "People" })).toBeTruthy();
  expect(bar.getByText("Five")).toBeTruthy();
  expect(within(screen.getByRole("main")).queryByRole("heading")).toBeNull();
  cleanup();
  render(
    <main>
      <SettingsPage title="People" chips={<span>Five</span>}>
        <p>the sections</p>
      </SettingsPage>
    </main>,
  );
  const page = within(screen.getByRole("main"));
  expect(page.getByRole("heading", { level: 1, name: "People" })).toBeTruthy();
  expect(page.getByText("Five")).toBeTruthy();
});
