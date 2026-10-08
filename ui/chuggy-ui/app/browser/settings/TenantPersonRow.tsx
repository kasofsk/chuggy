/**
 * One person in a workspace, their roles edited in place: each workspace role
 * and each role on each of the workspace's projects is one button, pressed
 * where the list says it is held. A press sends one grant or one removal and
 * reads the list again, so what the button shows is always what the list
 * holds, and a refusal is one line under the person's name.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  accessProjectRoles,
  accessTenantRoles,
  type AccessTenantPerson,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import {
  apiGrantProjectRole,
  apiGrantTenantRole,
  apiRemoveProjectRole,
  apiRemoveTenantRole,
} from "../../core/accessRoutes.ts";
import { tenantResourceKey } from "../../core/projectQueryKeys.ts";
import {
  projectRoleLabel,
  tenantPersonName,
  tenantPersonProjectRoles,
  tenantRoleChangeAsks,
  tenantRoleChangeNote,
  tenantRoleLabel,
} from "../../core/tenantPeople.ts";
import type { TenantRoleChange } from "../../core/tenantPeople.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";

/** No frame names this read, so a change's own invalidation is what reaches it. */
export const tenantPeopleResource = "access-people";

function tenantRoleChangeSent(
  ports: ApiPorts,
  tenant: string,
  subject: string,
  change: TenantRoleChange,
): Promise<ApiResult<undefined>> {
  if (change.scope === "Tenant")
    return change.held
      ? apiRemoveTenantRole(ports, tenant, subject, change.role)
      : apiGrantTenantRole(ports, tenant, subject, change.role);
  return change.held
    ? apiRemoveProjectRole(ports, tenant, change.project, subject, change.role)
    : apiGrantProjectRole(ports, tenant, change.project, subject, change.role);
}

/** One change at a time for one person, from the press to the line it leaves. */
function useTenantRoleChange(
  tenant: string,
  person: AccessTenantPerson,
): {
  readonly busy: boolean;
  readonly note: string | undefined;
  readonly asking: TenantRoleChange | undefined;
  readonly press: (change: TenantRoleChange) => void;
  readonly send: (change: TenantRoleChange) => void;
  readonly cancel: () => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [asking, setAsking] = useState<TenantRoleChange | undefined>(undefined);
  const send = (change: TenantRoleChange): void => {
    setBusy(true);
    setNote(undefined);
    void (async () => {
      const answered = await tenantRoleChangeSent(
        ports,
        tenant,
        person.subject,
        change,
      );
      await client.invalidateQueries({
        queryKey: tenantResourceKey(tenant, tenantPeopleResource),
      });
      setAsking(undefined);
      setBusy(false);
      setNote(tenantRoleChangeNote(answered));
    })();
  };
  return {
    busy,
    note,
    asking,
    send,
    press: (change) => {
      if (tenantRoleChangeAsks(person, change)) setAsking(change);
      else send(change);
    },
    cancel: () => {
      setAsking(undefined);
    },
  };
}

function TenantPersonWho(props: {
  readonly person: AccessTenantPerson;
}): ReactNode {
  const named = tenantPersonName(props.person);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {named.subject ? (
        <Identity label={{ text: named.name, title: named.name }} />
      ) : (
        <span>{named.name}</span>
      )}
      {named.githubLogin === undefined ? null : (
        <span className="text-sm text-ink-3">{named.githubLogin}</span>
      )}
      {named.noAccount ? (
        <span className="text-sm text-ink-3">No account</span>
      ) : null}
      {props.person.mine ? (
        <span className="text-sm text-ink-3">You</span>
      ) : null}
    </span>
  );
}

function TenantPersonProjects(props: {
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
  readonly busy: boolean;
  readonly press: (change: TenantRoleChange) => void;
}): ReactNode {
  return (
    <span className="grid gap-1">
      {props.projects.map((project) => {
        const held = tenantPersonProjectRoles(props.person, project);
        return (
          <span
            key={project}
            role="group"
            aria-label={project}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-sm text-ink-2">{project}</span>
            {accessProjectRoles.map((role) => (
              <Button
                key={role}
                size="sm"
                variant="quiet"
                pressed={held.includes(role)}
                disabled={props.busy}
                onClick={() => {
                  props.press({
                    scope: "Project",
                    project,
                    role,
                    held: held.includes(role),
                  });
                }}
              >
                {projectRoleLabel(role)}
              </Button>
            ))}
          </span>
        );
      })}
    </span>
  );
}

function TenantPersonRoles(props: {
  readonly person: AccessTenantPerson;
  readonly busy: boolean;
  readonly press: (change: TenantRoleChange) => void;
}): ReactNode {
  const held = props.person.tenantRoles;
  return (
    <span
      role="group"
      aria-label="Workspace"
      className="flex flex-wrap items-center gap-2"
    >
      {accessTenantRoles.map((role) => (
        <Button
          key={role}
          size="sm"
          variant="quiet"
          pressed={held.includes(role)}
          disabled={props.busy}
          onClick={() => {
            props.press({ scope: "Tenant", role, held: held.includes(role) });
          }}
        >
          {tenantRoleLabel(role)}
        </Button>
      ))}
    </span>
  );
}

export function TenantPersonRow(props: {
  readonly tenant: string;
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
}): ReactNode {
  const person = props.person;
  const change = useTenantRoleChange(props.tenant, person);
  const asking = change.asking;
  return (
    <tr>
      <th scope="row">
        <span className="grid gap-1">
          <TenantPersonWho person={person} />
          {change.note === undefined ? null : (
            <Notice tone="danger" inline role="status" detail={change.note} />
          )}
          {asking === undefined ? null : (
            <Confirm
              question="Remove your admin role"
              confirm="Remove"
              busy={change.busy}
              onConfirm={() => {
                change.send(asking);
              }}
              onCancel={change.cancel}
            >
              You will no longer manage this workspace.
            </Confirm>
          )}
        </span>
      </th>
      <td>
        <TenantPersonRoles
          person={person}
          busy={change.busy || asking !== undefined}
          press={change.press}
        />
      </td>
      <td>{person.hostedRuns ? "Granted" : "Not granted"}</td>
      <td>
        <TenantPersonProjects
          person={person}
          projects={props.projects}
          busy={change.busy || asking !== undefined}
          press={change.press}
        />
      </td>
    </tr>
  );
}
