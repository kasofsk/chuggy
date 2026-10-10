/**
 * The repositories page: what the project binds, and the picker that adds one.
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
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { RepositoriesPage } from "../app/browser/RepositoriesPage.tsx";
import { forgeAuthorizeTransactionKey } from "../app/core/forgeAuthorization.ts";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import { forgeReturnHold, forgeReturnKey } from "../app/core/forgeReturn.ts";
import type { ForgeReturnWord } from "../app/core/forgeReturn.ts";
import { transientStore } from "../app/browser/ports.ts";
import { forgeInstallationsFixture } from "./forgeInstallationsFixture.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";
import {
  abilitiesEvery,
  abilitiesOver,
  abilitiesUnrefusing,
  unanswered,
} from "./projectAbilitiesFixture.ts";
import { workRunnerOver, workRunnerUnreadable } from "./workRunnerReads.ts";
import type { WorkRunnerReads } from "./workRunnerReads.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted((): { redirects: string[] } => ({ redirects: [] }));

/** The digest answers at once, for the reason given in
 * `ui/chuggy-ui/test/settings/tenantAccountsPage.test.tsx`. */
vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  digest: (message: Uint8Array) => Promise.resolve(message),
  redirect: (url: string) => {
    held.redirects.push(url);
  },
}));

/** A link's path is filled from its params, so a link into the wrong project
 * is a wrong href rather than the same one. */
vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: {
    readonly to?: string;
    readonly params?: Readonly<Record<string, string>>;
    readonly children?: ReactNode;
  }) => (
    <a
      href={(props.to ?? "/").replace(
        /\$(\w+)/gu,
        (named: string, key: string) => props.params?.[key] ?? named,
      )}
    >
      {props.children}
    </a>
  ),
  useParams: () => ({ ...leadPartition }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  held.redirects.length = 0;
  sessionStorage.clear();
  history.pushState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const installations = forgeInstallationsFixture;

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
  /** What the claims listing answers with, where a case is about a listing
   * that does not answer them. */
  readonly listing?: () => Response;
  /** What a write answers with. */
  readonly posted?: (url: string) => Response;
  /** What one installation's own listing answers with. */
  readonly granting?: (url: string) => Response;
  /** The bindings this project holds, where a case is about how one is drawn. */
  readonly bound?: unknown;
  /** The bindings it holds once a bind has been answered, where a case is
   * about what the picker draws after one. */
  readonly rebound?: unknown;
  /** What this deployment answers about its apps. */
  readonly described?: unknown;
  /** A `fetch` laid over the page's own, where a case answers one more read. */
  readonly over?: (served: typeof fetch) => typeof fetch;
}

async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  const claimed = drawing.claimed ?? installations;
  const listing = drawing.listing ?? (() => answer(claimed));
  const posted = drawing.posted ?? deferred;
  const granting = drawing.granting ?? ((url) => answer(grantedBy(url)));
  const bound: unknown = drawing.bound ?? bindings;
  const rebound: unknown = drawing.rebound ?? bound;
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
    if (url.includes("/forge-installations")) return Promise.resolve(listing());
    const written = sent.some((one) => one.method === "POST");
    return Promise.resolve(answer(written ? rebound : bound));
  }) as unknown as typeof fetch;
  vi.stubGlobal("fetch", (drawing.over ?? ((served) => served))(fetching));
  const page = (
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <RepositoriesPage />
    </ScreenHarness>
  );
  render(page);
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

/** Where the page is drawn, which every install it offers must come back to. */
const projectPath = `/${leadPartition.tenant}/${leadPartition.project}/repositories`;

/** The page drawn at its own address with both apps held. */
async function drawAtProject(claimed?: typeof installations): Promise<void> {
  history.pushState({}, "", projectPath);
  await drawPage({
    ...(claimed === undefined ? {} : { claimed }),
    described: { apps: forgeApps, authorization: client },
  });
}

/** The same, with the claims listing answering as the case says. */
async function drawAtProjectListing(listing: () => Response): Promise<void> {
  history.pushState({}, "", projectPath);
  await drawPage({
    listing,
    described: { apps: forgeApps, authorization: client },
  });
}

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
  ).toBe(
    `/${leadPartition.tenant}/${leadPartition.project}/repositories/${boundUrl}`,
  );
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
  expect(statusesOf()).toStrictEqual(["Configurations imported · New ticket"]);
});

/** The row is what says Bound, once the bindings it is marked against are read
 * again; the one line under the roster says what came of it and what is next. */
test("a bind that bootstrapped draws Bound once and links a new ticket", async () => {
  await drawPage({
    posted: () =>
      answer(
        {
          repository: freeUrl,
          landing: { mode: "Push" },
          configurations: { result: "Bootstrapped", revision: "bootstrap" },
        },
        201,
      ),
    rebound: {
      repositories: [
        ...bindings.repositories,
        {
          repository: freeUrl,
          boundAt: "2026-10-01T00:00:00Z",
          landing: { mode: "Push" },
          configured: true,
        },
      ],
    },
  });
  await chooseFree();
  const picker = within(screen.getByRole("dialog"));
  const row = picker.getByRole("button", { name: "gdoteof/scratch" });
  expect(row.parentElement?.textContent).toBe("gdoteof/scratchBound");
  expect(statusesOf()).toStrictEqual([
    "Default configuration added · New ticket",
  ]);
  expect(
    picker.getByRole("link", { name: "New ticket" }).getAttribute("href"),
  ).toBe(`/${leadPartition.tenant}/${leadPartition.project}/tickets/new`);
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

/** A create that left a configuration offers the first ticket from its row, as
 * a bind that did offers it from the picker. */
test("a create that configured its repository says so and links a new ticket", async () => {
  const sent = await drawPage({
    posted: () =>
      answer(
        {
          ...made,
          configurations: { result: "Bootstrapped", revision: "bootstrap" },
        },
        201,
      ),
  });
  await typeCreate(sent);
  const rows = within(screen.getByRole("dialog")).getByRole("status");
  expect(rows.textContent).toContain(
    "ConfigurationsDefault configuration added · New ticket",
  );
  expect(
    within(rows).getByRole("link", { name: "New ticket" }).getAttribute("href"),
  ).toBe(`/${leadPartition.tenant}/${leadPartition.project}/tickets/new`);
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

/** The line drawn under Add and Create, which is none where nothing is missing. */
function offersLine(): string | null | undefined {
  return sectionOf("Repositories").querySelector(".notice")?.textContent;
}

function offered(name: string): boolean {
  return !within(sectionOf("Repositories")).getByRole<HTMLButtonElement>(
    "button",
    { name },
  ).disabled;
}

/** The steps the section offers under its line, each `null` where it is not. */
function offersSteps(): {
  readonly connect: HTMLButtonElement | null;
  readonly install: HTMLAnchorElement | null;
} {
  const section = within(sectionOf("Repositories"));
  return {
    connect: section.queryByRole<HTMLButtonElement>("button", {
      name: "Connect GitHub",
    }),
    install: section.queryByRole<HTMLAnchorElement>("link", {
      name: "Install worker",
    }),
  };
}

const noStep = { connect: null, install: null };

const noAccount: typeof installations = { truncated: false, installations: [] };

test("a reader the accounts are withheld from is told who adds repositories, and offered no step", async () => {
  await drawAtProjectListing(() => answer({}, 404));
  expect([offered("Add"), offered("Create")]).toStrictEqual([false, false]);
  expect(offersLine()).toBe("A workspace admin adds repositories");
  expect(offersSteps()).toStrictEqual(noStep);
});

/** Only the forbidden listing is this reader's standing; one that merely failed
 * says so, and says nothing of what the workspace holds to offer a step on. */
test("a listing that failed says the accounts did not load, and offers no step", async () => {
  await drawAtProjectListing(() => answer({}, 500));
  expect(offersLine()).toBe("Accounts failed to load");
  expect(offersSteps()).toStrictEqual(noStep);
});

/** A new project's creator lands here, so the press returns here, where Add is. */
test("with no account, the page offers Connect GitHub under its line, returning to itself", async () => {
  await drawAtProject(noAccount);
  expect([offered("Add"), offered("Create")]).toStrictEqual([false, false]);
  expect(offersLine()).toBe("Connect a GitHub account first");
  const { connect, install } = offersSteps();
  expect(install).toBeNull();
  expect(connect?.classList.contains("btn-primary")).toBe(true);
  expect(
    within(sectionOf("Repositories")).queryByRole("link", { name: "Accounts" }),
  ).toBeNull();
  fireEvent.click(connect ?? document.body);
  await settled();
  expect(held.redirects).toHaveLength(1);
  const url = new URL(held.redirects[0] ?? "");
  expect(`${url.origin}${url.pathname}`).toBe(client.authorizeUrl);
  expect(
    JSON.parse(sessionStorage.getItem(forgeAuthorizeTransactionKey) ?? "{}"),
  ).toMatchObject({
    state: url.searchParams.get("state"),
    tenant: leadPartition.tenant,
    returnPath: projectPath,
    installs: [],
  });
});

/** Back from a page at the forge can show this one again exactly as it was
 * left, with the press it left by still drawn as under way. */
test("a page restored after Connect GitHub was pressed offers the press again", async () => {
  await drawAtProject(noAccount);
  fireEvent.click(offersSteps().connect ?? document.body);
  await settled();
  expect(offered("Connect GitHub")).toBe(false);
  fireEvent(window, new PageTransitionEvent("pageshow", { persisted: false }));
  expect(offered("Connect GitHub")).toBe(false);
  fireEvent(window, new PageTransitionEvent("pageshow", { persisted: true }));
  expect(offered("Connect GitHub")).toBe(true);
  expect(offersSteps().connect?.getAttribute("aria-busy")).toBe("false");
  fireEvent.click(offersSteps().connect ?? document.body);
  await settled();
  expect(held.redirects).toHaveLength(2);
});

/** The line already says who puts it right, so a button that could only be
 * disabled beside it is not drawn. */
test("with no account on a deployment that cannot authorize, the page says who configures GitHub and offers no step", async () => {
  await drawPage({ claimed: noAccount });
  expect(offersLine()).toBe("GitHub not configured · ask an operator");
  expect(offersSteps()).toStrictEqual(noStep);
});

test("with no portal claim, the page says no account has the portal app, and offers no step", async () => {
  await drawAtProject(without("portal"));
  expect([offered("Add"), offered("Create")]).toStrictEqual([false, false]);
  expect(offersLine()).toBe("No account has the portal app");
  expect(offersSteps()).toStrictEqual(noStep);
});

/** Add is offered from an account like this one, and the first job on what it
 * binds would find no worker app to mint a credential under. */
test("an account without the worker app is named under Add and Create, with its install returning here", async () => {
  await drawAtProject(without("worker"));
  expect([offered("Add"), offered("Create")]).toStrictEqual([true, false]);
  expect(offersLine()).toBe("Worker app missing · kasofsk");
  const { connect, install } = offersSteps();
  expect(connect).toBeNull();
  expect(install?.classList.contains("btn-default")).toBe(true);
  expect(install?.href.startsWith(`${forgeApps[1]?.installUrl}?state=`)).toBe(
    true,
  );
  fireEvent.click(install ?? document.body);
  await settled();
  expect(
    JSON.parse(sessionStorage.getItem(forgeInstallTransactionKey) ?? "{}"),
  ).toStrictEqual({
    state: new URL(install?.href ?? "").searchParams.get("state"),
    tenant: leadPartition.tenant,
    returnPath: projectPath,
    installs: ["worker"],
  });
});

test("an account without the worker app is named where another holds both and nothing is withheld", async () => {
  await drawAtProject();
  expect([offered("Add"), offered("Create")]).toStrictEqual([true, true]);
  expect(offersLine()).toBe("Worker app missing · gdoteof");
  expect(offersSteps().install).not.toBeNull();
});

/** An install comes back through the authorization, so the line stands alone
 * where the deployment answers no client to finish one with. */
test("a deployment that offers no install still names the account without the worker app", async () => {
  await drawPage();
  expect(offersLine()).toBe("Worker app missing · gdoteof");
  expect(offersSteps()).toStrictEqual(noStep);
});

/** Every line the section draws above its bindings, the return's word first. */
function sectionLines(): readonly (string | null)[] {
  return [...sectionOf("Repositories").querySelectorAll(".notice")].map(
    (line) => line.textContent,
  );
}

/** A forge return held for this tenant, as the callback leaves it. */
function returnedWith(word: ForgeReturnWord): void {
  forgeReturnHold(transientStore, leadPartition.tenant, word);
}

/** A press from this page returns to it, so a word this page left held would
 * be drawn by the accounts page, about a press that page never saw. */
test("a return's word is drawn above the line once, and is not left held", async () => {
  returnedWith({ standing: "Uninstalled", status: "Not installed" });
  await drawAtProject(noAccount);
  expect(sectionLines()).toStrictEqual([
    "Not installed",
    "Connect a GitHub account first",
  ]);
  expect(sessionStorage.getItem(forgeReturnKey)).toBeNull();
  expect(offersSteps().connect).not.toBeNull();
  cleanup();
  await drawAtProject(noAccount);
  expect(sectionLines()).toStrictEqual(["Connect a GitHub account first"]);
});

test("a return that failed is drawn as a failure", async () => {
  returnedWith({ standing: "Failed", status: "Refused" });
  await drawAtProject(noAccount);
  const word = within(sectionOf("Repositories")).getByText("Refused");
  expect(word.classList.contains("notice-danger")).toBe(true);
});

test("a workspace whose accounts all hold both apps is offered Add and Create, no line and no step", async () => {
  await drawAtProject(twoAccounts);
  expect([offered("Add"), offered("Create")]).toStrictEqual([true, true]);
  expect(offersLine()).toBeUndefined();
  expect(offersSteps()).toStrictEqual(noStep);
});

test("a reader who may not administer reads that a binding deferred and is offered no Retry", async () => {
  await drawPage({
    bound: unconfigured,
    over: abilitiesOver({ ...abilitiesEvery, administer: false }),
  });
  expect(bindingRowsText()[0]).toBe("kasofsk/chuggyDeferred");
});

test.each(abilitiesUnrefusing)(
  "a reader the abilities read %s is offered Retry beside a deferred binding",
  async (_said, abilities) => {
    await drawPage({ bound: unconfigured, over: abilitiesOver(abilities) });
    expect(bindingRowsText()[0]).toBe("kasofsk/chuggyDeferredRetry");
  },
);

/** A bind answered with the configuration it left, which is the answer that
 * offers a next step. */
const bootstrapped = (): Response =>
  answer(
    {
      repository: freeUrl,
      landing: { mode: "Push" },
      configurations: { result: "Bootstrapped", revision: "bootstrap" },
    },
    201,
  );

const configured = "Default configuration added";

const runnersPath = `/${leadPartition.tenant}/${leadPartition.project}/runners`;

/** The steps the open dialog offers, each by its words and where it goes. */
function dialogSteps(): readonly (readonly [string | null, string | null])[] {
  return within(screen.getByRole("dialog"))
    .queryAllByRole("link", { name: /^(?:Add runner|New ticket)$/u })
    .map((link) => [link.textContent, link.getAttribute("href")]);
}

/** The first ticket of a project with no runner parks for want of one, so the
 * bind leads to the runner first and offers no ticket beside it. */
test("a bind in a project with no runner leads to adding one, and to no ticket", async () => {
  await drawPage({
    posted: bootstrapped,
    over: workRunnerOver({ runners: "Unregistered" }),
  });
  await chooseFree();
  expect(statusesOf()).toStrictEqual([`${configured} · Add runner`]);
  expect(dialogSteps()).toStrictEqual([["Add runner", runnersPath]]);
});

const ticketLeading: readonly (readonly [string, WorkRunnerReads])[] = [
  ["with a runner that is offline", { runners: "Offline" }],
  ["with a runner that is live", { runners: "Live" }],
  [
    "whose work is hosted, with no runner",
    { runners: "Unregistered", work: "InCluster" },
  ],
  ["whose runners read failed", { runners: workRunnerUnreadable }],
  [
    "whose route read failed",
    { runners: "Unregistered", work: workRunnerUnreadable },
  ],
];

test.each(ticketLeading)(
  "a bind in a project %s leads to a first ticket",
  async (_project, reads) => {
    await drawPage({ posted: bootstrapped, over: workRunnerOver(reads) });
    await chooseFree();
    expect(statusesOf()).toStrictEqual([`${configured} · New ticket`]);
    expect(dialogSteps().map(([words]) => words)).toStrictEqual(["New ticket"]);
  },
);

/** Either step drawn before the read is back could be the wrong one, and the
 * line already says what the bind came to. */
test("a bind whose runners read has not come back draws what it came to and no step yet", async () => {
  await drawPage({
    posted: bootstrapped,
    over: workRunnerOver({ runners: unanswered }),
  });
  await chooseFree();
  expect(statusesOf()).toStrictEqual([configured]);
  expect(dialogSteps()).toStrictEqual([]);
});

test("a bind that left no configuration offers no step, runner or none", async () => {
  await drawPage({
    posted: () =>
      answer(
        {
          repository: freeUrl,
          landing: { mode: "Push" },
          configurations: { result: "Deferred", reason: "StepFailed" },
        },
        201,
      ),
    over: workRunnerOver({ runners: "Unregistered" }),
  });
  await chooseFree();
  expect(dialogSteps()).toStrictEqual([]);
});

test("a create in a project with no runner leads to adding one from its row", async () => {
  const sent = await drawPage({
    posted: () =>
      answer(
        {
          ...made,
          configurations: { result: "Bootstrapped", revision: "bootstrap" },
        },
        201,
      ),
    over: workRunnerOver({ runners: "Unregistered" }),
  });
  await typeCreate(sent);
  expect(
    within(screen.getByRole("dialog")).getByRole("status").textContent,
  ).toContain(`Configurations${configured} · Add runner`);
  expect(dialogSteps()).toStrictEqual([["Add runner", runnersPath]]);
});

const unbound = { repositories: [] };

function addButtons(): readonly HTMLButtonElement[] {
  return within(sectionOf("Repositories")).getAllByRole<HTMLButtonElement>(
    "button",
    { name: "Add" },
  );
}

/** What the open picker is, by what a reader could tell two dialogs apart by. */
function pickerDrawn(): unknown {
  const dialog = screen.getByRole("dialog");
  return {
    name: dialog.getAttribute("aria-labelledby"),
    rows: pickerRows(),
    filter: within(dialog).queryByRole("textbox", { name: "Filter" }) !== null,
  };
}

/**
 * A workspace that has connected GitHub and bound nothing has one thing left
 * to do here, so the roster's empty line carries the control that does it.
 * It is the head's own dialog it opens, and a row chosen there binds.
 */
test("an empty roster carries Add under its line, and it opens the dialog the head's Add opens", async () => {
  const sent = await drawPage({
    claimed: twoAccounts,
    bound: unbound,
    posted: bootstrapped,
  });
  const [head, body, ...more] = addButtons();
  if (head === undefined || body === undefined) throw new Error("one Add");
  expect(more).toStrictEqual([]);
  expect(body.classList.contains("btn-primary")).toBe(true);
  expect(body.previousElementSibling?.textContent).toBe("No repository bound");

  fireEvent.click(head);
  await settled();
  const fromHead = pickerDrawn();
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
  );
  await settled();
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(body);
  await settled();
  expect(pickerDrawn()).toStrictEqual(fromHead);
  expect(pickerRows()).not.toStrictEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "gdoteof/scratch" }));
  await settled();
  expect(sent.find((one) => one.method === "POST")?.body).toStrictEqual({
    repository: freeUrl,
  });
});

const headOnly: readonly (readonly [string, Drawing])[] = [
  ["a repository is bound", { claimed: twoAccounts }],
  [
    "no account holds the portal app",
    { claimed: without("portal"), bound: unbound },
  ],
  [
    "an account lacks the worker app, whose install comes first",
    { bound: unbound, described: { apps: forgeApps, authorization: client } },
  ],
  [
    "no account is connected, and Connect GitHub comes first",
    {
      claimed: { truncated: false, installations: [] },
      bound: unbound,
      described: { apps: forgeApps, authorization: client },
    },
  ],
];

test.each(headOnly)(
  "Add is drawn once, in the head, where %s",
  async (_where, drawing) => {
    await drawPage(drawing);
    expect(addButtons()).toHaveLength(1);
  },
);
