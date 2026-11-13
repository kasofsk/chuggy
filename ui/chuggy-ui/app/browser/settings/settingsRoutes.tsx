/**
 * The settings' routes, described once and hung twice: under a project, where
 * they stay inside its shell, and under a workspace alone, in the frame a
 * screen outside every project is drawn in.
 *
 * A workspace's pages and the site's are the same routes in both places, so a
 * page reads its workspace from whichever address was matched. Each place's
 * bare address is the frame's to draw, which `SettingsLayout.tsx` says; the
 * workspace's bare address in a project replaces itself with its first page.
 *
 * EVERY ROUTE IS MADE BEFORE IT IS HUNG. One made inside the list
 * `addChildren` is given loses its path's type and takes every address the
 * router checks with it: the console still compiles, with no link or redirect
 * in it checked against a route.
 */

import {
  createRoute,
  redirect,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { catalogQueryOf } from "../../core/catalogConfigurations.ts";
import type { CatalogQuery } from "../../core/catalogConfigurations.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import { CatalogPage } from "../catalog/CatalogPage.tsx";
import { LeadPage } from "../LeadPage.tsx";
import { ProjectlessFrame } from "../ProjectCreation.tsx";
import { RepositoriesPage } from "../RepositoriesPage.tsx";
import { RepositoryPage } from "../repositories/RepositoryPage.tsx";
import { RunnersPage } from "../RunnersPage.tsx";
import { LeadSettingsPage } from "./LeadSettingsPage.tsx";
import { MyRunnerPage } from "./MyRunnerPage.tsx";
import { PlacementSettingsPage } from "./PlacementSettingsPage.tsx";
import { PreferencesPage } from "./PreferencesPage.tsx";
import { ProjectPermissionsPage } from "./ProjectPermissionsPage.tsx";
import { SettingsLayout } from "./SettingsLayout.tsx";
import { SitePermissionsPage } from "./SitePermissionsPage.tsx";
import { SiteWorkspacesPage } from "./SiteWorkspacesPage.tsx";
import { TenantAccountsPage } from "./TenantAccountsPage.tsx";
import { TenantPeoplePage } from "./TenantPeoplePage.tsx";
import { TenantPermissionsPage } from "./TenantPermissionsPage.tsx";
import { UsageSettingsPage } from "./UsageSettingsPage.tsx";

function SettingsCatalog(): ReactNode {
  return (
    <CatalogPage query={useSearch({ from: settingsRoutes.project.catalog })} />
  );
}

function projectPageRoutes<TParent extends AnyRoute>(parent: TParent) {
  const getParentRoute = (): TParent => parent;
  return [
    createRoute({ getParentRoute, path: "/lead", component: LeadSettingsPage }),
    createRoute({ getParentRoute, path: "/lead-session", component: LeadPage }),
    createRoute({
      getParentRoute,
      path: "/placement",
      component: PlacementSettingsPage,
    }),
    createRoute({
      getParentRoute,
      path: "/permissions",
      component: ProjectPermissionsPage,
    }),
    createRoute({
      getParentRoute,
      path: "/repositories",
      component: RepositoriesPage,
    }),
    /** One binding's own page. The repository is an address, which the
     * router encodes into the segment and decodes back out of it. */
    createRoute({
      getParentRoute,
      path: "/repositories/$repository",
      component: RepositoryPage,
    }),
    createRoute({ getParentRoute, path: "/runners", component: RunnersPage }),
    createRoute({
      getParentRoute,
      path: "/catalog",
      component: SettingsCatalog,
      validateSearch: (
        search: Readonly<Record<string, unknown>>,
      ): CatalogQuery => catalogQueryOf(search),
    }),
  ] as const;
}

function workspacePageRoutes<TParent extends AnyRoute>(parent: TParent) {
  const getParentRoute = (): TParent => parent;
  return [
    createRoute({
      getParentRoute,
      path: "/people",
      component: TenantPeoplePage,
    }),
    createRoute({
      getParentRoute,
      path: "/accounts",
      component: TenantAccountsPage,
    }),
    createRoute({
      getParentRoute,
      path: "/permissions",
      component: TenantPermissionsPage,
    }),
    createRoute({
      getParentRoute,
      path: "/runner",
      component: MyRunnerPage,
    }),
    createRoute({
      getParentRoute,
      path: "/usage",
      component: UsageSettingsPage,
    }),
  ] as const;
}

function sitePageRoutes<TParent extends AnyRoute>(parent: TParent) {
  const getParentRoute = (): TParent => parent;
  return [
    createRoute({
      getParentRoute,
      path: "/site/workspaces",
      component: SiteWorkspacesPage,
    }),
    createRoute({
      getParentRoute,
      path: "/site/permissions",
      component: SitePermissionsPage,
    }),
  ] as const;
}

/** The reader's own pages that belong to no workspace, so stand at the same
 * segment under a project's settings and a workspace's. */
function personPageRoutes<TParent extends AnyRoute>(parent: TParent) {
  const getParentRoute = (): TParent => parent;
  return [
    createRoute({
      getParentRoute,
      path: "/preferences",
      component: PreferencesPage,
    }),
  ] as const;
}

function ProjectSettings(): ReactNode {
  const params = useParams({ from: "/$tenant/$project" });
  return <SettingsLayout tenant={params.tenant} project={params.project} />;
}

function WorkspaceSettings(): ReactNode {
  const params = useParams({ from: "/tenants/$tenant/settings" });
  return (
    <ProjectlessFrame workspace={params.tenant}>
      <SettingsLayout tenant={params.tenant} project={undefined} />
    </ProjectlessFrame>
  );
}

/** A project's settings, hung under the route that carries the project. */
export function projectSettingsRoutes<TParent extends AnyRoute>(
  parent: TParent,
) {
  const settings = createRoute({
    getParentRoute: (): TParent => parent,
    path: "/settings",
    component: ProjectSettings,
  });
  const getParentRoute = (): typeof settings => settings;
  const index = createRoute({ getParentRoute, path: "/" });
  const workspace = createRoute({ getParentRoute, path: "/workspace" });
  const workspaceIndex = createRoute({
    getParentRoute: (): typeof workspace => workspace,
    path: "/",
    beforeLoad: ({ params }) => {
      redirect({
        to: settingsRoutes.project.people,
        params,
        replace: true,
        throw: true,
      });
    },
  });
  const workspacePages = workspace.addChildren([
    workspaceIndex,
    ...workspacePageRoutes(workspace),
  ]);
  return settings.addChildren([
    index,
    ...projectPageRoutes(settings),
    workspacePages,
    ...sitePageRoutes(settings),
    ...personPageRoutes(settings),
  ]);
}

/**
 * A workspace's settings outside every project. The first segment is the
 * literal `tenants`, as the API's own `/tenants/:tenant/…` is, because a page
 * at `/$tenant/settings` would stand where `/$tenant/$project` matches and
 * make a project named `settings` unreachable.
 */
export function workspaceSettingsRoutes<TParent extends AnyRoute>(
  parent: TParent,
) {
  const settings = createRoute({
    getParentRoute: (): TParent => parent,
    path: "/tenants/$tenant/settings",
    component: WorkspaceSettings,
  });
  const index = createRoute({
    getParentRoute: (): typeof settings => settings,
    path: "/",
  });
  return settings.addChildren([
    index,
    ...workspacePageRoutes(settings),
    ...sitePageRoutes(settings),
    ...personPageRoutes(settings),
  ]);
}
