/**
 * The project creation page where the console's router draws it: the
 * workspace its address names is what the form starts on, an address that
 * names none or names what no workspace is called starts it empty, and the
 * address a made workspace's reader is sent to is read back as that workspace
 * whatever it is called.
 *
 * Nothing of the console is mocked: the address bar is this document's and
 * the tree is `App` as the process root mounts it. A document has one router
 * and these cases share it, so each is mounted at the landing and moved to
 * its address, and put back before it is taken down.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { App } from "../app/browser/App.tsx";
import { InviteProvider } from "../app/browser/InvitePage.tsx";
import { SessionProvider } from "../app/browser/session.tsx";
import {
  projectCreationPathIn,
  projectCreationRoutePath,
} from "../app/core/projectCreation.ts";
import { inviteBrowser, inviteSession } from "./inviteDouble.ts";
import { answer, scriptedFetch, settled } from "./screenHarness.tsx";

/** The router restores a scroll position on every load, and jsdom scrolls nothing. */
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => undefined);
});

async function moved(address: string): Promise<void> {
  history.replaceState(null, "", address);
  await settled();
}

afterEach(async () => {
  await moved("/");
  cleanup();
  vi.unstubAllGlobals();
});

/** The console opened signed in and moved to an address, and what its form's fields hold there. */
async function fieldsAt(address: string): Promise<readonly string[]> {
  vi.stubGlobal("fetch", scriptedFetch(() => answer({}, 404)).fetch);
  const { session } = inviteSession("SignedIn");
  const { holder } = inviteBrowser({ pathname: "/" });
  render(
    <SessionProvider holder={session}>
      <InviteProvider holder={holder}>
        <App queryClient={new QueryClient()} />
      </InviteProvider>
    </SessionProvider>,
  );
  await settled();
  await moved(address);
  return ["Workspace", "Project"].map(
    (name) => screen.getByRole<HTMLInputElement>("textbox", { name }).value,
  );
}

test("the form starts on the workspace its address names, its project still to type", async () => {
  expect(
    await fieldsAt(`${projectCreationRoutePath}?workspace=northwind`),
  ).toStrictEqual(["northwind", ""]);
});

test.each(["northwind", "123", "true", "null"])(
  "the address a workspace called %s sends its reader to is read back as that workspace",
  async (workspace) => {
    expect(await fieldsAt(projectCreationPathIn(workspace))).toStrictEqual([
      workspace,
      "",
    ]);
  },
);

test.each([
  ["no workspace", projectCreationRoutePath],
  ["what no workspace is called", `${projectCreationRoutePath}?workspace=No`],
  ["a number", `${projectCreationRoutePath}?workspace=123`],
])("an address naming %s starts the form empty", async (_named, address) => {
  expect(await fieldsAt(address)).toStrictEqual(["", ""]);
});
