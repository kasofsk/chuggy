/**
 * What the setup landing decides from what the forge sent and what this tab
 * stored.
 *
 * THE STATE IS THE WHOLE OF THE PROOF. A return carrying somebody else's state,
 * or none, or one this tab has already spent, claims nothing — an installation
 * identity is a fact about an account the caller may not administer, and a
 * landing that claimed on the identity alone would let a link claim for them.
 */

import { expect, test } from "vitest";

import type { ForgeInstallTransaction } from "../app/core/forgeInstallation.ts";
import {
  forgeSetupDecision,
  forgeSetupQueryOf,
  forgeSetupReturn,
  forgeSetupRoutePath,
  forgeSetupStatusParam,
} from "../app/core/forgeSetup.ts";

const transaction: ForgeInstallTransaction = {
  state: "a-state",
  app: "worker",
  tenant: "vteng",
  project: "chuggy",
  returnPath: "/vteng/chuggy/repositories",
};

const arrived = forgeSetupQueryOf({
  installation_id: "42",
  setup_action: "install",
  state: "a-state",
});

test("the forge's own parameter names are what is read", () => {
  expect(arrived).toStrictEqual({
    installationId: "42",
    action: "install",
    state: "a-state",
  });
  expect(
    forgeSetupQueryOf({ setup_action: "elsewhere" }).action,
  ).toBeUndefined();
  expect(
    forgeSetupQueryOf({ installation_id: "" }).installationId,
  ).toBeUndefined();
});

test("a matching state claims the installation for the app that was installed", () => {
  expect(forgeSetupDecision(arrived, transaction)).toStrictEqual({
    decision: "Claim",
    transaction,
    installationId: "42",
  });
});

test("a state that does not match this tab claims nothing", () => {
  expect(
    forgeSetupDecision({ ...arrived, state: "someone-else" }, transaction)
      .decision,
  ).toBe("Unexpected");
});

test("a landing with nothing stored claims nothing", () => {
  expect(forgeSetupDecision(arrived, undefined).decision).toBe("Unexpected");
});

test("a return carrying no state claims nothing", () => {
  expect(
    forgeSetupDecision({ ...arrived, state: undefined }, transaction).decision,
  ).toBe("Unexpected");
});

/** An `update` is an installation whose repositories changed, and the claim is
 * the same claim; only a `request` has nothing to claim yet. */
test("an update claims and a request does not", () => {
  expect(
    forgeSetupDecision({ ...arrived, action: "update" }, transaction).decision,
  ).toBe("Claim");
  expect(
    forgeSetupDecision({ ...arrived, action: "request" }, transaction),
  ).toStrictEqual({ decision: "Requested", transaction });
});

test("a matching state with no installation claims nothing", () => {
  expect(
    forgeSetupDecision({ ...arrived, installationId: undefined }, transaction)
      .decision,
  ).toBe("Unexpected");
});

test("the way back carries the outcome and neither the state nor the identity", () => {
  const url = new URL(
    forgeSetupReturn(transaction.returnPath, "Claimed by another tenant"),
    "https://console.test",
  );
  expect(url.pathname).toBe(transaction.returnPath);
  expect([...url.searchParams.keys()]).toEqual([forgeSetupStatusParam]);
  expect(url.searchParams.get(forgeSetupStatusParam)).toBe(
    "Claimed by another tenant",
  );
});

/**
 * The address is a deployment's own configuration rather than a detail of the
 * router: an operator sets it on both Apps in the forge, and a deployment
 * already set up against it stops working the day it changes.
 */
test("the landing's address is the one the README tells an operator to set", () => {
  expect(forgeSetupRoutePath).toBe("/forge/github/setup");
});

test("a way back that already has a query keeps it", () => {
  const url = new URL(
    forgeSetupReturn("/vteng/chuggy/repositories?open=add", "Connected"),
    "https://console.test",
  );
  expect(url.searchParams.get("open")).toBe("add");
  expect(url.searchParams.get(forgeSetupStatusParam)).toBe("Connected");
});
