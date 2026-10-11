/**
 * What the setup landing decides from what the forge sent and what this tab
 * stored. A return carrying somebody else's state, or none, or one this tab has
 * already spent, starts nothing, and only an update among them is answered.
 */

import { expect, test } from "vitest";

import type { ForgeInstallTransaction } from "../app/core/forgeInstallation.ts";
import {
  forgeSetupActions,
  forgeSetupDecision,
  forgeSetupQueryOf,
  forgeSetupRoutePath,
} from "../app/core/forgeSetup.ts";
import type { ForgeSetupQuery } from "../app/core/forgeSetup.ts";

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
    forgeSetupDecision({ ...arrived, action: "update" }, transaction),
  ).toStrictEqual({ decision: "Authorize", transaction });
  expect(
    forgeSetupDecision({ ...arrived, action: "request" }, transaction),
  ).toStrictEqual({ decision: "Requested", transaction });
});

/** Every way a return fails to match what this tab stored, by what was stored. */
const unmatched: readonly (readonly [
  string | undefined,
  ForgeInstallTransaction | undefined,
])[] = [
  ["a-state", undefined],
  [undefined, undefined],
  [undefined, transaction],
  ["someone-else", transaction],
];

/** The forge sends an update to whoever saves an installation's settings, from
 * its own pages too, so one this tab cannot match is somebody's way back. */
test("an update this tab cannot match is a return, carrying the press it stored where it stored one", () => {
  const press = {
    tenant: transaction.tenant,
    returnPath: transaction.returnPath,
    installs: transaction.installs,
  };
  expect(
    unmatched.map(([state, taken]) =>
      forgeSetupDecision({ action: "update", state }, taken),
    ),
  ).toStrictEqual([
    { decision: "Updated", press: undefined },
    { decision: "Updated", press: undefined },
    { decision: "Updated", press },
    { decision: "Updated", press },
  ]);
});

test("an install, a request and a return naming neither stay refused where this tab cannot match them", () => {
  const actions: readonly ForgeSetupQuery["action"][] = [
    ...forgeSetupActions.filter((action) => action !== "update"),
    undefined,
  ];
  expect(actions).toHaveLength(forgeSetupActions.length);
  for (const action of actions)
    for (const [state, taken] of unmatched)
      expect(forgeSetupDecision({ action, state }, taken)).toStrictEqual({
        decision: "Unexpected",
      });
});

/**
 * The address is a deployment's own configuration rather than a detail of the
 * router: an operator sets it on both Apps in the forge, and a deployment
 * already set up against it stops working the day it changes.
 */
test("the landing's address is the one the README tells an operator to set", () => {
  expect(forgeSetupRoutePath).toBe("/forge/github/setup");
});
