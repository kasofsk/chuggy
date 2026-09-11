/**
 * The first half of connecting an account: the two addresses the dialog offers,
 * and what following one leaves behind.
 *
 * THE EQUALITY IS THE WHOLE DESIGN. The landing claims only for a state it can
 * match against the transaction this tab stored, so a link carrying one state
 * while the store holds another claims nothing, and a link followed with
 * nothing stored at all claims nothing either — either way every install in the
 * deployment reads as unexpected. What is asserted is therefore that the state
 * on the address is the state in the store.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { ConnectAccount } from "../app/browser/repositories/ConnectAccount.tsx";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";

const returnPath = "/acme/atlas/repositories";

const apps = {
  apps: [
    {
      app: "portal",
      id: "1",
      slug: "chuggy-portal",
      installUrl: "https://forge.test/apps/chuggy-portal/installations/new",
    },
    {
      app: "worker",
      id: "2",
      slug: "chuggy-worker",
      installUrl: "https://forge.test/apps/chuggy-worker/installations/new",
    },
  ],
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function drawDialog(): Promise<void> {
  vi.stubGlobal("fetch", () => Promise.resolve(answer(apps)));
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      <ConnectAccount partition={leadPartition} returnPath={returnPath} />
    </ScreenHarness>,
  );
  await settled();
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  await settled();
}

function linkTo(name: string): HTMLAnchorElement {
  return screen.getByRole<HTMLAnchorElement>("link", { name });
}

function stateOn(link: HTMLAnchorElement): string | null {
  return new URL(link.href).searchParams.get("state");
}

function stored(): unknown {
  const held = sessionStorage.getItem(forgeInstallTransactionKey);
  return held === null ? undefined : JSON.parse(held);
}

test("each app is offered the address it is installed from, with a state on it", async () => {
  await drawDialog();
  const portal = linkTo("Portal");
  expect(portal.href.startsWith(`${apps.apps[0]?.installUrl}?state=`)).toBe(
    true,
  );
  expect(stateOn(portal)).toBeTruthy();
  expect(linkTo("Worker").href).toContain(apps.apps[1]?.installUrl ?? "");
});

test("following a link stores the transaction the landing will match", async () => {
  await drawDialog();
  const worker = linkTo("Worker");
  fireEvent.click(worker);
  await settled();
  expect(stored()).toStrictEqual({
    state: stateOn(worker),
    app: "worker",
    tenant: leadPartition.tenant,
    project: leadPartition.project,
    returnPath,
  });
});

/** Two installs are two transactions, and the store holds one: a shared state
 * would let the second landing match the first's transaction. */
test("the two apps are offered two states", async () => {
  await drawDialog();
  expect(stateOn(linkTo("Portal"))).not.toBe(stateOn(linkTo("Worker")));
});
