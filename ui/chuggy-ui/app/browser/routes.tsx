/**
 * The route tree, which carries the partition in the path.
 *
 * Every screen below `/$tenant/$project` is inside one stream and one shell, so
 * a project change is a navigation and the connection follows it. The three
 * leaves are headings until the screens that belong there are built.
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
import { projectsInventoryKey } from "../core/projectQueryKeys.ts";
import { usePanelQuery } from "./api.ts";
import { Panel } from "./Panel.tsx";
import { persistentStore } from "./ports.ts";
import { ProjectTable } from "./ProjectTable.tsx";
import { Shell } from "./Shell.tsx";
import { ProjectStreamProvider } from "./stream.tsx";

function Landing(): ReactNode {
  const navigate = useNavigate();
  const state = usePanelQuery(projectsInventoryKey(), (ports) =>
    apiProjectInventoryAll(ports),
  );
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

function Heading(props: { readonly title: string }): ReactNode {
  return <h1 className="placeholder">{props.title}</h1>;
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
  component: () => <Heading title="escalation inbox" />,
});

const ticketCreationRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/tickets/new",
  component: () => <Heading title="new ticket" />,
});

const ticketRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/tickets/$ticket",
  component: () => <Heading title="ticket" />,
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
