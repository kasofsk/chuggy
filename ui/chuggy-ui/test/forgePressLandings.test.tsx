/**
 * One press of Connect GitHub taken through both landings, mounted, with the
 * forge played by the case: each address a landing leaves for is answered by
 * arriving at the other with the state that address carried. What is asserted
 * is the order of the addresses and where the press ends, which no landing
 * mounted alone can show.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ForgeCallbackPage } from "../app/browser/ForgeCallbackPage.tsx";
import { ForgeSetupPage } from "../app/browser/ForgeSetupPage.tsx";
import { forgeAuthorizeRedirect } from "../app/browser/forgeAuthorizeRedirect.ts";
import { redirect } from "../app/browser/ports.ts";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import { forgeReturnKey } from "../app/core/forgeReturn.ts";
import { answer, drawnStrict } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted(
  (): {
    arrived: Record<string, unknown>;
    left: string[];
    entered: string[];
    navigated: unknown[];
  } => ({ arrived: {}, left: [], entered: [], navigated: [] }),
);

/** The digest answers at once, for the reason given in
 * `ui/chuggy-ui/test/forgeSetupPage.test.tsx`. An address left for as a new
 * entry in the tab's history is kept apart from one left for in place. */
vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  digest: (message: Uint8Array) => Promise.resolve(message),
  currentOrigin: () => "https://console.test",
  redirect: (url: string) => {
    held.left.push(url);
    held.entered.push(url);
  },
  replaceLocation: (url: string) => {
    held.left.push(url);
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

const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

const portalInstall = "https://forge.test/apps/chuggy-portal/installations/new";
const workerInstall = "https://forge.test/apps/chuggy-worker/installations/new";

const apps = {
  apps: [
    {
      app: "portal",
      id: "1",
      slug: "chuggy-portal",
      installUrl: portalInstall,
    },
    {
      app: "worker",
      id: "2",
      slug: "chuggy-worker",
      installUrl: workerInstall,
    },
  ],
  authorization: client,
};

const press = {
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
  installs: [],
};

function owning(worker: string): unknown {
  return {
    accounts: [
      {
        account: "kasofsk",
        accountKind: "User",
        proof: "Proven",
        apps: [
          { app: "portal", claim: "Claimed" },
          { app: "worker", claim: worker },
        ],
      },
    ],
    truncated: false,
  };
}

const nothing = { accounts: [], truncated: false };
const workerless = owning("Missing");
const connected = owning("Claimed");

beforeEach(() => {
  held.arrived = {};
  held.left.length = 0;
  held.entered.length = 0;
  held.navigated.length = 0;
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

/** The address a landing left for, without the query the forge reads. */
function addressOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

/**
 * The forge answering the last address left for: an authorization comes back to
 * the callback with a code that redeems as `redeemed`, and an install to the
 * setup landing as installed, each under the state the address carried. It
 * answers whether the landing left for another address.
 */
async function forgeAnswers(redeemed: unknown): Promise<boolean> {
  const before = held.left.length;
  const left = new URL(held.left.at(-1) ?? "");
  const state = left.searchParams.get("state");
  cleanup();
  const authorizing = addressOf(left.href) === client.authorizeUrl;
  held.arrived = authorizing
    ? { code: "a-code", state }
    : { action: "install", state };
  await drawnStrict(
    authorizing ? <ForgeCallbackPage /> : <ForgeSetupPage />,
    (request) => answer(request.method === "POST" ? redeemed : apps),
  );
  return held.left.length > before;
}

/** The press taken as far as it goes: each of `redemptions` answers one
 * authorization, and an install its callback leaves for is made. */
async function pressed(
  redemptions: readonly unknown[],
): Promise<readonly string[]> {
  await forgeAuthorizeRedirect(client, press, redirect);
  for (const redeemed of redemptions) {
    const sentOn = await forgeAnswers(redeemed);
    if (!sentOn) break;
    const installed = await forgeAnswers(redeemed);
    if (!installed) break;
  }
  return held.left.map(addressOf);
}

/** Where the press was put back, and the word held for that page. */
function returned(): { readonly to: unknown; readonly word: unknown } {
  return {
    to: held.navigated.at(-1),
    word: JSON.parse(sessionStorage.getItem(forgeReturnKey) ?? "null"),
  };
}

const back = { href: press.returnPath, replace: true };

test("one press by a person holding neither app goes through both installs and returns connected", async () => {
  expect(await pressed([nothing, workerless, connected])).toStrictEqual([
    client.authorizeUrl,
    portalInstall,
    client.authorizeUrl,
    workerInstall,
    client.authorizeUrl,
  ]);
  expect(returned()).toStrictEqual({ to: back, word: null });
});

/** A landing left as an entry of its own is what Back from a page at the forge
 * opens, and a landing opened again takes whichever transaction is held by then. */
test("neither landing leaves an entry in the tab's history as a press goes through both installs", async () => {
  await pressed([nothing, workerless, connected]);
  expect(held.entered.map(addressOf)).toStrictEqual([client.authorizeUrl]);
});

test("a press whose portal install changed nothing returns with Not installed, sent on once", async () => {
  expect(await pressed([nothing, nothing, nothing])).toStrictEqual([
    client.authorizeUrl,
    portalInstall,
    client.authorizeUrl,
  ]);
  expect(returned()).toStrictEqual({
    to: back,
    word: {
      tenant: press.tenant,
      standing: "Uninstalled",
      status: "Not installed",
    },
  });
});

test("a press whose worker install changed nothing returns with no word, sent on once", async () => {
  expect(
    await pressed([nothing, workerless, workerless, workerless]),
  ).toStrictEqual([
    client.authorizeUrl,
    portalInstall,
    client.authorizeUrl,
    workerInstall,
    client.authorizeUrl,
  ]);
  expect(returned()).toStrictEqual({ to: back, word: null });
});

test("a press by a person whose account holds the portal app alone goes on to the worker's install", async () => {
  expect(await pressed([workerless, connected])).toStrictEqual([
    client.authorizeUrl,
    workerInstall,
    client.authorizeUrl,
  ]);
  expect(returned()).toStrictEqual({ to: back, word: null });
});

/**
 * The picker's own link to an app's page on the forge is an install link, so
 * what the forge sends back after a save there is an update under the state
 * that link stored, and it ends where the link was drawn: the picker's address.
 */
test("a grant saved on the forge from the picker's link authorizes and returns to the picker's address", async () => {
  const grant = {
    state: "a-state",
    tenant: press.tenant,
    returnPath: `${press.returnPath}#add`,
    installs: ["portal"],
  };
  sessionStorage.setItem(forgeInstallTransactionKey, JSON.stringify(grant));
  held.arrived = { action: "update", state: grant.state };
  await drawnStrict(<ForgeSetupPage />, () => answer(apps));
  expect(held.left.map(addressOf)).toStrictEqual([client.authorizeUrl]);
  expect(await forgeAnswers(connected)).toBe(false);
  expect(returned()).toStrictEqual({
    to: { href: grant.returnPath, replace: true },
    word: null,
  });
});
