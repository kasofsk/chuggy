/**
 * The invite page as it is drawn, with a session and without one: each card,
 * what its one action does, when the cookie is written and when it is ended,
 * and a redemption sent once however often the page mounts.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

import type { ConsoleConfiguration } from "../app/core/configuration.ts";
import type { InviteHolder } from "../app/core/inviteHolder.ts";
import {
  inviteCookieCleared,
  inviteCookieWritten,
} from "../app/core/invitePage.ts";
import type { SessionHolder, SessionPhase } from "../app/core/sessionHolder.ts";
import { InvitePage, InviteProvider } from "../app/browser/InvitePage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import {
  inviteBrowser,
  inviteConfiguration,
  inviteSession,
} from "./inviteDouble.ts";
import type { InviteBrowser } from "./inviteDouble.ts";
import {
  answer,
  heldAnswer,
  press,
  scriptedFetch,
  settled,
} from "./screenHarness.tsx";
import type { SentRequest } from "./screenHarness.tsx";
import { styleless } from "./styleless.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const redemptionPath = "/access/v1/invite-links/redemptions";

const granted = {
  tenant: "acme",
  role: "Member",
  projects: [{ project: "atlas", roles: ["Viewer"] }],
};

function page(session: SessionHolder, invite: InviteHolder): ReactNode {
  return (
    <StrictMode>
      <SessionProvider holder={session}>
        <InviteProvider holder={invite}>
          <InvitePage />
        </InviteProvider>
      </SessionProvider>
    </StrictMode>
  );
}

interface Opened {
  readonly browser: InviteBrowser;
  readonly signIns: readonly (string | undefined)[];
  readonly sent: readonly SentRequest[];
  /** The page taken down and mounted again in the same document. */
  readonly remount: () => Promise<void>;
}

/** The page opened under `StrictMode`, as the console's root mounts it. */
async function opened(
  phase: SessionPhase,
  at: Parameters<typeof inviteBrowser>[0],
  served: {
    readonly answered?: (request: SentRequest) => Response | Promise<Response>;
    readonly configuration?: ConsoleConfiguration;
  } = {},
): Promise<Opened> {
  const { browser, holder } = inviteBrowser(at);
  const { session, signIns } = inviteSession(phase, served.configuration);
  const scripted = scriptedFetch(served.answered ?? (() => answer(granted)));
  vi.stubGlobal("fetch", scripted.fetch);
  holder.arrive();
  let view = render(page(session, holder));
  await settled();
  return {
    browser,
    signIns,
    sent: scripted.sent,
    remount: async () => {
      view.unmount();
      view = render(page(session, holder));
      await settled();
    },
  };
}

function redemptions(sent: readonly SentRequest[]): readonly unknown[] {
  return sent
    .filter((request) => request.url.endsWith(redemptionPath))
    .map((request) => request.body);
}

function drawnButtons(): readonly (string | null)[] {
  return screen.queryAllByRole("button").map((button) => button.textContent);
}

test.each(["SignedOut", "SignedIn"] as const)(
  "a person the sign-in service sent back is drawn Invite needed, their cookie ended (%s)",
  async (phase) => {
    const { browser, signIns, sent } = await opened(
      phase,
      { search: "?flow=f-1", cookies: "chuggy_invite=crossed" },
      { configuration: inviteConfiguration("example.com") },
    );
    expect(screen.getByText("Invite needed")).toBeTruthy();
    expect(drawnButtons()).toStrictEqual(["Sign in"]);
    expect(new Set(browser.written)).toStrictEqual(
      new Set([inviteCookieCleared("example.com")]),
    );
    expect(redemptions(sent)).toStrictEqual([]);
    expect(signIns).toStrictEqual([]);
    const cleared = browser.written.length;
    await press("Sign in");
    expect(signIns).toStrictEqual(["/"]);
    expect(browser.written.length).toBe(cleared);
    styleless();
  },
);

test("a browser with no session and no link is drawn the ordinary signed-out card", async () => {
  const { browser, signIns } = await opened("SignedOut", {});
  expect(screen.getByText("Signed out")).toBeTruthy();
  expect(drawnButtons()).toStrictEqual(["Sign in"]);
  expect(screen.queryByText("Invited")).toBeNull();
  await press("Sign in");
  expect(signIns.length).toBe(1);
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
});

test("a reader with no link is sent to the landing page, and nothing is redeemed", async () => {
  const { browser, sent } = await opened("SignedIn", {});
  expect(new Set(browser.left)).toStrictEqual(new Set(["/"]));
  expect(redemptions(sent)).toStrictEqual([]);
  expect(drawnButtons()).toStrictEqual([]);
  expect(browser.written).toStrictEqual([]);
});

test("a link opened with no session is drawn Invited and goes nowhere without a press", async () => {
  const { browser, signIns, sent } = await opened(
    "SignedOut",
    { anchor: "t0ken" },
    { configuration: inviteConfiguration("example.com") },
  );
  expect(screen.getByText("Invited")).toBeTruthy();
  expect(drawnButtons()).toStrictEqual(["Sign in"]);
  expect(browser.replaced).toStrictEqual(["/invite"]);
  expect(browser.written).toStrictEqual([]);
  expect(signIns).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  expect(redemptions(sent)).toStrictEqual([]);
  await press("Sign in");
  expect(browser.written).toStrictEqual([
    inviteCookieWritten("t0ken", "example.com"),
  ]);
  expect(signIns).toStrictEqual(["/invite"]);
  styleless();
});

test("a deployment that names no domain writes the cookie as the console host's own", async () => {
  const { browser } = await opened("SignedOut", { anchor: "t0ken" });
  await press("Sign in");
  expect(browser.written).toStrictEqual([
    inviteCookieWritten("t0ken", undefined),
  ]);
});

test("a reader's link is redeemed once under a double mount and again under a remount, and sends them to their project", async () => {
  const { browser, sent, remount } = await opened(
    "SignedIn",
    { cookies: "chuggy_invite=crossed" },
    { configuration: inviteConfiguration("example.com") },
  );
  expect(redemptions(sent)).toStrictEqual([{ token: "crossed" }]);
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
  browser.cookies = "";
  await remount();
  expect(redemptions(sent)).toStrictEqual([{ token: "crossed" }]);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
  expect(drawnButtons()).toStrictEqual([]);
});

test("a link opened by a reader is redeemed with the token from the fragment, and no cookie is written", async () => {
  const { browser, sent } = await opened("SignedIn", { anchor: "t0ken" });
  expect(redemptions(sent)).toStrictEqual([{ token: "t0ken" }]);
  expect(browser.written).toStrictEqual([inviteCookieCleared(undefined)]);
});

test("a redemption unanswered is drawn as joining, with nothing to press", async () => {
  const held = heldAnswer();
  const { browser } = await opened(
    "SignedIn",
    { anchor: "t0ken" },
    { answered: () => held.answered },
  );
  expect(screen.getByText("Joining…")).toBeTruthy();
  expect(drawnButtons()).toStrictEqual([]);
  expect(browser.written).toStrictEqual([]);
  held.release(answer(granted));
  await settled();
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
});

test.each([
  ["the plane does not know", () => answer({}, 404)],
  [
    "is a request the plane will not read",
    () => answer({ error: { code: "InvalidRequest", message: "no" } }, 400),
  ],
])(
  "a link that %s is drawn Link not valid, its cookie ended",
  async (_named, answered) => {
    const { browser, sent, remount } = await opened(
      "SignedIn",
      { cookies: "chuggy_invite=crossed" },
      { answered },
    );
    expect(screen.getByText("Link not valid")).toBeTruthy();
    expect(drawnButtons()).toStrictEqual(["Open chuggy"]);
    expect(browser.written).toStrictEqual([inviteCookieCleared(undefined)]);
    expect(browser.left).toStrictEqual([]);
    browser.cookies = "";
    await remount();
    expect(screen.getByText("Link not valid")).toBeTruthy();
    expect(redemptions(sent).length).toBe(1);
    await press("Open chuggy");
    expect(browser.left).toStrictEqual(["/"]);
    styleless();
  },
);

test("a redemption that failed keeps the cookie and says the fault, and Retry sends it once more", async () => {
  let fails = true;
  const { browser, sent } = await opened(
    "SignedIn",
    { cookies: "chuggy_invite=crossed" },
    {
      answered: () =>
        fails
          ? answer({ error: { code: "InternalError", message: "no" } }, 500)
          : answer(granted),
    },
  );
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(drawnButtons()).toStrictEqual(["Retry"]);
  expect(screen.queryByText("Link not valid")).toBeNull();
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  expect(redemptions(sent).length).toBe(1);
  fails = false;
  await press("Retry");
  expect(redemptions(sent).length).toBe(2);
  expect(browser.written).toStrictEqual([inviteCookieCleared(undefined)]);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
});
