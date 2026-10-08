/**
 * The site's workspaces page, mounted: a row a workspace in the order
 * answered, saying who administers it and whom they may invite, under their
 * count and the one action; a cut list and an unread one each saying so; and
 * one line, with no list read, for a reader who may make no workspace.
 */

// jscpd:ignore-start -- renderer tests must declare their own hoisted mock factories
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { answer } from "../screenHarness.tsx";
import type * as BrowserPorts from "../../app/browser/ports.ts";
import { styleless } from "../styleless.ts";
import { permissionsTenant, unanswered } from "./permissionsFixture.tsx";
import {
  drawWorkspaces,
  workspaceListReads,
  workspaceRow,
  workspacesAbilitiesEvery,
  workspacesDrawn,
  workspacesListed,
  workspacesWithheld,
} from "./siteWorkspacesFixture.tsx";

vi.mock("../../app/browser/ports.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof BrowserPorts>()),
  sleepMs: () => Promise.resolve(),
}));

vi.mock("@tanstack/react-router", () => ({
  createLink: (component: unknown) => component,
  Link: (props: { readonly to?: string; readonly children?: ReactNode }) => (
    <a href={props.to}>{props.children}</a>
  ),
  useNavigate: () => (to: unknown) => Promise.resolve(to),
  useParams: () => ({ tenant: permissionsTenant }),
}));
// jscpd:ignore-end -- the case's own doubles resume here

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function listedWith(listed: Partial<typeof workspacesListed>): () => Response {
  return () => answer({ ...workspacesListed, ...listed });
}

test("a workspace is a row, in the order answered: its name, its admins a line each, and whom they may invite", async () => {
  await drawWorkspaces();
  expect(
    screen.getAllByRole("columnheader").map((column) => column.textContent),
  ).toStrictEqual(["Workspace", "Admins", "Invites"]);
  expect(workspacesDrawn()).toStrictEqual([
    [
      "globex",
      "bob@example.com bob",
      "s-robot No account",
      "+2 more",
      "Existing accounts",
    ],
    ["acme", "ada@example.com ada You", "s-dan", "New people"],
    ["umbrella", "3 unnamed", "New people"],
    ["initech", "Existing accounts"],
  ]);
  styleless();
});

test("an admin with no account, and one no directory answered for, is their subject in the identity's face", async () => {
  await drawWorkspaces();
  for (const subject of ["s-robot", "s-dan"])
    expect(screen.getByText(subject).classList.contains("identity")).toBe(true);
  expect(
    screen.getByText("bob@example.com").classList.contains("identity"),
  ).toBe(false);
});

test("a workspace whose admins may make no account says so quietly, one whose may does not, and a stacked row keeps either beside its name", async () => {
  await drawWorkspaces();
  const invites = (name: string): readonly string[] => [
    ...(workspaceRow(name).lastElementChild?.classList ?? []),
  ];
  expect(invites("globex")).toStrictEqual(["people-beside", "text-ink-3"]);
  expect(invites("acme")).toStrictEqual(["people-beside"]);
});

test("a workspace with no admin draws a dash its stacked row leaves out, and no other row does", async () => {
  await drawWorkspaces();
  const none = within(workspaceRow("initech")).getByText("None");
  expect(none.closest("td")?.getAttribute("data-none")).toBe("");
  expect(screen.getAllByText("None")).toStrictEqual([none]);
  expect(
    [...document.querySelectorAll("td[data-none]")].map(
      (cell) => cell.closest("tr")?.firstElementChild?.textContent,
    ),
  ).toStrictEqual(["initech"]);
});

test("the workspaces are counted over their table, beside the one action, with nothing said", async () => {
  await drawWorkspaces();
  expect(screen.getByRole("heading", { name: "4 workspaces" })).toBeTruthy();
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toStrictEqual(["New workspace"]);
  expect(screen.getAllByRole("region")).toHaveLength(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText("List cut short")).toBeNull();
  expect(screen.queryByText(workspacesWithheld)).toBeNull();
});

test("one workspace is counted as one, and none as none over no table", async () => {
  await drawWorkspaces({
    listing: listedWith({ tenants: workspacesListed.tenants.slice(0, 1) }),
  });
  expect(screen.getByRole("heading", { name: "1 workspace" })).toBeTruthy();
  expect(workspacesDrawn()).toHaveLength(1);
  cleanup();
  await drawWorkspaces({ listing: listedWith({ tenants: [] }) });
  expect(screen.getByRole("heading", { name: "0 workspaces" })).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.getByRole("button", { name: "New workspace" })).toBeTruthy();
});

test("a cut list says so under its table, in the People page's words", async () => {
  await drawWorkspaces({ listing: listedWith({ truncated: true }) });
  const cut = screen.getByText("List cut short");
  expect(
    screen.getByRole("table").compareDocumentPosition(cut) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(workspacesDrawn()).toHaveLength(workspacesListed.tenants.length);
});

test("a list loading or failed is the read's own line, with no table and no action", async () => {
  await drawWorkspaces({ listing: unanswered });
  expect(screen.getByText("Loading…")).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  cleanup();
  await drawWorkspaces({ listing: () => answer({}, 500) });
  expect(
    screen.getByText("Failed to load · the API failed with InternalError"),
  ).toBeTruthy();
  expect(screen.queryByRole("table")).toBeNull();
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(screen.queryByText(workspacesWithheld)).toBeNull();
});

test("a list absent to a reader the abilities offered it is who creates workspaces, and no action", async () => {
  await drawWorkspaces({ listing: () => answer({}, 404) });
  expect(screen.getByText(workspacesWithheld)).toBeTruthy();
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(screen.queryByText(/^Not available/u)).toBeNull();
});

test.each([
  {
    reader: "who may do everything on the site but make a workspace",
    abilities: () =>
      answer({ ...workspacesAbilitiesEvery, createTenant: false }),
  },
  {
    reader: "the site's abilities are absent to",
    abilities: () => answer({}, 404),
  },
])(
  "a reader $reader is told who creates workspaces, with no list read and no action",
  async ({ abilities }) => {
    const drawn = await drawWorkspaces({ abilities });
    expect(screen.getByText(workspacesWithheld)).toBeTruthy();
    expect(workspaceListReads(drawn)).toBe(0);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("region")).toBeNull();
    expect(screen.queryAllByRole("button")).toStrictEqual([]);
    expect(screen.queryByText(/^Not available/u)).toBeNull();
  },
);

test("the abilities loading or failed is the page's unready line, with no list read and no word on who creates", async () => {
  const loading = await drawWorkspaces({ abilities: unanswered });
  expect(screen.getByText("Loading…")).toBeTruthy();
  expect(workspaceListReads(loading)).toBe(0);
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(screen.queryByText(workspacesWithheld)).toBeNull();
  cleanup();
  const failed = await drawWorkspaces({ abilities: () => answer({}, 500) });
  expect(
    screen.getByText("Failed to load · the API failed with InternalError"),
  ).toBeTruthy();
  expect(workspaceListReads(failed)).toBe(0);
  expect(screen.queryAllByRole("button")).toStrictEqual([]);
  expect(screen.queryByText(workspacesWithheld)).toBeNull();
});
