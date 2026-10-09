/**
 * What the setup landing decides from what the forge sent and what this tab
 * stored. A return carrying somebody else's state, or none, or one this tab has
 * already spent, starts nothing.
 */

import { expect, test } from "vitest";

import type { ForgeInstallTransaction } from "../app/core/forgeInstallation.ts";
import {
  forgeSetupDecision,
  forgeSetupQueryOf,
  forgeSetupRoutePath,
} from "../app/core/forgeSetup.ts";

const transaction: ForgeInstallTransaction = {
  state: "a-state",
  tenant: "vteng",
  returnPath: "/vteng/chuggy/repositories",
  installs: ["worker"],
};

const arrived = forgeSetupQueryOf({
  installation_id: "42",
  setup_action: "install",
  state: "a-state",
});

test("the forge's own parameter names are what is read", () => {
  expect(arrived).toStrictEqual({ action: "install", state: "a-state" });
  expect(
    forgeSetupQueryOf({ setup_action: "elsewhere" }).action,
  ).toBeUndefined();
  expect(forgeSetupQueryOf({ state: "" }).state).toBeUndefined();
});

test("a matching state goes on to the authorization", () => {
  expect(forgeSetupDecision(arrived, transaction)).toStrictEqual({
    decision: "Authorize",
    transaction,
  });
});

test("a state that does not match this tab starts nothing", () => {
  expect(
    forgeSetupDecision({ ...arrived, state: "someone-else" }, transaction)
      .decision,
  ).toBe("Unexpected");
});

test("a landing with nothing stored starts nothing", () => {
  expect(forgeSetupDecision(arrived, undefined).decision).toBe("Unexpected");
});

test("a return carrying no state starts nothing", () => {
  expect(
    forgeSetupDecision({ ...arrived, state: undefined }, transaction).decision,
  ).toBe("Unexpected");
});

/** An `update` is an installation whose repositories changed; only a
 * `request` has nothing installed to authorize for yet. */
test("an update authorizes and a request does not", () => {
  expect(
    forgeSetupDecision({ ...arrived, action: "update" }, transaction).decision,
  ).toBe("Authorize");
  expect(
    forgeSetupDecision({ ...arrived, action: "request" }, transaction),
  ).toStrictEqual({ decision: "Requested", transaction });
});

/**
 * The address is a deployment's own configuration rather than a detail of the
 * router: an operator sets it on both Apps in the forge, and a deployment
 * already set up against it stops working the day it changes.
 */
test("the landing's address is the one the README tells an operator to set", () => {
  expect(forgeSetupRoutePath).toBe("/forge/github/setup");
});
