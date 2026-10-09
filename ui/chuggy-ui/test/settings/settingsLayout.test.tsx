/**
 * The settings' frame over the routes the console registers for it: each
 * bare address replaced by its first page, a group a level with every link in
 * the frame it is drawn in, the page's own link the current one, the site's
 * group holding only the pages the reader's site abilities give them, and a
 * workspace's page reading the workspace its address names in either frame.
 * The frame outside a project hands a page the clipboard, as the shell does
 * inside one.
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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
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
  press,
  scriptedFetch,
  settled,
  turned,
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
  siteAbilitiesNone,
  siteAbilitiesPath,
  siteAuthoritiesPath,
  siteAuthoritiesStarting,
  tenantAuthoritiesPath,
} from "./permissionsFixture.tsx";
import {
  siteWorkspacesPath,
  workspacesListed,
} from "./siteWorkspacesFixture.tsx";
import {
  abilitiesPath,
  linksPath,
  peopleAbilitiesAll,
  peopleListed,
  peoplePath,
} from "./tenantPeopleFixture.tsx";

const copied = vi.hoisted((): string[] => []);

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  clipboardWritten: (text: string) => {
    copied.push(text);
    return Promise.resolve(true);
  },
}));

/** The router restores a scroll position on every load, and jsdom scrolls nothing. */
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => undefined);
});

afterEach(() => {
  cleanup();
  copied.length = 0;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

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
  {
    bare: "/acme/atlas/settings/workspace",
    first: "/acme/atlas/settings/workspace/people",
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
  { address: "/acme/atlas/settings/site/workspaces", group: "Site" },
  { address: "/acme/atlas/settings/site/permissions", group: "Site" },
  { address: "/tenants/acme/settings/people", group: "Workspace acme" },
  { address: "/tenants/acme/settings/accounts", group: "Workspace acme" },
  { address: "/tenants/acme/settings/permissions", group: "Workspace acme" },
  { address: "/tenants/acme/settings/site/workspaces", group: "Site" },
  { address: "/tenants/acme/settings/site/permissions", group: "Site" },
])(
  "at $address the page's own link in $group is the current one and no other is",
  async ({ address, group }) => {
    await drawnSettings(
      address,
      siteAbilitiesAnswered({
        ...siteAbilitiesNone,
        administer: true,
        createTenant: true,
      }),
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

/** The site's group as one frame draws it, a link a page in the order given. */
function siteGroup(
  frame: string,
  pages: readonly string[],
): readonly [string, readonly string[]] {
  return [
    "Site",
    pages.map((page) => `${page} ${frame}/site/${page.toLowerCase()}`),
  ];
}

test.each([
  { held: { administer: true }, pages: ["Permissions"] },
  { held: { manageAuthorities: true }, pages: ["Permissions"] },
  { held: { createTenant: true }, pages: ["Workspaces"] },
  {
    held: { createTenant: true, manageAuthorities: true },
    pages: ["Workspaces", "Permissions"],
  },
])(
  "a reader whose site abilities say $held is drawn the site's group last with $pages alone, in either frame",
  async ({ held, pages }) => {
    const answered = siteAbilitiesAnswered({ ...siteAbilitiesNone, ...held });
    await drawnSettings("/acme/atlas/settings/permissions", answered);
    expect(groupsDrawn()).toStrictEqual([
      ...projectGroups,
      siteGroup("/acme/atlas/settings", pages),
    ]);
    cleanup();
    await drawnSettings("/tenants/acme/settings/permissions", answered);
    expect(groupsDrawn()).toStrictEqual([
      ...workspaceGroups,
      siteGroup("/tenants/acme/settings", pages),
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

test.each([
  { address: "/acme/atlas/settings/site/workspaces" },
  { address: "/tenants/acme/settings/site/workspaces" },
])(
  "the page at $address is the site's workspaces, its list and its action drawn to a reader who may make one",
  async ({ address }) => {
    await drawnSettings(address, (request) => {
      if (request.url === siteAbilitiesPath)
        return answer({ ...siteAbilitiesNone, createTenant: true });
      return request.url === siteWorkspacesPath
        ? answer(workspacesListed)
        : undefined;
    });
    expect(
      screen.getByRole("heading", { level: 1, name: "Workspaces" }),
    ).toBeTruthy();
    expect(screen.getByRole("table", { name: "Workspaces" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New workspace" })).toBeTruthy();
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
  await opened("Site", "Create accounts");
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

test("a link made on a workspace's People page outside a project is drawn with the control that copies its address", async () => {
  await drawnSettings("/tenants/acme/settings/people", (request) => {
    if (request.url === linksPath)
      return request.method === "POST"
        ? answer(
            {
              link: "l-new",
              token: "t0ken",
              expiresAtMs: 1,
              newAccounts: true,
            },
            201,
          )
        : answer({ links: [] });
    if (request.url === peoplePath) return answer(peopleListed);
    if (request.url === abilitiesPath) return answer(peopleAbilitiesAll());
    return undefined;
  });
  await press("Invite");
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Link" }));
  });
  await press("Create link");
  await press("Copy link");
  expect(copied).toStrictEqual([`${location.origin}/invite#t0ken`]);
  expect(screen.getByRole("status").textContent).toBe("Copied");
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
