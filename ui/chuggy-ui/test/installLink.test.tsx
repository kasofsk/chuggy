/**
 * Installing an app: the address a link offers, and what following one leaves
 * behind.
 *
 * THE EQUALITY IS THE WHOLE DESIGN. The landing goes on only for a state it can
 * match against the transaction this tab stored, so a link carrying one state
 * while the store holds another starts nothing, and a link followed with
 * nothing stored at all starts nothing either — either way every install in the
 * deployment reads as unexpected. What is asserted is therefore that the state
 * on the address is the state in the store.
 */

import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { ForgeAppName } from "../../../src/contract/rosters.ts";
import { InstallLink } from "../app/browser/repositories/InstallLink.tsx";
import { forgeInstallTransactionKey } from "../app/core/forgeInstallation.ts";
import {
  answer,
  openedStream,
  ScreenHarness,
  settled,
} from "./screenHarness.tsx";
import { leadPartition } from "./leadFixture.ts";

const returnPath = "/acme/atlas/repositories";

const portal = {
  app: "portal",
  id: "1",
  slug: "chuggy-portal",
  installUrl: "https://forge.test/apps/chuggy-portal/installations/new",
};

const worker = {
  app: "worker",
  id: "2",
  slug: "chuggy-worker",
  installUrl: "https://forge.test/apps/chuggy-worker/installations/new",
};

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

const authorization = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

async function drawLinks(
  apps: readonly ForgeAppName[],
  held: readonly unknown[] = [portal, worker],
  authorizes = true,
): Promise<void> {
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      answer(authorizes ? { apps: held, authorization } : { apps: held }),
    ),
  );
  render(
    <ScreenHarness
      partition={leadPartition}
      client={new QueryClient()}
      transport={openedStream().ports.fetch}
    >
      {apps.map((app) => (
        <InstallLink
          key={app}
          tenant={leadPartition.tenant}
          returnPath={returnPath}
          app={app}
        />
      ))}
    </ScreenHarness>,
  );
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

test("an app is offered the address it is installed from, with a state on it", async () => {
  await drawLinks(["portal"]);
  const link = linkTo("Install portal");
  expect(link.href.startsWith(`${portal.installUrl}?state=`)).toBe(true);
  expect(stateOn(link)).toBeTruthy();
});

test("following a link stores the transaction the landing will match", async () => {
  await drawLinks(["worker"]);
  const link = linkTo("Install worker");
  fireEvent.click(link);
  await settled();
  expect(stored()).toStrictEqual({
    state: stateOn(link),
    app: "worker",
    tenant: leadPartition.tenant,
    returnPath,
  });
});

/** Two installs are two transactions, and the store holds one: a shared state
 * would let the second landing match the first's transaction. */
test("two links are two states", async () => {
  await drawLinks(["portal", "worker"]);
  expect(stateOn(linkTo("Install portal"))).not.toBe(
    stateOn(linkTo("Install worker")),
  );
});

test("an app this deployment holds no key for is offered nothing", async () => {
  await drawLinks(["worker"], [portal]);
  expect(screen.queryByRole("link")).toBeNull();
});

/** The landing goes on to an authorization, so an install made where there is
 * none would end at Not configured with the app already installed. */
test("a deployment that answers no client to authorize is offered nothing", async () => {
  await drawLinks(["portal", "worker"], [portal, worker], false);
  expect(screen.queryByRole("link")).toBeNull();
});
