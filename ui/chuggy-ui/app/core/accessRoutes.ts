/**
 * The access plane's routes, each the contract's own route table filled by the
 * contract's own path function, so a route the plane moves moves here too.
 *
 * A grant and a removal answer nothing but their status, so each is read as
 * `Ok` with no value.
 */

import {
  accessInvitedSchema,
  accessPlanePath,
  accessPlaneRoutes,
  accessTenantPeopleSchema,
  type AccessInvitation,
  type AccessInvited,
  type AccessPlaneRouteName,
  type AccessProjectRole,
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
