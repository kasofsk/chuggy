/**
 * What the console's router draws for a screen that threw and for an address
 * it has no screen at: the router's own defaults, under a parent that stands
 * in for the shell, so a case sees whether the shell survives them.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ReactNode } from "react";

import { consoleRouter } from "../app/browser/routes.tsx";
import { settled, turned } from "./screenHarness.tsx";

/** The router restores a scroll position on every load, and jsdom scrolls
 * nothing; React reports every caught throw, which is the case's own. */
beforeEach(() => {
  vi.stubGlobal("scrollTo", () => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fault = { standing: true };

function Faulty(): ReactNode {
  if (fault.standing) throw new Error("the screen fell over");
  return <p>Screen drawn</p>;
}

function StandIn(): ReactNode {
  return (
    <>
      <nav>Shell nav</nav>
      <Outlet />
    </>
  );
}

const { defaultErrorComponent, defaultNotFoundComponent } =
  consoleRouter.options;

/** The console's own fallbacks, and the router's where it sets none. */
const consoleFallbacks = {
  ...(defaultErrorComponent === undefined ? {} : { defaultErrorComponent }),
  ...(defaultNotFoundComponent === undefined
    ? {}
    : { defaultNotFoundComponent }),
};

/** A shell and one screen under it, at `address`, falling back as the
 * console's router does. */
async function drawnAt(address: string): Promise<void> {
  const root = createRootRoute({ component: StandIn });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/", component: Faulty }),
    ]),
    history: createMemoryHistory({ initialEntries: [address] }),
    ...consoleFallbacks,
  });
  render(<RouterProvider router={router} />);
  await settled();
}

test("a screen that throws draws Page failed inside the shell, and Reload draws it again once the fault clears", async () => {
  fault.standing = true;
  await drawnAt("/");
  expect(screen.getByRole("heading", { name: "Page failed" })).toBeDefined();
  expect(screen.getByText("Shell nav")).toBeDefined();
  fault.standing = false;
  await turned(() => {
    screen.getByRole("button", { name: "Reload" }).click();
  });
  await settled();
  expect(screen.getByText("Screen drawn")).toBeDefined();
  expect(screen.queryByText("Page failed")).toBeNull();
});

test("an address with no screen draws Not found inside the shell", async () => {
  fault.standing = false;
  await drawnAt("/nowhere/at/all");
  expect(screen.getByRole("heading", { name: "Not found" })).toBeDefined();
  expect(screen.getByText("Shell nav")).toBeDefined();
});
