/**
 * One level's permissions as a section: a row a permission, and in each row
 * every holder as one item, in the order the rows give them, or `Nobody`.
 *
 * It reads nothing and is given no workspace, so any level's page draws its
 * rows with it. What a section says besides its table is its caller's.
 */

import type { ReactNode } from "react";

import {
  permissionsNobody,
  type PermissionHolder,
  type PermissionRow,
} from "../../core/permissions.ts";
import { Panel } from "../ui/Panel.tsx";
import { Table } from "../ui/Table.tsx";
import { TenantPersonWho } from "./TenantPersonRow.tsx";

function permissionHolderKey(holder: PermissionHolder): string {
  switch (holder.kind) {
    case "Person":
      return `Person:${holder.person.subject}`;
    case "SiteStanding":
    case "Group":
    case "TenantAdmins":
    case "Unnamed":
      return `${holder.kind}:${holder.words}`;
  }
}

function PermissionHolderItem(props: {
  readonly holder: PermissionHolder;
}): ReactNode {
  const holder = props.holder;
  return (
    <li>
      {holder.kind === "Person" ? (
        <TenantPersonWho person={holder.person} />
      ) : (
        holder.words
      )}
    </li>
  );
}

function PermissionRowDrawn(props: { readonly row: PermissionRow }): ReactNode {
  const holders = props.row.holders;
  return (
    <tr>
      <th scope="row">{props.row.name}</th>
      <td>
        {holders.length === 0 ? (
          permissionsNobody
        ) : (
          <ul className="m-0 grid list-none gap-1 p-0">
            {holders.map((holder) => (
              <PermissionHolderItem
                key={permissionHolderKey(holder)}
                holder={holder}
              />
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

export function PermissionsSection(props: {
  readonly title: string;
  readonly rows: readonly PermissionRow[] | undefined;
  readonly children?: ReactNode;
}): ReactNode {
  return (
    <Panel variant="section" title={props.title}>
      {props.rows === undefined ? null : (
        <Table caption={props.title}>
          <thead>
            <tr>
              <th scope="col">Permission</th>
              <th scope="col">Held by</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <PermissionRowDrawn key={row.authority} row={row} />
            ))}
          </tbody>
        </Table>
      )}
      {props.children}
    </Panel>
  );
}
