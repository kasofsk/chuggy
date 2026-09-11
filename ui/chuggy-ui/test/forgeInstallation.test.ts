/**
 * The install transaction and what a tenant's claims say about an account.
 *
 * THE TRANSACTION IS TAKEN ONCE. A landing reached a second time — a reload, a
 * back button, somebody else's link — must find nothing, because what the state
 * proves is that this tab started the install and a state that outlived its one
 * use proves nothing at all.
 */

import { expect, test } from "vitest";

import type { ForgeInstallationResponse } from "../../../src/contract/responses.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import type { ForgeInstallationClaimedResponse } from "../../../src/contract/responses.ts";
import {
  forgeAccountRows,
  forgeAppLabel,
  forgeClaimOutcome,
  forgeInstallBegin,
  forgeInstallState,
  forgeInstallStateBytesCount,
  forgeInstallTake,
  forgeInstallTransactionKey,
  forgeInstallUrl,
  forgePortalInstallations,
} from "../app/core/forgeInstallation.ts";
import type { ForgeInstallTransaction } from "../app/core/forgeInstallation.ts";
import { keyValueDouble } from "./keyValueDouble.ts";

const transaction: ForgeInstallTransaction = {
  state: "a-state",
  app: "portal",
  tenant: "vteng",
  project: "chuggy",
  returnPath: "/vteng/chuggy/repositories",
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
  held.write(
    forgeInstallTransactionKey,
    JSON.stringify({ ...transaction, app: "neither" }),
  );
  expect(forgeInstallTake(held)).toBeUndefined();
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

test("the repositories are read under the portal claims alone", () => {
  expect(
    forgePortalInstallations([
      claim({ app: "portal", installationId: "1" }),
      claim({ app: "worker", installationId: "2" }),
    ]).map((held) => held.installationId),
  ).toEqual(["1"]);
});

test("each app is named as a person reads it", () => {
  expect(forgeAppLabel("portal")).toBe("Portal");
  expect(forgeAppLabel("worker")).toBe("Worker");
});

const claimed: ForgeInstallationClaimedResponse = {
  forge: "github",
  app: "portal",
  account: "kasofsk",
  accountKind: "Organization",
  installationId: "1",
};

function outcomeStatus(
  result: ApiResult<ForgeInstallationClaimedResponse>,
): string | undefined {
  const outcome = forgeClaimOutcome(result);
  return outcome.outcome === "Refused" ? outcome.status : undefined;
}

test("a claim that landed answers the installation it claimed", () => {
  expect(forgeClaimOutcome({ outcome: "Ok", value: claimed })).toStrictEqual({
    outcome: "Claimed",
    installation: claimed,
  });
});

test("each refusal is the one line the landing sends back", () => {
  expect(
    outcomeStatus({
      outcome: "Conflict",
      code: "InstallationClaimed",
      body: undefined,
    }),
  ).toBe("Claimed by another tenant");
  expect(outcomeStatus({ outcome: "Absent" })).toBe("Unknown");
  expect(
    outcomeStatus({
      outcome: "Retryable",
      code: "ForgeUnavailable",
      retryAfterSeconds: 5,
    }),
  ).toBe("Deferring");
  expect(
    outcomeStatus({
      outcome: "Rejected",
      code: "InvalidRequest",
      status: 422,
      body: undefined,
    }),
  ).toBe("Refused");
});
