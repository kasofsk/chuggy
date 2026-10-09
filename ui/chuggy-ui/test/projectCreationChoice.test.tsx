/**
 * The form's workspace as each answer of its two reads draws it, on the page
 * a project is made at and on the landing a reader with no project meets: the
 * choice and where it stands, the name field the making of a workspace shows,
 * the loading field nothing is sent from, the free text a failed read leaves,
 * and the empty state that stands in for the form.
 *
 * What a press sends is asserted beside what is drawn, so the workspace named
 * on the wire is the one the choice stood on.
 */

// jscpd:ignore-start -- the imports and vi.mock factories a case cannot hoist out
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
  workspaceChoice,
  workspaceChosen,
  workspaceEntries,
} from "./projectCreationDrawn.tsx";
import type { ProjectCreationAccess } from "./projectCreationDrawn.tsx";
import { resizeObserverStubbed } from "./resizeObserver.ts";
import { answer, heldAnswer, settled } from "./screenHarness.tsx";
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

const several = [
  administered("acme"),
  joined("harbour"),
  administered("northwind"),
];

function workspaceBox(): HTMLElement | null {
  return screen.queryByRole("textbox", { name: "Workspace" });
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

test("several are listed in the order the read gives without the ones the reader only belongs to, and the form starts on the first", async () => {
  served([], created, accessHolding(several));
  await drawn(<ProjectCreationPage />);
  expect(screen.getByRole("button", { name: "Workspace acme" })).toBeDefined();
  expect(await workspaceEntries()).toStrictEqual(["acme", "northwind"]);
  expect(workspaceBox()).toBeNull();
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
  ["a workspace the reader may add to", "northwind", "northwind"],
  ["a workspace the reader only belongs to", "harbour", "acme"],
  ["what no workspace of theirs is called", "elsewhere", "acme"],
])(
  "under an address naming %s the form starts on %s's choice",
  async (_named, workspace, stands) => {
    served([], created, accessHolding(several));
    await drawn(<ProjectCreationPage workspace={workspace} />);
    expect(
      screen.getByRole("button", { name: `Workspace ${stands}` }),
    ).toBeDefined();
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

test("choosing another workspace takes a refusal's line down and draws a new identity", async () => {
  const posted = served(
    [],
    () =>
      Promise.resolve(
        answer({ error: { code: "ProjectExists", message: "exists" } }, 409),
      ),
    accessHolding(several),
  );
  await drawn(<ProjectCreationPage />);
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

test("a reader who may make a workspace has that as the last entry, and no name to type until they choose it", async () => {
  served([], created, accessHolding(several, true));
  await drawn(<ProjectCreationPage />);
  expect(screen.getByRole("button", { name: "Workspace acme" })).toBeDefined();
  expect(await workspaceEntries()).toStrictEqual([
    "acme",
    "northwind",
    "New workspace",
  ]);
  expect(workspaceBox()).toBeNull();
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
] as const)(
  "%s leaves the workspace the free text it was, starting on what the address names",
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
