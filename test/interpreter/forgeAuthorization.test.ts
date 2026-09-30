/**
 * Whether a person owns the account one installation stands on. Each term of
 * the proof is refuted alone, so a proof that dropped any one of them passes
 * a case here that it should have refused.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  forgeAccountProof,
  type ForgeMembershipRead,
  type ForgeUserInstallation,
} from "../../src/interpreter/forgeAuthorization.ts";
import {
  asForgeAccount,
  asForgeAccountId,
  asForgeInstallationId,
} from "../../src/interpreter/forgeInstallation.ts";

const person = { id: asForgeAccountId("7"), login: asForgeAccount("geoff") };

const organizationId = asForgeAccountId("500");

function personal(accountId: string): ForgeUserInstallation {
  return {
    accountKind: "User",
    installationId: asForgeInstallationId("8001"),
    account: person.login,
    accountId: asForgeAccountId(accountId),
  };
}

function organization(membership: ForgeMembershipRead): ForgeUserInstallation {
  return {
    accountKind: "Organization",
    installationId: asForgeInstallationId("8101"),
    account: asForgeAccount("kasofsk"),
    accountId: organizationId,
    membership,
  };
}

const activeOwner: ForgeMembershipRead = {
  read: "Membership",
  organizationId,
  active: true,
  owner: true,
};

test("a personal account is the person's by its number and not by its login", () => {
  assert.equal(forgeAccountProof(person, personal("7")), "Proven");
  assert.equal(forgeAccountProof(person, personal("8")), "NotOwner");
});

test("an organization is proven by an active owner of that organization alone", () => {
  assert.equal(forgeAccountProof(person, organization(activeOwner)), "Proven");
  assert.equal(
    forgeAccountProof(person, organization({ ...activeOwner, owner: false })),
    "NotOwner",
  );
  assert.equal(
    forgeAccountProof(person, organization({ ...activeOwner, active: false })),
    "NotOwner",
  );
  assert.equal(
    forgeAccountProof(
      person,
      organization({
        ...activeOwner,
        organizationId: asForgeAccountId("501"),
      }),
    ),
    "NotOwner",
  );
});

test("a membership the forge refused is not ownership, and one it could not answer is a wait", () => {
  assert.equal(
    forgeAccountProof(person, organization({ read: "Refused" })),
    "NotOwner",
  );
  assert.equal(
    forgeAccountProof(person, organization({ read: "Unavailable" })),
    "Unavailable",
  );
});
