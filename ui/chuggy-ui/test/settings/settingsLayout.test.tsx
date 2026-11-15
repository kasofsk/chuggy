/**
 * The settings' frame over the routes the console registers for it: each
 * bare address the index of its sections where the frame is narrow and
 * replaced by its first page where it is wide, a section under a link back to
 * that index, a group a level and a headed list, with every link in the frame
 * it is drawn in, the page's own link the current one, the site's
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
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderCopied } from "../copied.tsx";
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
import { ConsoleStoreProvided } from "../consoleStoreProvided.tsx";
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
  siteWorkspaceLinksPath,
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
import { readFailedLines } from "../readFailedLines.ts";
import { resizeObserverStubbed } from "../resizeObserver.ts";
import { viewportDeskEm, viewportEmPixels } from "../viewportSizes.ts";
import { copyTextEn } from "../../app/copy/catalog.ts";
import { settingsNav } from "../../app/core/settingsNav.ts";

const copied = vi.hoisted((): string[] => []);

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  clipboardWritten: (text: string) => {
    copied.push(text);
    return Promise.resolve(true);
  },
}));

/** A phone's width, narrower than the settings' two columns. */
const settingsPhoneEm = 22.5;

/** The settings' frame as wide as `em`, which is what the element that fills
 * the width measures; jsdom lays out nothing, so every other measures none. */
function settingsFrameAtEm(em: number): void {
  document.documentElement.style.fontSize = `${String(viewportEmPixels)}px`;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element): DOMRect {
      const width = this.hasAttribute("data-fills-width")
        ? em * viewportEmPixels
        : 0;
      const box = { x: 0, y: 0, left: 0, top: 0, width, height: 0 };
      return {
        ...box,
        right: width,
        bottom: 0,
        toJSON: () => box,
      };
    },
  );
}

/** The router restores a scroll position on every load, and jsdom scrolls
 * nothing. A case is at the desk unless it says otherwise. */
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => undefined);
  resizeObserverStubbed();
  settingsFrameAtEm(viewportDeskEm);
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
  address: string | readonly string[],
  answered: (request: SentRequest) => Response | undefined = () => undefined,
): Promise<{
  readonly sent: readonly SentRequest[];
  readonly router: ReturnType<typeof settingsRouter>;
}> {
  const scripted = scriptedFetch(
    (request) =>
      answered(request) ??
      (request.url.startsWith("/api/v1/projects")
        ? answer({ projects: [] })
        : answer({}, 404)),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const router = settingsRouter(
    typeof address === "string" ? [address] : address,
  );
  await router.load();
  renderCopied(
    <SessionProvider holder={holderDouble()}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ConsoleStoreProvided>
          <RouterProvider router={router} />
        </ConsoleStoreProvided>
      </QueryClientProvider>
    </SessionProvider>,
  );
  await settled();
  return { sent: scripted.sent, router };
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
    "Project atlas-web",
    [
      "Lead /acme-co/atlas-web/settings/lead",
      "Lead session /acme-co/atlas-web/settings/lead-session",
      "Placement /acme-co/atlas-web/settings/placement",
      "Permissions /acme-co/atlas-web/settings/permissions",
      "Repositories /acme-co/atlas-web/settings/repositories",
      "Runners /acme-co/atlas-web/settings/runners",
      "Catalog /acme-co/atlas-web/settings/catalog",
    ],
  ],
  [
    "Workspace acme-co",
    [
      "People /acme-co/atlas-web/settings/workspace/people",
      "GitHub accounts /acme-co/atlas-web/settings/workspace/accounts",
      "Permissions /acme-co/atlas-web/settings/workspace/permissions",
      "Usage /acme-co/atlas-web/settings/workspace/usage",
    ],
  ],
];

const projectPersonGroup = [
  "You",
  [
    "Personal runners /acme-co/atlas-web/settings/workspace/runner",
    "Preferences /acme-co/atlas-web/settings/preferences",
  ],
];

const workspaceGroups = [
  [
    "Workspace acme-co",
    [
      "People /tenants/acme-co/settings/people",
      "GitHub accounts /tenants/acme-co/settings/accounts",
      "Permissions /tenants/acme-co/settings/permissions",
      "Usage /tenants/acme-co/settings/usage",
    ],
  ],
];

const workspacePersonGroup = [
  "You",
  [
    "Personal runners /tenants/acme-co/settings/runner",
    "Preferences /tenants/acme-co/settings/preferences",
  ],
];

const settingsRoots = [
  {
    bare: "/acme-co/atlas-web/settings",
    first: "/acme-co/atlas-web/settings/lead",
    project: "atlas-web",
  },
  {
    bare: "/tenants/acme-co/settings",
    first: "/tenants/acme-co/settings/people",
    project: undefined,
  },
] as const;

test.each(settingsRoots)(
  "in a wide frame $bare is replaced by $first, so going back leaves the settings",
  async ({ bare, first }) => {
    const { router } = await drawnSettings(["/elsewhere", bare]);
    expect(router.state.location.pathname).toBe(first);
    expect(router.history.length).toBe(2);
  },
);

test("in a project the workspace's bare address is replaced by its first page, at any width", async () => {
  settingsFrameAtEm(settingsPhoneEm);
  const router = settingsRouter([
    "/elsewhere",
    "/acme-co/atlas-web/settings/workspace",
  ]);
  await router.load();
  expect(router.state.location.pathname).toBe(
    "/acme-co/atlas-web/settings/workspace/people",
  );
  expect(router.history.length).toBe(2);
});

/** Each list the navigation draws, by the heading that names it, and each of
 * its rows as its link's name and the line that describes it. */
function indexDrawn(): readonly (readonly [string, readonly string[]])[] {
  return within(navigation())
    .getAllByRole("list")
    .map((list) => {
      const heading = document.getElementById(
        list.getAttribute("aria-labelledby") ?? "",
      );
      expect(heading?.tagName).toBe("H2");
      return [
        heading?.textContent ?? "",
        within(list)
          .getAllByRole("link")
          .map(
            (link) =>
              `${link.textContent ?? ""}: ${document.getElementById(link.getAttribute("aria-describedby") ?? "")?.textContent ?? ""}`,
          ),
      ];
    });
}

test.each(settingsRoots)(
  "in a narrow frame $bare stays, the index of every section the navigation model gives, under its group's heading with its line, and no section beside it",
  async ({ bare, project }) => {
    settingsFrameAtEm(settingsPhoneEm);
    const { router } = await drawnSettings(["/elsewhere", bare]);
    expect(router.state.location.pathname).toBe(bare);
    const model = settingsNav({
      tenant: "acme-co",
      project,
      site: { workspaces: false, permissions: false },
    });
    expect(indexDrawn()).toStrictEqual(
      model.map((group) => [
        `${copyTextEn(group.label)}${group.name === undefined ? "" : ` ${group.name}`}`,
        group.entries.map(
          (entry) => `${copyTextEn(entry.label)}: ${copyTextEn(entry.summary)}`,
        ),
      ]),
    );
    expect(
      within(navigation())
        .getAllByRole("link")
        .filter((link) => link.hasAttribute("aria-current")),
    ).toStrictEqual([]);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.queryByRole("link", { name: "All settings" })).toBeNull();
  },
);

test.each([
  {
    address: "/acme-co/atlas-web/settings/workspace/usage",
    root: "/acme-co/atlas-web/settings",
  },
  {
    address: "/tenants/acme-co/settings/site/workspaces",
    root: "/tenants/acme-co/settings",
  },
])(
  "the section at $address is drawn under a link back to the index at $root, before its title",
  async ({ address, root }) => {
    settingsFrameAtEm(settingsPhoneEm);
    await drawnSettings(
      address,
      siteAbilitiesAnswered({ ...siteAbilitiesNone, createTenant: true }),
    );
    const back = screen.getByRole("link", { name: "All settings" });
    expect(back.getAttribute("href")).toBe(root);
    expect(navigation().contains(back)).toBe(false);
    const title = screen.getByRole("heading", { level: 1 });
    expect(
      back.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
);

test("in a project the navigation draws the project's group, the workspace's, then the reader's own, every link at its address in the project", async () => {
  await drawnSettings("/acme-co/atlas-web/settings/permissions");
  expect(groupsDrawn()).toStrictEqual([...projectGroups, projectPersonGroup]);
});

test("outside a project the navigation draws the workspace's group and the reader's own, every link at the workspace's own address", async () => {
  await drawnSettings("/tenants/acme-co/settings/permissions");
  expect(groupsDrawn()).toStrictEqual([
    ...workspaceGroups,
    workspacePersonGroup,
  ]);
});

test.each([
  { address: "/acme-co/atlas-web/settings/lead", group: "Project atlas-web" },
  {
    address: "/acme-co/atlas-web/settings/placement",
    group: "Project atlas-web",
  },
  {
    address: "/acme-co/atlas-web/settings/permissions",
    group: "Project atlas-web",
  },
  {
    address: "/acme-co/atlas-web/settings/repositories",
    group: "Project atlas-web",
  },
  {
    address: "/acme-co/atlas-web/settings/runners",
    group: "Project atlas-web",
  },
  {
    address: "/acme-co/atlas-web/settings/catalog",
    group: "Project atlas-web",
  },
  { address: "/acme-co/atlas-web/settings/workspace/runner", group: "You" },
  { address: "/tenants/acme-co/settings/runner", group: "You" },
  {
    address: "/acme-co/atlas-web/settings/workspace/people",
    group: "Workspace acme-co",
  },
  {
    address: "/acme-co/atlas-web/settings/workspace/accounts",
    group: "Workspace acme-co",
  },
  {
    address: "/acme-co/atlas-web/settings/workspace/permissions",
    group: "Workspace acme-co",
  },
  { address: "/acme-co/atlas-web/settings/site/workspaces", group: "Site" },
  { address: "/acme-co/atlas-web/settings/site/permissions", group: "Site" },
  { address: "/tenants/acme-co/settings/people", group: "Workspace acme-co" },
  { address: "/tenants/acme-co/settings/accounts", group: "Workspace acme-co" },
  {
    address: "/tenants/acme-co/settings/permissions",
    group: "Workspace acme-co",
  },
  { address: "/tenants/acme-co/settings/site/workspaces", group: "Site" },
  { address: "/tenants/acme-co/settings/site/permissions", group: "Site" },
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
  "a reader whose site abilities say $held is drawn the site's group before their own with $pages alone, in either frame",
  async ({ held, pages }) => {
    const answered = siteAbilitiesAnswered({ ...siteAbilitiesNone, ...held });
    await drawnSettings("/acme-co/atlas-web/settings/permissions", answered);
    expect(groupsDrawn()).toStrictEqual([
      ...projectGroups,
      siteGroup("/acme-co/atlas-web/settings", pages),
      projectPersonGroup,
    ]);
    cleanup();
    await drawnSettings("/tenants/acme-co/settings/permissions", answered);
    expect(groupsDrawn()).toStrictEqual([
      ...workspaceGroups,
      siteGroup("/tenants/acme-co/settings", pages),
      workspacePersonGroup,
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
      "/acme-co/atlas-web/settings/permissions",
      (request) =>
        request.url === siteAbilitiesPath ? abilities() : undefined,
    );
    expect(readsOf(drawn, siteAbilitiesPath)).toBeGreaterThan(0);
    expect(groupsDrawn()).toStrictEqual([...projectGroups, projectPersonGroup]);
    expect(readFailedLines()).toStrictEqual([]);
  },
);

test.each([
  {
    address: "/acme-co/atlas-web/settings/workspace/people",
    reads: permissionsPeoplePath,
  },
  {
    address: "/acme-co/atlas-web/settings/workspace/accounts",
    reads: "/api/v1/tenants/acme-co/forge-installations",
  },
  {
    address: "/acme-co/atlas-web/settings/workspace/permissions",
    reads: tenantAuthoritiesPath,
  },
  { address: "/tenants/acme-co/settings/people", reads: permissionsPeoplePath },
])(
  "the page at $address reads the workspace its address names",
  async ({ address, reads }) => {
    const drawn = await drawnSettings(address);
    expect(readsOf(drawn, reads)).toBeGreaterThan(0);
  },
);

test.each([
  { address: "/acme-co/atlas-web/settings/site/workspaces" },
  { address: "/tenants/acme-co/settings/site/workspaces" },
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
    "/acme-co/atlas-web/settings/site/permissions",
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
      url: `${siteAuthoritiesPath}/AccountCreators/tenants/acme-co`,
      body: undefined,
    },
  ]);
  expect(readsOf(drawn, siteAbilitiesPath)).toBeGreaterThan(before);
});

/** A links route that keeps none, and answers a link made with a made-up one. */
function linksKept(request: SentRequest): Response {
  return request.method === "POST"
    ? answer(
        { link: "l-new", token: "t0ken", expiresAtMs: 1, newAccounts: true },
        201,
      )
    : answer({ links: [] });
}

/** A link made in the dialog an action opens, and its address copied. */
async function linkCopied(opener: string): Promise<void> {
  await press(opener);
  await turned(() => {
    fireEvent.click(screen.getByRole("radio", { name: "Link" }));
  });
  await press("Create link");
  await press("Copy link");
  expect(copied).toStrictEqual([`${location.origin}/invite#t0ken`]);
  expect(screen.getByRole("status").textContent).toBe("Copied");
}

test("a link made on a workspace's People page outside a project is drawn with the control that copies its address", async () => {
  await drawnSettings("/tenants/acme-co/settings/people", (request) => {
    if (request.url === linksPath) return linksKept(request);
    if (request.url === peoplePath) return answer(peopleListed);
    if (request.url === abilitiesPath) return answer(peopleAbilitiesAll());
    return undefined;
  });
  await linkCopied("Invite");
});

test("a workspace link made on the site's Workspaces page outside a project is drawn with the control that copies its address", async () => {
  await drawnSettings(
    "/tenants/acme-co/settings/site/workspaces",
    (request) => {
      if (request.url === siteWorkspaceLinksPath) return linksKept(request);
      if (request.url === siteWorkspacesPath) return answer(workspacesListed);
      if (request.url === siteAbilitiesPath)
        return answer({ ...siteAbilitiesNone, createTenant: true });
      return undefined;
    },
  );
  await linkCopied("New workspace");
});

/** Inside the shell the settings' own nav names the page, so its title is
 * for a reader who does not see that and no row of the bar says it again. */
test("a page's title is hidden where the shell is around it, and over its sections where it is not", () => {
  renderCopied(
    <ShellSlots>
      <ShellSlotLandmarks>
        <SettingsPage title="People" chips={<span>Five</span>}>
          <p>the sections</p>
        </SettingsPage>
      </ShellSlotLandmarks>
    </ShellSlots>,
  );
  const shelled = within(screen.getByRole("main"));
  expect(
    shelled.getByRole("heading", { level: 1, name: "People" }).className,
  ).toBe("visually-hidden");
  expect(shelled.getByText("Five")).toBeTruthy();
  expect(within(screen.getByRole("banner")).queryByRole("heading")).toBeNull();
  cleanup();
  renderCopied(
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
