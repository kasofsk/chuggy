/**
 * A workspace's permissions: who may grant each of its roles, give it hosted
 * runs and change who may, and, to a reader who manages the site, who may make
 * an account and change who may. Where the reader may change a permission,
 * each holder a route removes is removed on its press, and everything the
 * removal may have changed is read again: both lists, the workspace's abilities
 * and its people. Nothing here adds a holder.
 *
 * The workspace's list answers only a reader who manages the workspace's
 * permissions, and the site's only one who manages the site's, so an absent
 * list is this reader's standing rather than a fault: the workspace's says who
 * manages permissions, and the site's is not drawn at all. A cut list says so.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type {
  AccessSiteAuthorities,
  AccessSiteAuthority,
  AccessTenantAbilities,
  AccessTenantAuthorities,
  AccessTenantAuthority,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import {
  apiRemoveSiteAuthorityGroup,
  apiRemoveSiteAuthorityPerson,
  apiRemoveSiteAuthorityTenant,
  apiRemoveTenantAuthorityGroup,
  apiRemoveTenantAuthorityPerson,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  permissionChangeable,
  sitePermissionRows,
  tenantPermissionRows,
  tenantPermissionsWithheld,
  type PermissionAuthority,
  type PermissionHolder,
  type PermissionLevel,
} from "../../core/permissions.ts";
import { tenantPeopleTruncated } from "../../core/tenantPeople.ts";
import { useApiPorts } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ProjectlessFrame } from "../ProjectCreation.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  PermissionsSection,
  type PermissionsRemoval,
} from "./PermissionsSection.tsx";
import {
  tenantPeopleReread,
  useTenantAbilities,
} from "./tenantPeopleResource.ts";
import {
  tenantPermissionsReread,
  useSiteAuthorities,
  useTenantAuthorities,
} from "./tenantPermissionsResource.ts";

/** This page's own address, which its reads take their tenant from. */
export const tenantPermissionsRoutePath =
  "/tenants/$tenant/settings/permissions";

function permissionRemovalUnrouted(holder: PermissionHolder): never {
  throw new Error(`no route removes ${holder.kind} from this permission`);
}

function tenantPermissionRemovalSent(
  ports: ApiPorts,
  tenant: string,
  authority: AccessTenantAuthority,
  holder: PermissionHolder,
): Promise<ApiResult<undefined>> {
  switch (holder.kind) {
    case "Group":
      return apiRemoveTenantAuthorityGroup(
        ports,
        tenant,
        authority,
        holder.group,
      );
    case "Person":
      return apiRemoveTenantAuthorityPerson(
        ports,
        tenant,
        authority,
        holder.person.subject,
      );
    case "TenantAdmins":
    case "SiteStanding":
    case "Unnamed":
      return permissionRemovalUnrouted(holder);
  }
}

function sitePermissionRemovalSent(
  ports: ApiPorts,
  authority: AccessSiteAuthority,
  holder: PermissionHolder,
): Promise<ApiResult<undefined>> {
  switch (holder.kind) {
    case "Group":
      return apiRemoveSiteAuthorityGroup(ports, authority, holder.group);
    case "Person":
      return apiRemoveSiteAuthorityPerson(
        ports,
        authority,
        holder.person.subject,
      );
    case "TenantAdmins":
      return authority === "AccountCreators"
        ? apiRemoveSiteAuthorityTenant(ports, holder.tenant)
        : permissionRemovalUnrouted(holder);
    case "SiteStanding":
    case "Unnamed":
      return permissionRemovalUnrouted(holder);
  }
}

/** One level's removal: a holder sent where the reader may change its
 * permission and a route removes it, then everything it may have changed read
 * again. */
function useTenantPermissionsRemoval<Authority extends PermissionAuthority>(
  tenant: string,
  level: PermissionLevel,
  abilities: AccessTenantAbilities | undefined,
  sent: (
    ports: ApiPorts,
    authority: Authority,
    holder: PermissionHolder,
  ) => Promise<ApiResult<undefined>>,
): PermissionsRemoval<Authority> {
  const ports = useApiPorts();
  const client = useQueryClient();
  return {
    removable: (row) => permissionChangeable(level, row.authority, abilities),
    remove: async (row, holder) => {
      const answered = await sent(ports, row.authority, holder);
      await Promise.all([
        tenantPeopleReread(client, tenant),
        tenantPermissionsReread(client, tenant),
      ]);
      return answered;
    },
  };
}

function PermissionsTruncated(props: {
  readonly truncated: boolean;
}): ReactNode {
  return props.truncated ? (
    <Notice tone="parked" inline detail={tenantPeopleTruncated} />
  ) : null;
}

function TenantPermissions(props: {
  readonly tenant: string;
  readonly read: PanelState<AccessTenantAuthorities>;
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const read = props.read;
  const tenant = props.tenant;
  const removal = useTenantPermissionsRemoval<AccessTenantAuthority>(
    tenant,
    "Tenant",
    props.abilities,
    (ports, authority, holder) =>
      tenantPermissionRemovalSent(ports, tenant, authority, holder),
  );
  if (read.state !== "Ready")
    return (
      <PermissionsSection title="Workspace" rows={undefined}>
        {read.state === "Absent" ? (
          <Notice tone="parked" inline detail={tenantPermissionsWithheld} />
        ) : (
          <PanelUnready state={read} />
        )}
      </PermissionsSection>
    );
  return (
    <PermissionsSection
      title="Workspace"
      rows={tenantPermissionRows(read.value)}
      removal={removal}
    >
      <PermissionsTruncated truncated={read.value.truncated} />
    </PermissionsSection>
  );
}

function SitePermissions(props: {
  readonly tenant: string;
  readonly read: PanelState<AccessSiteAuthorities>;
}): ReactNode {
  const read = props.read;
  const removal = useTenantPermissionsRemoval<AccessSiteAuthority>(
    props.tenant,
    "Site",
    undefined,
    sitePermissionRemovalSent,
  );
  if (read.state === "Pending" || read.state === "Absent") return null;
  if (read.state === "Failed")
    return (
      <PermissionsSection title="Site" rows={undefined}>
        <PanelUnready state={read} />
      </PermissionsSection>
    );
  return (
    <PermissionsSection
      title="Site"
      rows={sitePermissionRows(read.value)}
      removal={removal}
    >
      <PermissionsTruncated truncated={read.value.truncated} />
    </PermissionsSection>
  );
}

export function TenantPermissionsPage(): ReactNode {
  const params = useParams({ from: tenantPermissionsRoutePath });
  const tenant = useTenantAuthorities(params.tenant);
  const site = useSiteAuthorities(params.tenant);
  const abilities = useTenantAbilities(params.tenant);
  return (
    <ProjectlessFrame>
      <div className="grid min-w-0 max-w-settings gap-4">
        <h1 className="text-md font-strong text-ink-1 truncate">Permissions</h1>
        <TenantPermissions
          tenant={params.tenant}
          read={tenant}
          abilities={abilities.state === "Ready" ? abilities.value : undefined}
        />
        <SitePermissions tenant={params.tenant} read={site} />
      </div>
    </ProjectlessFrame>
  );
}
