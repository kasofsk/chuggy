/**
 * A workspace's permissions: who may grant each of its roles, give it hosted
 * runs and change who may, and, to a reader who manages the site, who may make
 * an account and change who may. It shows; nothing here changes a holder.
 *
 * The workspace's list answers only a reader who manages the workspace's
 * permissions, and the site's only one who manages the site's, so an absent
 * list is this reader's standing rather than a fault: the workspace's says who
 * manages permissions, and the site's is not drawn at all. A cut list says so.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type {
  AccessSiteAuthorities,
  AccessTenantAuthorities,
} from "../../../../../src/contract/accessPlane.ts";
import type { PanelState } from "../../core/freshness.ts";
import {
  sitePermissionRows,
  tenantPermissionRows,
  tenantPermissionsWithheld,
} from "../../core/permissions.ts";
import { tenantPeopleTruncated } from "../../core/tenantPeople.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ProjectlessFrame } from "../ProjectCreation.tsx";
import { Notice } from "../ui/Notice.tsx";
import { PermissionsSection } from "./PermissionsSection.tsx";
import {
  useSiteAuthorities,
  useTenantAuthorities,
} from "./tenantPermissionsResource.ts";

/** This page's own address, which its reads take their tenant from. */
export const tenantPermissionsRoutePath =
  "/tenants/$tenant/settings/permissions";

function PermissionsTruncated(props: {
  readonly truncated: boolean;
}): ReactNode {
  return props.truncated ? (
    <Notice tone="parked" inline detail={tenantPeopleTruncated} />
  ) : null;
}

function TenantPermissions(props: {
  readonly read: PanelState<AccessTenantAuthorities>;
}): ReactNode {
  const read = props.read;
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
    >
      <PermissionsTruncated truncated={read.value.truncated} />
    </PermissionsSection>
  );
}

function SitePermissions(props: {
  readonly read: PanelState<AccessSiteAuthorities>;
}): ReactNode {
  const read = props.read;
  if (read.state === "Pending" || read.state === "Absent") return null;
  if (read.state === "Failed")
    return (
      <PermissionsSection title="Site" rows={undefined}>
        <PanelUnready state={read} />
      </PermissionsSection>
    );
  return (
    <PermissionsSection title="Site" rows={sitePermissionRows(read.value)}>
      <PermissionsTruncated truncated={read.value.truncated} />
    </PermissionsSection>
  );
}

export function TenantPermissionsPage(): ReactNode {
  const params = useParams({ from: tenantPermissionsRoutePath });
  const tenant = useTenantAuthorities(params.tenant);
  const site = useSiteAuthorities(params.tenant);
  return (
    <ProjectlessFrame>
      <div className="grid min-w-0 max-w-settings gap-4">
        <h1 className="text-md font-strong text-ink-1 truncate">Permissions</h1>
        <TenantPermissions read={tenant} />
        <SitePermissions read={site} />
      </div>
    </ProjectlessFrame>
  );
}
