/**
 * The invite page where the console's root and its router draw it: a browser
 * with no session at the page's address is drawn the page and not the
 * signed-out card, and a person who pressed Sign in on it comes back signed in
 * to the address the sign-in was asked to return to, where the router draws it
 * once any agreement the deployment asks for is given.
 *
 * Nothing of the console is mocked. The session is a real holder over the
 * harness' ports, the address bar is this document's, and the tree is `App`
 * as the process root mounts it.
 */

import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "../app/browser/App.tsx";
import { InviteProvider } from "../app/browser/InvitePage.tsx";
import { apiFetch, sleepMs } from "../app/browser/ports.ts";
import { SessionProvider, sessionBegin } from "../app/browser/session.tsx";
import { consoleStore } from "../app/browser/store.ts";
import { apiPortsOver } from "../app/core/apiPorts.ts";
import { inviteRoutePath } from "../app/core/inviteLinks.ts";
import { createSessionHolder } from "../app/core/sessionHolder.ts";
import type { SessionHolder } from "../app/core/sessionHolder.ts";
import { ConsoleStoreBareProvided } from "./consoleStoreBare.tsx";
import { agreementTerms } from "./agreementPolicies.ts";
import { inviteBrowser, inviteSession } from "./inviteDouble.ts";
import { answer, press, scriptedFetch, settled } from "./screenHarness.tsx";
import {
  sessionHarness,
  sessionHarnessConfiguration,
} from "./sessionHolderHarness.ts";
import type { SessionHarness } from "./sessionHolderHarness.ts";
import { renderCopied } from "./copied.tsx";

/** The router restores a scroll position on every load, and jsdom scrolls nothing. */
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  history.replaceState(null, "", "/");
});

const granted = {
  tenant: "acme",
  role: "Member",
  projects: [{ project: "atlas", roles: ["Viewer"] }],
};

/** A sign-in asked to return to the invite page, the address bar at its
 * callback, and the holder the returning document is drawn under. */
async function returnedFromSignIn(
  harness: SessionHarness,
): Promise<SessionHolder> {
  const leaving = createSessionHolder(harness.ports);
  await leaving.load();
  await leaving.signIn(inviteRoutePath);
  const state = new URL(harness.redirects[0] ?? "").searchParams.get("state");
  history.replaceState(
    null,
    "",
    `/auth/callback?code=abc&state=${String(state)}`,
  );
  return createSessionHolder(harness.ports);
}

test("a person returning from sign-in to the invite page is drawn it, and their link is redeemed", async () => {
  const harness = sessionHarness();
  const returned = await returnedFromSignIn(harness);
  const scripted = scriptedFetch(() => answer(granted));
  vi.stubGlobal("fetch", scripted.fetch);
  const { browser, holder } = inviteBrowser({
    cookies: "chuggy_invite=crossed",
  });
  renderCopied(
    <SessionProvider holder={returned}>
      <InviteProvider holder={holder}>
        <ConsoleStoreBareProvided>
          <App
            queryClient={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          />
        </ConsoleStoreBareProvided>
      </InviteProvider>
    </SessionProvider>,
  );
  await act(() => sessionBegin(returned));
  await settled();
  expect(location.pathname).toBe(inviteRoutePath);
  expect(screen.queryByText("Not Found")).toBeNull();
  expect(
    scripted.sent.map((request) => [request.url, request.body]),
  ).toStrictEqual([
    ["/api/v1/appearance/choice", undefined],
    ["/access/v1/invite-links/redemptions", { token: "crossed" }],
  ]);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
});

test("where the deployment asks for agreement, a link opened before signing in is redeemed only once the person has agreed, at the invite's address", async () => {
  const harness = sessionHarness();
  const sessionAnswer = harness.answer;
  harness.answer = (request) =>
    request === "/config.json"
      ? { ...sessionHarnessConfiguration, agreements: true }
      : sessionAnswer(request);
  const returned = await returnedFromSignIn(harness);
  const scripted = scriptedFetch((request) =>
    request.url === "/agreements/v1/standing"
      ? answer({ policies: [agreementTerms] })
      : request.url === "/agreements/v1/agreements"
        ? answer({
            policies: [{ ...agreementTerms, agreedAt: "2026-11-27T10:00:00Z" }],
          })
        : answer(granted),
  );
  vi.stubGlobal("fetch", scripted.fetch);
  const { browser, holder } = inviteBrowser({
    cookies: "chuggy_invite=crossed",
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  renderCopied(
    <SessionProvider holder={returned}>
      <Provider
        store={consoleStore({
          ports: apiPortsOver(returned, apiFetch, sleepMs),
          client,
        })}
      >
        <InviteProvider holder={holder}>
          <App queryClient={client} />
        </InviteProvider>
      </Provider>
    </SessionProvider>,
  );
  await act(() => sessionBegin(returned));
  await settled();
  const redemption = "/access/v1/invite-links/redemptions";
  expect(scripted.sent.map((request) => request.url)).toStrictEqual([
    "/agreements/v1/standing",
  ]);
  await press("Agree and continue");
  expect(location.pathname).toBe(inviteRoutePath);
  const urls = scripted.sent.map((request) => request.url);
  expect(urls.indexOf(redemption)).toBeGreaterThan(
    urls.indexOf("/agreements/v1/agreements"),
  );
  expect(urls.filter((url) => url === redemption)).toHaveLength(1);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
});

test("a browser with no session is drawn the invite page at its address, and the signed-out card at any other", async () => {
  vi.stubGlobal(
    "fetch",
    scriptedFetch(() => answer({ state: "Open", kind: "Workspace" })).fetch,
  );
  const { session } = inviteSession("SignedOut");
  const { holder } = inviteBrowser({ anchor: "t0ken" });
  const tree = (
    <SessionProvider holder={session}>
      <InviteProvider holder={holder}>
        <ConsoleStoreBareProvided>
          <App
            queryClient={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          />
        </ConsoleStoreBareProvided>
      </InviteProvider>
    </SessionProvider>
  );
  history.replaceState(null, "", inviteRoutePath);
  const view = renderCopied(tree);
  await settled();
  expect(screen.getByText("Your own chuggy workspace")).toBeTruthy();
  view.unmount();
  history.replaceState(null, "", "/acme/atlas");
  renderCopied(tree);
  await settled();
  expect(
    screen.getByRole("heading", { name: "Sign in to chuggy" }),
  ).toBeTruthy();
  expect(screen.queryByText("Your own chuggy workspace")).toBeNull();
});
