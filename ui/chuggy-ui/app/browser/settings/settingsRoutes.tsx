/**
 * The settings' routes, described once and hung twice: under a project, where
 * they stay inside its shell, and under a workspace alone, in the frame a
 * screen outside every project is drawn in.
 *
 * A workspace's pages and the site's are the same routes in both places, so a
 * page reads its workspace from whichever address was matched. Each place's
 * bare address replaces itself with its first page: the settings have no page
 * of their own.
 *
 * EVERY ROUTE IS MADE BEFORE IT IS HUNG. One made inside the list
 * `addChildren` is given loses its path's type and takes every address the
 * router checks with it: the console still compiles, with no link or redirect
 * in it checked against a route.
 */

import { createRoute, redirect, useParams } from "@tanstack/react-router";
import type { AnyRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { settingsRoutes } from "../../core/settingsNav.ts";
import { ProjectlessFrame } from "../ProjectCreation.tsx";
import { LeadSettingsPage } from "./LeadSettingsPage.tsx";
import { PlacementSettingsPage } from "./PlacementSettingsPage.tsx";
import { ProjectPermissionsPage } from "./ProjectPermissionsPage.tsx";
import { SettingsLayout } from "./SettingsLayout.tsx";
import { SitePermissionsPage } from "./SitePermissionsPage.tsx";
import { SiteWorkspacesPage } from "./SiteWorkspacesPage.tsx";
import { TenantAccountsPage } from "./TenantAccountsPage.tsx";
import { TenantPeoplePage } from "./TenantPeoplePage.tsx";
import { TenantPermissionsPage } from "./TenantPermissionsPage.tsx";

function projectPageRoutes<TParent extends AnyRoute>(parent: TParent) {
  const getParentRoute = (): TParent => parent;
  return [
    createRoute({ getParentRoute, path: "/lead", component: LeadSettingsPage }),
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

function ProjectSettings(): ReactNode {
  const params = useParams({ from: "/$tenant/$project" });
  return <SettingsLayout tenant={params.tenant} project={params.project} />;
}

function WorkspaceSettings(): ReactNode {
  const params = useParams({ from: "/tenants/$tenant/settings" });
  return (
    <ProjectlessFrame>
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
  const index = createRoute({
    getParentRoute,
    path: "/",
    beforeLoad: ({ params }) => {
      redirect({
        to: settingsRoutes.project.lead,
        params,
        replace: true,
        throw: true,
      });
    },
  });
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
    beforeLoad: ({ params }) => {
      redirect({
        to: settingsRoutes.workspace.people,
        params: { tenant: params.tenant },
        replace: true,
        throw: true,
      });
    },
  });
  return settings.addChildren([
    index,
    ...workspacePageRoutes(settings),
    ...sitePageRoutes(settings),
  ]);
}
