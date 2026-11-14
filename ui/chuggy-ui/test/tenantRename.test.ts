/**
 * A workspace's rename as its settings decide it: offered only to a reader
 * who administers the workspace, and sending a trimmed display name the
 * contract takes that is not the one it has.
 */

import { expect, test } from "vitest";

import type { AccessTenantAbilities } from "../../../src/contract/accessPlane.ts";
import { projectDisplayNameCharsMax } from "../../../src/contract/requests.ts";
import {
  tenantRenameOffered,
  tenantRenameSent,
} from "../app/core/tenantRename.ts";

const abilities: AccessTenantAbilities = {
  tenant: "acme-co",
  roles: ["Admin"],
  grantHostedRuns: true,
  grantPersonalRunners: true,
  grantUnscopedChat: true,
  administerTenant: true,
  createAccount: true,
  manageAuthorities: true,
  manageSiteHeldAuthorities: true,
  projects: [],
  truncated: false,
};

test("the rename is offered to a reader who administers the workspace, and to no other or before the abilities answer", () => {
  expect(tenantRenameOffered(abilities)).toBe(true);
  expect(tenantRenameOffered({ ...abilities, administerTenant: false })).toBe(
    false,
  );
  expect(tenantRenameOffered(undefined)).toBe(false);
});

test("a name is sent trimmed, up to the contract's bound", () => {
  expect(tenantRenameSent("  Acme Co.  ", "acme-co")).toBe("Acme Co.");
  const widest = "€".repeat(projectDisplayNameCharsMax);
  expect(tenantRenameSent(widest, "acme-co")).toBe(widest);
});

test("nothing is sent for a name empty once trimmed, past the bound, holding a control character, or the one the workspace has", () => {
  for (const typed of [
    "",
    "   ",
    "n".repeat(projectDisplayNameCharsMax + 1),
    "two\nlines",
    "tab\tbed",
    "Acme Co.",
    " Acme Co. ",
  ])
    expect(tenantRenameSent(typed, "Acme Co.")).toBeUndefined();
});
