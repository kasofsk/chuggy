/**
 * The site's workspace links, decided with no renderer: what a note may be
 * before it is sent, what a link is sent as, what making one came to, and
 * which links a reader may revoke.
 */

import { expect, test } from "vitest";

import {
  accessInviteLinkLimitReachedCode,
  accessNotPermittedCode,
  accessWorkspaceLinkNoteCharsMax,
} from "../../../src/contract/accessPlane.ts";
import type {
  AccessInviteLinkMinted,
  AccessSiteAbilities,
  AccessWorkspaceLink,
} from "../../../src/contract/accessPlane.ts";
import {
  siteWorkspaceLinkBody,
  siteWorkspaceLinkNoteFault,
  siteWorkspaceLinkOutcome,
  siteWorkspaceLinkRevocable,
  siteWorkspaceLinkSendable,
} from "../app/core/siteWorkspaceLinks.ts";

const atBound = "n".repeat(accessWorkspaceLinkNoteCharsMax);

test("a note is counted by its code points, and one past the bound says Too long", () => {
  expect(siteWorkspaceLinkNoteFault(atBound)).toBeUndefined();
  expect(siteWorkspaceLinkNoteFault(`${atBound}n`)).toBe("Too long");
  expect(
    siteWorkspaceLinkNoteFault("😀".repeat(accessWorkspaceLinkNoteCharsMax)),
  ).toBeUndefined();
});

test("a note of more than one line says One line, and an empty one says nothing", () => {
  expect(siteWorkspaceLinkNoteFault("")).toBeUndefined();
  expect(siteWorkspaceLinkNoteFault("for\nLisbon")).toBe("One line");
  expect(
    siteWorkspaceLinkNoteFault(
      `${"😀".repeat(accessWorkspaceLinkNoteCharsMax - 1)}\n`,
    ),
  ).toBe("One line");
  expect(siteWorkspaceLinkNoteFault("For the Lisbon team")).toBeUndefined();
});

test("a link is sent as its box, and its note only where one was typed, as typed", () => {
  expect(siteWorkspaceLinkBody(true, "")).toStrictEqual({
    createAccounts: true,
  });
  expect(siteWorkspaceLinkBody(false, " Lisbon ")).toStrictEqual({
    createAccounts: false,
    note: " Lisbon ",
  });
});

test("a link may be sent with no note, with one the plane would read, and with no other", () => {
  expect(siteWorkspaceLinkSendable(siteWorkspaceLinkBody(true, ""))).toBe(true);
  expect(siteWorkspaceLinkSendable(siteWorkspaceLinkBody(true, atBound))).toBe(
    true,
  );
  expect(
    siteWorkspaceLinkSendable(siteWorkspaceLinkBody(true, `${atBound}n`)),
  ).toBe(false);
  expect(
    siteWorkspaceLinkSendable(siteWorkspaceLinkBody(false, "for\nLisbon")),
  ).toBe(false);
});

const minted: AccessInviteLinkMinted = {
  link: "w-new",
  token: "t0ken-made_2",
  expiresAtMs: 2,
  newAccounts: true,
};

test("a link made is handed on as the plane answered it", () => {
  expect(
    siteWorkspaceLinkOutcome({ outcome: "Ok", value: minted }),
  ).toStrictEqual({ outcome: "Made", minted });
});

test.each([
  [
    "a site at its limit of open links",
    {
      outcome: "Conflict",
      code: accessInviteLinkLimitReachedCode,
      body: {},
    },
    "Link limit reached",
  ],
  [
    "a reader not granted it",
    {
      outcome: "Rejected",
      code: accessNotPermittedCode,
      status: 403,
      body: {},
    },
    "Not permitted",
  ],
  ["a site that keeps no links", { outcome: "Absent" }, "Not available"],
  [
    "a plane that failed",
    { outcome: "Fault", code: "InternalError", status: 500 },
    "Failed",
  ],
] as const)("%s is the dialog's one line", (_named, result, line) => {
  expect(siteWorkspaceLinkOutcome(result)).toStrictEqual({
    outcome: "Refused",
    line,
  });
});

const none: AccessSiteAbilities = {
  administer: false,
  createAccount: false,
  createTenant: false,
  manageAuthorities: false,
};

const maker: AccessSiteAbilities = { ...none, createTenant: true };

const manager: AccessSiteAbilities = { ...maker, manageAuthorities: true };

function link(over: Partial<AccessWorkspaceLink>): AccessWorkspaceLink {
  return {
    link: "w-one",
    state: "Open",
    createAccounts: false,
    newAccounts: true,
    mintedBy: { subject: "s-ada" },
    mintedAtMs: 1,
    expiresAtMs: 2,
    ...over,
  } as AccessWorkspaceLink;
}

test("an open link is its maker's kind to revoke, and a link in any other state is nobody's", () => {
  expect(siteWorkspaceLinkRevocable(manager, link({}))).toBe(true);
  for (const state of ["Revoked", "Expired"] as const)
    expect(siteWorkspaceLinkRevocable(manager, link({ state }))).toBe(false);
  expect(
    siteWorkspaceLinkRevocable(
      manager,
      link({
        state: "Used",
        usedBy: { subject: "s-grace" },
        usedAtMs: 2,
        workspace: "northwind",
      }),
    ),
  ).toBe(false);
});

test("a reader who may make no workspace revokes nothing", () => {
  expect(
    siteWorkspaceLinkRevocable({ ...none, manageAuthorities: true }, link({})),
  ).toBe(false);
});

test("a link that hands account creation on is revoked only by a reader who manages the site's permissions", () => {
  const handsOn = link({ createAccounts: true });
  expect(siteWorkspaceLinkRevocable(maker, handsOn)).toBe(false);
  expect(siteWorkspaceLinkRevocable(manager, handsOn)).toBe(true);
  expect(siteWorkspaceLinkRevocable(maker, link({}))).toBe(true);
});
