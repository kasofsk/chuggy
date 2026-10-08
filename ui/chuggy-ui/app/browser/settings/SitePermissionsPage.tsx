/**
 * The site's permissions: who may make an account, who may make a workspace
 * and who may change who may, drawn and changed by the workspace page's own
 * section. Each holder a route
 * removes is removed on its press and each permission carries `Add`, a person
 * among the People list of the workspace the page was reached through, whose
 * admins are the ones `Add` offers account creation to; either change reads
 * again what the workspace page's does.
 *
 * The site's list answers only a reader who manages the site's permissions, so
 * an absent list is this reader's standing rather than a fault, and the page
 * says who manages permissions instead. A cut list says so.
 */

import type { ReactNode } from "react";

import type {
  AccessSiteAuthorities,
  AccessSiteAuthority,
  AccessTenantPeople,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts } from "../../core/apiRequest.ts";
import {
  apiAddSiteAuthorityGroup,
  apiAddSiteAuthorityPerson,
  apiAddSiteAuthorityTenant,
  apiRemoveSiteAuthorityGroup,
  apiRemoveSiteAuthorityPerson,
  apiRemoveSiteAuthorityTenant,
} from "../../core/accessRoutes.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  sitePermissionAdmits,
  sitePermissionRows,
  sitePermissionsWithheld,
} from "../../core/permissions.ts";
import {
  usePermissionsChange,
  type PermissionChange,
  type PermissionHolderRoutes,
} from "./permissionsChange.ts";
import { PermissionsSection } from "./PermissionsSection.tsx";
import { SettingsPage, useSettingsTenant } from "./SettingsPage.tsx";
import { useTenantPeople } from "./tenantPeopleResource.ts";
import {
  tenantPermissionsReread,
  useSiteAuthorities,
} from "./tenantPermissionsResource.ts";

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

function SitePermissions(props: {
  readonly tenant: string;
  readonly read: PanelState<AccessSiteAuthorities>;
  readonly people: AccessTenantPeople | undefined;
}): ReactNode {
  const change = usePermissionsChange<AccessSiteAuthority>({
    tenant: props.tenant,
    level: "Site",
    abilities: undefined,
    people: props.people,
    admits: sitePermissionAdmits,
    routes: sitePermissionRoutes,
    reread: (client) => tenantPermissionsReread(client, props.tenant),
  });
  return (
    <PermissionsSection
      label="Site permissions"
      read={props.read}
      rows={sitePermissionRows}
      withheld={sitePermissionsWithheld}
      removal={change.removal}
      addition={change.addition}
    />
  );
}

export function SitePermissionsPage(): ReactNode {
  const tenant = useSettingsTenant();
  const site = useSiteAuthorities(tenant);
  const read = useTenantPeople(tenant);
  return (
    <SettingsPage title="Permissions">
      <SitePermissions
        tenant={tenant}
        read={site}
        people={read.state === "Ready" ? read.value : undefined}
      />
    </SettingsPage>
  );
}
