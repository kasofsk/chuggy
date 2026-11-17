/**
 * The account menu: its trigger the reader's initials, from their login or
 * else their email, or a plain mark where the account answers neither, and
 * named the account menu either way; and what it opens, in order, the login
 * and the email as plain text where each is answered, Settings, Preferences
 * and Sign out, with nothing else and no choice of its own.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { AccessCallerAccount } from "../../../src/contract/accessPlane.ts";
import { AccountMenu } from "../app/browser/shell/AccountMenu.tsx";
import { accountMenuShown } from "../app/core/accountMenu.ts";
import { answer, drawnStrict, settled, turned } from "./screenHarness.tsx";
import { atlas } from "./shellRouter.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";
import type * as RouterModule from "@tanstack/react-router";

vi.mock("@tanstack/react-router", async (importOriginal) =>
  (await import("./shellRouter.tsx")).routerDouble(
    await importOriginal<typeof RouterModule>(),
    { outlet: () => null, params: () => atlas },
  ),
);

const accountPath = "/access/v1/account";

const ada: AccessCallerAccount = {
  subject: "subject-ada",
  principal: "issuer subject-ada",
  githubLogin: "ada-lovelace",
  email: "countess@example.com",
};

/** The same account with no login on record. */
const emailOnly: AccessCallerAccount = {
  subject: ada.subject,
  principal: ada.principal,
  email: "countess@example.com",
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The menu drawn in a frame, its account read answered `body`, or refused
 * where there is none. */
async function accountMenuDrawn(
  body: unknown,
  frame: { readonly tenant?: string; readonly project?: string } = atlas,
): Promise<HTMLElement> {
  viewportAtEm(viewportDeskEm);
  await drawnStrict(
    <AccountMenu tenant={frame.tenant} project={frame.project} />,
    (request) =>
      request.url === accountPath && body !== undefined
        ? answer(body)
        : answer({}, 404),
  );
  await settled();
  return screen.getByRole("button", { name: "Account menu" });
}

async function accountMenuOpened(trigger: HTMLElement): Promise<HTMLElement> {
  await turned(() => {
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
  });
  return screen.findByRole("menu");
}

function accountMenuItems(menu: HTMLElement): readonly string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent);
}

test("the initials are the login's words', else the email's, and none where neither is answered", () => {
  expect(accountMenuShown(ada).initials).toBe("AL");
  expect(accountMenuShown({ ...ada, githubLogin: "octocat" }).initials).toBe(
    "O",
  );
  expect(
    accountMenuShown({ ...ada, githubLogin: "grace-brewster-hopper" }).initials,
  ).toBe("GB");
  expect(accountMenuShown(emailOnly)).toStrictEqual({
    login: undefined,
    email: "countess@example.com",
    initials: "C",
  });
  expect(
    accountMenuShown({ ...emailOnly, email: "jean.bartik@example.com" })
      .initials,
  ).toBe("JB");
  expect(accountMenuShown(undefined)).toStrictEqual({
    login: undefined,
    email: undefined,
    initials: undefined,
  });
  expect(
    accountMenuShown({ subject: "s", principal: "issuer s", account: true }),
  ).toStrictEqual({ login: undefined, email: undefined, initials: undefined });
});

test("with an account answered the trigger shows its initials and the menu leads with the login and email, then Settings, Preferences and Sign out", async () => {
  const trigger = await accountMenuDrawn(ada);
  expect(trigger.textContent).toBe("AL");
  expect(trigger.querySelector("svg")).toBeNull();
  const menu = await accountMenuOpened(trigger);
  expect(accountMenuItems(menu)).toStrictEqual([
    "Settings",
    "Preferences",
    "Sign out",
  ]);
  const who = within(menu).getByText("ada-lovelace");
  expect(who.closest("[role=menuitem]")).toBeNull();
  const email = within(menu).getByText("countess@example.com");
  expect(email.closest("[role=menuitem]")).toBeNull();
  expect(
    who.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(
    email.compareDocumentPosition(within(menu).getByText("Settings")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).not.toBe(0);
  expect(within(menu).queryAllByRole("menuitemradio")).toStrictEqual([]);
  expect(within(menu).queryAllByRole("menuitemcheckbox")).toStrictEqual([]);
});

test("with an account answering only its email the trigger shows the email's initials and the menu names the email alone", async () => {
  const trigger = await accountMenuDrawn(emailOnly);
  expect(trigger.textContent).toBe("C");
  const menu = await accountMenuOpened(trigger);
  expect(within(menu).getByText("countess@example.com")).toBeDefined();
  expect(within(menu).queryByText("ada-lovelace")).toBeNull();
  expect(accountMenuItems(menu)).toStrictEqual([
    "Settings",
    "Preferences",
    "Sign out",
  ]);
});

test.each([
  ["an account answering neither", { subject: "s", principal: "issuer s" }],
  ["no account answer", undefined],
])(
  "with %s the trigger is a plain mark still named the account menu, and the menu holds Settings, Preferences and Sign out alone",
  async (_named, body) => {
    const trigger = await accountMenuDrawn(body);
    expect(trigger.textContent).toBe("");
    expect(trigger.querySelector("svg")).not.toBeNull();
    const menu = await accountMenuOpened(trigger);
    expect(menu.textContent).toBe("SettingsPreferencesSign out");
    expect(accountMenuItems(menu)).toStrictEqual([
      "Settings",
      "Preferences",
      "Sign out",
    ]);
  },
);

test("in a workspace outside every project the menu still names Settings and Preferences", async () => {
  const menu = await accountMenuOpened(
    await accountMenuDrawn(ada, { tenant: "acme" }),
  );
  expect(accountMenuItems(menu)).toStrictEqual([
    "Settings",
    "Preferences",
    "Sign out",
  ]);
});

test("where no workspace is named, which every settings page's address names, the menu holds Sign out alone", async () => {
  const menu = await accountMenuOpened(await accountMenuDrawn(ada, {}));
  expect(accountMenuItems(menu)).toStrictEqual(["Sign out"]);
});
