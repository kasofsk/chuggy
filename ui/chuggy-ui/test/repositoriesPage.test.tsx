/**
 * The repositories page: the accounts a tenant has connected, the repositories
 * the project binds, and the picker that adds one.
 *
 * THE PICKER'S TRAFFIC IS THE CASE WITH TEETH. A bind is keyed by an operation
 * identity the route refuses a request without, and it names the address the
 * forge listing gave — not the name a row draws — so what is asserted is the
 * request rather than the row.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { QueryClient } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { RepositoriesPage } from "../app/browser/RepositoriesPage.tsx";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import { forgeAuthorizeTransactionKey } from "../app/core/forgeAuthorization.ts";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const redirects = vi.hoisted((): string[] => []);

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  redirect: (url: string) => {
    redirects.push(url);
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to ?? "/"}>{props.children}</a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  redirects.length = 0;
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  history.pushState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const installations = {
  truncated: false,
  installations: [
    {
      forge: "github",
      app: "portal",
      account: "kasofsk",
      accountKind: "Organization",
      installationId: "11",
      claimedAt: "2026-09-11T00:00:00Z",
    },
    {
      forge: "github",
      app: "worker",
      account: "kasofsk",
      accountKind: "Organization",
      installationId: "12",
      claimedAt: "2026-09-11T00:00:01Z",
    },
    {
      forge: "github",
      app: "portal",
      account: "gdoteof",
      accountKind: "User",
      installationId: "13",
      claimedAt: "2026-09-11T00:00:02Z",
    },
  ],
};

/** The same tenant with one of the two apps installed nowhere at all. */
function without(app: string): typeof installations {
  return {
    truncated: false,
    installations: installations.installations.filter(
      (claim) => claim.app !== app,
    ),
  };
}

/** A second account holding both apps, which is what makes the create dialog's
 * account a choice rather than the only row. */
const twoAccounts: typeof installations = {
  truncated: false,
  installations: [
    ...installations.installations,
    {
      forge: "github",
      app: "worker",
      account: "gdoteof",
      accountKind: "User",
      installationId: "14",
      claimedAt: "2026-09-11T00:00:03Z",
    },
  ],
};

/** The client this deployment answers for authorizing the portal app. */
const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

/** Both apps this deployment holds, each with the address it is installed from. */
const forgeApps = [
  {
    app: "portal",
    id: "1",
    slug: "chuggy-portal",
    installUrl: "https://forge.test/apps/chuggy-portal/installations/new",
  },
  {
    app: "worker",
    id: "2",
    slug: "chuggy-worker",
    installUrl: "https://forge.test/apps/chuggy-worker/installations/new",
  },
];

const boundUrl = "https://forge.test/kasofsk/chuggy";
const freeUrl = "https://forge.test/gdoteof/scratch";

const bindings = {
  repositories: [
    {
      repository: boundUrl,
      boundAt: "2026-09-11T00:00:00Z",
      landing: { mode: "Push" },
      configured: true,
    },
  ],
};

/** What each portal installation grants, which is disjoint: a repository is
 * under one account, and one account is one installation of one app. */
const granted: Readonly<Record<string, unknown>> = {
  "11": {
    truncated: true,
    repositories: [
      {
        name: "chuggy",
        fullName: "kasofsk/chuggy",
        url: boundUrl,
        defaultBranch: "main",
        private: true,
      },
    ],
  },
  "13": {
    truncated: false,
    repositories: [
      {
        name: "scratch",
        fullName: "gdoteof/scratch",
        url: freeUrl,
        defaultBranch: "main",
        private: false,
      },
    ],
  },
};

function grantedBy(url: string): unknown {
  const found = Object.entries(granted).find(([id]) =>
    url.includes(`/forge-installations/${id}/`),
  );
  return found?.[1] ?? { truncated: false, repositories: [] };
}

interface Sent {
  readonly method: string;
  readonly url: string;
  readonly key: string | undefined;
  readonly body: unknown;
}

interface Init {
  readonly method?: string;
  readonly body?: string;
  readonly headers?: Record<string, string>;
}

/** What a write is answered with, the deferral being what a case that is about
 * the read rather than the write wants back. */
const deferred = (): Response => answer({}, 503);

interface Drawing {
  /** The claims the tenant holds, which decide what either dialog offers. */
  readonly claimed?: typeof installations;
  /** What a write answers with. */
  readonly posted?: (url: string) => Response;
  /** What one installation's own listing answers with. */
  readonly granting?: (url: string) => Response;
  /** The bindings this project holds, where a case is about how one is drawn. */
  readonly bound?: unknown;
  /** What this deployment answers about its apps. */
  readonly described?: unknown;
}

async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  const claimed = drawing.claimed ?? installations;
  const posted = drawing.posted ?? deferred;
  const granting = drawing.granting ?? ((url) => answer(grantedBy(url)));
  const bound: unknown = drawing.bound ?? bindings;
  const described: unknown = drawing.described ?? { apps: [] };
  const sent: Sent[] = [];
  const fetching = ((url: string, init?: Init) => {
    sent.push({
      method: init?.method ?? "GET",
      url,
      key: init?.headers?.["idempotency-key"],
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    if (init?.method === "POST" || init?.method === "PUT")
      return Promise.resolve(posted(url));
    if (url.endsWith("/forge/github"))
      return Promise.resolve(answer(described));
    if (url.includes("/forge-installations/"))
      return Promise.resolve(granting(url));
    if (url.includes("/forge-installations"))
      return Promise.resolve(answer(claimed));
    return Promise.resolve(answer(bound));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", fetching);
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <RepositoriesPage />
    </ScreenHarness>,
  );
  await settled();
  return sent;
}

function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

/** The picker opened and the one repository this project does not bind chosen. */
async function chooseFree(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "gdoteof/scratch" }));
  await settled();
}

/** The key the page's own bindings are cached under, written out rather than
 * built, because what a case holds is the key the page reads under. */
const bindingsKey = [
  "project",
  leadPartition.tenant,
  leadPartition.project,
  "Project",
  "project-repositories",
];

/**
 * The keys a write stales, watched from after the draw so the reads the draw
 * itself settles are not among them. The real invalidation is replaced rather
 * than observed, a refetch being nothing the cases that watch this assert on.
 */
function invalidationsAfterDraw(): readonly unknown[] {
  const raised: unknown[] = [];
  vi.spyOn(QueryClient.prototype, "invalidateQueries").mockImplementation(
    (filters?: { readonly queryKey?: unknown }) => {
      raised.push(filters?.queryKey);
      return Promise.resolve();
    },
  );
  return raised;
}

test("an account is one row saying which of the two apps it holds", async () => {
  await drawPage();
  const accounts = sectionOf("Accounts");
  const rows = within(accounts).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toStrictEqual([
    "AccountKindPortalWorker",
    "kasofskOrganizationInstalledInstalled",
    "gdoteofUserInstalledMissing",
  ]);
});

/** Where the page is drawn, which every install it offers must come back to. */
const projectPath = `/${leadPartition.tenant}/${leadPartition.project}/repositories`;

/** The install a followed link stored, which the setup landing matches. */
function storedInstall(): unknown {
  return JSON.parse(sessionStorage.getItem(forgeInstallTransactionKey) ?? "{}");
}

/** The page drawn at its own address with both apps held. */
async function drawAtProject(claimed?: typeof installations): Promise<void> {
  history.pushState({}, "", projectPath);
  await drawPage({
    ...(claimed === undefined ? {} : { claimed }),
    described: { apps: forgeApps, authorization: client },
  });
}

test("a panel with no account offers Connect GitHub alone", async () => {
  await drawAtProject({ truncated: false, installations: [] });
  const accounts = within(sectionOf("Accounts"));
  expect(
    accounts.getAllByRole("button").map((one) => one.textContent),
  ).toStrictEqual(["Connect GitHub"]);
  expect(accounts.queryAllByRole("link")).toStrictEqual([]);
});

/** An install comes back through the authorization, so where the deployment
 * answers no client the panel offers no install that could not be finished. */
test("a panel whose deployment cannot authorize offers no install", async () => {
  history.pushState({}, "", projectPath);
  await drawPage({ described: { apps: forgeApps } });
  expect(within(sectionOf("Accounts")).queryAllByRole("link")).toStrictEqual(
    [],
  );
});

/** Connect GitHub claims only what is already installed, so a second account is
 * the portal app's install, which comes back through the authorization. */
test("a panel with an account offers Add account, which installs the portal", async () => {
  await drawAtProject();
  const add = within(sectionOf("Accounts")).getByRole<HTMLAnchorElement>(
    "link",
    { name: "Add account" },
  );
  expect(add.href.startsWith(`${forgeApps[0]?.installUrl}?state=`)).toBe(true);
  fireEvent.click(add);
  await settled();
  expect(storedInstall()).toStrictEqual({
    state: new URL(add.href).searchParams.get("state"),
    app: "portal",
    tenant: leadPartition.tenant,
    project: leadPartition.project,
    returnPath: projectPath,
  });
});

/** Connect GitHub claims the worker app where it is installed, so the worker's
 * install is the one thing a connected account can still be missing. */
test("an account connected without the worker offers the worker's install on its own row", async () => {
  await drawAtProject();
  const rows = within(sectionOf("Accounts")).getAllByRole("row");
  expect(rows.map((row) => within(row).queryAllByRole("link").length)).toEqual([
    0, 0, 1,
  ]);
  const install = within(rows[2] ?? document.body).getByRole<HTMLAnchorElement>(
    "link",
    { name: "Install worker" },
  );
  expect(install.href.startsWith(`${forgeApps[1]?.installUrl}?state=`)).toBe(
    true,
  );
  fireEvent.click(install);
  await settled();
  expect(storedInstall()).toStrictEqual({
    state: new URL(install.href).searchParams.get("state"),
    app: "worker",
    tenant: leadPartition.tenant,
    project: leadPartition.project,
    returnPath: projectPath,
  });
});

test("the bindings are drawn by the account and name they are under", async () => {
  await drawPage();
  const repositories = sectionOf("Repositories");
  expect(
    within(repositories).getByRole("rowheader", { name: "kasofsk/chuggy" }),
  ).toBeTruthy();
});

/**
 * A retired binding is still bound, so it is still a row and still a page; the
 * one word beside its name is what says a ticket may no longer name it.
 */
test("a retired binding is drawn as retired and a live one carries no word", async () => {
  await drawPage({
    bound: {
      repositories: [
        { ...bindings.repositories[0], retiredAt: "2026-09-14T00:00:00Z" },
      ],
    },
  });
  const row = within(sectionOf("Repositories")).getByRole("rowheader", {
    name: /kasofsk\/chuggy/,
  });
  expect(row.textContent).toBe("kasofsk/chuggyRetired");
});

/** A binding is a row and a page, and the row is the only way to the page. */
test("a binding's name is the link to its own page", async () => {
  await drawPage();
  expect(
    within(sectionOf("Repositories"))
      .getByRole("link", { name: "kasofsk/chuggy" })
      .getAttribute("href"),
  ).toBe("/$tenant/$project/repositories/$repository");
});

/**
 * The roster is read under the portal claims alone, because the worker app's
 * installation is not what a binding is checked against.
 */
test("the picker reads every portal installation and marks what is bound", async () => {
  const sent = await drawPage();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  const read = sent
    .filter((one) => one.url.includes("/forge-installations/"))
    .map((one) => one.url);
  expect(read.some((url) => url.includes("/11/repositories"))).toBe(true);
  expect(read.some((url) => url.includes("/13/repositories"))).toBe(true);
  expect(read.some((url) => url.includes("/12/repositories"))).toBe(false);
  const picker = within(screen.getByRole("dialog"));
  expect(picker.getByText("More than shown")).toBeTruthy();
  expect(picker.getByRole("button", { name: "kasofsk/chuggy" })).toBeTruthy();
  expect(picker.getByText("Bound")).toBeTruthy();
});

test("choosing a repository binds it by address under an idempotency key", async () => {
  const sent = await drawPage();
  await chooseFree();
  const bind = sent.find((one) => one.method === "POST");
  expect(bind?.body).toStrictEqual({ repository: freeUrl });
  expect(bind?.key).toBeTruthy();
  expect(
    within(screen.getByRole("dialog")).getByText("Deferring"),
  ).toBeTruthy();
});

function pickerRows(): readonly (string | null)[] {
  return within(screen.getByRole("dialog"))
    .queryAllByRole("listitem")
    .map((row) => row.textContent);
}

function typedInPicker(query: string): void {
  fireEvent.change(screen.getByRole("textbox", { name: "Filter" }), {
    target: { value: query },
  });
}

async function searchPicker(query: string): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  typedInPicker(query);
  await settled();
}

test("the picker's filter says what it is and has the caret once the roster arrives", async () => {
  await drawPage();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  const box = screen.getByRole("textbox", { name: "Filter" });
  expect(box.getAttribute("placeholder")).toBe("Filter");
  expect(document.activeElement).toBe(box);
});

test("clearing the filter draws every row again, the bound mark with them", async () => {
  await drawPage();
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  const every = pickerRows();
  expect(every.length).toBeGreaterThan(1);
  typedInPicker("scratch");
  expect(pickerRows()).toStrictEqual(["gdoteof/scratch"]);
  typedInPicker("");
  expect(pickerRows()).toStrictEqual(every);
  expect(within(screen.getByRole("dialog")).getByText("Bound")).toBeTruthy();
});

test("a query narrows the picker and a row it kept still binds by address", async () => {
  const sent = await drawPage();
  await searchPicker("SCRATCH");
  const picker = within(screen.getByRole("dialog"));
  expect(picker.queryByRole("button", { name: "kasofsk/chuggy" })).toBeNull();
  fireEvent.click(picker.getByRole("button", { name: "gdoteof/scratch" }));
  await settled();
  expect(sent.find((one) => one.method === "POST")?.body).toStrictEqual({
    repository: freeUrl,
  });
});

/** The address is behind the row and not on it, so a query naming only the
 * address's host keeps nothing. */
test("a query is matched against the name a row draws and not its address", async () => {
  await drawPage();
  await searchPicker("forge.test");
  expect(
    within(screen.getByRole("dialog")).queryAllByRole("listitem"),
  ).toStrictEqual([]);
});

/** A reader who searched and found nothing has to see the roster they searched
 * was not all of it. */
test("a query matching nothing still draws the listing was partial", async () => {
  await drawPage();
  await searchPicker("absent");
  const picker = within(screen.getByRole("dialog"));
  expect(picker.getByText("No match")).toBeTruthy();
  expect(picker.getByText("More than shown")).toBeTruthy();
});

/**
 * A binding is checked against a portal installation, so with none there is
 * nothing the picker could offer and nothing a bind could be granted by — the
 * control says so by being unusable rather than by opening onto an empty list.
 */
test("a tenant holding no portal claim cannot open the picker", async () => {
  await drawPage({ claimed: without("portal") });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Add" }).disabled,
  ).toBe(true);
});

test("connecting is offered only where this deployment answers a client to authorize", async () => {
  await drawPage();
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Connect GitHub" })
      .disabled,
  ).toBe(true);
  expect(screen.getByText("Not configured")).toBeTruthy();
});

test("a deployment that answers a client says nothing against connecting", async () => {
  await drawPage({
    described: {
      apps: [],
      authorization: {
        clientId: "Iv1.portal",
        authorizeUrl: "https://forge.test/login/oauth/authorize",
      },
    },
  });
  expect(screen.queryByText("Not configured")).toBeNull();
});

test("connecting stores this tab's transaction and sends the person to authorize", async () => {
  await drawPage({ described: { apps: [], authorization: client } });
  fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
  await settled();
  expect(redirects).toHaveLength(1);
  const url = new URL(redirects[0] ?? "");
  expect(url.searchParams.get("client_id")).toBe(client.clientId);
  const stored = JSON.parse(
    sessionStorage.getItem(forgeAuthorizeTransactionKey) ?? "{}",
  ) as Record<string, unknown>;
  expect(stored["state"]).toBe(url.searchParams.get("state"));
  expect(stored).toMatchObject({ ...leadPartition });
});

function statusesOf(): readonly (string | null)[] {
  return within(screen.getByRole("dialog"))
    .getAllByRole("status")
    .map((one) => one.textContent);
}

/** The `201` carries the configurations the binding found and the `200` carries
 * the repository alone, so the second line is drawn for one and not the other. */
test("a new binding draws what its own configurations came to", async () => {
  await drawPage({
    posted: () =>
      answer(
        {
          repository: freeUrl,
          landing: { mode: "Push" },
          configurations: { result: "Imported", count: 2 },
        },
        201,
      ),
  });
  await chooseFree();
  expect(statusesOf()).toStrictEqual(["Bound", "Imported"]);
});

test("a binding that already stood draws the one word and no more", async () => {
  await drawPage({ posted: () => answer({ repository: freeUrl }) });
  await chooseFree();
  expect(statusesOf()).toStrictEqual(["Already bound"]);
});

/** A create makes the repository through one app's installation and leaves the
 * work to the other's, so an account holding one of them is not offered. */
test("the create dialog offers only an account holding both apps", async () => {
  await drawPage();
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await settled();
  fireEvent.keyDown(screen.getByRole("button", { name: /^Account / }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  expect(
    screen.getAllByRole("menuitemradio").map((one) => one.textContent),
  ).toStrictEqual(["kasofsk"]);
});

test("a tenant holding no account with both apps cannot open the create dialog", async () => {
  await drawPage({ claimed: without("worker") });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Create" }).disabled,
  ).toBe(true);
});

const madeUrl = "https://forge.test/kasofsk/scratch";

const made = {
  repository: madeUrl,
  landing: { mode: "Push" },
  created: { account: "kasofsk", name: "scratch", url: madeUrl },
  seeded: true,
  ruleset: { result: "Refused", message: "no branch yet" },
  configurations: { result: "Deferred", reason: "StepFailed" },
};

async function typeCreate(
  sent: readonly Sent[],
  visibility: string | null = "Public",
): Promise<Sent | undefined> {
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await settled();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "scratch" },
  });
  if (visibility !== null)
    fireEvent.click(screen.getByRole("radio", { name: visibility }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Create" }),
  );
  await settled();
  return sent.find((one) => one.url.includes("/repositories/new"));
}

test("a create names what it asked for and draws every step it took", async () => {
  const sent = await drawPage({ posted: () => answer(made, 201) });
  const posted = await typeCreate(sent);
  expect(posted?.body).toStrictEqual({
    account: "kasofsk",
    name: "scratch",
    visibility: "public",
  });
  expect(posted?.key).toBeTruthy();
  const rows = within(screen.getByRole("dialog")).getByRole("status");
  expect(rows.textContent).toBe(
    "Repositoryscratch" +
      "SeedSeeded" +
      "RulesetRefused · no branch yet" +
      "ConfigurationsStep failed",
  );
  expect(
    within(rows).getByRole<HTMLAnchorElement>("link", { name: "scratch" }).href,
  ).toBe(madeUrl);
});

test("a create the route refuses is the one line it refused with", async () => {
  const sent = await drawPage({
    posted: () =>
      answer(
        {
          error: {
            code: "InstallationMissing",
            message:
              "This tenant has claimed no worker installation on the account.",
          },
        },
        422,
      ),
  });
  await typeCreate(sent);
  expect(statusesOf()).toStrictEqual(["Missing: worker"]);
});

/**
 * One installation that will not answer takes the whole roster down, because a
 * repository the reader cannot find may be in the part that was not answered
 * and a roster missing an account silently reads as the account holding none.
 */
test("a listing that fails is a picker that offers nothing", async () => {
  await drawPage({
    granting: (url) =>
      url.includes("/13/repositories")
        ? answer({}, 503)
        : answer(grantedBy(url)),
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  const picker = within(screen.getByRole("dialog"));
  expect(picker.queryByRole("button", { name: "kasofsk/chuggy" })).toBeNull();
  expect(
    picker.getByText(
      "Failed to load · the API asked to be tried again and kept saying so",
    ),
  ).toBeTruthy();
});

/**
 * The bindings table is a read the write does not answer and no frame names, so
 * a bind that staled nothing would leave the row the reader just added off the
 * page until they reloaded it.
 */
test("a bind stales the bindings the page drew", async () => {
  await drawPage({
    posted: () =>
      answer(
        {
          repository: freeUrl,
          landing: { mode: "Push" },
          configurations: { result: "Imported", count: 2 },
        },
        201,
      ),
  });
  const raised = invalidationsAfterDraw();
  await chooseFree();
  expect(raised).toStrictEqual([bindingsKey]);
});

test("a create stales the bindings the page drew", async () => {
  const sent = await drawPage({ posted: () => answer(made, 201) });
  const raised = invalidationsAfterDraw();
  await typeCreate(sent);
  expect(raised).toStrictEqual([bindingsKey]);
});

/** Nothing was bound, so there is nothing to re-read: a refusal that staled the
 * key would send the page back to the API on every failed attempt. */
test("a refused bind stales nothing", async () => {
  await drawPage({
    posted: () =>
      answer(
        {
          error: {
            code: "RepositoryNotInstalled",
            message: "The portal app is not installed on that repository.",
          },
        },
        422,
      ),
  });
  const raised = invalidationsAfterDraw();
  await chooseFree();
  expect(raised).toStrictEqual([]);
});

/** Private is what the dialog opens on, so a create nobody thought about does
 * not put a repository on the open internet. */
test("a create nobody chose a visibility for asks for a private one", async () => {
  const sent = await drawPage({ posted: () => answer(made, 201) });
  const posted = await typeCreate(sent, null);
  expect(posted?.body).toStrictEqual({
    account: "kasofsk",
    name: "scratch",
    visibility: "private",
  });
});

/** The account is where the repository is made, so a choice that did not reach
 * the body would make it under whichever account happened to be first. */
test("the account chosen is the account the create is asked under", async () => {
  const sent = await drawPage({
    claimed: twoAccounts,
    posted: () => answer(made, 201),
  });
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await settled();
  fireEvent.keyDown(screen.getByRole("button", { name: /^Account / }), {
    key: "ArrowDown",
  });
  await screen.findByRole("menu");
  fireEvent.click(screen.getByRole("menuitemradio", { name: "gdoteof" }));
  await settled();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "scratch" },
  });
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Create" }),
  );
  await settled();
  expect(
    sent.find((one) => one.url.includes("/repositories/new"))?.body,
  ).toStrictEqual({
    account: "gdoteof",
    name: "scratch",
    visibility: "private",
  });
});

const retiredUrl = "https://forge.test/kasofsk/old";

/** A live binding the project holds nothing for, beside one it holds and one retired. */
const unconfigured = {
  repositories: [
    { ...bindings.repositories[0], configured: false },
    {
      repository: freeUrl,
      boundAt: "2026-09-11T00:00:00Z",
      landing: { mode: "Push" },
      configured: true,
    },
    {
      repository: retiredUrl,
      boundAt: "2026-09-11T00:00:00Z",
      landing: { mode: "Push" },
      configured: false,
      retiredAt: "2026-09-14T00:00:00Z",
    },
  ],
};

function bindingRowsText(): readonly (string | null)[] {
  return within(sectionOf("Repositories"))
    .getAllByRole("rowheader")
    .map((row) => row.textContent);
}

/** The step asked for again from the one row that offers it. */
async function retryFirst(): Promise<void> {
  fireEvent.click(
    within(sectionOf("Repositories")).getByRole("button", { name: "Retry" }),
  );
  await settled();
}

/** The listing answers nothing on why a step deferred, so a row says only that it did. */
test("only a live binding the project holds nothing for draws Deferred and offers Retry", async () => {
  await drawPage({ bound: unconfigured });
  expect(bindingRowsText()).toStrictEqual([
    "kasofsk/chuggyDeferredRetry",
    "gdoteof/scratch",
    "kasofsk/oldRetired",
  ]);
});

test("a retry asks for the step again by address and stales the bindings the page drew", async () => {
  const sent = await drawPage({
    bound: unconfigured,
    posted: () =>
      answer({
        repository: boundUrl,
        configurations: { result: "Bootstrapped", revision: "bootstrap" },
      }),
  });
  const raised = invalidationsAfterDraw();
  await retryFirst();
  expect(
    sent
      .filter((one) => one.method === "PUT")
      .map(({ url, body }) => ({ url, body })),
  ).toStrictEqual([
    {
      url: `/api/v1/tenants/${leadPartition.tenant}/projects/${leadPartition.project}/repositories/configurations`,
      body: { repository: boundUrl },
    },
  ]);
  expect(raised).toStrictEqual([bindingsKey]);
});

/** The reason is what says whether retrying again can help, so the row takes it in place of the bare word. */
test("a retry that defers for a reason a retry can clear names it and offers Retry again", async () => {
  await drawPage({
    bound: unconfigured,
    posted: () =>
      answer({
        repository: boundUrl,
        configurations: {
          result: "Deferred",
          reason: "DefaultBranchUnavailable",
        },
      }),
  });
  await retryFirst();
  expect(bindingRowsText()[0]).toBe("kasofsk/chuggyGitHub unavailableRetry");
});

test("a retry that defers for a reason only someone else can clear names who and offers nothing", async () => {
  await drawPage({
    bound: unconfigured,
    posted: () =>
      answer({
        repository: boundUrl,
        configurations: { result: "Deferred", reason: "NoBootstrapImage" },
      }),
  });
  await retryFirst();
  expect(bindingRowsText()[0]).toBe(
    "kasofsk/chuggyNo worker image · ask an operator",
  );
});

test("a refused retry draws its refusal and stales nothing", async () => {
  await drawPage({ bound: unconfigured });
  const raised = invalidationsAfterDraw();
  await retryFirst();
  expect(bindingRowsText()[0]).toBe("kasofsk/chuggyDeferringRetry");
  expect(raised).toStrictEqual([]);
});

/** The listing is what draws a binding retired, so the one refusal that changes it redraws it. */
test("a retry that meets the binding retired stales the bindings the page drew", async () => {
  await drawPage({
    bound: unconfigured,
    posted: () =>
      answer({ error: { code: "RepositoryRetired", message: "retired" } }, 409),
  });
  const raised = invalidationsAfterDraw();
  await retryFirst();
  expect(bindingRowsText()[0]).toBe("kasofsk/chuggyRetired");
  expect(raised).toStrictEqual([bindingsKey]);
});
