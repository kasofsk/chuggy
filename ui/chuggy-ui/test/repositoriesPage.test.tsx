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
    Link: (props: { readonly children?: ReactNode }) => (
      <a href="/">{props.children}</a>
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

const boundUrl = "https://forge.test/kasofsk/chuggy";
const freeUrl = "https://forge.test/gdoteof/scratch";

const bindings = {
  repositories: [{ repository: boundUrl, boundAt: "2026-09-11T00:00:00Z" }],
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

async function drawPage(
  claimed = installations,
  posted: (url: string) => Response = deferred,
): Promise<readonly Sent[]> {
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
      return Promise.resolve(answer(grantedBy(url)));
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
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "gdoteof/scratch" }));
  await settled();
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
  await drawPage({
    truncated: false,
    installations: installations.installations.filter(
      (claim) => claim.app !== "portal",
    ),
  });
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
  await drawPage(installations, () =>
    answer(
      { repository: freeUrl, configurations: { result: "Imported", count: 2 } },
      201,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "gdoteof/scratch" }));
  await settled();
  expect(statusesOf()).toStrictEqual(["Bound", "Imported"]);
});

test("a binding that already stood draws the one word and no more", async () => {
  await drawPage(installations, () => answer({ repository: freeUrl }));
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "gdoteof/scratch" }));
  await settled();
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
  await drawPage({
    truncated: false,
    installations: installations.installations.filter(
      (claim) => claim.app !== "worker",
    ),
  });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Create" }).disabled,
  ).toBe(true);
});

const madeUrl = "https://forge.test/kasofsk/scratch";

const made = {
  repository: madeUrl,
  created: { account: "kasofsk", name: "scratch", url: madeUrl },
  seeded: true,
  ruleset: { result: "Refused", message: "no branch yet" },
  configurations: { result: "Deferred", reason: "StepFailed" },
};

async function typeCreate(sent: readonly Sent[]): Promise<Sent | undefined> {
  fireEvent.click(screen.getByRole("button", { name: "Create" }));
  await settled();
  fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
    target: { value: "scratch" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "Public" }));
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Create" }),
  );
  await settled();
  return sent.find((one) => one.url.includes("/repositories/new"));
}

test("a create names what it asked for and draws every step it took", async () => {
  const sent = await drawPage(installations, () => answer(made, 201));
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
  const sent = await drawPage(installations, () =>
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
  );
  await typeCreate(sent);
  expect(statusesOf()).toStrictEqual(["Missing: worker"]);
});
