/**
 * The invite page where the console's root and its router draw it: a browser
 * with no session at the page's address is drawn the page and not the
 * signed-out card, and a person who pressed Sign in on it comes back signed in
 * to the address the sign-in was asked to return to, where the router draws it.
 *
 * Nothing of the console is mocked. The session is a real holder over the
 * harness' ports, the address bar is this document's, and the tree is `App`
 * as the process root mounts it.
 */

import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "../app/browser/App.tsx";
import { InviteProvider } from "../app/browser/InvitePage.tsx";
import { SessionProvider, sessionBegin } from "../app/browser/session.tsx";
import { inviteRoutePath } from "../app/core/inviteLinks.ts";
import { createSessionHolder } from "../app/core/sessionHolder.ts";
import { inviteBrowser, inviteSession } from "./inviteDouble.ts";
import { answer, scriptedFetch, settled } from "./screenHarness.tsx";
import { sessionHarness } from "./sessionHolderHarness.ts";

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

test("a person returning from sign-in to the invite page is drawn it, and their link is redeemed", async () => {
  const harness = sessionHarness();
  const leaving = createSessionHolder(harness.ports);
  await leaving.load();
  await leaving.signIn(inviteRoutePath);
  const state = new URL(harness.redirects[0] ?? "").searchParams.get("state");
  history.replaceState(
    null,
    "",
    `/auth/callback?code=abc&state=${String(state)}`,
  );
  const scripted = scriptedFetch(() => answer(granted));
  vi.stubGlobal("fetch", scripted.fetch);
  const { browser, holder } = inviteBrowser({
    cookies: "chuggy_invite=crossed",
  });
  const returned = createSessionHolder(harness.ports);
  render(
    <SessionProvider holder={returned}>
      <InviteProvider holder={holder}>
        <App queryClient={new QueryClient()} />
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
    ["/access/v1/invite-links/redemptions", { token: "crossed" }],
  ]);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
});

test("a browser with no session is drawn the invite page at its address, and the signed-out card at any other", async () => {
  const { session } = inviteSession("SignedOut");
  const { holder } = inviteBrowser({ anchor: "t0ken" });
  const tree = (
    <SessionProvider holder={session}>
      <InviteProvider holder={holder}>
        <App queryClient={new QueryClient()} />
      </InviteProvider>
    </SessionProvider>
  );
  history.replaceState(null, "", inviteRoutePath);
  const view = render(tree);
  await settled();
  expect(screen.getByText("Invited")).toBeTruthy();
  view.unmount();
  history.replaceState(null, "", "/acme/atlas");
  render(tree);
  await settled();
  expect(screen.getByText("Signed out")).toBeTruthy();
  expect(screen.queryByText("Invited")).toBeNull();
});
