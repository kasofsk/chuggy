/**
 * What the console names a workspace: its display name where the reader's own
 * list answers one, and its id wherever it answers none.
 */

import { expect, test } from "vitest";

import type { AccessCallerTenants } from "../../../src/contract/accessPlane.ts";
import type { PanelState } from "../app/core/freshness.ts";
import { workspaceNames } from "../app/core/workspaceNames.ts";

const listed: PanelState<AccessCallerTenants> = {
  state: "Ready",
  value: {
    tenants: [
      {
        tenant: "acme-co",
        displayName: "Acme Co.",
        roles: ["Admin"],
        administer: true,
      },
    ],
    truncated: false,
  },
  observedAtMs: undefined,
};

test("a workspace the reader's list names is called by its display name, and one it does not by its id", () => {
  const named = workspaceNames(listed);
  expect(named("acme-co")).toBe("Acme Co.");
  expect(named("globex-co")).toBe("globex-co");
});

test.each([
  { state: "Pending" } as const,
  { state: "Absent" } as const,
  {
    state: "Failed",
    failure: { outcome: "Unreachable", reason: "the plane failed" },
  } as const,
])("a list that is $state names every workspace by its id", (held) => {
  expect(workspaceNames(held)("acme-co")).toBe("acme-co");
});
