/**
 * A workspace's permissions: who may grant each of its roles, give it hosted
 * runs and change who may. Where the reader may change a permission, each
 * holder a route removes is removed on its press, and everything the removal
 * may have changed is read again: the workspace's list and the site's, the
 * reader's abilities and the people. Each such permission carries `Add`,
 * offering what it admits and has not got, a person among them from the People
 * list where it is read; an addition reads again what a removal does.
 *
 * The list answers only a reader who manages the workspace's permissions, so
 * an absent list is this reader's standing rather than a fault, and the page
 * says who manages permissions instead. A cut list says so.
 */

import type { ReactNode } from "react";

import type {
  AccessTenantAbilities,
  AccessTenantAuthorities,
  AccessTenantAuthority,
  AccessTenantPeople,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts } from "../../core/apiRequest.ts";
import {
  apiAddTenantAuthorityGroup,
  apiAddTenantAuthorityPerson,
  apiRemoveTenantAuthorityGroup,
  apiRemoveTenantAuthorityPerson,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  tenantPermissionAdmits,
  tenantPermissionRows,
  tenantPermissionsWithheld,
} from "../../core/permissions.ts";
import { PanelUnready } from "../DataPanel.tsx";
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
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { useTenantAbilities, useTenantPeople } from "./tenantPeopleResource.ts";
import {
  tenantPermissionsReread,
  useTenantAuthorities,
} from "./tenantPermissionsResource.ts";

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
    reread: (client) => tenantPermissionsReread(client, tenant),
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

export function TenantPermissionsPage(): ReactNode {
  const tenant = useSettingsTenant();
  const read = useTenantAuthorities(tenant);
  const abilities = useTenantAbilities(tenant);
  const people = useTenantPeople(tenant);
  return (
    <SettingsPage title="Permissions">
      <TenantPermissions
        tenant={tenant}
        read={read}
        abilities={abilities.state === "Ready" ? abilities.value : undefined}
        people={people.state === "Ready" ? people.value : undefined}
      />
    </SettingsPage>
  );
}
