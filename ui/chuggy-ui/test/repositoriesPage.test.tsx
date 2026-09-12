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
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

/**
 * The address, as a router actually behaves: navigating rewrites the search
 * and the subscribers are told, so a page that reads the search live redraws
 * without it.
 *
 * A DOUBLE THAT LEFT THE SEARCH STANDING WOULD HIDE THE GUARD UNDER TEST: the
 * outcome word is taken once precisely so it survives the clearing, and a
 * search that never changed would make taking it and reading it live look the
 * same.
 */
const routed = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const went: unknown[] = [];
  let search: { readonly connected: string | undefined } = {
    connected: undefined,
  };
  const settle = (next: string | undefined): void => {
    search = { connected: next };
    for (const listener of listeners) listener();
  };
  return {
    went,
    reset: (next: string | undefined): void => {
      went.length = 0;
      listeners.clear();
      search = { connected: next };
    },
    snapshot: () => search,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    navigate: (to: unknown): Promise<void> => {
      went.push(to);
      settle(undefined);
      return Promise.resolve();
    },
  };
});

vi.mock("@tanstack/react-router", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    createLink: (component: unknown) => component,
    Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
      <a href={props.to ?? "/"}>{props.children}</a>
    ),
    useParams: () => ({ ...leadPartition }),
    useSearch: () => useSyncExternalStore(routed.subscribe, routed.snapshot),
    useNavigate: () => routed.navigate,
  };
});
// jscpd:ignore-end -- the case's own doubles resume here

beforeEach(() => {
  routed.reset(undefined);
});

afterEach(() => {
  cleanup();
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

const boundUrl = "https://forge.test/kasofsk/chuggy";
const freeUrl = "https://forge.test/gdoteof/scratch";

const bindings = {
  repositories: [
    {
      repository: boundUrl,
      boundAt: "2026-09-11T00:00:00Z",
      landing: { mode: "Push" },
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
}

async function drawPage(drawing: Drawing = {}): Promise<readonly Sent[]> {
  const claimed = drawing.claimed ?? installations;
  const posted = drawing.posted ?? deferred;
  const granting = drawing.granting ?? ((url) => answer(grantedBy(url)));
  const sent: Sent[] = [];
  const fetching = ((url: string, init?: Init) => {
    sent.push({
      method: init?.method ?? "GET",
      url,
      key: init?.headers?.["idempotency-key"],
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    });
    if (init?.method === "POST") return Promise.resolve(posted(url));
    if (url.includes("/forge-installations/"))
      return Promise.resolve(granting(url));
    if (url.includes("/forge-installations"))
      return Promise.resolve(answer(claimed));
    return Promise.resolve(answer(bindings));
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

test("the bindings are drawn by the account and name they are under", async () => {
  await drawPage();
  const repositories = sectionOf("Repositories");
  expect(
    within(repositories).getByRole("rowheader", { name: "kasofsk/chuggy" }),
  ).toBeTruthy();
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

test("the landing's word is drawn once, and the address it came on is cleared", async () => {
  routed.reset("Connected");
  await drawPage();
  expect(screen.getAllByText("Connected")).toHaveLength(1);
  expect(routed.went).toStrictEqual([
    { search: { connected: undefined }, replace: true },
  ]);
});

test("an address carrying no outcome draws no line and clears nothing", async () => {
  await drawPage();
  expect(screen.queryByText("Connected")).toBeNull();
  expect(routed.went).toStrictEqual([]);
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
      "ConfigurationsDeferred · StepFailed",
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
