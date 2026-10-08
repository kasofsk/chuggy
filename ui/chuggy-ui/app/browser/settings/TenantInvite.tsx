/**
 * Inviting one person to a workspace: their GitHub username, their email, a
 * workspace role, and roles on the workspace's projects, each offered only
 * where the reader may grant it. A reader who may not make an account is told
 * so under the GitHub field before anything is sent. Each field's fault stands
 * under it before anything is sent, a refusal is one line under the form with
 * everything typed still there, and an invitation that created or found the
 * person closes the dialog and reads the list and the abilities again.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessProjectRole,
  AccessTenantAbilities,
  AccessTenantRole,
} from "../../../../../src/contract/accessPlane.ts";
import { apiInviteTenantPerson } from "../../core/accessRoutes.ts";
import {
  projectRoleLabel,
  tenantInvitationAccountLine,
  tenantInvitationBody,
  tenantInvitationEmailFault,
  tenantInvitationGithubFault,
  tenantInvitationOutcome,
  tenantInvitationProjects,
  tenantInvitationProjectsFault,
  tenantInvitationProjectToggled,
  tenantInvitationRoleChosen,
  tenantInvitationRoleOpening,
  tenantInvitationRoles,
  tenantInvitationSendable,
  tenantRoleLabel,
} from "../../core/tenantPeople.ts";
import type { TenantInvitationForm } from "../../core/tenantPeople.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Input } from "../ui/Input.tsx";
import { Notice } from "../ui/Notice.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { tenantPeopleReread } from "./tenantPeopleResource.ts";

function TenantInviteFault(props: {
  readonly id: string;
  readonly fault: string | undefined;
}): ReactNode {
  return (
    <span id={props.id} className="text-xs text-tone-fail">
      {props.fault}
    </span>
  );
}

function TenantInviteText(props: {
  readonly label: string;
  readonly value: string;
  readonly fault: string | undefined;
  readonly line?: string | undefined;
  readonly onChange: (value: string) => void;
}): ReactNode {
  const faultId = useId();
  return (
    <label className="grid gap-1 text-sm text-ink-2">
      {props.label}
      <Input
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        invalid={props.fault !== undefined}
        describedBy={faultId}
      />
      <TenantInviteFault id={faultId} fault={props.fault} />
      {props.line === undefined ? null : (
        <span className="text-xs text-ink-3">{props.line}</span>
      )}
    </label>
  );
}

/** Each project the reader may grant on, with the roles they may grant there. */
function TenantInviteProjects(props: {
  readonly offered: readonly {
    readonly project: string;
    readonly roles: readonly AccessProjectRole[];
  }[];
  readonly form: TenantInvitationForm;
  readonly onChange: (form: TenantInvitationForm) => void;
}): ReactNode {
  const faultId = useId();
  const form = props.form;
  if (props.offered.length === 0) return null;
  return (
    <div role="group" aria-label="Projects" className="grid gap-1">
      <span className="text-sm text-ink-2">Projects</span>
      {props.offered.map((offered) => (
        <span
          key={offered.project}
          role="group"
          aria-label={offered.project}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-sm text-ink-2">{offered.project}</span>
          {offered.roles.map((role) => (
            <Button
              key={role}
              size="sm"
              variant="quiet"
              pressed={tenantInvitationRoleChosen(form, offered.project, role)}
              onClick={() => {
                props.onChange(
                  tenantInvitationProjectToggled(form, offered.project, role),
                );
              }}
            >
              {projectRoleLabel(role)}
            </Button>
          ))}
        </span>
      ))}
      <TenantInviteFault
        id={faultId}
        fault={tenantInvitationProjectsFault(form)}
      />
    </div>
  );
}

/** One invitation, from the press to the dialog closing or the line it leaves. */
function useTenantInvite(
  tenant: string,
  onInvited: () => void,
): {
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly invite: (form: TenantInvitationForm) => void;
} {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  return {
    busy,
    status,
    invite: (form) => {
      setBusy(true);
      setStatus(undefined);
      void (async () => {
        const outcome = tenantInvitationOutcome(
          await apiInviteTenantPerson(
            ports,
            tenant,
            tenantInvitationBody(form),
          ),
        );
        setBusy(false);
        if (outcome.outcome === "Refused") setStatus(outcome.status);
        else onInvited();
        if (outcome.outcome === "Invited" || outcome.reread)
          await tenantPeopleReread(client, tenant);
      })();
    },
  };
}

function TenantInviteRole(props: {
  readonly offered: readonly AccessTenantRole[];
  readonly role: AccessTenantRole;
  readonly onChoose: (role: AccessTenantRole) => void;
}): ReactNode {
  return (
    <RadioGroup
      label="Workspace role"
      value={props.role}
      options={props.offered.map((role) => ({
        value: role,
        text: tenantRoleLabel(role),
      }))}
      onChoose={(value) => {
        const role = props.offered.find((known) => known === value);
        if (role !== undefined) props.onChoose(role);
      }}
    />
  );
}

function TenantInviteBody(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities;
  readonly opening: AccessTenantRole;
  readonly onInvited: () => void;
}): ReactNode {
  const offered = tenantInvitationProjects(props.abilities, props.projects);
  const [form, setForm] = useState<TenantInvitationForm>(() => ({
    github: "",
    email: "",
    role: props.opening,
    projects: offered.map((project) => ({
      project: project.project,
      roles: [],
    })),
  }));
  const inviting = useTenantInvite(props.tenant, props.onInvited);
  return (
    <div className="grid gap-3">
      <TenantInviteText
        label="GitHub username"
        value={form.github}
        fault={tenantInvitationGithubFault(form.github)}
        line={tenantInvitationAccountLine(props.abilities)}
        onChange={(github) => {
          setForm({ ...form, github });
        }}
      />
      <TenantInviteText
        label="Email"
        value={form.email}
        fault={tenantInvitationEmailFault(form.email)}
        onChange={(email) => {
          setForm({ ...form, email });
        }}
      />
      <TenantInviteRole
        offered={tenantInvitationRoles(props.abilities)}
        role={form.role}
        onChoose={(role) => {
          setForm({ ...form, role });
        }}
      />
      <TenantInviteProjects offered={offered} form={form} onChange={setForm} />
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!tenantInvitationSendable(form) || inviting.busy}
          busy={inviting.busy}
          onClick={() => {
            inviting.invite(form);
          }}
        >
          {inviting.busy ? "Inviting…" : "Invite"}
        </Button>
        {inviting.status === undefined ? null : (
          <Notice tone="info" inline role="status" detail={inviting.status} />
        )}
      </div>
    </div>
  );
}

/** Drawn only where the reader may grant some workspace role, the one the
 * form opens on. */
export function TenantInvite(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const opening = tenantInvitationRoleOpening(props.abilities);
  if (opening === undefined) return null;
  return (
    <Dialog title="Invite" trigger="Invite" open={open} onOpenChange={setOpen}>
      <TenantInviteBody
        tenant={props.tenant}
        projects={props.projects}
        abilities={props.abilities}
        opening={opening}
        onInvited={() => {
          setOpen(false);
        }}
      />
    </Dialog>
  );
}
