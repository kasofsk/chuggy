/**
 * The route tree, which carries the partition in the path.
 *
 * Every screen below `/$tenant/$project` is inside one stream and one shell, so
 * a project change is a navigation and the connection follows it. The leaves
 * with no screen yet are headings until the screens that belong there are
 * built.
 */

import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useEffect } from "react";
import type { ReactNode } from "react";

import { apiProjectInventoryAll } from "../core/apiRoutes.ts";
import { lastProjectOrFirst, lastProjectRead } from "../core/lastProject.ts";
import { usePanelInventory } from "./api.ts";
import { Footer } from "./Footer.tsx";
import { Inbox } from "./Inbox.tsx";
import { Panel } from "./Panel.tsx";
import { persistentStore } from "./ports.ts";
import { ProjectTable } from "./ProjectTable.tsx";
import { Shell } from "./Shell.tsx";
import { ProjectStreamProvider } from "./stream.tsx";
import { TicketCreation } from "./TicketCreation.tsx";
import { TicketPage } from "./TicketPage.tsx";

export function Landing(): ReactNode {
  const navigate = useNavigate();
  const state = usePanelInventory((ports) => apiProjectInventoryAll(ports));
  const chosen =
    state.state === "Ready"
      ? lastProjectOrFirst(lastProjectRead(persistentStore), state.value)
      : undefined;
  useEffect(() => {
    if (chosen === undefined) return;
    void navigate({
      to: "/$tenant/$project",
      params: { tenant: chosen.tenant, project: chosen.project },
      replace: true,
    });
  }, [navigate, chosen]);
  return (
    <div className="shell">
      <main className="shell-body">
        <Panel title="projects" state={state}>
          {(projects) =>
            projects.length === 0 ? (
              <p className="panel-absent">
                this installation has no project you may read
              </p>
            ) : (
              <p className="panel-note">
                opening {projects.length} project(s)…
              </p>
            )
          }
        </Panel>
      </main>
      <Footer />
    </div>
  );
}

function PartitionLayout(): ReactNode {
  const partition = useParams({ from: "/$tenant/$project" });
  return (
    <ProjectStreamProvider partition={partition}>
      <Shell partition={partition} />
    </ProjectStreamProvider>
  );
}

const rootRoute = createRootRoute({ component: Outlet });

const landingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Landing,
});

const partitionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$tenant/$project",
  component: PartitionLayout,
});

const projectRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/",
  component: ProjectTable,
});

const inboxRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/inbox",
  component: Inbox,
});

const ticketCreationRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/tickets/new",
  component: TicketCreation,
});

const ticketRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/tickets/$ticket",
  component: TicketPage,
});

const routeTree = rootRoute.addChildren([
  landingRoute,
  partitionRoute.addChildren([
    projectRoute,
    inboxRoute,
    ticketCreationRoute,
    ticketRoute,
  ]),
]);

export const consoleRouter = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof consoleRouter;
  }
}
