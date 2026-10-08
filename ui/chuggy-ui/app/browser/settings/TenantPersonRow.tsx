/**
 * One person in a workspace, their roles and hosted runs edited in place where
 * the reader may grant them: each such role, and hosted runs, is one button,
 * pressed where the list says it is held. A role the reader may not grant is
 * its label where held and absent where not, and hosted runs the reader may not
 * give are `Granted` or `Not granted`. A project is drawn where the person
 * holds a role there or the reader may grant one. A press sends one grant or
 * one removal and reads the list and the abilities again, so what the button
 * shows is always what the list holds, and a refusal is one line under the
 * person's name. Removing the reader's own workspace admin, and hosted runs
 * from a subject that is no account, is asked first, one question at a time.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import {
  accessProjectRoles,
  accessTenantRoles,
  type AccessTenantAbilities,
  type AccessTenantPerson,
} from "../../../../../src/contract/accessPlane.ts";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import {
  apiGrantHostedRuns,
  apiGrantProjectRole,
  apiGrantTenantRole,
  apiRemoveHostedRuns,
  apiRemoveProjectRole,
  apiRemoveTenantRole,
} from "../../core/accessRoutes.ts";
import {
  projectRoleLabel,
  projectRoleOffered,
  tenantHostedRunsOffered,
  tenantPersonChangeAsks,
  tenantPersonChangeNote,
  tenantPersonName,
  tenantPersonProjectDrawn,
  tenantPersonProjectRoles,
  tenantPersonQuestion,
  tenantRoleLabel,
  tenantRoleOffered,
} from "../../core/tenantPeople.ts";
import type { TenantPersonChange } from "../../core/tenantPeople.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { tenantPeopleReread } from "./tenantPeopleResource.ts";

function tenantPersonChangeSent(
  ports: ApiPorts,
  tenant: string,
  subject: string,
  change: TenantPersonChange,
): Promise<ApiResult<undefined>> {
  if (change.scope === "HostedRuns")
    return change.held
      ? apiRemoveHostedRuns(ports, tenant, subject)
      : apiGrantHostedRuns(ports, tenant, subject);
  if (change.scope === "Tenant")
    return change.held
      ? apiRemoveTenantRole(ports, tenant, subject, change.role)
      : apiGrantTenantRole(ports, tenant, subject, change.role);
  return change.held
    ? apiRemoveProjectRole(ports, tenant, change.project, subject, change.role)
    : apiGrantProjectRole(ports, tenant, change.project, subject, change.role);
}

/** One change at a time for one person, from the press to the line it leaves. */
function useTenantPersonChange(
  tenant: string,
  person: AccessTenantPerson,
): {
  readonly busy: boolean;
  readonly note: string | undefined;
  readonly asking: TenantPersonChange | undefined;
  readonly press: (change: TenantPersonChange) => void;
  readonly send: (change: TenantPersonChange) => void;
  readonly cancel: () => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | undefined>(undefined);
  const [asking, setAsking] = useState<TenantPersonChange | undefined>(
    undefined,
  );
  const send = (change: TenantPersonChange): void => {
    setBusy(true);
    setNote(undefined);
    void (async () => {
      const answered = await tenantPersonChangeSent(
        ports,
        tenant,
        person.subject,
        change,
      );
      await tenantPeopleReread(client, tenant);
      setAsking(undefined);
      setBusy(false);
      setNote(tenantPersonChangeNote(answered));
    })();
  };
  return {
    busy,
    note,
    asking,
    send,
    press: (change) => {
      if (tenantPersonChangeAsks(person, change)) setAsking(change);
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

/** One role as the reader may change it: a button where they may grant it,
 * otherwise its label where held and nothing where not. */
function TenantPersonRole(props: {
  readonly label: string;
  readonly offered: boolean;
  readonly held: boolean;
  readonly busy: boolean;
  readonly onPress: () => void;
}): ReactNode {
  if (!props.offered)
    return props.held ? (
      <span className="text-sm text-ink-2">{props.label}</span>
    ) : null;
  return (
    <Button
      size="sm"
      variant="quiet"
      pressed={props.held}
      disabled={props.busy}
      onClick={props.onPress}
    >
      {props.label}
    </Button>
  );
}

function TenantPersonProjects(props: {
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities | undefined;
  readonly busy: boolean;
  readonly press: (change: TenantPersonChange) => void;
}): ReactNode {
  const drawn = props.projects.filter((project) =>
    tenantPersonProjectDrawn(props.abilities, props.person, project),
  );
  return (
    <span className="grid gap-1">
      {drawn.map((project) => {
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
              <TenantPersonRole
                key={role}
                label={projectRoleLabel(role)}
                offered={projectRoleOffered(props.abilities, project, role)}
                held={held.includes(role)}
                busy={props.busy}
                onPress={() => {
                  props.press({
                    scope: "Project",
                    project,
                    role,
                    held: held.includes(role),
                  });
                }}
              />
            ))}
          </span>
        );
      })}
    </span>
  );
}

function TenantPersonRoles(props: {
  readonly person: AccessTenantPerson;
  readonly abilities: AccessTenantAbilities | undefined;
  readonly busy: boolean;
  readonly press: (change: TenantPersonChange) => void;
}): ReactNode {
  const held = props.person.tenantRoles;
  return (
    <span
      role="group"
      aria-label="Workspace"
      className="flex flex-wrap items-center gap-2"
    >
      {accessTenantRoles.map((role) => (
        <TenantPersonRole
          key={role}
          label={tenantRoleLabel(role)}
          offered={tenantRoleOffered(props.abilities, role)}
          held={held.includes(role)}
          busy={props.busy}
          onPress={() => {
            props.press({ scope: "Tenant", role, held: held.includes(role) });
          }}
        />
      ))}
    </span>
  );
}

function TenantPersonHostedRuns(props: {
  readonly person: AccessTenantPerson;
  readonly abilities: AccessTenantAbilities | undefined;
  readonly busy: boolean;
  readonly press: (change: TenantPersonChange) => void;
}): ReactNode {
  const held = props.person.hostedRuns;
  if (!tenantHostedRunsOffered(props.abilities))
    return held ? "Granted" : "Not granted";
  return (
    <TenantPersonRole
      label="Hosted runs"
      offered
      held={held}
      busy={props.busy}
      onPress={() => {
        props.press({ scope: "HostedRuns", held });
      }}
    />
  );
}

/** Who the person is, the line a refused change leaves, and the question a
 * change asked first waits on. */
function TenantPersonHeader(props: {
  readonly person: AccessTenantPerson;
  readonly change: ReturnType<typeof useTenantPersonChange>;
}): ReactNode {
  const change = props.change;
  const asking = change.asking;
  return (
    <span className="grid gap-1">
      <TenantPersonWho person={props.person} />
      {change.note === undefined ? null : (
        <Notice tone="danger" inline role="status" detail={change.note} />
      )}
      {asking === undefined ? null : (
        <Confirm
          question={tenantPersonQuestion(asking).question}
          confirm="Remove"
          busy={change.busy}
          onConfirm={() => {
            change.send(asking);
          }}
          onCancel={change.cancel}
        >
          {tenantPersonQuestion(asking).line}
        </Confirm>
      )}
    </span>
  );
}

export function TenantPersonRow(props: {
  readonly tenant: string;
  readonly person: AccessTenantPerson;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const person = props.person;
  const change = useTenantPersonChange(props.tenant, person);
  const busy = change.busy || change.asking !== undefined;
  return (
    <tr>
      <th scope="row">
        <TenantPersonHeader person={person} change={change} />
      </th>
      <td>
        <TenantPersonRoles
          person={person}
          abilities={props.abilities}
          busy={busy}
          press={change.press}
        />
      </td>
      <td>
        <TenantPersonHostedRuns
          person={person}
          abilities={props.abilities}
          busy={busy}
          press={change.press}
        />
      </td>
      <td>
        <TenantPersonProjects
          person={person}
          projects={props.projects}
          abilities={props.abilities}
          busy={busy}
          press={change.press}
        />
      </td>
    </tr>
  );
}
