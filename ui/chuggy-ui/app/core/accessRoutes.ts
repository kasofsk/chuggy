/**
 * The access plane's routes, each the contract's own route table filled by the
 * contract's own path function, so a route the plane moves moves here too.
 *
 * A grant, an addition and a removal answer nothing but their status, so each is read as
 * `Ok` with no value.
 */

import {
  accessInvitedSchema,
  accessPlanePath,
  accessPlaneRoutes,
  accessProjectAuthoritiesSchema,
  accessProjectPeopleSchema,
  accessSiteAbilitiesSchema,
  accessSiteAuthoritiesSchema,
  accessTenantAbilitiesSchema,
  accessTenantAuthoritiesSchema,
  accessTenantPeopleSchema,
  type AccessInvitation,
  type AccessInvited,
  type AccessGroup,
  type AccessPlaneRouteName,
  type AccessProjectAuthorities,
  type AccessProjectAuthority,
  type AccessProjectPeople,
  type AccessProjectRole,
  type AccessSiteAbilities,
  type AccessSiteAuthorities,
  type AccessSiteAuthority,
  type AccessTenantAbilities,
  type AccessTenantAuthorities,
  type AccessTenantAuthority,
  type AccessTenantPeople,
  type AccessTenantRole,
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
