/**
 * A signup link, on the page it is opened at: a reader whose token crossed a
 * sign-in is asked nothing, the token is sent alone, once however often the
 * page mounts, and the workspace it made sends them to the welcome page with
 * the cookie ended.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { inviteCookieCleared } from "../app/core/invitePage.ts";
import { inviteConfiguration } from "./inviteDouble.ts";
import {
  inviteButtonsDrawn,
  inviteOpened,
  inviteRedemptionsSent,
} from "./invitePageDrawn.tsx";
import { answer } from "./screenHarness.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const made = {
  tenant: "0f8e6b52-3c1d-4a7e-9b2f-5d6c7a8b9e01",
  role: "Admin",
  projects: [],
};

function signedUp() {
  return inviteOpened(
    "SignedIn",
    { cookies: "chuggy_invite=crossed" },
    {
      configuration: inviteConfiguration("example.com"),
      answered: () => answer(made),
    },
  );
}

test("a signup link is sent with its token alone as soon as the reader is signed in, and draws no field to name a workspace", async () => {
  const { sent } = await signedUp();
  expect(inviteRedemptionsSent(sent)).toStrictEqual([{ token: "crossed" }]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(inviteButtonsDrawn()).toStrictEqual([]);
});

test("the workspace a signup link made sends its reader, in this entry's place, to the welcome page and ends the cookie, once under a remount", async () => {
  const { browser, sent, remount } = await signedUp();
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual(["/"]);
  await remount();
  expect(inviteRedemptionsSent(sent)).toStrictEqual([{ token: "crossed" }]);
  expect(browser.left).toStrictEqual(["/"]);
});
