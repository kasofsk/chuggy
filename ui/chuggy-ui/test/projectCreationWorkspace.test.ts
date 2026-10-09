/**
 * The workspace choice as it is decided: the entries it holds and where it
 * starts under each pair of answers, which is on nothing wherever starting
 * would be a guess, the empty state each reader with nothing to choose is
 * drawn, the free text a failed or cut-short read leaves, and the name the
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
  projectCreationWorkspacePicked,
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

/** An answer that says there are more workspaces than it lists. */
function cutShort(
  ...tenants: readonly AccessCallerTenant[]
): PanelState<AccessCallerTenants> {
  return ready({ tenants: [...tenants], truncated: true });
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
  start: ProjectCreationWorkspaceEntry | undefined,
): ProjectCreationWorkspaceOffer {
  return { offer: "Choice", entries, start };
}

const untouched = { picked: undefined, typed: undefined };

const several = listed(administered("acme"), administered("northwind"));
const severalEntries = [held("acme"), held("northwind")];

test("one workspace the reader administers is the whole choice, and where it starts", () => {
  expect(
    projectCreationWorkspaceOffer(
      listed(administered("mimage")),
      mayNothing,
      undefined,
    ),
  ).toStrictEqual(choice([held("mimage")], held("mimage")));
});

test("several are entries in the order the read gives, and the choice starts on none of them", () => {
  expect(
    projectCreationWorkspaceOffer(
      listed(administered("northwind"), administered("acme")),
      mayNothing,
      undefined,
    ),
  ).toStrictEqual(choice([held("northwind"), held("acme")], undefined));
});

test("among several the choice starts on the workspace the address names, and on nothing where the address names no entry", () => {
  expect(
    projectCreationWorkspaceOffer(several, mayNothing, "northwind"),
  ).toStrictEqual(choice(severalEntries, held("northwind")));
  expect(
    projectCreationWorkspaceOffer(several, mayNothing, "elsewhere"),
  ).toStrictEqual(choice(severalEntries, undefined));
});

test("the only workspace there is to choose is where the choice starts, whatever the address names and whether or not one may be made", () => {
  for (const may of [mayNothing, mayCreate])
    for (const named of [undefined, "elsewhere"])
      expect(
        projectCreationWorkspaceOffer(
          listed(administered("mimage")),
          may,
          named,
        ),
      ).toMatchObject({ offer: "Choice", start: held("mimage") });
});

test("a reader who may make a workspace has that as the last entry, and one who may not has no such entry", () => {
  expect(
    projectCreationWorkspaceOffer(several, mayCreate, undefined),
  ).toStrictEqual(choice([...severalEntries, creation], undefined));
  expect(
    projectCreationWorkspaceOffer(
      listed(administered("mimage")),
      mayCreate,
      undefined,
    ),
  ).toStrictEqual(choice([held("mimage"), creation], held("mimage")));
  for (const may of [mayNothing, abilities(false)])
    expect(
      projectCreationWorkspaceOffer(several, may, undefined),
    ).toStrictEqual(choice(severalEntries, undefined));
});

test("the address never starts the choice on the making of a workspace", () => {
  expect(
    projectCreationWorkspaceOffer(several, mayCreate, "elsewhere"),
  ).toStrictEqual(choice([...severalEntries, creation], undefined));
});

test("a reader who may make a workspace and has none to add to starts on making one", () => {
  expect(
    projectCreationWorkspaceOffer(listed(), mayCreate, undefined),
  ).toStrictEqual(choice([creation], creation));
  expect(
    projectCreationWorkspaceOffer(
      listed(joined("harbour")),
      mayCreate,
      "harbour",
    ),
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

test.each([
  ["the workspaces read is unsettled", pending, mayNothing],
  ["the abilities read is unsettled", listed(administered("mimage")), pending],
  [
    "the workspaces read is unsettled and the other has failed",
    pending,
    failed,
  ],
] as const)("nothing is offered while %s", (_, workspaces, may) => {
  expect(
    projectCreationWorkspaceOffer(workspaces, may, "northwind"),
  ).toStrictEqual({ offer: "Pending" });
});

test.each([
  ["the workspaces read failing", failed, mayNothing],
  ["the workspaces read answering nothing", absent, mayNothing],
  ["the workspaces read failing while the other is unsettled", failed, pending],
  ["both reads failing", failed, failed],
  ["an answer cut short", cutShort(administered("mimage")), mayNothing],
  ["an answer cut short that lists no workspace", cutShort(), mayNothing],
  ["an answer cut short while the other is unsettled", cutShort(), pending],
  [
    "an answer cut short where the other has failed",
    cutShort(administered("mimage")),
    failed,
  ],
  ["the abilities read failing over several workspaces", several, failed],
  ["the abilities read failing over no workspace", listed(), failed],
] as const)(
  "%s leaves the field free text, starting on the workspace the address names or on nothing",
  (_, workspaces, may) => {
    expect(
      projectCreationWorkspaceOffer(workspaces, may, "northwind"),
    ).toStrictEqual({ offer: "Typed", name: "northwind" });
    expect(
      projectCreationWorkspaceOffer(workspaces, may, undefined),
    ).toStrictEqual({ offer: "Typed", name: "" });
  },
);

test("the abilities read failing over one workspace to add to starts the free text on it, and on the address's where it names one", () => {
  const one = listed(joined("harbour"), administered("mimage"));
  expect(projectCreationWorkspaceOffer(one, failed, undefined)).toStrictEqual({
    offer: "Typed",
    name: "mimage",
  });
  expect(projectCreationWorkspaceOffer(one, failed, "northwind")).toStrictEqual(
    { offer: "Typed", name: "northwind" },
  );
});

test("an entry is called by its workspace, and the making of one by its own words", () => {
  expect(projectCreationWorkspaceEntryText(held("mimage"))).toBe("mimage");
  expect(projectCreationWorkspaceEntryText(creation)).toBe("New workspace");
});

const offered = {
  offer: "Choice",
  entries: [held("acme"), held("northwind"), creation],
  start: held("northwind"),
} as const;

const unstarted = { ...offered, start: undefined };

test("the form stands where the choice starts until the reader picks, and on their pick after", () => {
  expect(projectCreationWorkspaceChosen(offered, undefined)).toStrictEqual(
    held("northwind"),
  );
  expect(projectCreationWorkspaceChosen(unstarted, undefined)).toBeUndefined();
  for (const start of [offered, unstarted]) {
    expect(projectCreationWorkspaceChosen(start, held("acme"))).toStrictEqual(
      held("acme"),
    );
    expect(projectCreationWorkspaceChosen(start, creation)).toStrictEqual(
      creation,
    );
  }
});

test("a pick the choice no longer holds falls back to where it starts", () => {
  expect(projectCreationWorkspaceChosen(offered, held("gone"))).toStrictEqual(
    held("northwind"),
  );
  expect(
    projectCreationWorkspaceChosen(unstarted, held("gone")),
  ).toBeUndefined();
  expect(
    projectCreationWorkspaceChosen(
      { ...offered, entries: [held("acme"), held("northwind")] },
      creation,
    ),
  ).toStrictEqual(held("northwind"));
});

test("picking a workspace drops a name typed for a new one, and picking the making of one keeps it", () => {
  const typing = { picked: creation, typed: "abandoned" };
  expect(projectCreationWorkspacePicked(typing, held("acme"))).toStrictEqual({
    picked: held("acme"),
    typed: undefined,
  });
  expect(projectCreationWorkspacePicked(typing, creation)).toStrictEqual(
    typing,
  );
  expect(projectCreationWorkspacePicked(untouched, creation)).toStrictEqual({
    picked: creation,
    typed: undefined,
  });
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

test("a choice standing on no entry sends no workspace, whatever was typed", () => {
  expect(projectCreationWorkspaceTenant(unstarted, untouched)).toBe("");
  expect(
    projectCreationWorkspaceTenant(unstarted, {
      picked: undefined,
      typed: "typed-and-left",
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
