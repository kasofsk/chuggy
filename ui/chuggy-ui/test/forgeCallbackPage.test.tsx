/**
 * The page the forge returns an authorization to, mounted. What is asserted is
 * the traffic, because a code posted from a return this tab did not start
 * would claim someone else's accounts, and where the person goes next: on to
 * an install the answer leaves to be made, or back where they pressed.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ForgeCallbackPage } from "../app/browser/ForgeCallbackPage.tsx";
import { forgeAuthorizeTransactionKey } from "../app/core/forgeAuthorization.ts";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import { forgeReturnKey } from "../app/core/forgeReturn.ts";
import { answer, drawnStrict, settled } from "./screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted(
  (): {
    arrived: Record<string, unknown>;
    navigated: unknown[];
    replaced: string[];
  } => ({ arrived: {}, navigated: [], replaced: [] }),
);

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => "https://console.test",
  replaceLocation: (url: string) => {
    held.replaced.push(url);
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to: string; readonly children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
  useSearch: () => held.arrived,
  useNavigate: () => (to: unknown) => {
    held.navigated.push(to);
    return Promise.resolve();
  },
}));
// jscpd:ignore-end -- the case's own doubles resume here

/** The transaction as Connect GitHub leaves it: a press sent on to no install. */
const transaction = {
  state: "a-state",
  verifier: "a-verifier-".padEnd(43, "v"),
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
  installs: [] as string[],
};

/** An answer reaching one account the person owns, with what claiming the
 * worker app on it came to, and one they do not. */
function reaching(worker: string): unknown {
  return {
    accounts: [
      {
        account: "kasofsk",
        accountKind: "Organization",
        proof: "Proven",
        apps: [
          { app: "portal", claim: "Claimed" },
          { app: "worker", claim: worker },
        ],
      },
      {
        account: "globex",
        accountKind: "Organization",
        proof: "NotOwner",
        apps: [],
      },
    ],
    truncated: false,
  };
}

const authorized = reaching("Claimed");
const workerless = reaching("Missing");
const nothing = { accounts: [], truncated: false };

const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

const portal = {
  app: "portal",
  id: "1",
  slug: "chuggy-portal",
  installUrl: "https://forge.test/apps/chuggy-portal/installations/new",
};

const worker = {
  app: "worker",
  id: "2",
  slug: "chuggy-worker",
  installUrl: "https://forge.test/apps/chuggy-worker/installations/new",
};

/** Both apps this deployment holds, and the client it authorizes with. */
const apps = { apps: [portal, worker], authorization: client };

/** The stored transaction as a press that has been through these installs. */
function through(...installs: readonly string[]): void {
  sessionStorage.setItem(
    forgeAuthorizeTransactionKey,
    JSON.stringify({ ...transaction, installs }),
  );
}

beforeEach(() => {
  held.arrived = { code: "a-code", state: "a-state" };
  held.navigated.length = 0;
  held.replaced.length = 0;
  through();
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function drawCallback(
  redeemed: () => Response = () => answer(authorized),
  described: () => Response = () => answer(apps),
): Promise<DrawnStrict> {
  return drawnStrict(<ForgeCallbackPage />, (request) =>
    request.method === "POST" ? redeemed() : described(),
  );
}

function posts(sent: readonly SentRequest[]): readonly SentRequest[] {
  return sent.filter((request) => request.method === "POST");
}

/** The navigation that puts the person back where they pressed Connect GitHub. */
const returned = { href: transaction.returnPath, replace: true };

/** The word held for the page returned to, or `null` where none is. */
function heldWord(): unknown {
  return JSON.parse(sessionStorage.getItem(forgeReturnKey) ?? "null");
}

function refusedWith(code: string, status: number): () => Response {
  return () =>
    answer({ error: { code, message: "The forge said no." } }, status);
}

/** The install transaction held, or `null` where none is. */
function heldInstall(): unknown {
  return JSON.parse(
    sessionStorage.getItem(forgeInstallTransactionKey) ?? "null",
  );
}

/** The one address this page left for, and the state on it. */
function leftFor(): { readonly address: string; readonly state: string } {
  expect(held.replaced).toHaveLength(1);
  const url = new URL(held.replaced[0] ?? "");
  return {
    address: `${url.origin}${url.pathname}`,
    state: url.searchParams.get("state") ?? "",
  };
}

const notInstalled = {
  tenant: transaction.tenant,
  standing: "Uninstalled",
  status: "Not installed",
};

test("a matching state redeems the code once, for the stored tenant, with the stored verifier", async () => {
  const { sent } = await drawCallback();
  expect(posts(sent)).toHaveLength(1);
  expect(posts(sent)[0]?.url).toContain("/tenants/vteng/forge-authorizations");
  expect(posts(sent)[0]?.body).toStrictEqual({
    forge: "github",
    code: "a-code",
    redirectUri: "https://console.test/forge/github/callback",
    codeVerifier: transaction.verifier,
  });
});

/** The accounts page returned to is what says an account connected, so this
 * page says Connecting and nothing else. */
test("a redeemed authorization replaces this address with where it started, drawing no account and holding no word", async () => {
  await drawCallback();
  expect(held.navigated.at(-1)).toStrictEqual(returned);
  expect(heldWord()).toBeNull();
  expect(screen.getByRole("main").textContent).toBe("GitHubConnecting");
});

/** The install comes back through the setup landing, which matches the state on
 * the address against the transaction held, as it does for a link followed. */
test("an authorization reaching no account goes on to the portal's install, holding its transaction and no word", async () => {
  const { sent } = await drawCallback(() => answer(nothing));
  const left = leftFor();
  expect(left.address).toBe(portal.installUrl);
  expect(left.state).toBeTruthy();
  expect(heldInstall()).toStrictEqual({
    state: left.state,
    tenant: transaction.tenant,
    returnPath: transaction.returnPath,
    installs: ["portal"],
  });
  expect(sent.map((request) => request.method)).toStrictEqual(["POST", "GET"]);
  expect(held.navigated).not.toContainEqual(returned);
  expect(heldWord()).toBeNull();
  expect(screen.getByRole("main").textContent).toBe("GitHubConnecting");
});

test("an account claimed without the worker app goes on to the worker's install", async () => {
  await drawCallback(() => answer(workerless));
  const left = leftFor();
  expect(left.address).toBe(worker.installUrl);
  expect(heldInstall()).toStrictEqual({
    state: left.state,
    tenant: transaction.tenant,
    returnPath: transaction.returnPath,
    installs: ["worker"],
  });
  expect(held.navigated).not.toContainEqual(returned);
  expect(heldWord()).toBeNull();
});

test("a press back from the portal's install goes on to the worker's, carrying both", async () => {
  through("portal");
  await drawCallback(() => answer(workerless));
  const left = leftFor();
  expect(left.address).toBe(worker.installUrl);
  expect(heldInstall()).toMatchObject({ installs: ["portal", "worker"] });
});

/** Asking again would send the person round the same install, so the page they
 * left says what the forge still answers. */
test("a press that has been through the portal's install and still reaches nothing returns with Not installed", async () => {
  through("portal");
  const { sent } = await drawCallback(() => answer(nothing));
  expect(held.replaced).toStrictEqual([]);
  expect(posts(sent)).toHaveLength(sent.length);
  expect(held.navigated.at(-1)).toStrictEqual(returned);
  expect(heldWord()).toStrictEqual(notInstalled);
  expect(heldInstall()).toBeNull();
});

/** The account's row on the page returned to is what says Missing. */
test("a press that has been through the worker's install and still lacks it returns with no word", async () => {
  through("portal", "worker");
  await drawCallback(() => answer(workerless));
  expect(held.replaced).toStrictEqual([]);
  expect(held.navigated.at(-1)).toStrictEqual(returned);
  expect(heldWord()).toBeNull();
});

test.each([
  ["holds no key for the app", () => answer({ ...apps, apps: [worker] })],
  ["answers no client to authorize", () => answer({ apps: [portal, worker] })],
  ["does not answer its apps", () => answer({}, 503)],
])(
  "a deployment that %s sends nobody on, and the return carries Not installed",
  async (_said, described) => {
    await drawCallback(() => answer(nothing), described);
    expect(held.replaced).toStrictEqual([]);
    expect(held.navigated.at(-1)).toStrictEqual(returned);
    expect(heldWord()).toStrictEqual(notInstalled);
    expect(heldInstall()).toBeNull();
  },
);

/** An answer that read only some accounts may have missed the one that holds
 * the portal app. */
test("a partial answer reaching nothing installs nothing and returns with Partial", async () => {
  const { sent } = await drawCallback(() =>
    answer({ accounts: [], truncated: true }),
  );
  expect(held.replaced).toStrictEqual([]);
  expect(posts(sent)).toHaveLength(sent.length);
  expect(heldWord()).toMatchObject({
    standing: "Uninstalled",
    status: "Partial",
  });
});

test("the code and state leave the address while it is redeemed", async () => {
  await drawCallback();
  expect(held.navigated).toStrictEqual([
    {
      to: "/forge/github/callback",
      search: { code: undefined, state: undefined, error: undefined },
      replace: true,
    },
    returned,
  ]);
});

test("a code the forge would not redeem returns with Refused, and goes on to no install", async () => {
  await drawCallback(refusedWith("AuthorizationRefused", 422));
  expect(held.replaced).toStrictEqual([]);
  expect(held.navigated.at(-1)).toStrictEqual(returned);
  expect(heldWord()).toMatchObject({ standing: "Failed", status: "Refused" });
});

test("a code the forge spent before it could be read returns with Start again", async () => {
  const { sent } = await drawCallback(refusedWith("AuthorizationSpent", 502));
  expect(posts(sent)).toHaveLength(1);
  expect(held.navigated.at(-1)).toStrictEqual(returned);
  expect(heldWord()).toMatchObject({
    standing: "Failed",
    status: "Start again",
  });
});

test("a person who declined at the forge returns with Declined and nothing is posted", async () => {
  held.arrived = { error: "access_denied", state: "a-state" };
  expect((await drawCallback()).sent).toStrictEqual([]);
  expect(held.navigated).toStrictEqual([returned]);
  expect(heldWord()).toMatchObject({
    standing: "Unfinished",
    status: "Declined",
  });
});

test("a state that is not this tab's redeems nothing, stays and links home", async () => {
  held.arrived = { ...held.arrived, state: "someone-else" };
  const { sent } = await drawCallback();
  expect(sent).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
  expect(
    screen.getByRole<HTMLAnchorElement>("link", { name: "Home" }).pathname,
  ).toBe("/");
  expect(held.navigated).not.toContainEqual(returned);
  expect(heldWord()).toBeNull();
});

test("a callback carrying no state redeems nothing", async () => {
  held.arrived = { code: "a-code" };
  expect((await drawCallback()).sent).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

/** A reload is the same address opened a second time, with the transaction
 * already spent, so the code is not posted twice. */
test("the transaction is spent, and the callback opened again redeems nothing", async () => {
  await drawCallback();
  expect(sessionStorage.getItem(forgeAuthorizeTransactionKey)).toBeNull();
  cleanup();
  expect((await drawCallback()).sent).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

test("the code is posted once however often the page is drawn", async () => {
  const landed = await drawCallback();
  landed.redraw();
  await settled();
  expect(posts(landed.sent)).toHaveLength(1);
  expect(screen.queryByText("Not expected")).toBeNull();
});

test("a press is sent on once however often the page is drawn", async () => {
  const landed = await drawCallback(() => answer(nothing));
  landed.redraw();
  await settled();
  expect(posts(landed.sent)).toHaveLength(1);
  expect(held.replaced).toHaveLength(1);
});
