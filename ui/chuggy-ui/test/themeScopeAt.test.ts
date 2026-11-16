/**
 * The scope the first paint reads the cache for, from the console's own
 * router: the project an address sits in, at its root or any page below it,
 * and no project for an address outside every project.
 */

import { expect, test } from "vitest";

import { consoleRouter } from "../app/browser/routes.tsx";
import { themeScopeAt } from "../app/browser/themeWorn.ts";

function themeScopeAtPath(path: string) {
  return themeScopeAt(consoleRouter.matchRoutes(path));
}

test("an address in a project, at its root or below it, is drawn in that project's scope", () => {
  for (const path of [
    "/acme/atlas",
    "/acme/atlas/",
    "/acme/atlas/tickets/41",
    "/acme/atlas/settings/preferences",
  ])
    expect(themeScopeAtPath(path), path).toEqual({
      tenant: "acme",
      project: "atlas",
    });
});

test("an address outside every project is drawn in no project's scope", () => {
  for (const path of ["/", "/tenants/acme/settings", "/tenants/acme/settings/"])
    expect(themeScopeAtPath(path), path).toBeUndefined();
});
