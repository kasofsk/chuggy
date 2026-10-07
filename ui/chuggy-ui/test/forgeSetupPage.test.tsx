/**
 * The landing the forge sends a person back to after an install, mounted. What
 * is asserted is the traffic and the redirect, not only the words.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ForgeSetupPage } from "../app/browser/ForgeSetupPage.tsx";
import { forgeAuthorizeTransactionKey } from "../app/core/forgeAuthorization.ts";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import { forgeReturnKey } from "../app/core/forgeReturn.ts";
import { answer, drawnStrict, settled } from "./screenHarness.tsx";
import type { DrawnStrict } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted(
  (): {
    arrived: Record<string, unknown>;
    redirects: string[];
    navigated: unknown[];
  } => ({
    arrived: {},
    redirects: [],
    navigated: [],
  }),
);

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  redirect: (url: string) => {
    held.redirects.push(url);
  },
}));

vi.mock("@tanstack/react-router", () => ({
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

const transaction = {
  state: "a-state",
  app: "worker",
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
};

const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

const apps = { apps: [], authorization: client };

beforeEach(() => {
  held.arrived = { action: "install", state: "a-state" };
  held.redirects.length = 0;
  held.navigated.length = 0;
  sessionStorage.setItem(
    forgeInstallTransactionKey,
    JSON.stringify(transaction),
  );
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function drawLanding(
  answered: () => Response = () => answer(apps),
): Promise<DrawnStrict> {
  return drawnStrict(<ForgeSetupPage />, answered);
}

/** The navigation that puts the person back where they followed the install. */
const returned = { href: transaction.returnPath, replace: true };

/** The word held for the page returned to, or `null` where none is. */
function heldWord(): unknown {
  return JSON.parse(sessionStorage.getItem(forgeReturnKey) ?? "null");
}

test("a matching install sends the person to authorize, with this tab's transaction stored", async () => {
  const { sent } = await drawLanding();
  expect(sent.map((request) => request.method)).toStrictEqual(["GET"]);
  expect(sent[0]?.url).toContain("/forge/github");
  expect(held.redirects).toHaveLength(1);
  const url = new URL(held.redirects[0] ?? "");
  expect(`${url.origin}${url.pathname}`).toBe(client.authorizeUrl);
  expect(url.searchParams.get("client_id")).toBe(client.clientId);
  const stored = JSON.parse(
    sessionStorage.getItem(forgeAuthorizeTransactionKey) ?? "{}",
  ) as Record<string, unknown>;
  expect(url.searchParams.get("state")).toBe(stored["state"]);
  expect(stored).toMatchObject({
    tenant: transaction.tenant,
    returnPath: transaction.returnPath,
  });
  expect(held.navigated).toStrictEqual([]);
  expect(screen.getByRole("main").textContent).toBe("SetupConnecting");
});

test("a deployment that answers no client returns with Not configured, sending nobody to the forge", async () => {
  await drawLanding(() => answer({ apps: [] }));
  expect(held.redirects).toStrictEqual([]);
  expect(held.navigated).toStrictEqual([returned]);
  expect(heldWord()).toStrictEqual({
    tenant: transaction.tenant,
    standing: "Failed",
    status: "Not configured",
  });
});

test("a state that is not this tab's asks nothing, stays and links home", async () => {
  held.arrived = { ...held.arrived, state: "someone-else" };
  const { sent } = await drawLanding();
  expect(sent).toStrictEqual([]);
  expect(held.redirects).toStrictEqual([]);
  expect(held.navigated).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
  expect(
    screen.getByRole<HTMLAnchorElement>("link", { name: "Home" }).pathname,
  ).toBe("/");
});

test("a landing carrying no state asks nothing", async () => {
  held.arrived = { action: "install" };
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

/** The transaction is spent on the first landing, so a reload — which is the
 * same address opened a second time — has nothing left to match against. */
test("the transaction is spent, and the landing opened again asks nothing", async () => {
  await drawLanding();
  expect(sessionStorage.getItem(forgeInstallTransactionKey)).toBeNull();
  cleanup();
  held.redirects.length = 0;
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(held.redirects).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

/** A `request` is somebody asking an owner to install; nothing is installed
 * to authorize for yet, so the person goes back with that word. */
test("a request that awaits an owner asks nothing and returns with Requested", async () => {
  held.arrived = { ...held.arrived, action: "request" };
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(held.redirects).toStrictEqual([]);
  expect(held.navigated).toStrictEqual([returned]);
  expect(heldWord()).toMatchObject({
    standing: "Unfinished",
    status: "Requested",
  });
});

/**
 * The decision is taken once and kept, which is what a re-render would
 * otherwise undo: the transaction is spent by the taking, so a second taking
 * finds nothing and the landing that just matched says it was not expected.
 */
test("the decision survives the page being drawn again", async () => {
  const landed = await drawLanding();
  landed.redraw();
  await settled();
  expect(landed.sent).toHaveLength(1);
  expect(held.redirects).toHaveLength(1);
  expect(screen.queryByText("Not expected")).toBeNull();
});
