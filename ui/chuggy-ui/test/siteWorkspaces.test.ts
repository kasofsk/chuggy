/**
 * The site's invitation into a workspace of the person's own: who is drawn its
 * form, how the form starts, what a name may be before it is sent, what is
 * sent, and the one line each answer comes to.
 */

import { expect, test } from "vitest";

import {
  accessInvitationCodes,
  accessNotPermittedCode,
  accessTenantTakenCode,
} from "../../../src/contract/accessPlane.ts";
import type {
  AccessOwnerInvited,
  AccessSiteAbilities,
} from "../../../src/contract/accessPlane.ts";
import {
  projectNameCharsMax,
  reservedTenantNames,
} from "../../../src/contract/requests.ts";
import type { ApiResult } from "../app/core/apiRequest.ts";
import {
  projectNameLengthFault,
  projectNameRule,
  tenantNameReservedFault,
} from "../app/core/projectCreation.ts";
import {
  siteWorkspaceBlank,
  siteWorkspaceHeld,
  siteWorkspaceNameFault,
  siteWorkspaceOffered,
  siteWorkspaceOutcome,
  siteWorkspaceSendable,
} from "../app/core/siteWorkspaces.ts";
import type { SiteWorkspaceForm } from "../app/core/siteWorkspaces.ts";

const none: AccessSiteAbilities = {
  administer: false,
  createAccount: false,
  createTenant: false,
  manageAuthorities: false,
};

const manager: AccessSiteAbilities = { ...none, manageAuthorities: true };

const typed: SiteWorkspaceForm = {
  tenant: "northwind",
  github: "octocat",
  email: "owner@example.com",
  createAccounts: true,
};

function line(result: ApiResult<AccessOwnerInvited>): string {
  return siteWorkspaceOutcome(typed, result).line;
}

test("the form is drawn to a reader who may make a workspace, and to no other", () => {
  expect(siteWorkspaceOffered({ ...none, createTenant: true })).toBe(true);
  expect(
    siteWorkspaceOffered({
      ...none,
      administer: true,
      createAccount: true,
      manageAuthorities: true,
    }),
  ).toBe(false);
  expect(siteWorkspaceOffered(undefined)).toBe(false);
});

test("the form starts with nothing typed, its box checked only where the reader manages the site's permissions", () => {
  expect(siteWorkspaceBlank(manager)).toStrictEqual({
    tenant: "",
    github: "",
    email: "",
    createAccounts: true,
  });
  expect(siteWorkspaceBlank(none).createAccounts).toBe(false);
});

test("a box checked under abilities since lost is drawn and sent unchecked, and nothing else moves", () => {
  expect(siteWorkspaceHeld(typed, manager)).toStrictEqual(typed);
  expect(siteWorkspaceHeld(typed, none)).toStrictEqual({
    ...typed,
    createAccounts: false,
  });
  const unchecked = { ...typed, createAccounts: false };
  expect(siteWorkspaceHeld(unchecked, manager)).toStrictEqual(unchecked);
});

test("a name is faulted as a project's is, a reserved one as reserved, and an empty one not at all", () => {
  expect(siteWorkspaceNameFault("")).toBeUndefined();
  expect(siteWorkspaceNameFault("northwind")).toBeUndefined();
  for (const name of ["North", "-a", "a-", "a b"])
    expect(siteWorkspaceNameFault(name), name).toBe(projectNameRule);
  expect(siteWorkspaceNameFault("a".repeat(projectNameCharsMax + 1))).toBe(
    projectNameLengthFault,
  );
  for (const name of reservedTenantNames)
    expect(siteWorkspaceNameFault(name), name).toBe(tenantNameReservedFault);
});

test("a form is sent only when the plane's own schema takes every field of it", () => {
  expect(siteWorkspaceSendable(typed)).toBe(true);
  expect(siteWorkspaceSendable({ ...typed, createAccounts: false })).toBe(true);
  for (const broken of [
    { tenant: "" },
    { tenant: "North Wind" },
    { tenant: "api" },
    { github: "" },
    { github: "-octocat" },
    { email: "" },
    { email: "owner@" },
  ])
    expect(
      siteWorkspaceSendable({ ...typed, ...broken }),
      JSON.stringify(broken),
    ).toBe(false);
});

test("a creation or its replay names the workspace answered and the person typed", () => {
  for (const created of [true, false])
    expect(
      siteWorkspaceOutcome(typed, {
        outcome: "Ok",
        value: { tenant: "northwind-answered", subject: "s-owner", created },
      }),
    ).toStrictEqual({
      outcome: "Created",
      line: "northwind-answered created · octocat signs in with GitHub",
    });
});

test("each refusal is one short line of its own, and none a creation", () => {
  const conflict = (code: string): ApiResult<AccessOwnerInvited> => ({
    outcome: "Conflict",
    code,
    body: undefined,
  });
  const rejected = (code: string): ApiResult<AccessOwnerInvited> => ({
    outcome: "Rejected",
    code,
    status: 422,
    body: undefined,
  });
  expect(siteWorkspaceOutcome(typed, conflict("Any")).outcome).toBe("Refused");
  expect(line(conflict(accessTenantTakenCode))).toBe("Name taken");
  expect(line(rejected(accessNotPermittedCode))).toBe("Not permitted");
  expect(line(rejected(accessInvitationCodes.AccountNotPermitted))).toBe(
    "Account creation not permitted",
  );
  expect(line(rejected(accessInvitationCodes.GithubAccountUnknown))).toBe(
    "No such GitHub user",
  );
  expect(line(conflict(accessInvitationCodes.EmailHeld))).toBe(
    "Email held by another account · use another address",
  );
  expect(line(rejected("SomethingNew"))).toBe("Unknown refusal (SomethingNew)");
  expect(
    line({
      outcome: "Retryable",
      code: accessInvitationCodes.GithubUnavailable,
      retryAfterSeconds: 1,
    }),
  ).toBe("GitHub unavailable");
});

test("an answer that is no refusal of the plane's is the ordinary failure's word", () => {
  expect(line({ outcome: "Absent" })).toBe("Not available");
  expect(line({ outcome: "Unauthenticated" })).toBe("Not signed in");
  expect(line({ outcome: "Fault", code: "InternalError", status: 500 })).toBe(
    "Failed",
  );
  expect(line({ outcome: "Unreachable", reason: "offline" })).toBe(
    "Unreachable",
  );
  expect(line({ outcome: "Unreadable", reason: "not json" })).toBe(
    "Unreadable",
  );
});
