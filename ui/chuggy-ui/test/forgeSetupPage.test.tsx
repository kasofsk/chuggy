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
import { answer, drawnStrict, press, settled } from "./screenHarness.tsx";
import type { DrawnStrict } from "./screenHarness.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

const held = vi.hoisted(
  (): {
    arrived: Record<string, unknown>;
    redirects: string[];
    replaced: string[];
    navigated: unknown[];
  } => ({
    arrived: {},
    redirects: [],
    replaced: [],
    navigated: [],
  }),
);

/**
 * The digest is a double that answers at once: the real one is answered from
 * another thread, so a redirect that waits for it can land after the turns a
 * case waits out, or in the case that follows. What a challenge must equal is
 * asserted in `ui/chuggy-ui/test/pkce.test.ts`.
 */
vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
  digest: (message: Uint8Array) => Promise.resolve(message),
  redirect: (url: string) => {
    held.redirects.push(url);
  },
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

const transaction = {
  state: "a-state",
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
  installs: ["portal"],
};

const client = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

const apps = { apps: [], authorization: client };

beforeEach(() => {
  held.arrived = { action: "install", state: "a-state" };
  held.redirects.length = 0;
  held.replaced.length = 0;
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

/** The installs the press has been sent on to go with it, which is what the
 * callback reads before it sends anybody on again. */
test("a matching install sends the person to authorize, with this tab's transaction stored", async () => {
  const { sent } = await drawLanding();
  expect(sent.map((request) => request.method)).toStrictEqual(["GET"]);
  expect(sent[0]?.url).toContain("/forge/github");
  expect(held.replaced).toHaveLength(1);
  const url = new URL(held.replaced[0] ?? "");
  expect(`${url.origin}${url.pathname}`).toBe(client.authorizeUrl);
  expect(url.searchParams.get("client_id")).toBe(client.clientId);
  const stored = JSON.parse(
    sessionStorage.getItem(forgeAuthorizeTransactionKey) ?? "{}",
  ) as Record<string, unknown>;
  expect(url.searchParams.get("state")).toBe(stored["state"]);
  expect(stored).toMatchObject({
    tenant: transaction.tenant,
    returnPath: transaction.returnPath,
    installs: transaction.installs,
  });
  expect(held.navigated).toStrictEqual([]);
  expect(screen.getByRole("main").textContent).toBe("SetupConnecting");
});

/** Left as an entry of its own, the landing is what Back from the next
 * install's page opens, and opened again it takes that install's transaction. */
test("a matching install leaves in this address's place, so no visit back lands on it", async () => {
  await drawLanding();
  expect(held.replaced).toHaveLength(1);
  expect(held.redirects).toStrictEqual([]);
});

test("a deployment that answers no client returns with Not configured, sending nobody to the forge", async () => {
  await drawLanding(() => answer({ apps: [] }));
  expect(held.replaced).toStrictEqual([]);
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
  expect(held.replaced).toStrictEqual([]);
  expect(held.navigated).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
  expect(
    screen.getByRole<HTMLAnchorElement>("link", { name: "Home" }).pathname,
  ).toBe("/");
});

/** What the landing did beyond drawing: every request, every address left for
 * and every navigation, which for a return it cannot match is none of them. */
function landingActs(landed: DrawnStrict): readonly unknown[] {
  return [
    ...landed.sent,
    ...held.replaced,
    ...held.redirects,
    ...held.navigated,
  ];
}

/** GitHub's own settings page sends this return to whoever saves there, so it
 * is the ordinary way back for a person this tab never sent. */
test("an update with nothing stored asks nothing, says where from without alarm and links home", async () => {
  sessionStorage.clear();
  held.arrived = { action: "update" };
  const landed = await drawLanding();
  expect(landingActs(landed)).toStrictEqual([]);
  expect(heldWord()).toBeNull();
  expect(screen.getByRole("main").textContent).toBe(
    "SetupBack from GitHubHome",
  );
  expect(
    screen.getByText("Back from GitHub").classList.contains("notice-info"),
  ).toBe(true);
  expect(
    screen.getByRole<HTMLAnchorElement>("link", { name: "Home" }).pathname,
  ).toBe("/");
});

/** The state is what proves a return is this tab's, so one without it starts
 * no authorization; the page the press left by is still this tab's own. */
test.each([[undefined], ["someone-else"]])(
  "an update carrying state %s against this tab's press starts nothing and offers the page it left by",
  async (state) => {
    held.arrived = { action: "update", state };
    const landed = await drawLanding();
    expect(landingActs(landed)).toStrictEqual([]);
    expect(screen.getByRole("main").textContent).toBe(
      "SetupBack from GitHubContinue",
    );
    expect(sessionStorage.getItem(forgeInstallTransactionKey)).toBeNull();
    await press("Continue");
    expect(landingActs(landed)).toStrictEqual([returned]);
    expect(heldWord()).toBeNull();
  },
);

test.each([["install"], ["request"]])(
  "an %s with nothing stored is still refused, in the danger tone",
  async (action) => {
    sessionStorage.clear();
    held.arrived = { action, state: "a-state" };
    expect(landingActs(await drawLanding())).toStrictEqual([]);
    expect(
      screen.getByText("Not expected").classList.contains("notice-danger"),
    ).toBe(true);
    expect(screen.queryByText("Back from GitHub")).toBeNull();
  },
);

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
  held.replaced.length = 0;
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(held.replaced).toStrictEqual([]);
  expect(screen.getByText("Not expected")).toBeTruthy();
});

/** A `request` is somebody asking an owner to install; nothing is installed
 * to authorize for yet, so the person goes back with that word. */
test("a request that awaits an owner asks nothing and returns with Requested", async () => {
  held.arrived = { ...held.arrived, action: "request" };
  expect((await drawLanding()).sent).toStrictEqual([]);
  expect(held.replaced).toStrictEqual([]);
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
  expect(held.replaced).toHaveLength(1);
  expect(screen.queryByText("Not expected")).toBeNull();
});
