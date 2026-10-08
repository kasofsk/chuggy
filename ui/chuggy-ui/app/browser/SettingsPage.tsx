/**
 * The project's settings: the groups an administrator writes for everyone, one
 * line per group linking to its own page.
 *
 * A LIST RATHER THAN A REDIRECT. It gains a row every time a further group
 * moves under it, so a reader who has bookmarked this address keeps landing
 * somewhere that still makes sense as the rows change.
 */

import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { leadSettingsRoutePath } from "./settings/LeadSettingsPage.tsx";
import { placementSettingsRoutePath } from "./settings/PlacementSettingsPage.tsx";
import { TopBarSlot } from "./shell/slots.tsx";
import { tenantSettingsRoutePath } from "./TenantSettingsPage.tsx";
import { Table } from "./ui/Table.tsx";

/** This page's own address, which its reads take their partition from. */
export const settingsRoutePath = "/$tenant/$project/settings";

interface SettingsGroup {
  readonly id: string;
  readonly label: string;
  readonly to:
    | typeof leadSettingsRoutePath
    | typeof placementSettingsRoutePath
    | typeof tenantSettingsRoutePath;
}

/** The project's settings groups, in the order they are listed, the last
 * leading to the workspace's own. */
const settingsGroups: readonly SettingsGroup[] = [
  { id: "lead", label: "Lead", to: leadSettingsRoutePath },
  { id: "placement", label: "Placement", to: placementSettingsRoutePath },
  { id: "workspace", label: "Workspace", to: tenantSettingsRoutePath },
];

function SettingsGroupRow(props: {
  readonly partition: PartitionIdentity;
  readonly group: SettingsGroup;
}): ReactNode {
  return (
    <tr>
      <th scope="row">
        <Link to={props.group.to} params={props.partition}>
          {props.group.label}
        </Link>
      </th>
    </tr>
  );
}

export function SettingsPage(): ReactNode {
  const params = useParams({ from: settingsRoutePath });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  return (
    <div className="grid min-w-0 max-w-settings gap-4">
      <TopBarSlot>
        <h1 className="text-md font-strong text-ink-1 truncate">Settings</h1>
      </TopBarSlot>
      <Table caption="Settings groups">
        <tbody>
          {settingsGroups.map((group) => (
            <SettingsGroupRow
              key={group.id}
              partition={partition}
              group={group}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}
