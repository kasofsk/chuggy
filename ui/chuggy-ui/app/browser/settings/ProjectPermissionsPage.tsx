/**
 * A project's permissions: who may grant each of its roles and who may change
 * that, drawn and changed by the workspace page's own section. Each holder a
 * route removes is removed on its press and each permission carries `Add`,
 * offering what it admits and has not got, a person among the project's people
 * where they are read; either change reads the project's list and its people
 * again.
 *
 * The project's list answers only a reader who may change every permission on
 * it, so an absent list is this reader's standing rather than a fault, and the
 * page says who manages permissions instead. A cut list says so.
 */

import { useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type {
  AccessProjectAuthority,
  AccessProjectPeople,
} from "../../../../../src/contract/accessPlane.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ApiPorts } from "../../core/apiRequest.ts";
import {
  apiAddProjectAuthorityGroup,
  apiAddProjectAuthorityPerson,
  apiRemoveProjectAuthorityGroup,
  apiRemoveProjectAuthorityPerson,
} from "../../core/accessRoutes.ts";
import {
  projectPermissionAdmits,
  projectPermissionRows,
  projectPermissionsWithheld,
} from "../../core/permissions.ts";
import { settingsRoutes } from "../../core/settingsNav.ts";
import {
  usePermissionsChange,
  type PermissionChange,
  type PermissionHolderRoutes,
} from "./permissionsChange.ts";
import { PermissionsSection } from "./PermissionsSection.tsx";
import {
  projectPermissionsReread,
  useProjectAuthorities,
  useProjectPeople,
} from "./projectPermissionsResource.ts";
import { SettingsPage } from "./SettingsPage.tsx";

/** No route sends a workspace's admins on a project. */
function projectPermissionRoutes(
  ports: ApiPorts,
  partition: PartitionIdentity,
  authority: AccessProjectAuthority,
  change: PermissionChange,
): PermissionHolderRoutes {
  const { tenant, project } = partition;
  switch (change) {
    case "Removal":
      return {
        group: (group) =>
          apiRemoveProjectAuthorityGroup(
            ports,
            tenant,
            project,
            authority,
            group,
          ),
        person: (subject) =>
          apiRemoveProjectAuthorityPerson(
            ports,
            tenant,
            project,
            authority,
            subject,
          ),
        tenant: undefined,
      };
    case "Addition":
      return {
        group: (group) =>
          apiAddProjectAuthorityGroup(ports, tenant, project, authority, group),
        person: (subject) =>
          apiAddProjectAuthorityPerson(
            ports,
            tenant,
            project,
            authority,
            subject,
          ),
        tenant: undefined,
      };
  }
}

function ProjectPermissions(props: {
  readonly partition: PartitionIdentity;
  readonly people: AccessProjectPeople | undefined;
}): ReactNode {
  const partition = props.partition;
  const read = useProjectAuthorities(partition);
  const change = usePermissionsChange<AccessProjectAuthority>({
    tenant: partition.tenant,
    level: "Project",
    abilities: undefined,
    people: props.people,
    admits: projectPermissionAdmits,
    routes: (ports, authority, sent) =>
      projectPermissionRoutes(ports, partition, authority, sent),
    reread: (client) => projectPermissionsReread(client, partition),
  });
  return (
    <PermissionsSection
      label="Project permissions"
      read={read}
      rows={projectPermissionRows}
      withheld={projectPermissionsWithheld}
      removal={change.removal}
      addition={change.addition}
    />
  );
}

export function ProjectPermissionsPage(): ReactNode {
  const params = useParams({ from: settingsRoutes.project.permissions });
  const partition: PartitionIdentity = {
    tenant: params.tenant,
    project: params.project,
  };
  const people = useProjectPeople(partition);
  return (
    <SettingsPage title="Permissions">
      <ProjectPermissions
        partition={partition}
        people={people.state === "Ready" ? people.value : undefined}
      />
    </SettingsPage>
  );
}
