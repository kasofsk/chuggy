/**
 * The account menu, mounted: its trigger the reader's initials where the
 * access plane names them and a plain mark where it does not, named the
 * account menu either way, and its entries in order — who the reader is where
 * the answer says, the settings, the preferences and signing out, and nothing
 * else.
 */

import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { accessPlaneBasePath } from "../../../src/contract/accessPlane.ts";
import { AccountMenu } from "../app/browser/shell/AccountMenu.tsx";
import type { SettingsNavParams } from "../app/core/settingsNav.ts";
import { answer, drawnStrict, settled, turned } from "./screenHarness.tsx";
import { viewportAtEm, viewportDeskEm } from "./viewport.ts";

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (
    props: Readonly<Record<string, unknown>> & {
      readonly children?: ReactNode;
      readonly to?: string;
      readonly params?: unknown;
    },
  ) => {
    const { children, to, params, ...rest } = props;
    void params;
    return (
      <a href={to} {...rest}>
        {children}
      </a>
    );
  },
}));

const accountPath = `${accessPlaneBasePath}/account`;

const caller = { subject: "member", principal: "issuer member" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const inProject: SettingsNavParams = { tenant: "acme", project: "atlas" };

async function accountMenuOpened(
  served: Response,
  params: SettingsNavParams | undefined,
): Promise<HTMLElement> {
  viewportAtEm(viewportDeskEm);
  await drawnStrict(<AccountMenu params={params} />, (request) =>
    request.url === accountPath ? served.clone() : answer({}, 404),
  );
  await settled();
  await turned(() => {
    fireEvent.keyDown(screen.getByRole("button", { name: "Account menu" }), {
      key: "ArrowDown",
    });
  });
  return screen.findByRole("menu");
}

/** The menu's entries in order: each line of who the reader is, then each
 * item. */
function entriesOf(menu: HTMLElement): readonly string[] {
  return Array.from(
    menu.querySelectorAll(".account-name > span, [role=menuitem]"),
    (entry) => entry.textContent,
  );
}

test("where the answer names the reader the trigger is their initials, and the menu leads with their login and email", async () => {
  const menu = await accountMenuOpened(
    answer({ ...caller, githubLogin: "mona-lisa", email: "mona@example.com" }),
    inProject,
  );
  const trigger = screen.getByRole("button", { name: "Account menu" });
  expect(trigger.textContent).toBe("ML");
  expect(entriesOf(menu)).toStrictEqual([
    "mona-lisa",
    "mona@example.com",
    "Settings",
    "Preferences",
    "Sign out",
  ]);
  expect(within(menu).queryAllByRole("menuitemradio")).toStrictEqual([]);
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .slice(0, 2)
      .map((item) => item.getAttribute("href")),
  ).toStrictEqual([
    "/$tenant/$project/settings",
    "/$tenant/$project/settings/preferences",
  ]);
});

test("where the answer has no login the initials are the email's", async () => {
  await accountMenuOpened(
    answer({ ...caller, email: "jane.doe@example.com" }),
    inProject,
  );
  expect(screen.getByRole("button", { name: "Account menu" }).textContent).toBe(
    "JD",
  );
});

test.each([
  { said: "names neither", served: () => answer(caller) },
  { said: "could not be read", served: () => answer({}, 503) },
])(
  "where the answer $said the trigger is a plain mark and the menu names nobody",
  async ({ served }) => {
    const menu = await accountMenuOpened(served(), inProject);
    const trigger = screen.getByRole("button", { name: "Account menu" });
    expect(trigger.textContent).toBe("");
    expect(trigger.querySelector("svg")).not.toBeNull();
    expect(entriesOf(menu)).toStrictEqual([
      "Settings",
      "Preferences",
      "Sign out",
    ]);
  },
);

test("outside every project the places are the workspace's, and where no workspace is named the menu holds signing out alone", async () => {
  const menu = await accountMenuOpened(answer(caller), { tenant: "acme" });
  expect(
    within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.getAttribute("href")),
  ).toStrictEqual([
    "/tenants/$tenant/settings",
    "/tenants/$tenant/settings/preferences",
    null,
  ]);
  cleanup();
  const bare = await accountMenuOpened(answer(caller), undefined);
  expect(entriesOf(bare)).toStrictEqual(["Sign out"]);
});
