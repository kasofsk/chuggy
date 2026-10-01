/**
 * What the creation screen draws for a project with nothing to shape a ticket
 * with: a status for each way of having none, and a way to the Repositories
 * page only where the cause is that nothing is bound.
 */

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test } from "vitest";

import { CreationContextAbsent } from "../app/browser/TicketCreation.tsx";
import type { CreationContext } from "../app/core/ticketCreationRun.ts";
import { creationPartition } from "./ticketCreationFixture.ts";

afterEach(cleanup);

async function drawn(
  context: Exclude<CreationContext, { context: "Ready" }>,
): Promise<void> {
  const root = createRootRoute({ component: Outlet });
  const partition = createRoute({
    getParentRoute: () => root,
    path: "/$tenant/$project",
  });
  const router = createRouter({
    history: createMemoryHistory({ initialEntries: ["/acme/atlas"] }),
    routeTree: root.addChildren([
      partition.addChildren([
        createRoute({
          getParentRoute: () => partition,
          path: "/",
          component: () => (
            <CreationContextAbsent
              partition={creationPartition}
              context={context}
            />
          ),
        }),
        createRoute({
          getParentRoute: () => partition,
          path: "/repositories",
        }),
      ]),
    ]),
  });
  render(<RouterProvider router={router} />);
  await waitFor(() => {
    expect(document.body.textContent).not.toBe("");
  });
}

test("a project binding no repository says so and links to Repositories", async () => {
  await drawn({ context: "NoRepository" });
  expect(screen.getByText("No repository bound")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "Repositories" }).getAttribute("href"),
  ).toBe("/acme/atlas/repositories");
});

test("a bound repository with no ready revision says no configuration and links nowhere", async () => {
  await drawn({ context: "NoReadyConfiguration" });
  expect(screen.getByText("No configuration")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

test("a walk that ran out of budget keeps its own sentence", async () => {
  await drawn({ context: "ReadyConfigurationUnknown", pagesRead: 3 });
  expect(screen.getByText(/the newest 3 pages/)).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
