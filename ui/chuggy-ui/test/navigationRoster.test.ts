/**
 * The navigation model against the router: every page the console registers
 * is a primary place, a settings section, or a page reached from one of them,
 * and every address a page left redirects to its section, with what it
 * carried. A page added to the router and to neither navigation fails here,
 * as does a section whose route the router never registered.
 */

import { createMemoryHistory } from "@tanstack/react-router";
import { expect, test } from "vitest";

import { consoleRouterOver } from "../app/browser/routes.tsx";
import { settingsSections } from "../app/core/settingsNav.ts";
import { navMoved, navRoutes, shellNav } from "../app/core/shellNav.ts";

const project = navRoutes.overview;

const routeIds = Object.keys(
  consoleRouterOver(createMemoryHistory()).routesById,
);

/** A route at or beneath an address, segment by segment. */
function beneath(routeId: string, address: string): boolean {
  return routeId === address || routeId.startsWith(`${address}/`);
}

/** The pages under a project that no navigation names, by what reaches each:
 * a ticket's from Tickets, a thread's from the chat pane. */
const reachedFromPlaces = [`${project}/tickets`, `${project}/threads`] as const;

test("every page under a project is a primary place, a settings section, a page reached from one, or an address that moved", () => {
  const places = shellNav({ tenant: "acme", project: "atlas" })
    .map((entry) => entry.to)
    .filter((to) => to !== project);
  const sections = settingsSections.map((section) => section.project);
  const unaccounted = routeIds
    .filter((routeId) => routeId.startsWith(`${project}/`))
    .filter((routeId) => routeId !== `${project}/`)
    .filter(
      (routeId) =>
        !places.some((place) => beneath(routeId, place)) &&
        !beneath(routeId, navRoutes.settings) &&
        !reachedFromPlaces.some((address) => beneath(routeId, address)) &&
        !(routeId in navMoved),
    );
  expect(unaccounted).toStrictEqual([]);
  const settingsPages = routeIds.filter(
    (routeId) =>
      beneath(routeId, navRoutes.settings) &&
      !routeId.endsWith("/") &&
      routeId !== navRoutes.settings &&
      routeId !== `${navRoutes.settings}/workspace`,
  );
  expect(
    settingsPages.filter(
      (routeId) => !sections.some((section) => beneath(routeId, section)),
    ),
  ).toStrictEqual([]);
});

test("every section is a page the router registers, in a project and, where it has one, outside every project", () => {
  for (const section of settingsSections) {
    expect(routeIds, section.id).toContain(section.project);
    if (section.workspace !== undefined)
      expect(routeIds, section.id).toContain(section.workspace);
  }
  const outside = settingsSections.flatMap((section) =>
    section.workspace === undefined ? [] : [section.workspace],
  );
  expect(
    routeIds.filter(
      (routeId) =>
        routeId.startsWith("/tenants/$tenant/settings/") &&
        !routeId.endsWith("/") &&
        !outside.some((address) => address === routeId),
    ),
  ).toStrictEqual([]);
});

/** Where the router stands once it has followed an address. */
async function followed(
  address: string,
): Promise<{ readonly pathname: string; readonly search: unknown }> {
  const router = consoleRouterOver(
    createMemoryHistory({ initialEntries: [address] }),
  );
  await router.load();
  return {
    pathname: router.state.location.pathname,
    search: router.state.location.search,
  };
}

test.each([
  ["/acme/atlas/lead", "/acme/atlas/settings/lead-session"],
  ["/acme/atlas/catalog", "/acme/atlas/settings/catalog"],
  ["/acme/atlas/repositories", "/acme/atlas/settings/repositories"],
  [
    "/acme/atlas/repositories/github.com%2Facme%2Fatlas",
    "/acme/atlas/settings/repositories/github.com%2Facme%2Fatlas",
  ],
  ["/acme/atlas/runners", "/acme/atlas/settings/runners"],
])("%s redirects to %s", async (from, to) => {
  expect((await followed(from)).pathname).toBe(to);
});

test("every address that moved is one the redirects above follow", () => {
  expect(Object.keys(navMoved)).toStrictEqual([
    "/$tenant/$project/lead",
    "/$tenant/$project/catalog",
    "/$tenant/$project/repositories",
    "/$tenant/$project/repositories/$repository",
    "/$tenant/$project/runners",
  ]);
});

test("the catalog's old address carries its query to the new one", async () => {
  expect(
    await followed("/acme/atlas/catalog?configuration=ci&source=head"),
  ).toEqual({
    pathname: "/acme/atlas/settings/catalog",
    search: { configuration: "ci", source: "head" },
  });
});
