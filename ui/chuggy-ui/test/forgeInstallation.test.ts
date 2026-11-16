/**
 * The install transaction and what a tenant's claims say about an account.
 *
 * THE TRANSACTION IS TAKEN ONCE. A landing reached a second time — a reload, a
 * back button, somebody else's link — must find nothing, because what the state
 * proves is that this tab started the install and a state that outlived its one
 * use proves nothing at all.
 */

import { expect, test } from "vitest";

import { copyTextEn } from "../app/copy/catalog.ts";

import type {
  ForgeAppsResponse,
  ForgeInstallationResponse,
  ForgeRepositoriesResponse,
} from "../../../src/contract/responses.ts";
import {
  forgeAccountRows,
  forgeInstallBegin,
  forgeInstallLabel,
  forgeInstallOffered,
  forgeInstallState,
  forgeInstallStateBytesCount,
  forgeInstallSuggestedMax,
  forgeInstallSuggestedUrl,
  forgeInstallTake,
  forgeInstallTransactionKey,
  forgeInstallUrl,
  forgePortalInstallations,
  forgeWorkerInstallations,
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

const workerInstallUrl =
  "https://forge.test/apps/chuggy-worker/installations/new";

/** A portal listing of `count` chosen repositories on account 1342004. */
function chosen(count: number): ForgeRepositoriesResponse {
  return {
    repositories: Array.from({ length: count }, (_row, index) => ({
      id: String(1296269 + index),
      name: `repo-${String(index)}`,
      fullName: `kasofsk/repo-${String(index)}`,
      url: `https://forge.test/kasofsk/repo-${String(index)}.git`,
      defaultBranch: "main",
      private: true,
    })),
    truncated: false,
    selection: "Selected",
    accountId: "1342004",
  };
}

test("an install suggested from chosen repositories names the account and every one of them, keeping the state", () => {
  const url = new URL(
    forgeInstallSuggestedUrl(workerInstallUrl, "a/b", chosen(2)),
  );
  expect(`${url.origin}${url.pathname}`).toBe(
    `${workerInstallUrl}/permissions`,
  );
  expect(url.searchParams.get("suggested_target_id")).toBe("1342004");
  expect(url.searchParams.getAll("repository_ids[]")).toEqual([
    "1296269",
    "1296270",
  ]);
  expect(url.searchParams.get("state")).toBe("a/b");
});

test("as many repositories as the forge takes are still suggested", () => {
  const url = new URL(
    forgeInstallSuggestedUrl(
      workerInstallUrl,
      "s",
      chosen(forgeInstallSuggestedMax),
    ),
  );
  expect(url.searchParams.getAll("repository_ids[]")).toHaveLength(
    forgeInstallSuggestedMax,
  );
});

test.each<readonly [string, ForgeRepositoriesResponse]>([
  ["given every repository", { ...chosen(2), selection: "All" }],
  ["cut short", { ...chosen(2), truncated: true }],
  ["past what the forge takes", chosen(forgeInstallSuggestedMax + 1)],
  [
    "naming no account",
    { repositories: [], truncated: false, selection: "Selected" },
  ],
])("a listing %s is followed at the plain address", (_said, granted) => {
  expect(forgeInstallSuggestedUrl(workerInstallUrl, "a/b", granted)).toBe(
    forgeInstallUrl(workerInstallUrl, "a/b"),
  );
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

/** A worker claim on an account no portal claim lists has no listed
 * repository to be compared against, and reading it would spend a request. */
test("the worker claims read are the ones on an account a portal claim lists", () => {
  expect(
    forgeWorkerInstallations([
      claim({ app: "portal", installationId: "1" }),
      claim({ app: "worker", installationId: "2" }),
      claim({ app: "worker", account: "gdoteof", installationId: "3" }),
      claim({ app: "portal", account: "otherco", installationId: "4" }),
    ]).map((held) => held.installationId),
  ).toEqual(["2"]);
});

test("each app's install is named as a person reads it", () => {
  expect(copyTextEn(forgeInstallLabel("portal"))).toBe("Install portal");
  expect(copyTextEn(forgeInstallLabel("worker"))).toBe("Install worker");
});
