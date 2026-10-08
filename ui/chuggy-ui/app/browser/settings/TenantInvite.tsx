/**
 * Inviting one person to a workspace, in a dialog: their email, their GitHub
 * username, a workspace role, and roles on the workspace's projects, each
 * offered only where the reader may grant it. A reader who may not make an
 * account is told so under the GitHub field before anything is sent. Each
 * field's fault stands under it before anything is sent, a refusal is one line
 * under the form with everything typed still there, and an invitation that
 * created or found the person closes the dialog and reads the list and the
 * abilities again. Every opening starts from nothing typed.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessTenantAbilities,
  AccessTenantRole,
} from "../../../../../src/contract/accessPlane.ts";
import { apiInviteTenantPerson } from "../../core/accessRoutes.ts";
import {
  projectRoleOffered,
  tenantInvitationBlank,
  tenantInvitationBody,
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
import { RadioGroup } from "../ui/RadioGroup.tsx";
import {
  InvitationEmail,
  InvitationFault,
  InvitationGithub,
  invitationLabelClassName,
} from "./InvitationFields.tsx";
import { tenantPeopleReread } from "./tenantPeopleResource.ts";
import { TenantProjectsGrid } from "./TenantProjectsGrid.tsx";

function TenantInviteRole(props: {
  readonly offered: readonly AccessTenantRole[];
  readonly role: AccessTenantRole;
  readonly onChoose: (role: AccessTenantRole) => void;
}): ReactNode {
  return (
    <div className="grid gap-2">
      <span aria-hidden="true" className={invitationLabelClassName}>
        Workspace role
      </span>
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
    </div>
  );
}

interface TenantInviting {
  readonly form: TenantInvitationForm;
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly change: (form: TenantInvitationForm) => void;
  /** The dialog opening: the form it starts from, and nothing said yet. */
  readonly begin: (form: TenantInvitationForm) => void;
  readonly invite: () => void;
}

/** One invitation, from the dialog opening to it closing or the line a
 * refusal leaves. */
function useTenantInvite(
  tenant: string,
  blank: TenantInvitationForm,
  onInvited: () => void,
): TenantInviting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [form, setForm] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  return {
    form,
    busy,
    status,
    change: setForm,
    begin: (opened) => {
      setForm(opened);
      setStatus(undefined);
    },
    invite: () => {
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

function TenantInviteProjects(props: {
  readonly abilities: AccessTenantAbilities;
  readonly offered: ReturnType<typeof tenantInvitationProjects>;
  readonly inviting: TenantInviting;
}): ReactNode {
  const { form, change } = props.inviting;
  if (props.offered.length === 0) return null;
  return (
    <div className="grid gap-1">
      <TenantProjectsGrid
        projects={props.offered.map((offered) => offered.project)}
        box={(project, role) =>
          projectRoleOffered(props.abilities, project, role)
            ? {
                checked: tenantInvitationRoleChosen(form, project, role),
                disabled: false,
              }
            : undefined
        }
        onToggle={(project, role) => {
          change(tenantInvitationProjectToggled(form, project, role));
        }}
      />
      <InvitationFault fault={tenantInvitationProjectsFault(form)} />
    </div>
  );
}

function TenantInviteFields(props: {
  readonly abilities: AccessTenantAbilities;
  readonly offered: ReturnType<typeof tenantInvitationProjects>;
  readonly inviting: TenantInviting;
}): ReactNode {
  const { form, change } = props.inviting;
  return (
    <div className="grid gap-4">
      <InvitationEmail
        value={form.email}
        onChange={(email) => {
          change({ ...form, email });
        }}
      />
      <InvitationGithub
        value={form.github}
        abilities={props.abilities}
        onChange={(github) => {
          change({ ...form, github });
        }}
      />
      <TenantInviteRole
        offered={tenantInvitationRoles(props.abilities)}
        role={form.role}
        onChoose={(role) => {
          change({ ...form, role });
        }}
      />
      <TenantInviteProjects
        abilities={props.abilities}
        offered={props.offered}
        inviting={props.inviting}
      />
    </div>
  );
}

function TenantInviteFoot(props: {
  readonly inviting: TenantInviting;
  readonly onCancel: () => void;
}): ReactNode {
  const inviting = props.inviting;
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        disabled={inviting.busy}
        onClick={props.onCancel}
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!tenantInvitationSendable(inviting.form) || inviting.busy}
        busy={inviting.busy}
        onClick={inviting.invite}
      >
        {inviting.busy ? "Inviting…" : "Invite"}
      </Button>
    </>
  );
}

function TenantInviteDialog(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities;
  readonly opening: AccessTenantRole;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const offered = tenantInvitationProjects(props.abilities, props.projects);
  const blank = tenantInvitationBlank(props.opening, offered);
  const inviting = useTenantInvite(props.tenant, blank, () => {
    setOpen(false);
  });
  return (
    <Dialog
      wide
      title={`Invite to ${props.tenant}`}
      trigger="Invite"
      open={open}
      onOpenChange={(opened) => {
        if (opened) inviting.begin(blank);
        setOpen(opened);
      }}
      busy={inviting.busy}
      note={inviting.status}
      foot={
        <TenantInviteFoot
          inviting={inviting}
          onCancel={() => {
            setOpen(false);
          }}
        />
      }
    >
      <TenantInviteFields
        abilities={props.abilities}
        offered={offered}
        inviting={inviting}
      />
    </Dialog>
  );
}

/** Drawn only where the reader may grant some workspace role, the one the
 * form opens on. */
export function TenantInvite(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities;
}): ReactNode {
  const opening = tenantInvitationRoleOpening(props.abilities);
  if (opening === undefined) return null;
  return (
    <TenantInviteDialog
      tenant={props.tenant}
      projects={props.projects}
      abilities={props.abilities}
      opening={opening}
    />
  );
}
