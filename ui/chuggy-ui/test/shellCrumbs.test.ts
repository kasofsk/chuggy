/**
 * The bar's trail, derived from the address: the workspace and the project by
 * the names given for them, the project linking to its tickets, the screen
 * linking to itself where it has a page of its own, and whatever the screen
 * holds named by its decoded segments.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { projectNamed } from "../app/core/projectNaming.ts";
import { memberChatCrumbs, shellCrumbs } from "../app/core/shellCrumbs.ts";
import type { ShellCrumbNames } from "../app/core/shellCrumbs.ts";
import { navRoutes } from "../app/core/shellNav.ts";
import { workspaceNames } from "../app/core/workspaceNames.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

const params = { tenant: "acme", project: "atlas" };

/** The reader's own lists, which call the workspace and the project something other than their address. */
const names: ShellCrumbNames = {
  workspace: workspaceNames({
    state: "Ready",
    value: {
      tenants: [
        {
          tenant: "acme",
          displayName: "Acme's Workspace",
          roles: ["Member"],
          administer: false,
        },
      ],
      truncated: false,
    },
    observedAtMs: undefined,
  }),
  project: (partition) =>
    projectNamed(
      [{ tenant: "acme", project: "atlas", name: "Atlas Web" }],
      partition,
    ),
};

/** Lists that have not answered, which name nothing. */
const unnamed: ShellCrumbNames = {
  workspace: workspaceNames({ state: "Pending" }),
  project: (partition) => projectNamed(undefined, partition),
};

/** The workspace and the project, which head every trail in a project. */
const head = [
  { label: "Acme's Workspace" },
  { label: "Atlas Web", link: { to: navRoutes.overview, params } },
] as const;

test("the workspace and the project are named by their segments where the reader's lists give no names", () => {
  expect(shellCrumbs(atlas, "/acme/atlas/tickets/7", unnamed)).toStrictEqual([
    { label: "acme" },
    { label: "atlas", link: { to: navRoutes.overview, params } },
    { label: "tickets", link: { to: navRoutes.overview, params } },
    { label: "7" },
  ]);
  expect(memberChatCrumbs("acme", unnamed.workspace)).toStrictEqual([
    { label: "acme" },
    { label: "chat" },
  ]);
});

test("the overview is the workspace, the project and its tickets", () => {
  expect(shellCrumbs(atlas, "/acme/atlas", names)).toStrictEqual([
    ...head,
    { label: "tickets" },
  ]);
});

test("a ticket's page and its edit are under tickets, which links to the overview", () => {
  const tickets = {
    label: "tickets",
    link: { to: navRoutes.overview, params },
  };
  expect(shellCrumbs(atlas, "/acme/atlas/tickets/7", names)).toStrictEqual([
    ...head,
    tickets,
    { label: "7" },
  ]);
  expect(shellCrumbs(atlas, "/acme/atlas/tickets/7/edit", names)).toStrictEqual(
    [...head, tickets, { label: "7" }, { label: "edit" }],
  );
});

test("a screen links to its own page, and what it holds is named decoded", () => {
  expect(shellCrumbs(atlas, "/acme/atlas/repositories", names)).toStrictEqual([
    ...head,
    { label: "repositories", link: { to: navRoutes.repositories, params } },
  ]);
  expect(
    shellCrumbs(atlas, "/acme/atlas/repositories/a%2Fb", names),
  ).toStrictEqual([
    ...head,
    { label: "repositories", link: { to: navRoutes.repositories, params } },
    { label: "a/b" },
  ]);
});

test("the Pools page is under settings, as every settings page is", () => {
  expect(shellCrumbs(atlas, "/acme/atlas/settings/pools", names)).toStrictEqual(
    [
      ...head,
      { label: "settings", link: { to: navRoutes.settings, params } },
      { label: "pools" },
    ],
  );
});

test("a screen with no page of its own is named and links nowhere", () => {
  expect(shellCrumbs(atlas, "/acme/atlas/threads/s1", names)).toStrictEqual([
    ...head,
    { label: "threads" },
    { label: "s1" },
  ]);
});

test("a workspace's own chat is under the workspace by its name, and named by its segment", () => {
  expect(memberChatCrumbs("acme", names.workspace)).toStrictEqual([
    { label: "Acme's Workspace" },
    { label: "chat" },
  ]);
});
