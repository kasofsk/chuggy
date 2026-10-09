/**
 * The install transaction and what a tenant's claims say about an account.
 *
 * THE TRANSACTION IS TAKEN ONCE. A landing reached a second time — a reload, a
 * back button, somebody else's link — must find nothing, because what the state
 * proves is that this tab started the install and a state that outlived its one
 * use proves nothing at all.
 */

import { expect, test } from "vitest";

import type {
  ForgeAppsResponse,
  ForgeInstallationResponse,
} from "../../../src/contract/responses.ts";
import {
  forgeAccountRows,
  forgeCreatingAccounts,
  forgeInstallBegin,
  forgeInstallLabel,
  forgeInstallOffered,
  forgeInstallState,
  forgeInstallStateBytesCount,
  forgeInstallTake,
  forgeInstallTransactionKey,
  forgeInstallUrl,
  forgePortalInstallations,
  forgeWorkerlessAccounts,
} from "../app/core/forgeInstallation.ts";
import type { ForgeInstallTransaction } from "../app/core/forgeInstallation.ts";
import { keyValueDouble } from "./keyValueDouble.ts";

const transaction: ForgeInstallTransaction = {
  state: "a-state",
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
  installs: ["portal"],
};

function claim(
  over: Partial<ForgeInstallationResponse>,
): ForgeInstallationResponse {
  return {
    forge: "github",
    app: "portal",
    account: "kasofsk",
    accountKind: "Organization",
    installationId: "1",
    claimedAt: "2026-09-11T00:00:00Z",
    ...over,
  };
}

test("the state is drawn from the bytes it is asked for", () => {
  const drawn: number[] = [];
  const state = forgeInstallState((count) => {
    drawn.push(count);
    return new Uint8Array(count).fill(7);
  });
  expect(drawn).toEqual([forgeInstallStateBytesCount]);
  expect(state).not.toContain("=");
  expect(state).not.toContain("+");
});

test("a stored transaction is read once and is gone the second time", () => {
  const held = keyValueDouble();
  forgeInstallBegin(held, transaction);
  expect(forgeInstallTake(held)).toStrictEqual(transaction);
  expect(forgeInstallTake(held)).toBeUndefined();
});

test("a transaction that is not one is read as none", () => {
  const held = keyValueDouble();
  held.write(forgeInstallTransactionKey, "{");
  expect(forgeInstallTake(held)).toBeUndefined();
  held.write(forgeInstallTransactionKey, JSON.stringify({ state: "a" }));
  expect(forgeInstallTake(held)).toBeUndefined();
  for (const over of [{ installs: ["neither"] }, { state: undefined }]) {
    held.write(
      forgeInstallTransactionKey,
      JSON.stringify({ ...transaction, ...over }),
    );
    expect(forgeInstallTake(held)).toBeUndefined();
  }
});

const portal = {
  app: "portal" as const,
  id: "1",
  slug: "chuggy-portal",
  installUrl: "https://forge.test/apps/chuggy-portal/installations/new",
};

const authorization = {
  clientId: "Iv1.portal",
  authorizeUrl: "https://forge.test/login/oauth/authorize",
};

/** The landing claims an install only through the authorization, so an install
 * made where there is none would end with the app installed and unclaimed. */
test("an install is offered only for an app held, by a deployment that can authorize", () => {
  const held: ForgeAppsResponse = { apps: [portal], authorization };
  expect(forgeInstallOffered(held, "portal")).toStrictEqual(portal);
  expect(forgeInstallOffered(held, "worker")).toBeUndefined();
  expect(forgeInstallOffered({ apps: [portal] }, "portal")).toBeUndefined();
});

/** The api builds the address from an `html_url` it refuses with a query of its
 * own, so the state is the only thing on it. */
test("the install address carries the state and nothing else", () => {
  const url = new URL(
    forgeInstallUrl("https://forge.test/apps/chuggy/installations/new", "a/b"),
  );
  expect([...url.searchParams.keys()]).toEqual(["state"]);
  expect(url.searchParams.get("state")).toBe("a/b");
});

test("an account is one row saying which apps it holds", () => {
  expect(
    forgeAccountRows([
      claim({ app: "portal", account: "kasofsk", installationId: "1" }),
      claim({ app: "worker", account: "kasofsk", installationId: "2" }),
      claim({
        app: "portal",
        account: "gdoteof",
        accountKind: "User",
        installationId: "3",
      }),
    ]),
  ).toStrictEqual([
    {
      account: "kasofsk",
      kind: "Organization",
      portal: "Installed",
      worker: "Installed",
    },
    {
      account: "gdoteof",
      kind: "User",
      portal: "Installed",
      worker: "Missing",
    },
  ]);
});

/** A create makes the repository through one app's installation and leaves the
 * work to the other's, so an account holding one of them is not offered. */
test("only an account holding both apps may be created under", () => {
  expect(
    forgeCreatingAccounts([
      claim({ app: "portal", account: "kasofsk", installationId: "1" }),
      claim({ app: "worker", account: "kasofsk", installationId: "2" }),
      claim({ app: "portal", account: "gdoteof", installationId: "3" }),
      claim({ app: "worker", account: "vteng", installationId: "4" }),
    ]),
  ).toEqual(["kasofsk"]);
  expect(forgeCreatingAccounts([])).toEqual([]);
});

test("an account lacks the worker app where it holds the portal app alone", () => {
  expect(
    forgeWorkerlessAccounts([
      claim({ app: "portal", account: "kasofsk", installationId: "1" }),
      claim({ app: "worker", account: "kasofsk", installationId: "2" }),
      claim({ app: "portal", account: "gdoteof", installationId: "3" }),
      claim({ app: "worker", account: "vteng", installationId: "4" }),
      claim({ app: "portal", account: "initech", installationId: "5" }),
    ]),
  ).toEqual(["gdoteof", "initech"]);
  expect(forgeWorkerlessAccounts([])).toEqual([]);
});

test("the repositories are read under the portal claims alone", () => {
  expect(
    forgePortalInstallations([
      claim({ app: "portal", installationId: "1" }),
      claim({ app: "worker", installationId: "2" }),
    ]).map((held) => held.installationId),
  ).toEqual(["1"]);
});

test("each app's install is named as a person reads it", () => {
  expect(forgeInstallLabel("portal")).toBe("Install portal");
  expect(forgeInstallLabel("worker")).toBe("Install worker");
});
