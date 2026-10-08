/**
 * Inviting one person to a workspace: their GitHub username, their email, a
 * workspace role, and roles on any of the workspace's projects. Each field's
 * fault stands under it before anything is sent, a refusal is one line under
 * the form with everything typed still there, and an invitation that created
 * or found the person closes the dialog and reads the list again.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import {
  accessProjectRoles,
  accessTenantRoles,
} from "../../../../../src/contract/accessPlane.ts";
import { apiInviteTenantPerson } from "../../core/accessRoutes.ts";
import { tenantResourceKey } from "../../core/projectQueryKeys.ts";
import {
  projectRoleLabel,
  tenantInvitationBody,
  tenantInvitationEmailFault,
  tenantInvitationGithubFault,
  tenantInvitationOutcome,
  tenantInvitationProjectsFault,
  tenantInvitationProjectToggled,
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
import { tenantPeopleResource } from "./TenantPersonRow.tsx";

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
    </label>
  );
}

function TenantInviteProjects(props: {
  readonly form: TenantInvitationForm;
  readonly onChange: (form: TenantInvitationForm) => void;
}): ReactNode {
  const faultId = useId();
  const form = props.form;
  if (form.projects.length === 0) return null;
  return (
    <div role="group" aria-label="Projects" className="grid gap-1">
      <span className="text-sm text-ink-2">Projects</span>
      {form.projects.map((chosen) => (
        <span
          key={chosen.project}
          role="group"
          aria-label={chosen.project}
          className="flex flex-wrap items-center gap-2"
        >
          <span className="text-sm text-ink-2">{chosen.project}</span>
          {accessProjectRoles.map((role) => (
            <Button
              key={role}
              size="sm"
              variant="quiet"
              pressed={chosen.roles.includes(role)}
              onClick={() => {
                props.onChange(
                  tenantInvitationProjectToggled(form, chosen.project, role),
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
          await client.invalidateQueries({
            queryKey: tenantResourceKey(tenant, tenantPeopleResource),
          });
      })();
    },
  };
}

function TenantInviteBody(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
  readonly onInvited: () => void;
}): ReactNode {
  const [form, setForm] = useState<TenantInvitationForm>(() => ({
    github: "",
    email: "",
    role: "Member",
    projects: props.projects.map((project) => ({ project, roles: [] })),
  }));
  const inviting = useTenantInvite(props.tenant, props.onInvited);
  return (
    <div className="grid gap-3">
      <TenantInviteText
        label="GitHub username"
        value={form.github}
        fault={tenantInvitationGithubFault(form.github)}
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
      <RadioGroup
        label="Workspace role"
        value={form.role}
        options={accessTenantRoles.map((role) => ({
          value: role,
          text: tenantRoleLabel(role),
        }))}
        onChoose={(value) => {
          const role = accessTenantRoles.find((known) => known === value);
          if (role !== undefined) setForm({ ...form, role });
        }}
      />
      <TenantInviteProjects form={form} onChange={setForm} />
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

export function TenantInvite(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
}): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <Dialog title="Invite" trigger="Invite" open={open} onOpenChange={setOpen}>
      <TenantInviteBody
        tenant={props.tenant}
        projects={props.projects}
        onInvited={() => {
          setOpen(false);
        }}
      />
    </Dialog>
  );
}
