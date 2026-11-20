/**
 * The invite page as it is drawn, with a session and without one: each card,
 * what a link's summary draws before sign-in, what its one action does, when the cookie is written and when it is ended,
 * and a redemption sent once however often the page mounts.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import {
  inviteCookieCleared,
  inviteCookieWritten,
} from "../app/core/invitePage.ts";
import { inviteConfiguration } from "./inviteDouble.ts";
import {
  inviteButtonsDrawn as drawnButtons,
  inviteGranted as granted,
  inviteJoinSummary as joinSummary,
  inviteOpened as opened,
  inviteRedemptionsSent as redemptions,
  inviteSummariesSent as summaries,
} from "./invitePageDrawn.tsx";
import { centeredPageSaid } from "./centeredPageDrawn.ts";
import { answer, heldAnswer, press, settled } from "./screenHarness.tsx";
import { styleless } from "./styleless.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test.each(["SignedOut", "SignedIn"] as const)(
  "a person the sign-in service sent back is drawn Invite needed, their cookie ended (%s)",
  async (phase) => {
    const { browser, signIns, sent } = await opened(
      phase,
      { search: "?flow=f-1", cookies: "chuggy_invite=crossed" },
      { configuration: inviteConfiguration("example.com") },
    );
    expect(centeredPageSaid()).toStrictEqual({
      title: "An invite is needed",
      actions: ["Sign in"],
    });
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

test("a browser with no session and no link is drawn the ordinary signed-out card, and summarizes nothing", async () => {
  const { browser, signIns, sent } = await opened("SignedOut", {});
  expect(centeredPageSaid()).toStrictEqual({
    title: "Sign in to chuggy",
    actions: ["Sign in"],
  });
  expect(drawnButtons()).toStrictEqual(["Sign in"]);
  expect(summaries(sent)).toStrictEqual([]);
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

test("a tenant's link opened with no session is titled Join and its workspace, names its inviter and role, and goes nowhere without a press", async () => {
  const { browser, signIns, sent } = await opened(
    "SignedOut",
    { anchor: "t0ken" },
    { configuration: inviteConfiguration("example.com") },
  );
  expect(screen.getByRole("heading").textContent).toBe("Join Acme Co");
  expect(
    screen.getByText("octo-maker invites you to join as a member."),
  ).toBeTruthy();
  expect(drawnButtons()).toStrictEqual(["Sign in with GitHub"]);
  expect(new Set(summaries(sent))).toStrictEqual(new Set([{ token: "t0ken" }]));
  expect(browser.replaced).toStrictEqual(["/invite"]);
  expect(browser.written).toStrictEqual([]);
  expect(signIns).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  expect(redemptions(sent)).toStrictEqual([]);
  await press("Sign in with GitHub");
  expect(browser.written).toStrictEqual([
    inviteCookieWritten("t0ken", "example.com"),
  ]);
  expect(signIns).toStrictEqual(["/invite"]);
  styleless();
});

test.each([
  [
    "a workspace link from its maker",
    { state: "Open", kind: "Workspace", mintedBy: "octo-maker" },
    "Your own chuggy workspace",
    "octo-maker invites you to make a workspace of your own, as its admin.",
  ],
  [
    "a workspace link whose maker the plane does not name",
    { state: "Open", kind: "Workspace" },
    "Your own chuggy workspace",
    "This link makes you a workspace of your own, as its admin.",
  ],
  [
    "a tenant's link making an admin from its maker",
    { ...joinSummary, role: "Admin" },
    "Join Acme Co",
    "octo-maker invites you to join as an admin.",
  ],
  [
    "a tenant's link whose maker the plane does not name",
    { state: "Open", kind: "Tenant", displayName: "Acme Co", role: "Member" },
    "Join Acme Co",
    "This link makes you a member of Acme Co.",
  ],
])(
  "%s is drawn with no session as what it gives, and Sign in with GitHub",
  async (_named, summary, title, line) => {
    const { signIns } = await opened(
      "SignedOut",
      { anchor: "t0ken" },
      { summarized: () => answer(summary) },
    );
    expect(screen.getByRole("heading").textContent).toBe(title);
    expect(screen.getByText(line)).toBeTruthy();
    expect(drawnButtons()).toStrictEqual(["Sign in with GitHub"]);
    await press("Sign in with GitHub");
    expect(signIns).toStrictEqual(["/invite"]);
    styleless();
  },
);

test.each([
  ["the plane summarizes as ended", () => answer({ state: "Ended" })],
  ["the plane does not know", () => answer({}, 404)],
])(
  "a link %s is titled as no longer usable before sign-in, with nothing to press",
  async (_named, summarized) => {
    const { browser, signIns, sent } = await opened(
      "SignedOut",
      { anchor: "t0ken" },
      { summarized },
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "This link can no longer be used",
    );
    expect(
      screen.getByText(
        "This link has been used or revoked, has expired, or was never made. Ask whoever sent it for a new one.",
      ),
    ).toBeTruthy();
    expect(drawnButtons()).toStrictEqual([]);
    expect(browser.written).toStrictEqual([]);
    expect(signIns).toStrictEqual([]);
    expect(redemptions(sent)).toStrictEqual([]);
    styleless();
  },
);

test("a summary unanswered is drawn as reading the link, with nothing to press", async () => {
  const held = heldAnswer();
  await opened(
    "SignedOut",
    { anchor: "t0ken" },
    { summarized: () => held.answered },
  );
  expect(screen.getByText("Reading the link…")).toBeTruthy();
  expect(drawnButtons()).toStrictEqual([]);
  held.release(answer(joinSummary));
  await settled();
  expect(screen.getByRole("heading").textContent).toBe("Join Acme Co");
});

test("a summary that failed says the fault, and Retry reads it again", async () => {
  let fails = true;
  const { sent } = await opened(
    "SignedOut",
    { anchor: "t0ken" },
    {
      summarized: () =>
        fails
          ? answer({ error: { code: "InternalError", message: "no" } }, 500)
          : answer(joinSummary),
    },
  );
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(drawnButtons()).toStrictEqual(["Retry"]);
  const read = summaries(sent).length;
  fails = false;
  await press("Retry");
  expect(summaries(sent).length).toBe(read + 1);
  expect(screen.getByRole("heading").textContent).toBe("Join Acme Co");
  expect(drawnButtons()).toStrictEqual(["Sign in with GitHub"]);
  expect(redemptions(sent)).toStrictEqual([]);
});

test("a deployment that names no domain writes the cookie as the console host's own", async () => {
  const { browser } = await opened("SignedOut", { anchor: "t0ken" });
  await press("Sign in with GitHub");
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
  expect(centeredPageSaid()).toStrictEqual({
    title: "Joining chuggy",
    actions: [],
  });
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
  "a link that %s is drawn as no longer usable, its cookie ended",
  async (_named, answered) => {
    const { browser, sent, remount } = await opened(
      "SignedIn",
      { cookies: "chuggy_invite=crossed" },
      { answered },
    );
    expect(centeredPageSaid()).toStrictEqual({
      title: "This link can no longer be used",
      actions: ["Open chuggy"],
    });
    expect(browser.written).toStrictEqual([inviteCookieCleared(undefined)]);
    expect(browser.left).toStrictEqual([]);
    browser.cookies = "";
    await remount();
    expect(centeredPageSaid().title).toBe("This link can no longer be used");
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
  expect(centeredPageSaid()).toStrictEqual({
    title: "The invite was not accepted",
    actions: ["Retry"],
  });
  expect(screen.getByText("Failed")).toBeTruthy();
  expect(
    screen.getByText("Retry. If it keeps failing, ask whoever sent the link."),
  ).toBeTruthy();
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  expect(redemptions(sent).length).toBe(1);
  fails = false;
  await press("Retry");
  expect(redemptions(sent).length).toBe(2);
  expect(browser.written).toStrictEqual([inviteCookieCleared(undefined)]);
  expect(browser.left).toStrictEqual(["/acme/atlas"]);
});
