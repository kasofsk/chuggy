/**
 * The project's settings: the groups an administrator writes for everyone, one
 * line per group linking to its own page.
 *
 * A LIST RATHER THAN A REDIRECT. It holds two groups today and gains another
 * every time a further one moves under it, so a reader who has bookmarked
 * this address keeps landing somewhere that still makes sense once there is
 * more than one row.
 */

import { Link, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../src/contract/http.ts";
import { leadSettingsRoutePath } from "./settings/LeadSettingsPage.tsx";
import { placementSettingsRoutePath } from "./settings/PlacementSettingsPage.tsx";
import { TopBarSlot } from "./shell/slots.tsx";
import { Table } from "./ui/Table.tsx";

/** This page's own address, which its reads take their partition from. */
export const settingsRoutePath = "/$tenant/$project/settings";

interface SettingsGroup {
  readonly id: string;
  readonly label: string;
  readonly to: typeof leadSettingsRoutePath | typeof placementSettingsRoutePath;
}

/** The project's settings groups, in the order they are listed. Gains a row as
 * each further group moves under this page. */
const settingsGroups: readonly SettingsGroup[] = [
  { id: "lead", label: "Lead", to: leadSettingsRoutePath },
  { id: "placement", label: "Placement", to: placementSettingsRoutePath },
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
