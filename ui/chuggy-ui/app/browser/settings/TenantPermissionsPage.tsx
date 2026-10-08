/**
 * A workspace's permissions: who may grant each of its roles, give it hosted
 * runs and change who may, and, to a reader who manages the site, who may make
 * an account and change who may. Where the reader may change a permission,
 * each holder a route removes is removed on its press, and everything the
 * removal may have changed is read again: both lists, the workspace's abilities
 * and its people. Each such permission carries `Add`, offering what it admits
 * and has not got, a person among them from the People list where it is read;
 * an addition reads again what a removal does.
 *
 * The workspace's list answers only a reader who manages the workspace's
 * permissions, and the site's only one who manages the site's, so an absent
 * list is this reader's standing rather than a fault: the workspace's says who
 * manages permissions, and the site's is not drawn at all. A cut list says so.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type {
  AccessSiteAuthorities,
  AccessSiteAuthority,
  AccessTenantAbilities,
  AccessTenantAuthorities,
  AccessTenantAuthority,
  AccessTenantPeople,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts } from "../../core/apiRequest.ts";
import {
  apiAddSiteAuthorityGroup,
  apiAddSiteAuthorityPerson,
  apiAddSiteAuthorityTenant,
  apiAddTenantAuthorityGroup,
  apiAddTenantAuthorityPerson,
  apiRemoveSiteAuthorityGroup,
  apiRemoveSiteAuthorityPerson,
  apiRemoveSiteAuthorityTenant,
  apiRemoveTenantAuthorityGroup,
  apiRemoveTenantAuthorityPerson,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  sitePermissionAdmits,
  sitePermissionRows,
  tenantPermissionAdmits,
  tenantPermissionRows,
  tenantPermissionsWithheld,
} from "../../core/permissions.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ProjectlessFrame } from "../ProjectCreation.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  usePermissionsChange,
  type PermissionChange,
  type PermissionHolderRoutes,
} from "./permissionsChange.ts";
import {
  PermissionsSection,
  PermissionsTruncated,
} from "./PermissionsSection.tsx";
import {
  tenantPeopleReread,
  useTenantAbilities,
  useTenantPeople,
} from "./tenantPeopleResource.ts";
import {
  tenantPermissionsReread,
  useSiteAuthorities,
  useTenantAuthorities,
} from "./tenantPermissionsResource.ts";

/** This page's own address, which its reads take their tenant from. */
export const tenantPermissionsRoutePath =
  "/tenants/$tenant/settings/permissions";

function tenantPermissionRoutes(
  ports: ApiPorts,
  tenant: string,
  authority: AccessTenantAuthority,
  change: PermissionChange,
): PermissionHolderRoutes {
  switch (change) {
    case "Removal":
      return {
        group: (group) =>
          apiRemoveTenantAuthorityGroup(ports, tenant, authority, group),
        person: (subject) =>
          apiRemoveTenantAuthorityPerson(ports, tenant, authority, subject),
        tenant: undefined,
      };
    case "Addition":
      return {
        group: (group) =>
          apiAddTenantAuthorityGroup(ports, tenant, authority, group),
        person: (subject) =>
          apiAddTenantAuthorityPerson(ports, tenant, authority, subject),
        tenant: undefined,
      };
  }
}

/** Only account creation is held by a workspace's admins. */
function sitePermissionRoutes(
  ports: ApiPorts,
  authority: AccessSiteAuthority,
  change: PermissionChange,
): PermissionHolderRoutes {
  const creators = authority === "AccountCreators";
  switch (change) {
    case "Removal":
      return {
        group: (group) => apiRemoveSiteAuthorityGroup(ports, authority, group),
        person: (subject) =>
          apiRemoveSiteAuthorityPerson(ports, authority, subject),
        tenant: creators
          ? (tenant) => apiRemoveSiteAuthorityTenant(ports, tenant)
          : undefined,
      };
    case "Addition":
      return {
        group: (group) => apiAddSiteAuthorityGroup(ports, authority, group),
        person: (subject) =>
          apiAddSiteAuthorityPerson(ports, authority, subject),
        tenant: creators
          ? (tenant) => apiAddSiteAuthorityTenant(ports, tenant)
          : undefined,
      };
  }
}

/** A change on this page may change either list, the reader's abilities and the people. */
function tenantPermissionsChangeReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  return Promise.all([
    tenantPeopleReread(client, tenant),
    tenantPermissionsReread(client, tenant),
  ]).then(() => undefined);
}

function TenantPermissions(props: {
  readonly tenant: string;
  readonly read: PanelState<AccessTenantAuthorities>;
  readonly abilities: AccessTenantAbilities | undefined;
  readonly people: AccessTenantPeople | undefined;
}): ReactNode {
  const read = props.read;
  const tenant = props.tenant;
  const change = usePermissionsChange<AccessTenantAuthority>({
    tenant,
    level: "Tenant",
    abilities: props.abilities,
    people: props.people,
    admits: tenantPermissionAdmits,
    routes: (ports, authority, sent) =>
      tenantPermissionRoutes(ports, tenant, authority, sent),
    reread: (client) => tenantPermissionsChangeReread(client, tenant),
  });
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
      removal={change.removal}
      addition={change.addition}
    >
      <PermissionsTruncated truncated={read.value.truncated} />
    </PermissionsSection>
  );
}

function SitePermissions(props: {
  readonly tenant: string;
  readonly read: PanelState<AccessSiteAuthorities>;
  readonly people: AccessTenantPeople | undefined;
}): ReactNode {
  const read = props.read;
  const change = usePermissionsChange<AccessSiteAuthority>({
    tenant: props.tenant,
    level: "Site",
    abilities: undefined,
    people: props.people,
    admits: sitePermissionAdmits,
    routes: sitePermissionRoutes,
    reread: (client) => tenantPermissionsChangeReread(client, props.tenant),
  });
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
      removal={change.removal}
      addition={change.addition}
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
  const read = useTenantPeople(params.tenant);
  const people = read.state === "Ready" ? read.value : undefined;
  return (
    <ProjectlessFrame>
      <div className="grid min-w-0 max-w-settings gap-4">
        <h1 className="text-md font-strong text-ink-1 truncate">Permissions</h1>
        <TenantPermissions
          tenant={params.tenant}
          read={tenant}
          abilities={abilities.state === "Ready" ? abilities.value : undefined}
          people={people}
        />
        <SitePermissions tenant={params.tenant} read={site} people={people} />
      </div>
    </ProjectlessFrame>
  );
}
