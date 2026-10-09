/**
 * The workspace choice as it is decided: the entries it holds and where it
 * starts under each pair of answers, the empty state each reader with nothing
 * to choose is drawn, the free text a failed read leaves, and the name the
 * form sends under the reader's own edits.
 */

import { expect, test } from "vitest";

import type {
  AccessCallerTenant,
  AccessCallerTenants,
  AccessSiteAbilities,
} from "../../../src/contract/accessPlane.ts";
import type { PanelState } from "../app/core/freshness.ts";
import {
  projectCreationWorkspaceChosen,
  projectCreationWorkspaceEntryText,
  projectCreationWorkspaceOffer,
  projectCreationWorkspaceTenant,
} from "../app/core/projectCreationWorkspace.ts";
import type {
  ProjectCreationWorkspaceEntry,
  ProjectCreationWorkspaceOffer,
} from "../app/core/projectCreationWorkspace.ts";

function ready<T>(value: T): PanelState<T> {
  return { state: "Ready", value, observedAtMs: undefined };
}

const pending = { state: "Pending" } as const;
const absent = { state: "Absent", reason: "no such resource" } as const;
const failed = { state: "Failed", reason: "the plane failed" } as const;

function administered(tenant: string): AccessCallerTenant {
  return { tenant, roles: ["Admin"], administer: true };
}

function joined(tenant: string): AccessCallerTenant {
  return { tenant, roles: ["Member"], administer: false };
}

function listed(
  ...tenants: readonly AccessCallerTenant[]
): PanelState<AccessCallerTenants> {
  return ready({ tenants: [...tenants], truncated: false });
}

function abilities(createTenant: boolean): PanelState<AccessSiteAbilities> {
  return ready({
    administer: true,
    createAccount: true,
    createTenant,
    manageAuthorities: true,
  });
}

/** What a reader who may do nothing on the site is answered: nothing. */
const mayNothing = absent;
const mayCreate = abilities(true);

function held(tenant: string): ProjectCreationWorkspaceEntry {
  return { entry: "Held", tenant };
}

const creation: ProjectCreationWorkspaceEntry = { entry: "New" };

function choice(
  entries: readonly ProjectCreationWorkspaceEntry[],
  start: ProjectCreationWorkspaceEntry,
): ProjectCreationWorkspaceOffer {
  return { offer: "Choice", entries, start };
}

const untouched = { picked: undefined, typed: undefined };

test("one workspace the reader administers is the whole choice, and where it starts", () => {
  expect(
    projectCreationWorkspaceOffer(
      listed(administered("mimage")),
      mayNothing,
      undefined,
    ),
  ).toStrictEqual(choice([held("mimage")], held("mimage")));
});

test("several are entries in the order the read gives, starting on the first", () => {
  expect(
    projectCreationWorkspaceOffer(
      listed(administered("northwind"), administered("acme")),
      mayNothing,
      undefined,
    ),
  ).toStrictEqual(choice([held("northwind"), held("acme")], held("northwind")));
});

test("the choice starts on the workspace the address names where it holds it, and on the first where it does not", () => {
  const read = listed(administered("acme"), administered("northwind"));
  const entries = [held("acme"), held("northwind")];
  expect(
    projectCreationWorkspaceOffer(read, mayNothing, "northwind"),
  ).toStrictEqual(choice(entries, held("northwind")));
  expect(
    projectCreationWorkspaceOffer(read, mayNothing, "elsewhere"),
  ).toStrictEqual(choice(entries, held("acme")));
});

test("a reader who may make a workspace has that as the last entry, and one who may not has no such entry", () => {
  const read = listed(administered("acme"), administered("northwind"));
  expect(
    projectCreationWorkspaceOffer(read, mayCreate, undefined),
  ).toStrictEqual(
    choice([held("acme"), held("northwind"), creation], held("acme")),
  );
  for (const may of [mayNothing, abilities(false)])
    expect(projectCreationWorkspaceOffer(read, may, undefined)).toStrictEqual(
      choice([held("acme"), held("northwind")], held("acme")),
    );
});

test("a reader who may make a workspace and holds none starts on making one", () => {
  expect(
    projectCreationWorkspaceOffer(listed(), mayCreate, undefined),
  ).toStrictEqual(choice([creation], creation));
});

test("a workspace the reader holds and does not administer is never an entry", () => {
  expect(
    projectCreationWorkspaceOffer(
      listed(joined("harbour"), administered("mimage"), joined("zephyr")),
      mayNothing,
      "harbour",
    ),
  ).toStrictEqual(choice([held("mimage")], held("mimage")));
  expect(
    projectCreationWorkspaceOffer(
      listed(joined("harbour")),
      mayCreate,
      "harbour",
    ),
  ).toStrictEqual(choice([creation], creation));
});

test("a reader no workspace holds, who may make none, is drawn that a new one needs an invite link", () => {
  for (const may of [mayNothing, abilities(false)])
    expect(
      projectCreationWorkspaceOffer(listed(), may, undefined),
    ).toStrictEqual({
      offer: "Withheld",
      label: "No workspace",
      detail: "A new workspace needs an invite link",
    });
});

test("a member of some workspace who administers none is drawn that an admin adds projects", () => {
  expect(
    projectCreationWorkspaceOffer(
      listed(joined("harbour"), joined("zephyr")),
      mayNothing,
      undefined,
    ),
  ).toStrictEqual({
    offer: "Withheld",
    label: "No workspace to add to",
    detail: "A workspace admin adds projects",
  });
});

test("nothing is offered while either read is unsettled", () => {
  expect(
    projectCreationWorkspaceOffer(pending, mayNothing, undefined),
  ).toStrictEqual({ offer: "Pending" });
  expect(
    projectCreationWorkspaceOffer(
      listed(administered("mimage")),
      pending,
      undefined,
    ),
  ).toStrictEqual({ offer: "Pending" });
});

test.each([
  ["the workspaces read failing", failed, mayNothing],
  ["the workspaces read answering nothing", absent, mayNothing],
  ["the abilities read failing", listed(administered("mimage")), failed],
  ["one read failing while the other is unsettled", failed, pending],
  ["one read unsettled while the other has failed", pending, failed],
] as const)(
  "%s leaves the field free text, starting on the workspace the address names",
  (_, workspaces, may) => {
    expect(
      projectCreationWorkspaceOffer(workspaces, may, "northwind"),
    ).toStrictEqual({ offer: "Typed", name: "northwind" });
    expect(
      projectCreationWorkspaceOffer(workspaces, may, undefined),
    ).toStrictEqual({ offer: "Typed", name: "" });
  },
);

test("an entry is called by its workspace, and the making of one by its own words", () => {
  expect(projectCreationWorkspaceEntryText(held("mimage"))).toBe("mimage");
  expect(projectCreationWorkspaceEntryText(creation)).toBe("New workspace");
});

const offered = {
  offer: "Choice",
  entries: [held("acme"), held("northwind"), creation],
  start: held("northwind"),
} as const;

test("the form stands where the choice starts until the reader picks, and on their pick after", () => {
  expect(projectCreationWorkspaceChosen(offered, undefined)).toStrictEqual(
    held("northwind"),
  );
  expect(projectCreationWorkspaceChosen(offered, held("acme"))).toStrictEqual(
    held("acme"),
  );
  expect(projectCreationWorkspaceChosen(offered, creation)).toStrictEqual(
    creation,
  );
});

test("a pick the choice no longer holds falls back to where it starts", () => {
  expect(projectCreationWorkspaceChosen(offered, held("gone"))).toStrictEqual(
    held("northwind"),
  );
  expect(
    projectCreationWorkspaceChosen(
      { ...offered, entries: [held("acme"), held("northwind")] },
      creation,
    ),
  ).toStrictEqual(held("northwind"));
});

test("the form sends the workspace it stands on, and the typed name where it stands on making one", () => {
  expect(projectCreationWorkspaceTenant(offered, untouched)).toBe("northwind");
  expect(
    projectCreationWorkspaceTenant(offered, {
      picked: held("acme"),
      typed: "typed-and-left",
    }),
  ).toBe("acme");
  expect(
    projectCreationWorkspaceTenant(offered, {
      picked: creation,
      typed: "brand-new",
    }),
  ).toBe("brand-new");
  expect(
    projectCreationWorkspaceTenant(offered, {
      picked: creation,
      typed: undefined,
    }),
  ).toBe("");
});

test("free text sends what the reader typed, and what it started on until they type", () => {
  const typed = { offer: "Typed", name: "northwind" } as const;
  expect(projectCreationWorkspaceTenant(typed, untouched)).toBe("northwind");
  expect(
    projectCreationWorkspaceTenant(typed, { picked: undefined, typed: "" }),
  ).toBe("");
  expect(
    projectCreationWorkspaceTenant(typed, { picked: undefined, typed: "acme" }),
  ).toBe("acme");
});

test("nothing offered yet sends no workspace, whatever was typed", () => {
  expect(
    projectCreationWorkspaceTenant(
      { offer: "Pending" },
      { picked: held("acme"), typed: "acme" },
    ),
  ).toBe("");
});
