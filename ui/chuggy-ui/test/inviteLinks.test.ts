/**
 * A workspace's invite links, decided with no renderer: the address a made
 * link is handed out as, what a link's form sends, the line a refused one
 * leaves, the word and the access a row draws, and which links the reader may
 * revoke.
 */

import { expect, test } from "vitest";

import {
  accessInviteLinkEndedCode,
  accessInviteLinkLimitReachedCode,
  accessInviteLinkStates,
  accessNotPermittedCode,
  type AccessInviteLink,
  type AccessTenantAbilities,
} from "../../../src/contract/accessPlane.ts";
import {
  inviteLinkAccess,
  inviteLinkAddress,
  inviteLinkRevocable,
  inviteLinkRevocationNote,
  inviteLinkStateLabel,
  tenantInviteLinkSendable,
} from "../app/core/inviteLinks.ts";
import {
  accessFailureLabel,
  tenantInvitationBlank,
  tenantInvitationRefusalRereads,
} from "../app/core/tenantPeople.ts";
import { copyTextEn } from "../app/copy/catalog.ts";
import type { Copy } from "../app/core/copy.ts";

/** A line in the base language's words, nothing where there is no line. */
function en(copy: Copy | undefined): string | undefined {
  return copy === undefined ? undefined : copyTextEn(copy);
}

/** What a link's row draws, in the base language's words. */
function enAccess(link: AccessInviteLink) {
  const access = inviteLinkAccess(link);
  return {
    held: access.held.map(copyTextEn),
    every: access.every,
    lines: access.lines.map((line) => ({
      project: line.project,
      roles: line.roles.map(copyTextEn),
    })),
  };
}

const open: AccessInviteLink = {
  link: "l-1",
  role: "Member",
  projects: [
    { project: "beacon", roles: ["Viewer", "Developer"] },
    { project: "atlas", roles: ["Dispatcher"] },
  ],
  newAccounts: true,
  mintedBy: { subject: "s-1" },
  mintedAtMs: 1,
  expiresAtMs: 2,
  state: "Open",
};

const abilities: AccessTenantAbilities = {
  tenant: "acme",
  roles: ["Member"],
  grantHostedRuns: false,
  grantPersonalRunners: false,
  grantUnscopedChat: false,
  administerTenant: false,
  createAccount: false,
  manageAuthorities: false,
  manageSiteHeldAuthorities: false,
  projects: [
    { project: "atlas", roles: ["Dispatcher"], manageAuthorities: false },
    {
      project: "beacon",
      roles: ["Viewer", "Developer"],
      manageAuthorities: false,
    },
  ],
  truncated: false,
};

test("a link is handed out as this console's invite page with the token in the fragment", () => {
  expect(inviteLinkAddress("https://chuggy.example", "t0ken-_")).toBe(
    "https://chuggy.example/invite#t0ken-_",
  );
});

test("a link's form is sendable with a role alone, and not with more projects than one names", () => {
  const blank = tenantInvitationBlank("Member", [{ project: "atlas" }]);
  expect(tenantInviteLinkSendable(blank)).toBe(true);
  expect(
    tenantInviteLinkSendable({
      ...blank,
      projects: [
        { project: "atlas", roles: ["Admin"] },
        { project: "atlas", roles: ["Viewer"] },
      ],
    }),
  ).toBe(false);
});

test("a workspace at its link limit says so and rereads nothing, and an absent answer rereads", () => {
  const limit = {
    outcome: "Conflict",
    code: accessInviteLinkLimitReachedCode,
    body: {},
  } as const;
  expect(en(accessFailureLabel(limit))).toBe("Link limit reached");
  expect(tenantInvitationRefusalRereads(limit)).toBe(false);
  expect(en(accessFailureLabel({ outcome: "Absent" }))).toBe("Not available");
  expect(tenantInvitationRefusalRereads({ outcome: "Absent" })).toBe(true);
});

test("every state a link is in has its own word", () => {
  const words = accessInviteLinkStates
    .map(inviteLinkStateLabel)
    .map(copyTextEn);
  expect(words).toStrictEqual(["Open", "Used", "Revoked", "Expired"]);
});

test("a row draws what its link carries: the workspace role, then a line a project in the link's order and the roster's", () => {
  expect(enAccess(open)).toStrictEqual({
    held: ["Member"],
    every: false,
    lines: [
      { project: "beacon", roles: ["Developer", "Viewer"] },
      { project: "atlas", roles: ["Dispatcher"] },
    ],
  });
  expect(enAccess({ ...open, role: "Admin", projects: [] })).toStrictEqual({
    held: ["Admin"],
    every: true,
    lines: [],
  });
});

test("a link is the reader's to revoke where it is open and they may grant every role it carries", () => {
  expect(inviteLinkRevocable(abilities, open)).toBe(true);
  expect(inviteLinkRevocable(undefined, open)).toBe(false);
});

test("a link that is no longer open is nobody's to revoke", () => {
  for (const state of ["Revoked", "Expired"] as const)
    expect(inviteLinkRevocable(abilities, { ...open, state })).toBe(false);
  expect(
    inviteLinkRevocable(abilities, {
      ...open,
      state: "Used",
      usedBy: { subject: "s-2" },
      usedAtMs: 2,
    }),
  ).toBe(false);
});

test("a link whose workspace role the reader may not grant is not theirs to revoke", () => {
  expect(inviteLinkRevocable({ ...abilities, roles: [] }, open)).toBe(false);
});

test("a link carrying one project role the reader may not grant is not theirs to revoke", () => {
  const short: AccessTenantAbilities = {
    ...abilities,
    projects: [
      { project: "atlas", roles: ["Dispatcher"], manageAuthorities: false },
      { project: "beacon", roles: ["Developer"], manageAuthorities: false },
    ],
  };
  expect(inviteLinkRevocable(short, open)).toBe(false);
});

test("a revocation done, and one of a link that had already ended, say nothing; any other refusal its line", () => {
  expect(inviteLinkRevocationNote({ outcome: "Ok", value: undefined })).toBe(
    undefined,
  );
  expect(
    inviteLinkRevocationNote({
      outcome: "Conflict",
      code: accessInviteLinkEndedCode,
      body: {},
    }),
  ).toBe(undefined);
  expect(
    en(
      inviteLinkRevocationNote({
        outcome: "Rejected",
        code: accessNotPermittedCode,
        status: 403,
        body: {},
      }),
    ),
  ).toBe("Change not permitted");
  expect(
    en(
      inviteLinkRevocationNote({
        outcome: "Conflict",
        code: "SomethingElse",
        body: {},
      }),
    ),
  ).toBe("Unknown refusal (SomethingElse)");
});
