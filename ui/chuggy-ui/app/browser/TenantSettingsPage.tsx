/**
 * The tenant's settings: the groups an administrator writes for everyone, one
 * line per group linking to its own page.
 *
 * A LIST RATHER THAN A REDIRECT, for the reason `SettingsPage.tsx` states for
 * the project's own: it holds one group today, and a reader who has
 * bookmarked this address keeps landing somewhere that still makes sense once
 * there is more than one row.
 */

import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { ProjectlessFrame } from "./ProjectCreation.tsx";
import { tenantAccountsRoutePath } from "./settings/TenantAccountsPage.tsx";
import { Table } from "./ui/Table.tsx";

/** This page's own address, which its reads take their tenant from. */
export const tenantSettingsRoutePath = "/tenants/$tenant/settings";

interface TenantSettingsGroup {
  readonly id: string;
  readonly label: string;
  readonly to: typeof tenantAccountsRoutePath;
}

/** The tenant's settings groups, in the order they are listed. */
const tenantSettingsGroups: readonly TenantSettingsGroup[] = [
  { id: "accounts", label: "Accounts", to: tenantAccountsRoutePath },
];

function TenantSettingsGroupRow(props: {
  readonly tenant: string;
  readonly group: TenantSettingsGroup;
}): ReactNode {
  return (
    <tr>
      <th scope="row">
        <Link to={props.group.to} params={{ tenant: props.tenant }}>
          {props.group.label}
        </Link>
      </th>
    </tr>
  );
}

export function TenantSettingsPage(): ReactNode {
  const params = useParams({ from: tenantSettingsRoutePath });
  return (
    <ProjectlessFrame>
      <div className="grid min-w-0 max-w-settings gap-4">
        <h1 className="text-md font-strong text-ink-1 truncate">Settings</h1>
        <Table caption="Settings groups">
          <tbody>
            {tenantSettingsGroups.map((group) => (
              <TenantSettingsGroupRow
                key={group.id}
                tenant={params.tenant}
                group={group}
              />
            ))}
          </tbody>
        </Table>
      </div>
    </ProjectlessFrame>
  );
}
