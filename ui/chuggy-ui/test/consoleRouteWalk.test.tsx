/**
 * Every route the console's tree declares, visited over the site: each draws
 * without throwing and without `Page failed`, every read it makes is one
 * the site has a fixture for, and no state is set during another component's
 * render. The list is the router's own, so a route added
 * to the tree is visited here without a case of its own.
 */

import { screen } from "@testing-library/react";
import { createMemoryHistory } from "@tanstack/react-router";
import { expect, test, vi } from "vitest";

import { consoleRouterOver } from "../app/browser/routes.tsx";
import {
  consoleAdvanced,
  consoleMounted,
  consoleRouteParameters,
  consoleSiteClean,
  consoleSiteEachCase,
} from "./consoleSite.tsx";
import type { ConsoleSite } from "./consoleSite.tsx";
import type * as BrowserPorts from "../app/browser/ports.ts";

vi.mock("../app/browser/ports.ts", async (importOriginal) =>
  (await import("./consoleNetwork.ts")).consolePortsOver(
    await importOriginal<typeof BrowserPorts>(),
  ),
);

let site: ConsoleSite;

consoleSiteEachCase((made) => {
  site = made;
});

/** How long a screen is given to read what it reads and draw it. */
const consoleRouteWalkSettleMs = 1_000;

/** A declared path with each parameter filled from the site's fixtures. */
function consoleRouteAddress(path: string): string {
  return path.replace(/\$([A-Za-z]+)/gu, (_whole, name: string) => {
    const value = consoleRouteParameters[name];
    if (value === undefined)
      throw new Error(`no fixture fills the parameter ${name} of ${path}`);
    return value;
  });
}

/** Every route but the root, by its own path: an index route is a route of
 * its own, though it answers its parent's address. */
const consoleRoutePaths = Object.values(
  consoleRouterOver(createMemoryHistory()).routesById,
)
  .filter((route) => !route.isRoot)
  .map((route) => route.fullPath);

test("the router declares routes for the walk to visit", () => {
  expect(consoleRoutePaths.length).toBeGreaterThan(1);
});

test.each(consoleRoutePaths)("%s draws over the site", async (path) => {
  consoleMounted(consoleRouteAddress(path));
  await consoleAdvanced(consoleRouteWalkSettleMs);
  expect(screen.queryByText("Page failed")).toBeNull();
  expect(screen.queryByText("Not found")).toBeNull();
  consoleSiteClean(site);
});
