/**
 * The access plane's routes, each the contract's own route table filled by the
 * contract's own path function, so a route the plane moves moves here too.
 *
 * A grant, an addition and a removal answer nothing but their status, so each is read as
 * `Ok` with no value.
 */

import {
  accessCallerTenantsSchema,
  accessInvitedSchema,
  accessInviteLinkMintedSchema,
  accessInviteLinkRedeemedSchema,
  accessInviteLinksSchema,
  accessOwnerInvitedSchema,
  accessPlanePath,
  accessPlaneRoutes,
  accessProjectAuthoritiesSchema,
  accessProjectPeopleSchema,
  accessSiteAbilitiesSchema,
  accessSiteAuthoritiesSchema,
  accessSiteTenantsSchema,
  accessTenantAbilitiesSchema,
  accessTenantAuthoritiesSchema,
  accessTenantPeopleSchema,
  accessWorkspaceLinksSchema,
  type AccessCallerTenants,
  type AccessInvitation,
  type AccessInvitationGrants,
  type AccessInvited,
  type AccessInviteLinkMinted,
  type AccessInviteLinkRedeemed,
  type AccessInviteLinks,
  type AccessGroup,
  type AccessOwnerInvitation,
  type AccessOwnerInvited,
  type AccessPlaneRouteName,
  type AccessProjectAuthorities,
  type AccessProjectAuthority,
  type AccessProjectPeople,
  type AccessProjectRole,
  type AccessSiteAbilities,
  type AccessSiteAuthorities,
  type AccessSiteAuthority,
  type AccessSiteTenants,
  type AccessTenantAbilities,
  type AccessTenantAuthorities,
  type AccessTenantAuthority,
  type AccessTenantPeople,
  type AccessTenantRole,
  type AccessWorkspaceLinkCreation,
  type AccessWorkspaceLinks,
} from "../../../../src/contract/accessPlane.ts";

import { apiRead } from "./apiRequest.ts";
import type { ApiPorts, ApiResult } from "./apiRequest.ts";
import { apiGet } from "./apiRoutes.ts";

function accessSent(
  ports: ApiPorts,
  route: AccessPlaneRouteName,
  segments: Readonly<Record<string, string>>,
  body?: unknown,
): Promise<ApiResult<undefined>> {
  return apiRead(
    ports,
    {
      method: accessPlaneRoutes[route].method,
      path: accessPlanePath(route, segments),
      ...(body === undefined ? {} : { body }),
    },
    () => undefined,
  );
}

/** One tenant's people, absent for a caller who does not administer it. */
export function apiTenantPeople(
  ports: ApiPorts,
  tenant: string,
): Promise<ApiResult<AccessTenantPeople>> {
  return apiGet(ports, accessPlanePath("tenantPeople", { tenant }), (value) =>
    accessTenantPeopleSchema.parse(value),
  );
}

/** What the caller may do in one tenant, answered to whoever the list is. */
export function apiTenantAbilities(
  ports: ApiPorts,
  tenant: string,
): Promise<ApiResult<AccessTenantAbilities>> {
  return apiGet(
    ports,
    accessPlanePath("tenantAbilities", { tenant }),
    (value) => accessTenantAbilitiesSchema.parse(value),
  );
}

/** Who holds each of one tenant's authorities, absent for a caller who does not manage them. */
export function apiTenantAuthorities(
  ports: ApiPorts,
  tenant: string,
): Promise<ApiResult<AccessTenantAuthorities>> {
  return apiGet(
    ports,
    accessPlanePath("tenantAuthorities", { tenant }),
    (value) => accessTenantAuthoritiesSchema.parse(value),
  );
}

/** One project's people, absent for a caller who may not see them. */
export function apiProjectPeople(
  ports: ApiPorts,
  tenant: string,
  project: string,
): Promise<ApiResult<AccessProjectPeople>> {
  return apiGet(
    ports,
    accessPlanePath("projectPeople", { tenant, project }),
    (value) => accessProjectPeopleSchema.parse(value),
  );
}

/** Who holds each of one project's authorities, absent for a caller who does not manage them. */
export function apiProjectAuthorities(
  ports: ApiPorts,
  tenant: string,
  project: string,
): Promise<ApiResult<AccessProjectAuthorities>> {
  return apiGet(
    ports,
    accessPlanePath("projectAuthorities", { tenant, project }),
    (value) => accessProjectAuthoritiesSchema.parse(value),
  );
}

/** What the caller may do on the site, absent for one who may do none of it. */
export function apiSiteAbilities(
  ports: ApiPorts,
): Promise<ApiResult<AccessSiteAbilities>> {
  return apiGet(ports, accessPlanePath("siteAbilities", {}), (value) =>
    accessSiteAbilitiesSchema.parse(value),
  );
}

/** Who holds each of the site's authorities, absent for a caller who does not manage them. */
export function apiSiteAuthorities(
  ports: ApiPorts,
): Promise<ApiResult<AccessSiteAuthorities>> {
  return apiGet(ports, accessPlanePath("siteAuthorities", {}), (value) =>
    accessSiteAuthoritiesSchema.parse(value),
  );
}

/** The site's workspaces and who administers each, absent for a caller who may make none. */
export function apiSiteTenants(
  ports: ApiPorts,
): Promise<ApiResult<AccessSiteTenants>> {
  return apiGet(ports, accessPlanePath("siteTenants", {}), (value) =>
    accessSiteTenantsSchema.parse(value),
  );
}

/** The workspaces a role names the caller in, answered to anyone signed in about themself. */
export function apiCallerTenants(
  ports: ApiPorts,
): Promise<ApiResult<AccessCallerTenants>> {
  return apiGet(ports, accessPlanePath("callerTenants", {}), (value) =>
    accessCallerTenantsSchema.parse(value),
  );
}

export function apiGrantTenantRole(
  ports: ApiPorts,
  tenant: string,
  subject: string,
  role: AccessTenantRole,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "tenantRoleGrant", { tenant, subject }, { role });
}

export function apiRemoveTenantRole(
  ports: ApiPorts,
  tenant: string,
  subject: string,
  role: AccessTenantRole,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "tenantRoleRemoval", { tenant, subject, role });
}

export function apiGrantProjectRole(
  ports: ApiPorts,
  tenant: string,
  project: string,
  subject: string,
  role: AccessProjectRole,
): Promise<ApiResult<undefined>> {
  return accessSent(
    ports,
    "projectRoleGrant",
    { tenant, project, subject },
    { role },
  );
}

export function apiRemoveProjectRole(
  ports: ApiPorts,
  tenant: string,
  project: string,
  subject: string,
  role: AccessProjectRole,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "projectRoleRemoval", {
    tenant,
    project,
    subject,
    role,
  });
}

export function apiGrantHostedRuns(
  ports: ApiPorts,
  tenant: string,
  subject: string,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "tenantHostedRunsGrant", { tenant, subject });
}

export function apiRemoveHostedRuns(
  ports: ApiPorts,
  tenant: string,
  subject: string,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "tenantHostedRunsRemoval", { tenant, subject });
}

export function apiRemoveTenantAuthorityGroup(
  ports: ApiPorts,
  tenant: string,
  authority: AccessTenantAuthority,
  group: AccessGroup,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, authority, group };
  return accessSent(ports, "tenantAuthorityGroupRemoval", segments);
}

export function apiRemoveTenantAuthorityPerson(
  ports: ApiPorts,
  tenant: string,
  authority: AccessTenantAuthority,
  subject: string,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, authority, subject };
  return accessSent(ports, "tenantAuthorityPersonRemoval", segments);
}

export function apiRemoveSiteAuthorityGroup(
  ports: ApiPorts,
  authority: AccessSiteAuthority,
  group: AccessGroup,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "siteAuthorityGroupRemoval", { authority, group });
}

export function apiRemoveSiteAuthorityPerson(
  ports: ApiPorts,
  authority: AccessSiteAuthority,
  subject: string,
): Promise<ApiResult<undefined>> {
  const segments = { authority, subject };
  return accessSent(ports, "siteAuthorityPersonRemoval", segments);
}

/** One workspace's admins taken from the site's account creators, the one site permission a workspace holds. */
export function apiRemoveSiteAuthorityTenant(
  ports: ApiPorts,
  tenant: string,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "siteAuthorityTenantRemoval", { tenant });
}

export function apiAddTenantAuthorityGroup(
  ports: ApiPorts,
  tenant: string,
  authority: AccessTenantAuthority,
  group: AccessGroup,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, authority, group };
  return accessSent(ports, "tenantAuthorityGroupAddition", segments);
}

export function apiAddTenantAuthorityPerson(
  ports: ApiPorts,
  tenant: string,
  authority: AccessTenantAuthority,
  subject: string,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, authority, subject };
  return accessSent(ports, "tenantAuthorityPersonAddition", segments);
}

export function apiAddSiteAuthorityGroup(
  ports: ApiPorts,
  authority: AccessSiteAuthority,
  group: AccessGroup,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "siteAuthorityGroupAddition", { authority, group });
}

export function apiAddSiteAuthorityPerson(
  ports: ApiPorts,
  authority: AccessSiteAuthority,
  subject: string,
): Promise<ApiResult<undefined>> {
  const segments = { authority, subject };
  return accessSent(ports, "siteAuthorityPersonAddition", segments);
}

/** One workspace's admins given the site's account creators. */
export function apiAddSiteAuthorityTenant(
  ports: ApiPorts,
  tenant: string,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "siteAuthorityTenantAddition", { tenant });
}

export function apiAddProjectAuthorityGroup(
  ports: ApiPorts,
  tenant: string,
  project: string,
  authority: AccessProjectAuthority,
  group: AccessGroup,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, project, authority, group };
  return accessSent(ports, "projectAuthorityGroupAddition", segments);
}

export function apiRemoveProjectAuthorityGroup(
  ports: ApiPorts,
  tenant: string,
  project: string,
  authority: AccessProjectAuthority,
  group: AccessGroup,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, project, authority, group };
  return accessSent(ports, "projectAuthorityGroupRemoval", segments);
}

export function apiAddProjectAuthorityPerson(
  ports: ApiPorts,
  tenant: string,
  project: string,
  authority: AccessProjectAuthority,
  subject: string,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, project, authority, subject };
  return accessSent(ports, "projectAuthorityPersonAddition", segments);
}

export function apiRemoveProjectAuthorityPerson(
  ports: ApiPorts,
  tenant: string,
  project: string,
  authority: AccessProjectAuthority,
  subject: string,
): Promise<ApiResult<undefined>> {
  const segments = { tenant, project, authority, subject };
  return accessSent(ports, "projectAuthorityPersonRemoval", segments);
}

/** One person invited by their GitHub account, created or found. */
export function apiInviteTenantPerson(
  ports: ApiPorts,
  tenant: string,
  invitation: AccessInvitation,
): Promise<ApiResult<AccessInvited>> {
  return apiRead(
    ports,
    {
      method: accessPlaneRoutes.tenantInvitation.method,
      path: accessPlanePath("tenantInvitation", { tenant }),
      body: invitation,
    },
    (value) => accessInvitedSchema.parse(value),
  );
}

/** One invite link made for a workspace, its token in this answer and no later one. */
export function apiMintTenantInviteLink(
  ports: ApiPorts,
  tenant: string,
  grants: AccessInvitationGrants,
): Promise<ApiResult<AccessInviteLinkMinted>> {
  return apiRead(
    ports,
    {
      method: accessPlaneRoutes.tenantInviteLinkCreation.method,
      path: accessPlanePath("tenantInviteLinkCreation", { tenant }),
      body: grants,
    },
    (value) => accessInviteLinkMintedSchema.parse(value),
  );
}

/** Every invite link one workspace keeps, absent on a plane that keeps none. */
export function apiTenantInviteLinks(
  ports: ApiPorts,
  tenant: string,
): Promise<ApiResult<AccessInviteLinks>> {
  return apiGet(
    ports,
    accessPlanePath("tenantInviteLinks", { tenant }),
    (value) => accessInviteLinksSchema.parse(value),
  );
}

/** One open invite link ended before anyone used it. */
export function apiRevokeTenantInviteLink(
  ports: ApiPorts,
  tenant: string,
  link: string,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "tenantInviteLinkRevocation", { tenant, link });
}

/** An invite link used by the caller, with the name of the workspace it makes where one is given, answered with what it granted them. */
export function apiRedeemInviteLink(
  ports: ApiPorts,
  token: string,
  workspace?: string,
): Promise<ApiResult<AccessInviteLinkRedeemed>> {
  return apiRead(
    ports,
    {
      method: accessPlaneRoutes.inviteLinkRedemption.method,
      path: accessPlanePath("inviteLinkRedemption", {}),
      body: workspace === undefined ? { token } : { token, workspace },
    },
    (value) => accessInviteLinkRedeemedSchema.parse(value),
  );
}

/** One workspace link made for the site, its token in this answer and no later one. */
export function apiMintSiteWorkspaceLink(
  ports: ApiPorts,
  creation: AccessWorkspaceLinkCreation,
): Promise<ApiResult<AccessInviteLinkMinted>> {
  return apiRead(
    ports,
    {
      method: accessPlaneRoutes.siteWorkspaceLinkCreation.method,
      path: accessPlanePath("siteWorkspaceLinkCreation", {}),
      body: creation,
    },
    (value) => accessInviteLinkMintedSchema.parse(value),
  );
}

/** Every workspace link the site keeps, absent on a plane that keeps none and to a caller who may make no workspace. */
export function apiSiteWorkspaceLinks(
  ports: ApiPorts,
): Promise<ApiResult<AccessWorkspaceLinks>> {
  return apiGet(ports, accessPlanePath("siteWorkspaceLinks", {}), (value) =>
    accessWorkspaceLinksSchema.parse(value),
  );
}

/** One open workspace link ended before anyone used it. */
export function apiRevokeSiteWorkspaceLink(
  ports: ApiPorts,
  link: string,
): Promise<ApiResult<undefined>> {
  return accessSent(ports, "siteWorkspaceLinkRevocation", { link });
}

/** One person invited into a workspace of their own, which this makes or finds theirs. */
export function apiInviteSiteOwner(
  ports: ApiPorts,
  invitation: AccessOwnerInvitation,
): Promise<ApiResult<AccessOwnerInvited>> {
  return apiRead(
    ports,
    {
      method: accessPlaneRoutes.siteOwnerInvitation.method,
      path: accessPlanePath("siteOwnerInvitation", {}),
      body: invitation,
    },
    (value) => accessOwnerInvitedSchema.parse(value),
  );
}
