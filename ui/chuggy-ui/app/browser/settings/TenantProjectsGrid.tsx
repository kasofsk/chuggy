/**
 * A workspace's projects as a grid of boxes, a row a project and a column a
 * role: where a person's project roles are changed, and where an invitation's
 * are chosen. Each box is named by its project and its role, a cell the caller
 * answers with no box is left empty, and no project draws no grid.
 *
 * Total over a grid wide enough for a name beside its roles and one that is
 * not, where a project is the table's card: its name over a row of its boxes,
 * each under its role's word, and a cell with no box keeping its place so a
 * role stands at the same place down the grid. The box is named without the
 * role's word, which the card draws for the eye alone.
 */

import type { ReactNode } from "react";

import { accessProjectRoles } from "../../../../../src/contract/accessPlane.ts";
import type { AccessProjectRole } from "../../../../../src/contract/accessPlane.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { CopyText } from "../../core/copy.ts";
import { projectRoleLabel } from "../../core/tenantPeople.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Table } from "../ui/Table.tsx";
import type { TableRow } from "../ui/Table.tsx";

import "./tenantPeople.css";

export interface TenantProjectsBox {
  readonly checked: boolean;
  /** Drawn as it stands and not pressable. */
  readonly disabled: boolean;
  /** Not pressable for now, while its caller settles a change. */
  readonly held?: boolean;
}

type TenantProjectsColumn = "project" | AccessProjectRole;

function tenantProjectsRow(
  project: string,
  drawn: {
    readonly box: (role: AccessProjectRole) => TenantProjectsBox | undefined;
    readonly onToggle: (role: AccessProjectRole) => void;
    readonly text: CopyText;
  },
): TableRow<TenantProjectsColumn> {
  const boxes = accessProjectRoles.map((role) => {
    const box = drawn.box(role);
    return [
      role,
      box === undefined ? null : (
        <Checkbox
          bare
          label={drawn.text({
            id: "settings-people-grid-box",
            args: { project, role: projectRoleLabel(role) },
          })}
          checked={box.checked}
          disabled={box.disabled}
          held={box.held ?? false}
          onChange={() => {
            drawn.onToggle(role);
          }}
        />
      ),
    ] as const;
  });
  return {
    key: project,
    cells: {
      project,
      ...(Object.fromEntries(boxes) as Record<AccessProjectRole, ReactNode>),
    },
    empty: boxes.filter(([, box]) => box === null).map(([role]) => role),
  };
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
      <Table
        caption={projects}
        stacked={{
          columns: [
            {
              key: "project",
              label: projects,
              rowHeader: true,
              headClassName: "people-grid-project",
            },
            ...accessProjectRoles.map((role) => ({
              key: role,
              label: text(projectRoleLabel(role)),
              inline: true,
            })),
          ],
          rows: props.projects.map((project) =>
            tenantProjectsRow(project, {
              box: (role) => props.box(project, role),
              onToggle: (role) => {
                props.onToggle(project, role);
              },
              text,
            }),
          ),
        }}
      />
    </div>
  );
}
