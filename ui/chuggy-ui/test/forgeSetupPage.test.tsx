/**
 * The landing the forge sends a person back to after an install, mounted. What
 * is asserted is the traffic and the redirect, not only the words.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ForgeSetupPage } from "../app/browser/ForgeSetupPage.tsx";
import { forgeAuthorizeTransactionKey } from "../app/core/forgeAuthorization.ts";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import { answer, drawnStrict, settled } from "./screenHarness.tsx";
import type { DrawnStrict } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted(
  (): { arrived: Record<string, unknown>; redirects: string[] } => ({
    arrived: {},
    redirects: [],
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
  useSearch: () => held.arrived,
}));
// jscpd:ignore-end -- the case's own doubles resume here

const transaction = {
  state: "a-state",
  app: "worker",
  tenant: "vteng",
  project: "chuggy",
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
    project: transaction.project,
    returnPath: transaction.returnPath,
  });
});

test("a deployment that answers no client says so and sends nobody anywhere", async () => {
  await drawLanding(() => answer({ apps: [] }));
  expect(held.redirects).toStrictEqual([]);
  expect(screen.getByText("Not configured")).toBeTruthy();
});

test("a state that is not this tab's asks nothing and goes nowhere", async () => {
  held.arrived = { ...held.arrived, state: "someone-else" };
  const { sent } = await drawLanding();
  expect(sent).toStrictEqual([]);
  expect(held.redirects).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
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
 * to authorize for yet, and the page says so rather than sending them on. */
test("a request that awaits an owner asks nothing and says what it is", async () => {
  held.arrived = { ...held.arrived, action: "request" };
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(held.redirects).toStrictEqual([]);
  expect(screen.getByText("Requested")).toBeTruthy();
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
