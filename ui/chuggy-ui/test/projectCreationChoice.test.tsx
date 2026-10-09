/**
 * The form's workspace as each answer of its two reads draws it, on the page
 * a project is made at and on the landing a reader with no project meets: the
 * choice and where it stands, which among several is on none until the reader
 * says, the name field the making of a workspace shows, the loading field
 * nothing is sent from, the typed name a failed or cut-short read leaves, and
 * the empty state that stands in for the form.
 *
 * What a press sends is asserted beside what is drawn, so the workspace named
 * on the wire is the one the choice stood on, and so is the identity it went
 * under, which no other pair of names is sent under.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
import { QueryClient } from "@tanstack/react-query";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { ProjectCreationPage } from "../app/browser/ProjectCreation.tsx";
import { Landing } from "../app/browser/routes.tsx";
import { projectNameRule } from "../app/core/projectCreation.ts";
import {
  accessHolding,
  administered,
  drawn,
  joined,
  pressed,
  ruleUnder,
  served,
  submit,
  typed,
  workspaceCaptions,
  workspaceChoice,
  workspaceChosen,
  workspaceEntries,
} from "./projectCreationDrawn.tsx";
import type {
  ProjectCreationAccess,
  ProjectCreationPosted,
} from "./projectCreationDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, heldAnswer, settled } from "./screenHarness.tsx";
import type { AccessCallerTenant } from "../../../src/contract/accessPlane.ts";
import type * as BrowserPorts from "../app/browser/ports.ts";
import type * as RouterModule from "@tanstack/react-router";

vi.mock("../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  Link: (props: { readonly children?: ReactNode }) => (
    <a href="/">{props.children}</a>
  ),
  useNavigate: () => () => Promise.resolve(),
}));
// jscpd:ignore-end -- the case's own doubles resume here

beforeAll(() => {
  Element.prototype.scrollIntoView = () => undefined;
  Element.prototype.hasPointerCapture = () => false;
});

beforeEach(() => {
  resizeObserverStubbed();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function created(): Promise<Response> {
  return Promise.resolve(answer({ tenant: "acme", project: "atlas" }, 201));
}

function refused(): Promise<Response> {
  return Promise.resolve(
    answer({ error: { code: "ProjectExists", message: "exists" } }, 409),
  );
}

function unanswered(): Promise<Response> {
  return Promise.reject(new Error("offline"));
}

const several = [
  administered("acme"),
  joined("harbour"),
  administered("northwind"),
];

function workspaceBox(): HTMLElement | null {
  return screen.queryByRole("textbox", { name: "Workspace" });
}

/** The trigger of a choice that stands on no entry. */
function workspaceUnchosen(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Workspace Choose" });
}

test("one workspace the reader may add to is shown chosen, and the project is the only name to type", async () => {
  const posted = served([], created, accessHolding([administered("mimage")]));
  await drawn(<ProjectCreationPage />);
  expect(screen.getByRole("heading", { name: "New project" })).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Workspace mimage" }),
  ).toBeDefined();
  expect(
    screen.getAllByRole("textbox").map((box) => box.getAttribute("aria-label")),
  ).toStrictEqual(["Project"]);
  expect(await workspaceEntries()).toStrictEqual(["mimage"]);
  typed("Project", "atlas");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "mimage", project: "atlas" },
  ]);
});

test.each([
  ["the choice", accessHolding(several)],
  ["the choice of one", accessHolding([administered("mimage")])],
  [
    "the typed name",
    { ...accessHolding([]), workspaces: () => answer({}, 500) },
  ],
] as const)(
  "%s is captioned Workspace where a reader sees it",
  async (_, access) => {
    served([], created, access);
    await drawn(<ProjectCreationPage />);
    expect(workspaceCaptions()).toHaveLength(1);
  },
);

test("several are listed in the order the read gives without the ones the reader only belongs to, and the choice stands on none of them", async () => {
  served([], created, accessHolding(several));
  await drawn(<ProjectCreationPage />);
  expect(workspaceUnchosen()).not.toBeNull();
  expect(await workspaceEntries()).toStrictEqual(["acme", "northwind"]);
  expect(workspaceBox()).toBeNull();
});

test("a choice that stands on no entry sends nothing until the reader chooses one", async () => {
  const posted = served([], created, accessHolding(several));
  await drawn(<ProjectCreationPage />);
  typed("Project", "atlas");
  expect(submit()).toHaveProperty("disabled", true);
  await pressed();
  expect(posted).toStrictEqual([]);
  await workspaceChosen("northwind");
  expect(workspaceUnchosen()).toBeNull();
  expect(submit()).toHaveProperty("disabled", false);
});

/** The field stands at the page's edge, where a menu under its trigger's
 * middle would be pushed against the viewport. */
test("the choice's menu lines up with the start of its trigger", async () => {
  served([], created, accessHolding(several));
  await drawn(<ProjectCreationPage />);
  fireEvent.keyDown(workspaceChoice(), { key: "ArrowDown" });
  expect((await screen.findByRole("menu")).getAttribute("data-align")).toBe(
    "start",
  );
});

test.each([
  ["a workspace the reader may add to", "that workspace", "northwind"],
  ["a workspace the reader only belongs to", "no entry", "harbour"],
  ["what no workspace of theirs is called", "no entry", "elsewhere"],
] as const)(
  "under an address naming %s the choice starts on %s",
  async (_named, stands, workspace) => {
    served([], created, accessHolding(several));
    await drawn(<ProjectCreationPage workspace={workspace} />);
    expect(
      screen.getByRole("button", {
        name: `Workspace ${stands === "no entry" ? "Choose" : workspace}`,
      }),
    ).toBeDefined();
    typed("Project", "atlas");
    expect(submit()).toHaveProperty("disabled", stands === "no entry");
  },
);

test("the form sends the workspace the reader chose", async () => {
  const posted = served([], created, accessHolding(several));
  await drawn(<ProjectCreationPage />);
  await workspaceChosen("northwind");
  expect(
    screen.getByRole("button", { name: "Workspace northwind" }),
  ).toBeDefined();
  typed("Project", "atlas");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "northwind", project: "atlas" },
  ]);
});

test("choosing another workspace takes a refusal's line down and sends under a new identity", async () => {
  const posted = served([], refused, accessHolding(several));
  await drawn(<ProjectCreationPage />);
  await workspaceChosen("acme");
  typed("Project", "atlas");
  await pressed();
  expect(screen.getByRole("status").textContent).toBe("Exists");
  await workspaceChosen("northwind");
  expect(screen.queryByRole("status")).toBeNull();
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "acme", project: "atlas" },
    { tenant: "northwind", project: "atlas" },
  ]);
  expect(posted[1]?.key).not.toBe(posted[0]?.key);
});

test("the two names an answer never came for, stood on again, show its line again and repeat under its identity", async () => {
  const posted = served([], unanswered, accessHolding(several));
  await drawn(<ProjectCreationPage />);
  await workspaceChosen("acme");
  typed("Project", "atlas");
  await pressed();
  expect(screen.getByRole("status").textContent).toBe("Unreachable");
  await workspaceChosen("northwind");
  expect(screen.queryByRole("status")).toBeNull();
  await workspaceChosen("acme");
  expect(screen.getByRole("status").textContent).toBe("Unreachable");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "acme", project: "atlas" },
    { tenant: "acme", project: "atlas" },
  ]);
  expect(posted[1]?.key).toBe(posted[0]?.key);
});

test("a press takes the last answer's line down until its own answer comes", async () => {
  const second = heldAnswer();
  const answers = [refused(), second.answered];
  const posted = served(
    [],
    () => answers.shift() ?? refused(),
    accessHolding([administered("mimage")]),
  );
  await drawn(<ProjectCreationPage />);
  typed("Project", "atlas");
  await pressed();
  expect(screen.getByRole("status").textContent).toBe("Exists");
  await pressed();
  expect(screen.queryByRole("status")).toBeNull();
  second.release(await refused());
  await settled();
  expect(screen.getByRole("status").textContent).toBe("Exists");
  expect(posted).toHaveLength(2);
});

/**
 * The page mounted a second time over what its first mount read of `first`.
 * The second mount draws that and reads the workspaces again, which is
 * answered when the case calls `arrives`.
 */
async function mountedAgain(
  first: readonly AccessCallerTenant[],
  creation: () => Promise<Response>,
): Promise<{
  readonly posted: readonly ProjectCreationPosted[];
  readonly arrives: (tenants: readonly AccessCallerTenant[]) => Promise<void>;
}> {
  const client = new QueryClient();
  served([], creation, accessHolding(first));
  await drawn(<ProjectCreationPage />, client);
  cleanup();
  const reread = heldAnswer();
  const posted = served([], creation, {
    ...accessHolding([]),
    workspaces: () => reread.answered,
  });
  await drawn(<ProjectCreationPage />, client);
  return {
    posted,
    arrives: async (tenants) => {
      reread.release(answer({ tenants, truncated: false }));
      await settled();
    },
  };
}

/** The workspace the form stands on comes from a read, so it can change with
 * no edit between two presses. */
test("a read arriving again that moves where the form stands takes the unanswered line down, and the next press goes under a new identity", async () => {
  const again = await mountedAgain([administered("northwind")], unanswered);
  expect(workspaceChoice().textContent).toContain("northwind");
  typed("Project", "atlas");
  await pressed();
  expect(screen.getByRole("status").textContent).toBe("Unreachable");
  await again.arrives([administered("acme")]);
  expect(workspaceChoice().textContent).toContain("acme");
  expect(screen.queryByRole("status")).toBeNull();
  await pressed();
  expect(again.posted.map((one) => one.body)).toStrictEqual([
    { tenant: "northwind", project: "atlas" },
    { tenant: "acme", project: "atlas" },
  ]);
  expect(again.posted[1]?.key).not.toBe(again.posted[0]?.key);
});

test("a read arriving again moves nothing the reader chose", async () => {
  const again = await mountedAgain(several, created);
  await workspaceChosen("northwind");
  await again.arrives([administered("zephyr"), ...several]);
  expect(await workspaceEntries()).toStrictEqual([
    "zephyr",
    "acme",
    "northwind",
  ]);
  typed("Project", "atlas");
  await pressed();
  expect(again.posted.map((one) => one.body)).toStrictEqual([
    { tenant: "northwind", project: "atlas" },
  ]);
});

test("a reader who may make a workspace has that as the last entry, and no name to type until they choose it", async () => {
  served([], created, accessHolding(several, true));
  await drawn(<ProjectCreationPage />);
  expect(workspaceUnchosen()).not.toBeNull();
  expect(await workspaceEntries()).toStrictEqual([
    "acme",
    "northwind",
    "New workspace",
  ]);
  expect(workspaceBox()).toBeNull();
});

test("the only workspace to add to is where a reader who may make another starts", async () => {
  const posted = served(
    [],
    created,
    accessHolding([administered("mimage")], true),
  );
  await drawn(<ProjectCreationPage />);
  expect(
    screen.getByRole("button", { name: "Workspace mimage" }),
  ).toBeDefined();
  expect(await workspaceEntries()).toStrictEqual(["mimage", "New workspace"]);
  typed("Project", "atlas");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "mimage", project: "atlas" },
  ]);
});

test("choosing New workspace shows its name field under the rule, and choosing another takes the field and its fault down", async () => {
  const posted = served([], created, accessHolding(several, true));
  await drawn(<ProjectCreationPage />);
  typed("Project", "atlas");
  await workspaceChosen("New workspace");
  expect(workspaceBox()).toHaveProperty("value", "");
  expect(ruleUnder("Workspace").textContent).toBe(projectNameRule);
  expect(ruleUnder("Workspace").className).not.toContain("text-tone-fail");
  expect(submit()).toHaveProperty("disabled", true);
  typed("Workspace", "Brand New");
  expect(ruleUnder("Workspace").className).toContain("text-tone-fail");
  expect(workspaceBox()?.getAttribute("aria-invalid")).toBe("true");
  expect(submit()).toHaveProperty("disabled", true);
  await workspaceChosen("northwind");
  expect(workspaceBox()).toBeNull();
  expect(document.querySelector(".text-tone-fail")).toBeNull();
  expect(submit()).toHaveProperty("disabled", false);
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "northwind", project: "atlas" },
  ]);
});

test("a name typed for a new workspace is gone once another entry is chosen", async () => {
  served([], created, accessHolding(several, true));
  await drawn(<ProjectCreationPage />);
  await workspaceChosen("New workspace");
  typed("Workspace", "abandoned");
  await workspaceChosen("northwind");
  await workspaceChosen("New workspace");
  expect(workspaceBox()).toHaveProperty("value", "");
});

test("the form sends the name typed for a new workspace", async () => {
  const posted = served([], created, accessHolding(several, true));
  await drawn(<ProjectCreationPage />);
  await workspaceChosen("New workspace");
  typed("Workspace", "brand-new");
  typed("Project", "atlas");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "brand-new", project: "atlas" },
  ]);
});

test("a reader who may make a workspace and holds none starts on making one", async () => {
  served([], created, accessHolding([], true));
  await drawn(<ProjectCreationPage workspace="northwind" />);
  expect(
    screen.getByRole("button", { name: "Workspace New workspace" }),
  ).toBeDefined();
  expect(workspaceBox()).toHaveProperty("value", "");
  expect(await workspaceEntries()).toStrictEqual(["New workspace"]);
});

test.each([
  [
    "the reader's workspaces",
    (unsettled: Promise<Response>): ProjectCreationAccess => ({
      ...accessHolding([]),
      workspaces: () => unsettled,
    }),
    answer({ tenants: [administered("mimage")], truncated: false }),
  ],
  [
    "what the reader may do on the site",
    (unsettled: Promise<Response>): ProjectCreationAccess => ({
      ...accessHolding([administered("mimage")]),
      abilities: () => unsettled,
    }),
    answer({}, 404),
  ],
])(
  "while the read of %s is unsettled the field says it is loading and nothing is sent, and the project typed meanwhile is kept",
  async (_read, access, arrives) => {
    const unsettled = heldAnswer();
    const posted = served([], created, access(unsettled.answered));
    await drawn(<ProjectCreationPage />);
    expect(screen.getByText("Workspace")).toBeDefined();
    expect(screen.getByText("Loading…")).toBeDefined();
    expect(workspaceBox()).toBeNull();
    expect(screen.queryByRole("button", { name: /^Workspace / })).toBeNull();
    typed("Project", "atlas");
    expect(submit()).toHaveProperty("disabled", true);
    await pressed();
    expect(posted).toStrictEqual([]);
    unsettled.release(arrives);
    await settled();
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(workspaceChoice().textContent).toContain("mimage");
    expect(screen.getByRole("textbox", { name: "Project" })).toHaveProperty(
      "value",
      "atlas",
    );
    expect(submit()).toHaveProperty("disabled", false);
  },
);

test.each([
  [
    "the workspaces read failing",
    { ...accessHolding([]), workspaces: () => answer({}, 500) },
  ],
  [
    "the workspaces read answering what cannot be read",
    { ...accessHolding([]), workspaces: () => answer({ tenants: "many" }) },
  ],
  [
    "the abilities read failing",
    { ...accessHolding(several), abilities: () => answer({}, 500) },
  ],
  [
    "a workspaces answer cut short",
    {
      ...accessHolding([]),
      workspaces: () =>
        answer({ tenants: [administered("mimage")], truncated: true }),
    },
  ],
] as const)(
  "%s leaves the workspace a name to type, starting on what the address names",
  async (_failure, access) => {
    const posted = served([], created, access);
    await drawn(<ProjectCreationPage workspace="northwind" />);
    expect(workspaceBox()).toHaveProperty("value", "northwind");
    expect(ruleUnder("Workspace").textContent).toBe(projectNameRule);
    expect(screen.queryByRole("button", { name: /^Workspace / })).toBeNull();
    typed("Workspace", "typed-here");
    typed("Project", "atlas");
    await pressed();
    expect(posted.map((one) => one.body)).toStrictEqual([
      { tenant: "typed-here", project: "atlas" },
    ]);
  },
);

test("the abilities read failing over one workspace to add to starts the typed name on it", async () => {
  const posted = served([], created, {
    ...accessHolding([joined("harbour"), administered("mimage")]),
    abilities: () => answer({}, 500),
  });
  await drawn(<ProjectCreationPage />);
  expect(workspaceBox()).toHaveProperty("value", "mimage");
  typed("Project", "atlas");
  await pressed();
  expect(posted.map((one) => one.body)).toStrictEqual([
    { tenant: "mimage", project: "atlas" },
  ]);
});

test.each([
  ["no workspace", []],
  ["only workspaces the reader belongs to", [joined("harbour")]],
] as const)(
  "an answer cut short that lists %s draws the form and no empty state",
  async (_listed, tenants) => {
    served([], created, {
      ...accessHolding([]),
      workspaces: () => answer({ tenants, truncated: true }),
    });
    await drawn(<ProjectCreationPage />);
    expect(screen.getByRole("heading", { name: "New project" })).toBeDefined();
    expect(workspaceBox()).toHaveProperty("value", "");
    expect(submit()).toBeDefined();
  },
);

const unheld = {
  access: accessHolding([]),
  label: "No workspace",
  detail: "A new workspace needs an invite link",
};

const unadministered = {
  access: accessHolding([joined("harbour"), joined("zephyr")]),
  label: "No workspace to add to",
  detail: "A workspace admin adds projects",
};

test.each([
  ["the page a project is made at", "no workspace", "page", unheld],
  ["the page a project is made at", "none to add to", "page", unadministered],
  ["the no-project landing", "no workspace", "landing", unheld],
  ["the no-project landing", "none to add to", "landing", unadministered],
] as const)(
  "%s draws one empty state and no form for a reader with %s",
  async (_page, _reader, page, withheld) => {
    const posted = served([], created, withheld.access);
    await drawn(page === "page" ? <ProjectCreationPage /> : <Landing />);
    expect(
      screen
        .getAllByRole("heading", { level: 1 })
        .map((heading) => heading.textContent),
    ).toStrictEqual([withheld.label]);
    expect(screen.getByText(withheld.detail)).toBeDefined();
    expect(screen.queryByText("No projects")).toBeNull();
    expect(screen.queryByText("Create one to start")).toBeNull();
    expect(screen.queryByText("New project")).toBeNull();
    expect(screen.queryAllByRole("textbox")).toStrictEqual([]);
    expect(screen.queryByRole("button", { name: "Create project" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Workspace / })).toBeNull();
    expect(posted).toStrictEqual([]);
  },
);

test("the no-project landing leads the choice with its own empty state", async () => {
  served([], created, accessHolding([administered("mimage")]));
  await drawn(<Landing />);
  expect(
    screen
      .getAllByRole("heading", { level: 1 })
      .map((heading) => heading.textContent),
  ).toStrictEqual(["No projects"]);
  expect(screen.getByText("Create one to start")).toBeDefined();
  expect(
    screen.getByRole("button", { name: "Workspace mimage" }),
  ).toBeDefined();
  expect(submit()).toBeDefined();
});
