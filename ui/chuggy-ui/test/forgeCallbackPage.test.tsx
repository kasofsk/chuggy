/**
 * The page the forge returns an authorization to, mounted. What is asserted is
 * the traffic, because a code posted from a return this tab did not start
 * would claim someone else's accounts.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { ForgeCallbackPage } from "../app/browser/ForgeCallbackPage.tsx";
import { forgeAuthorizeTransactionKey } from "../app/core/forgeAuthorization.ts";
import { answer, drawnStrict, settled } from "./screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted((): { arrived: Record<string, unknown> } => ({
  arrived: {},
}));

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => "https://console.test",
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  useSearch: () => held.arrived,
}));
// jscpd:ignore-end -- the case's own doubles resume here

const transaction = {
  state: "a-state",
  verifier: "a-verifier-".padEnd(43, "v"),
  tenant: "vteng",
  project: "chuggy",
  returnPath: "/vteng/chuggy/repositories",
};

const authorized = {
  accounts: [
    {
      account: "kasofsk",
      accountKind: "Organization",
      proof: "Proven",
      apps: [
        { app: "portal", claim: "Claimed" },
        { app: "worker", claim: "Missing" },
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

const apps = {
  apps: [
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
  ],
};

beforeEach(() => {
  held.arrived = { code: "a-code", state: "a-state" };
  sessionStorage.setItem(
    forgeAuthorizeTransactionKey,
    JSON.stringify(transaction),
  );
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

function drawCallback(
  redeemed: () => Response = () => answer(authorized),
): Promise<DrawnStrict> {
  return drawnStrict(<ForgeCallbackPage />, (request) =>
    request.method === "POST" ? redeemed() : answer(apps),
  );
}

function posts(sent: readonly SentRequest[]): readonly SentRequest[] {
  return sent.filter((request) => request.method === "POST");
}

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

test("each account is one line, and a missing app is offered its install", async () => {
  await drawCallback();
  expect(screen.getByText("kasofsk")).toBeTruthy();
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(screen.getByText("globex")).toBeTruthy();
  expect(screen.getByText("Not owner")).toBeTruthy();
  const install = screen.getByRole<HTMLAnchorElement>("link", {
    name: "Worker",
  });
  expect(install.href).toContain(apps.apps[1]?.installUrl ?? "");
  expect(screen.queryByRole("link", { name: "Portal" })).toBeNull();
  expect(
    screen.getByRole<HTMLAnchorElement>("link", { name: "Repositories" })
      .pathname,
  ).toBe(transaction.returnPath);
});

test("a state that is not this tab's redeems nothing", async () => {
  held.arrived = { ...held.arrived, state: "someone-else" };
  const { sent } = await drawCallback();
  expect(sent).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
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

test("a person who declined at the forge is told so and nothing is posted", async () => {
  held.arrived = { error: "access_denied", state: "a-state" };
  expect((await drawCallback()).sent).toStrictEqual([]);
  expect(screen.getByText("Declined")).toBeTruthy();
});

test("a code the forge would not redeem is one word, with no account drawn", async () => {
  await drawCallback(() =>
    answer(
      {
        error: {
          code: "AuthorizationRefused",
          message: "The forge did not accept the authorization.",
        },
      },
      422,
    ),
  );
  expect(screen.getByText("Refused")).toBeTruthy();
  expect(screen.queryByText("Connected")).toBeNull();
});

test("the code is posted once however often the page is drawn", async () => {
  const landed = await drawCallback();
  landed.redraw();
  await settled();
  expect(posts(landed.sent)).toHaveLength(1);
  expect(screen.queryByText("Not expected")).toBeNull();
});
