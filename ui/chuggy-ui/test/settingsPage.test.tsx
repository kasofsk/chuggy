/**
 * The settings index: the project's settings groups, each one line linking to
 * its own page — the shape `/repositories` has over `/repositories/$repository`
 * — and one more leading to the workspace's own settings.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";
import type { ReactNode } from "react";

import { SettingsPage } from "../app/browser/SettingsPage.tsx";
import { ShellSlotHarness } from "./shellSlotHarness.tsx";

afterEach(cleanup);

function Shell(): ReactNode {
  return (
    <ShellSlotHarness>
      <Outlet />
    </ShellSlotHarness>
  );
}

async function drawnSettingsPage(): Promise<void> {
  const root = createRootRoute({ component: Shell });
  const partition = createRoute({
    getParentRoute: () => root,
    path: "/$tenant/$project",
    component: Outlet,
  });
  const settings = createRoute({
    getParentRoute: () => partition,
    path: "/settings",
    component: SettingsPage,
  });
  const settingsLead = createRoute({
    getParentRoute: () => partition,
    path: "/settings/lead",
    component: () => <p>the lead settings page</p>,
  });
  const settingsPlacement = createRoute({
    getParentRoute: () => partition,
    path: "/settings/placement",
    component: () => <p>the placement settings page</p>,
  });
  const tenantSettings = createRoute({
    getParentRoute: () => root,
    path: "/tenants/$tenant/settings",
    component: () => <p>the workspace settings page</p>,
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/acme/atlas/settings"] }),
    routeTree: root.addChildren([
      tenantSettings,
      partition.addChildren([settings, settingsLead, settingsPlacement]),
    ]),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole("heading", { name: "Settings" });
}

test("the index names the Lead group and links to its own page", async () => {
  await drawnSettingsPage();
  fireEvent.click(screen.getByRole("link", { name: "Lead" }));
  expect(await screen.findByText("the lead settings page")).toBeDefined();
});

test("the index names the Placement group and links to its own page", async () => {
  await drawnSettingsPage();
  fireEvent.click(screen.getByRole("link", { name: "Placement" }));
  expect(await screen.findByText("the placement settings page")).toBeDefined();
});

test("the index names the Workspace group and links to the workspace's own settings", async () => {
  await drawnSettingsPage();
  const workspace = screen.getByRole<HTMLAnchorElement>("link", {
    name: "Workspace",
  });
  expect(workspace.getAttribute("href")).toBe("/tenants/acme/settings");
  fireEvent.click(workspace);
  expect(await screen.findByText("the workspace settings page")).toBeDefined();
});
