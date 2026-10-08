/**
 * A workspace's projects as a grid of boxes, a row a project and a column a
 * role: where a person's project roles are changed, and where an invitation's
 * are chosen. Each box is named by its project and its role, a cell the caller
 * answers with no box is left empty, and no project draws no grid.
 */

import type { ReactNode } from "react";

import { accessProjectRoles } from "../../../../../src/contract/accessPlane.ts";
import type { AccessProjectRole } from "../../../../../src/contract/accessPlane.ts";
import { projectRoleLabel } from "../../core/tenantPeople.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Table } from "../ui/Table.tsx";

import "./tenantPeople.css";

export interface TenantProjectsBox {
  readonly checked: boolean;
  /** Drawn as it stands and not pressable. */
  readonly disabled: boolean;
}

function TenantProjectsRow(props: {
  readonly project: string;
  readonly box: (role: AccessProjectRole) => TenantProjectsBox | undefined;
  readonly onToggle: (role: AccessProjectRole) => void;
}): ReactNode {
  return (
    <tr>
      <th scope="row">{props.project}</th>
      {accessProjectRoles.map((role) => {
        const box = props.box(role);
        return (
          <td key={role}>
            {box === undefined ? null : (
              <Checkbox
                bare
                label={`${props.project} ${projectRoleLabel(role)}`}
                checked={box.checked}
                disabled={box.disabled}
                onChange={() => {
                  props.onToggle(role);
                }}
              />
            )}
          </td>
        );
      })}
    </tr>
  );
}

export function TenantProjectsGrid(props: {
  readonly projects: readonly string[];
  readonly box: (
    project: string,
    role: AccessProjectRole,
  ) => TenantProjectsBox | undefined;
  readonly onToggle: (project: string, role: AccessProjectRole) => void;
}): ReactNode {
  if (props.projects.length === 0) return null;
  return (
    <div className="people-grid">
      <Table caption="Projects">
        <thead>
          <tr>
            <th scope="col">Projects</th>
            {accessProjectRoles.map((role) => (
              <th key={role} scope="col">
                {projectRoleLabel(role)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.projects.map((project) => (
            <TenantProjectsRow
              key={project}
              project={project}
              box={(role) => props.box(project, role)}
              onToggle={(role) => {
                props.onToggle(project, role);
              }}
            />
          ))}
        </tbody>
      </Table>
    </div>
  );
}
