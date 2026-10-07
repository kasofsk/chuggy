/**
 * The page the forge returns an authorization to, mounted. What is asserted is
 * the traffic, because a code posted from a return this tab did not start
 * would claim someone else's accounts, and where the person is put back.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ForgeCallbackPage } from "../app/browser/ForgeCallbackPage.tsx";
import { forgeAuthorizeTransactionKey } from "../app/core/forgeAuthorization.ts";
import { forgeReturnKey } from "../app/core/forgeReturn.ts";
import { answer, drawnStrict, settled } from "./screenHarness.tsx";
import type { DrawnStrict, SentRequest } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted(
  (): {
    arrived: Record<string, unknown>;
    navigated: unknown[];
  } => ({ arrived: {}, navigated: [] }),
);

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  currentOrigin: () => "https://console.test",
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

const transaction = {
  state: "a-state",
  verifier: "a-verifier-".padEnd(43, "v"),
  tenant: "vteng",
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

beforeEach(() => {
  held.arrived = { code: "a-code", state: "a-state" };
  held.navigated.length = 0;
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
  return drawnStrict(<ForgeCallbackPage />, () => redeemed());
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

test("an authorization reaching no installation returns with Not installed, for its own tenant", async () => {
  await drawCallback(() => answer({ accounts: [], truncated: false }));
  expect(held.navigated.at(-1)).toStrictEqual(returned);
  expect(heldWord()).toStrictEqual({
    tenant: transaction.tenant,
    standing: "Uninstalled",
    status: "Not installed",
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

test("a code the forge would not redeem returns with Refused", async () => {
  await drawCallback(refusedWith("AuthorizationRefused", 422));
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
