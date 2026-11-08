/**
 * A workspace's projects as a grid of boxes, a row a project and a column a
 * role: where a person's project roles are changed, and where an invitation's
 * are chosen. Each box is named by its project and its role, a cell the caller
 * answers with no box is left empty, and no project draws no grid.
 *
 * Total over a grid wide enough for a name beside its roles and one that is
 * not, where a project is a block and the sheet draws each box under its
 * role's word. The word is in every cell that has a box for that form alone:
 * the box is named without it, so it is hidden from a reader who is read to.
 */

import type { ReactNode } from "react";

import { accessProjectRoles } from "../../../../../src/contract/accessPlane.ts";
import type { AccessProjectRole } from "../../../../../src/contract/accessPlane.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import { projectRoleLabel } from "../../core/tenantPeople.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Table } from "../ui/Table.tsx";

import "./tenantPeople.css";

export interface TenantProjectsBox {
  readonly checked: boolean;
  /** Drawn as it stands and not pressable. */
  readonly disabled: boolean;
  /** Not pressable for now, while its caller settles a change. */
  readonly held?: boolean;
}

function TenantProjectsRow(props: {
  readonly project: string;
  readonly box: (role: AccessProjectRole) => TenantProjectsBox | undefined;
  readonly onToggle: (role: AccessProjectRole) => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <tr>
      <th scope="row">{props.project}</th>
      {accessProjectRoles.map((role) => {
        const box = props.box(role);
        const word = projectRoleLabel(role);
        return (
          <td key={role}>
            {box === undefined ? null : (
              <label className="people-grid-box">
                <span className="people-grid-role" aria-hidden="true">
                  {text(word)}
                </span>
                <Checkbox
                  bare
                  label={text({
                    id: "settings-people-grid-box",
                    args: { project: props.project, role: word },
                  })}
                  checked={box.checked}
                  disabled={box.disabled}
                  held={box.held ?? false}
                  onChange={() => {
                    props.onToggle(role);
                  }}
                />
              </label>
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
  const text = useCopyText();
  if (props.projects.length === 0) return null;
  const projects = text({ id: "settings-people-projects" });
  return (
    <div className="people-grid">
      <Table caption={projects}>
        <thead>
          <tr>
            <th scope="col">{projects}</th>
            {accessProjectRoles.map((role) => (
              <th key={role} scope="col">
                {text(projectRoleLabel(role))}
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
