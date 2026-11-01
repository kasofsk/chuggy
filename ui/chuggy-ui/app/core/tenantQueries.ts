/**
 * The reads that belong to a tenant, to the reader, or to no partition at
 * all, and so lie outside every partition's refresh path: each is read as a
 * screen drawing it mounts, on a clock where it names one, and again where a
 * write to it invalidates it by the query's own key.
 */

import {
  apiCallerTenants,
  apiSiteAbilities,
  apiSiteAuthorities,
  apiSiteTenants,
  apiSiteWorkspaceLinks,
  apiTenantAbilities,
  apiTenantAuthorities,
  apiTenantInviteLinks,
  apiTenantPeople,
} from "./accessRoutes.ts";
import {
  apiChatAbilities,
  apiChatHost,
  apiChatThread,
  apiChatThreads,
  apiForgeApps,
  apiForgeInstallationPermissions,
  apiForgeInstallations,
  apiPersonalRunner,
  apiPersonalRunnerPermit,
  apiProjectInventoryAll,
} from "./apiRoutes.ts";
import {
  consoleCallerQuery,
  consoleInventoryQuery,
  consoleTenantQuery,
} from "./consoleQuery.ts";
import type { ConsoleRead } from "./consoleQuery.ts";
import type { ForgeReachable } from "./projectRepositories.ts";
import { memberChatThreadPolledMs } from "./memberChat.ts";
import { sessionPlacementPolledMs } from "./sessionRunners.ts";

export function projectsInventoryQuery() {
  return consoleInventoryQuery((ports) => apiProjectInventoryAll(ports));
}

/** Which workspaces hold the reader, asked on a page that is in none yet. */
export function callerTenantsQuery() {
  return consoleCallerQuery("access-workspaces", (ports) =>
    apiCallerTenants(ports),
  );
}

/** What the reader may do on the site, before they are in any workspace. */
export function callerSiteAbilitiesQuery() {
  return consoleCallerQuery("access-site-abilities", (ports) =>
    apiSiteAbilities(ports),
  );
}

/** Polled at the pace a session's standing is, since no frame says a runner
 * polled. */
export function personalRunnerQuery(tenant: string) {
  return consoleTenantQuery(
    tenant,
    "personal-runner",
    (ports) => apiPersonalRunner(ports, tenant),
    sessionPlacementPolledMs,
  );
}

export function personalRunnerPermitQuery(tenant: string) {
  return consoleTenantQuery(tenant, "personal-runner-permit", (ports) =>
    apiPersonalRunnerPermit(ports, tenant),
  );
}

/** Polled at the pace a session's standing is, since no frame says a host
 * polled. */
export function chatHostQuery(tenant: string) {
  return consoleTenantQuery(
    tenant,
    "chat-host",
    (ports) => apiChatHost(ports, tenant),
    sessionPlacementPolledMs,
  );
}

export function chatAbilitiesQuery(tenant: string) {
  return consoleTenantQuery(tenant, "chat-abilities", (ports) =>
    apiChatAbilities(ports, tenant),
  );
}

/** The reader's own chat listing, polled since no frame names it. */
export function memberChatThreadsQuery(tenant: string) {
  return consoleTenantQuery(
    tenant,
    "chat-threads",
    (ports) => apiChatThreads(ports, tenant),
    sessionPlacementPolledMs,
  );
}

/** One thread of the reader's own chat, which no frame names and so is read
 * again on its own clock: briskly while its newest turn is still `writing`,
 * and otherwise at the pace a session's standing is. */
export function memberChatThreadQuery(
  tenant: string,
  session: string,
  writing = false,
) {
  return consoleTenantQuery(
    tenant,
    `chat-thread-${session}`,
    (ports) => apiChatThread(ports, tenant, session),
    writing ? memberChatThreadPolledMs : sessionPlacementPolledMs,
  );
}

export function siteWorkspacesQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-site-tenants", (ports) =>
    apiSiteTenants(ports),
  );
}

export function siteWorkspaceLinksQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-site-workspace-links", (ports) =>
    apiSiteWorkspaceLinks(ports),
  );
}

export function tenantPeopleQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-people", (ports) =>
    apiTenantPeople(ports, tenant),
  );
}

export function tenantAbilitiesQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-abilities", (ports) =>
    apiTenantAbilities(ports, tenant),
  );
}

/** Absent on a plane that keeps no links, and to a reader the people list is
 * not answered to. */
export function tenantInviteLinksQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-invite-links", (ports) =>
    apiTenantInviteLinks(ports, tenant),
  );
}

export function tenantPermissionsQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-authorities", (ports) =>
    apiTenantAuthorities(ports, tenant),
  );
}

/** The site's list, held under the workspace whose page reads it. */
export function sitePermissionsQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-site-authorities", (ports) =>
    apiSiteAuthorities(ports),
  );
}

/** What the reader may do on the site, held under the workspace whose
 * settings read it. */
export function siteAbilitiesQuery(tenant: string) {
  return consoleTenantQuery(tenant, "access-site-abilities", (ports) =>
    apiSiteAbilities(ports),
  );
}

export function forgeInstallationsQuery(tenant: string) {
  return consoleTenantQuery(tenant, "forge-installations", (ports) =>
    apiForgeInstallations(ports, tenant),
  );
}

/** Each installation's own, apart from every other's. */
export function forgeInstallationPermissionsQuery(
  tenant: string,
  installationId: string,
) {
  return consoleTenantQuery(
    tenant,
    `forge-installation-permissions/${installationId}`,
    (ports) => apiForgeInstallationPermissions(ports, tenant, installationId),
  );
}

export function forgeAppsQuery(tenant: string) {
  return consoleTenantQuery(tenant, "forge-apps", (ports) =>
    apiForgeApps(ports),
  );
}

/** The repository picker's roster under the tenant's key, where nothing reads
 * it but the picker that draws it — and so read as that picker says, written
 * as it arrives and read again on the picker's own clock. */
export function forgeReachableQuery(
  tenant: string,
  read: ConsoleRead<ForgeReachable>,
  polledMs: number | undefined,
) {
  return consoleTenantQuery(tenant, "forge-reachable", read, polledMs);
}
