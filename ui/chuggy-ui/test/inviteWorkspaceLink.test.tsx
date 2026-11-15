/**
 * A link that makes a workspace, on the page it is opened at: a reader signed
 * in is asked nothing, the token alone is sent once, and the workspace the
 * plane made is where they are sent.
 */

import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { accessTenantTakenCode } from "../../../src/contract/accessPlane.ts";
import { inviteCookieCleared } from "../app/core/invitePage.ts";
import { inviteConfiguration } from "./inviteDouble.ts";
import {
  inviteButtonsDrawn,
  inviteOpened,
  inviteRedemptionsSent,
} from "./invitePageDrawn.tsx";
import type { InviteOpened } from "./invitePageDrawn.tsx";
import { answer, press } from "./screenHarness.tsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const workspace = "0f8fad5b-d9cb-469f-a165-70867728950e";

const made = {
  tenant: workspace,
  displayName: "octocat's Workspace",
  workspaceMade: true,
  role: "Admin",
  projects: [],
};

const sent = { token: "crossed" };

const projectCreation = `/projects/new?workspace=${workspace}`;

/** A workspace link opened by a reader whose token crossed a sign-in, each send answered by the case. */
function linked(
  answered: () => Response | Promise<Response> = () => answer(made),
): Promise<InviteOpened> {
  return inviteOpened(
    "SignedIn",
    { cookies: "chuggy_invite=crossed" },
    { configuration: inviteConfiguration("example.com"), answered },
  );
}

test("a reader signed in is asked nothing: the token alone is sent, the cookie cleared, and they are sent, in this entry's place, to where the new workspace's first project is made", async () => {
  const { browser, sent: requests } = await linked();
  expect(inviteRedemptionsSent(requests)).toStrictEqual([sent]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByText("New workspace")).toBeNull();
  expect(inviteButtonsDrawn()).toStrictEqual([]);
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual([projectCreation]);
});

test("the send is made once under a double mount and a remount", async () => {
  const { browser, sent: requests, remount } = await linked();
  await remount();
  expect(inviteRedemptionsSent(requests)).toStrictEqual([sent]);
  expect(browser.left).toStrictEqual([projectCreation]);
});

test("a drawn id something holds is a failure Retry mends, the cookie kept until then and no field drawn", async () => {
  let taken = true;
  const { browser, sent: requests } = await linked(() =>
    taken
      ? answer(
          { error: { code: accessTenantTakenCode, message: "taken" } },
          409,
        )
      : answer(made),
  );
  expect(inviteButtonsDrawn()).toStrictEqual(["Retry"]);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(browser.written).toStrictEqual([]);
  expect(browser.left).toStrictEqual([]);
  taken = false;
  await press("Retry");
  expect(inviteRedemptionsSent(requests)).toStrictEqual([sent, sent]);
  expect(browser.written).toStrictEqual([inviteCookieCleared("example.com")]);
  expect(browser.left).toStrictEqual([projectCreation]);
});
