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
import {
  forgeCallbackQueryOf,
  forgeCallbackRoutePath,
} from "../core/forgeAuthorization.ts";
import type { ForgeCallbackQuery } from "../core/forgeAuthorization.ts";
import { forgeSetupQueryOf, forgeSetupRoutePath } from "../core/forgeSetup.ts";
import type { ForgeSetupQuery } from "../core/forgeSetup.ts";
import { lastProjectOrFirst, lastProjectRead } from "../core/lastProject.ts";
import { projectCreationRoutePath } from "../core/projectCreation.ts";
import { ticketDuplicateQueryOf } from "../core/ticketDuplicate.ts";
import type { TicketDuplicateQuery } from "../core/ticketDuplicate.ts";
import { usePanelInventory } from "./api.ts";
import { DataPanel } from "./DataPanel.tsx";
import { ForgeCallbackPage } from "./ForgeCallbackPage.tsx";
import { ForgeSetupPage } from "./ForgeSetupPage.tsx";
import { Inbox } from "./Inbox.tsx";
import { LeadPage } from "./LeadPage.tsx";
import { persistentStore } from "./ports.ts";
import {
  ProjectCreationForm,
  ProjectCreationPage,
  ProjectlessFrame,
} from "./ProjectCreation.tsx";
import { ProjectTable } from "./ProjectTable.tsx";
import { RepositoriesPage } from "./RepositoriesPage.tsx";
import { RepositoryPage } from "./repositories/RepositoryPage.tsx";
import { RunnersPage } from "./RunnersPage.tsx";
import { SettingsPage } from "./SettingsPage.tsx";
import { LeadSettingsPage } from "./settings/LeadSettingsPage.tsx";
import { PlacementSettingsPage } from "./settings/PlacementSettingsPage.tsx";
import { TenantAccountsPage } from "./settings/TenantAccountsPage.tsx";
import {
  TenantPeoplePage,
  tenantPeopleRoutePath,
} from "./settings/TenantPeoplePage.tsx";
import {
  TenantPermissionsPage,
  tenantPermissionsRoutePath,
} from "./settings/TenantPermissionsPage.tsx";
import { Shell } from "./Shell.tsx";
import { ProjectStreamProvider } from "./stream.tsx";
import { TenantSettingsPage } from "./TenantSettingsPage.tsx";
import { TicketCreationFrom } from "./TicketDuplicate.tsx";
import { TicketEdit } from "./TicketEdit.tsx";
import { TicketPage } from "./TicketPage.tsx";
import { EmptyState } from "./ui/EmptyState.tsx";

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
  if (state.state === "Ready" && state.value.length === 0)
    return (
      <ProjectlessFrame>
        <div className="grid justify-items-center gap-4">
          <EmptyState
            variant="page"
            label="No projects"
            detail="Create one to start"
          />
          <ProjectCreationForm />
        </div>
      </ProjectlessFrame>
    );
  return (
    <ProjectlessFrame>
      <DataPanel title="projects" state={state}>
        {(projects) => (
          <p className="panel-note">opening {projects.length} project(s)…</p>
        )}
      </DataPanel>
    </ProjectlessFrame>
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

const leadRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/lead",
  component: LeadPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/settings",
  component: SettingsPage,
});

/** One settings group's own page. */
const settingsLeadRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/settings/lead",
  component: LeadSettingsPage,
});

/** Another settings group's own page. */
const settingsPlacementRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/settings/placement",
  component: PlacementSettingsPage,
});

const repositoriesRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/repositories",
  component: RepositoriesPage,
});

const runnersRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/runners",
  component: RunnersPage,
});

/** One binding's own page. The repository is an address, which the router
 * encodes into the segment and decodes back out of it. */
const repositoryRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/repositories/$repository",
  component: RepositoryPage,
});

/**
 * The address both apps' Setup URL points at. It is outside the partition
 * because the forge is given one fixed address and is told no project; which
 * project the install belongs to is the stored transaction's to say.
 */
const forgeSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: forgeSetupRoutePath,
  component: ForgeSetupPage,
  validateSearch: (
    search: Readonly<Record<string, unknown>>,
  ): ForgeSetupQuery => forgeSetupQueryOf(search),
});

/**
 * The address the portal app's authorization returns to, outside the partition
 * for the same reason as the setup landing.
 */
const forgeCallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: forgeCallbackRoutePath,
  component: ForgeCallbackPage,
  validateSearch: (
    search: Readonly<Record<string, unknown>>,
  ): ForgeCallbackQuery => forgeCallbackQueryOf(search),
});

/** Outside the partition because it makes one. A static segment outranks a
 * parameter, so this address is never read as a tenant and a project. */
const projectCreationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: projectCreationRoutePath,
  component: ProjectCreationPage,
});

/**
 * The tenant's own settings, outside the partition because a forge account is
 * the tenant's and not any one project's. The first segment is the literal
 * `tenants`, mirroring the API's own `/tenants/:tenant/…`, and not
 * `/$tenant/settings`: a tenant page at the second segment would stand where
 * `/$tenant/$project` matches and make a project named `settings`
 * unreachable.
 */
const tenantSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tenants/$tenant/settings",
  component: TenantSettingsPage,
});

/** One tenant settings group's own page. */
const tenantAccountsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/tenants/$tenant/settings/accounts",
  component: TenantAccountsPage,
});

/** Another tenant settings group's own page. */
const tenantPeopleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: tenantPeopleRoutePath,
  component: TenantPeoplePage,
});

/** Another tenant settings group's own page. */
const tenantPermissionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: tenantPermissionsRoutePath,
  component: TenantPermissionsPage,
});

function TicketCreationRoute(): ReactNode {
  return <TicketCreationFrom from={ticketCreationRoute.useSearch().from} />;
}

const ticketCreationRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/tickets/new",
  component: TicketCreationRoute,
  validateSearch: (
    search: Readonly<Record<string, unknown>>,
  ): TicketDuplicateQuery => ticketDuplicateQueryOf(search),
});

const ticketRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/tickets/$ticket",
  component: TicketPage,
});

const ticketEditRoute = createRoute({
  getParentRoute: () => partitionRoute,
  path: "/tickets/$ticket/edit",
  component: TicketEdit,
});

const routeTree = rootRoute.addChildren([
  landingRoute,
  forgeSetupRoute,
  forgeCallbackRoute,
  projectCreationRoute,
  tenantSettingsRoute,
  tenantAccountsRoute,
  tenantPeopleRoute,
  tenantPermissionsRoute,
  partitionRoute.addChildren([
    projectRoute,
    inboxRoute,
    leadRoute,
    settingsRoute,
    settingsLeadRoute,
    settingsPlacementRoute,
    repositoriesRoute,
    repositoryRoute,
    runnersRoute,
    ticketCreationRoute,
    ticketRoute,
    ticketEditRoute,
  ]),
]);

export const consoleRouter = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof consoleRouter;
  }
}
