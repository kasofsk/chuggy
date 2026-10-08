/**
 * The tenant's accounts page, mounted: Connect GitHub until an account is
 * connected, Add account and a missing worker's install after, and the one
 * word a return from the forge leaves.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { TenantAccountsPage } from "../../app/browser/settings/TenantAccountsPage.tsx";
import { forgeAuthorizeTransactionKey } from "../../app/core/forgeAuthorization.ts";
import { forgeInstallTransactionKey } from "../../app/core/forgeInstallation.ts";
import { forgeReturnHold } from "../../app/core/forgeReturn.ts";
import type { ForgeReturnWord } from "../../app/core/forgeReturn.ts";
import { transientStore } from "../../app/browser/ports.ts";
import { forgeInstallationsFixture } from "../forgeInstallationsFixture.ts";
import { answer, drawnStrict, settled } from "../screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "../screenHarness.tsx";
import { leadPartition } from "../leadFixture.ts";
import type * as BrowserPorts from "../../app/browser/ports.ts";

const held = vi.hoisted((): { redirects: string[] } => ({ redirects: [] }));

/**
 * The digest is a double that answers at once: the real one is answered from
 * another thread, so a redirect that waits for it can land after the turns a
 * case waits out, or in the case that follows. What a challenge must equal is
 * asserted in `ui/chuggy-ui/test/pkce.test.ts`.
 */
vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  digest: (message: Uint8Array) => Promise.resolve(message),
  redirect: (url: string) => {
    held.redirects.push(url);
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
  useNavigate: () => (to: unknown) => Promise.resolve(to),
  useParams: () => ({ tenant: leadPartition.tenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

const tenant = leadPartition.tenant;
const accountsPath = `/tenants/${tenant}/settings/accounts`;

const installations = forgeInstallationsFixture;

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

beforeEach(() => {
  held.redirects.length = 0;
  history.pushState({}, "", accountsPath);
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  history.pushState({}, "", "/");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface Drawing {
  /** The claims the tenant holds, which decide what the panel offers. */
  readonly claimed?: unknown;
  /** What the claims listing answers with, where a case is about a listing
   * that does not answer them. */
  readonly listing?: () => Response;
  /** What this deployment answers about its apps. */
  readonly described?: unknown;
}

function drawAccounts(drawing: Drawing = {}): Promise<DrawnStrict> {
  const claimed = drawing.claimed ?? installations;
  const listing = drawing.listing ?? (() => answer(claimed));
  const described = drawing.described ?? { apps: [] };
  return drawnStrict(<TenantAccountsPage />, (request: SentRequest) => {
    if (request.url.endsWith("/forge/github")) return answer(described);
    if (request.url.includes("/forge-installations")) return listing();
    return answer({}, 404);
  });
}

function sectionOf(title: string): HTMLElement {
  return screen.getByRole("region", { name: new RegExp(`^${title}`) });
}

/** The install a followed link stored, which the setup landing matches. */
function storedInstall(): unknown {
  return JSON.parse(sessionStorage.getItem(forgeInstallTransactionKey) ?? "{}");
}

/** A forge return held for this tenant, as the callback leaves it. */
function returnedWith(word: ForgeReturnWord): void {
  forgeReturnHold(transientStore, tenant, word);
}

/** The panel's own lines, which a return's word is one of. */
function accountsLines(): readonly (string | null)[] {
  return within(sectionOf("Accounts"))
    .queryAllByRole("paragraph")
    .map((line) => line.textContent);
}

test("an account is one row saying which of the two apps it holds", async () => {
  await drawAccounts();
  const accounts = sectionOf("Accounts");
  const rows = within(accounts).getAllByRole("row");
  expect(rows.map((row) => row.textContent)).toStrictEqual([
    "AccountKindPortalWorker",
    "kasofskOrganizationInstalledInstalled",
    "gdoteofUserInstalledMissing",
  ]);
});

test("a panel with no account offers Connect GitHub alone", async () => {
  await drawAccounts({ claimed: { truncated: false, installations: [] } });
  const accounts = within(sectionOf("Accounts"));
  expect(
    accounts.getAllByRole("button").map((one) => one.textContent),
  ).toStrictEqual(["Connect GitHub"]);
  expect(accounts.queryAllByRole("link")).toStrictEqual([]);
});

/** An install comes back through the authorization, so where the deployment
 * answers no client the panel offers no install that could not be finished. */
test("a panel whose deployment cannot authorize offers no install", async () => {
  await drawAccounts({ described: { apps: forgeApps } });
  expect(within(sectionOf("Accounts")).queryAllByRole("link")).toStrictEqual(
    [],
  );
});

/** Connect GitHub claims only what is already installed, so a second account is
 * the portal app's install, which comes back through the authorization. */
test("a panel with an account offers Add account, which installs the portal", async () => {
  await drawAccounts({ described: { apps: forgeApps, authorization: client } });
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
    tenant,
    returnPath: accountsPath,
  });
});

test("a return's word is drawn on the Accounts panel once, and not on the next visit", async () => {
  returnedWith({ standing: "Failed", status: "Refused" });
  await drawAccounts();
  expect(accountsLines()).toStrictEqual(["Refused"]);
  expect(
    within(sectionOf("Accounts"))
      .getByText("Refused")
      .classList.contains("notice-danger"),
  ).toBe(true);
  cleanup();
  await drawAccounts();
  expect(accountsLines()).toStrictEqual([]);
});

/** Connect GitHub claims only what is installed, so a return that reached no
 * account the person owns is one the portal's install puts right. */
test("a return that reached no account the person owns offers Add account beside Connect GitHub", async () => {
  returnedWith({ standing: "Uninstalled", status: "Not installed" });
  await drawAccounts({
    claimed: { truncated: false, installations: [] },
    described: { apps: forgeApps, authorization: client },
  });
  const accounts = within(sectionOf("Accounts"));
  expect(accountsLines()).toStrictEqual([
    "Not installed",
    "No account connected",
  ]);
  expect(accounts.getByRole("button", { name: "Connect GitHub" })).toBeTruthy();
  const add = accounts.getByRole<HTMLAnchorElement>("link", {
    name: "Add account",
  });
  expect(add.href.startsWith(`${forgeApps[0]?.installUrl}?state=`)).toBe(true);
});

test("a return that stopped short for another reason offers no install with no account", async () => {
  returnedWith({ standing: "Unfinished", status: "Declined" });
  await drawAccounts({ claimed: { truncated: false, installations: [] } });
  expect(accountsLines()).toStrictEqual(["Declined", "No account connected"]);
  const accounts = within(sectionOf("Accounts"));
  expect(
    accounts.getByText("Declined").classList.contains("notice-parked"),
  ).toBe(true);
  expect(accounts.queryAllByRole("link")).toStrictEqual([]);
});

/** Connect GitHub claims the worker app where it is installed, so the worker's
 * install is the one thing a connected account can still be missing. */
test("an account connected without the worker offers the worker's install on its own row", async () => {
  await drawAccounts({ described: { apps: forgeApps, authorization: client } });
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
    tenant,
    returnPath: accountsPath,
  });
});

test("connecting is offered only where this deployment answers a client to authorize", async () => {
  await drawAccounts({ described: { apps: forgeApps } });
  expect(
    screen.getByRole<HTMLButtonElement>("button", { name: "Connect GitHub" })
      .disabled,
  ).toBe(true);
  expect(screen.getByText("Not configured")).toBeTruthy();
});

test("a deployment that answers a client says nothing against connecting", async () => {
  await drawAccounts({
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
  await drawAccounts({ described: { apps: [], authorization: client } });
  fireEvent.click(screen.getByRole("button", { name: "Connect GitHub" }));
  await settled();
  expect(held.redirects).toHaveLength(1);
  const url = new URL(held.redirects[0] ?? "");
  expect(url.searchParams.get("client_id")).toBe(client.clientId);
  const stored = JSON.parse(
    sessionStorage.getItem(forgeAuthorizeTransactionKey) ?? "{}",
  ) as Record<string, unknown>;
  expect(stored["state"]).toBe(url.searchParams.get("state"));
  expect(stored).toMatchObject({ tenant, returnPath: accountsPath });
});

/** The listing answers only a workspace admin, so a 404 is this reader's
 * standing, and a connect they started would be refused at the claim. */
test("a reader the accounts are withheld from is told who connects them and offered no connect", async () => {
  await drawAccounts({ listing: () => answer({}, 404) });
  const accounts = within(sectionOf("Accounts"));
  expect(
    accounts.getByText("A workspace admin connects GitHub accounts"),
  ).toBeTruthy();
  expect(accounts.queryByText(/^Not available/)).toBeNull();
  expect(accounts.queryAllByRole("button")).toStrictEqual([]);
  expect(accounts.queryAllByRole("link")).toStrictEqual([]);
});

/** A listing that merely failed still says it failed and why, unlike the
 * forbidden listing above, which this reader's standing rather than a fault. */
test("a listing that failed keeps its own line", async () => {
  await drawAccounts({ listing: () => answer({}, 500) });
  expect(
    within(sectionOf("Accounts")).getByText(
      "Failed to load · the API failed with InternalError",
    ),
  ).toBeTruthy();
});
