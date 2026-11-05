/**
 * The bar's trail, derived from the address: the workspace by name, the project
 * linking to its tickets, the screen linking to itself where it has a page of
 * its own, and whatever the screen holds named by its decoded segments.
 */

import { expect, test } from "vitest";

import type { PartitionIdentity } from "../../../src/contract/http.ts";
import { shellCrumbs } from "../app/core/shellCrumbs.ts";
import { navRoutes } from "../app/core/shellNav.ts";

const atlas: PartitionIdentity = { tenant: "acme", project: "atlas" };

const params = { tenant: "acme", project: "atlas" };

/** The workspace and the project, which head every trail in a project. */
const head = [
  { label: "acme" },
  { label: "atlas", link: { to: navRoutes.overview, params } },
] as const;

test("the overview is the workspace, the project and its tickets", () => {
  expect(shellCrumbs(atlas, "/acme/atlas")).toStrictEqual([
    ...head,
    { label: "tickets" },
  ]);
});

test("a ticket's page and its edit are under tickets, which links to the overview", () => {
  const tickets = {
    label: "tickets",
    link: { to: navRoutes.overview, params },
  };
  expect(shellCrumbs(atlas, "/acme/atlas/tickets/7")).toStrictEqual([
    ...head,
    tickets,
    { label: "7" },
  ]);
  expect(shellCrumbs(atlas, "/acme/atlas/tickets/7/edit")).toStrictEqual([
    ...head,
    tickets,
    { label: "7" },
    { label: "edit" },
  ]);
});

test("a screen links to its own page, and what it holds is named decoded", () => {
  expect(shellCrumbs(atlas, "/acme/atlas/runners")).toStrictEqual([
    ...head,
    { label: "runners", link: { to: navRoutes.runners, params } },
  ]);
  expect(shellCrumbs(atlas, "/acme/atlas/repositories/a%2Fb")).toStrictEqual([
    ...head,
    { label: "repositories", link: { to: navRoutes.repositories, params } },
    { label: "a/b" },
  ]);
});

test("a screen with no page of its own is named and links nowhere", () => {
  expect(shellCrumbs(atlas, "/acme/atlas/threads/s1")).toStrictEqual([
    ...head,
    { label: "threads" },
    { label: "s1" },
  ]);
});
