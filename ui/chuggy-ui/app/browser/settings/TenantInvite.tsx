/**
 * Inviting one person to a workspace, in a dialog: their email, their GitHub
 * username, a workspace role, and roles on the workspace's projects, each
 * offered only where the reader may grant it. A reader who may not make an
 * account is told so under the GitHub field before anything is sent. Each
 * field's fault stands under it before anything is sent, a refusal is one line
 * under the form with everything typed still there, and an invitation that
 * created or found the person closes the dialog and reads the list and the
 * abilities again. Every opening starts from nothing typed.
 *
 * Where the workspace keeps invite links the same dialog makes one: the roles
 * and no person, since whoever opens the link is who it invites. A link made
 * replaces the form with its address, which only `Done` or Escape puts away,
 * because the address is shown this once.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessInvited,
  AccessInviteLinkMinted,
  AccessTenantAbilities,
  AccessTenantRole,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiInviteTenantPerson,
  apiMintTenantInviteLink,
} from "../../core/accessRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import {
  inviteLinkSendWords,
  tenantInviteLinkSendable,
} from "../../core/inviteLinks.ts";
import type { InviteMode } from "../../core/inviteLinks.ts";
import {
  accessFailureLabel,
  projectRoleOffered,
  tenantInvitationBlank,
  tenantInvitationBody,
  tenantInvitationGrantsBody,
  tenantInvitationProjects,
  tenantInvitationProjectsFault,
  tenantInvitationProjectToggled,
  tenantInvitationRefusalRereads,
  tenantInvitationRoleChosen,
  tenantInvitationRoleOpening,
  tenantInvitationRoles,
  tenantInvitationSendable,
  tenantRoleLabel,
} from "../../core/tenantPeople.ts";
import type { TenantInvitationForm } from "../../core/tenantPeople.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import {
  InvitationEmail,
  InvitationFault,
  InvitationGithub,
  invitationLabelClassName,
} from "./InvitationFields.tsx";
import { InviteFoot, InviteModes } from "./InviteDialog.tsx";
import { TenantInviteLinkMade } from "./TenantInviteLinkMade.tsx";
import {
  tenantInviteLinksReread,
  tenantPeopleReread,
} from "./tenantPeopleResource.ts";
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
  readonly mode: InviteMode;
  /** The link this opening made, which only the write that made it holds. */
  readonly made: AccessInviteLinkMinted | undefined;
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly change: (form: TenantInvitationForm) => void;
  readonly choose: (mode: InviteMode) => void;
  /** The dialog opening or closing: the form it starts from, a person to invite, and nothing made or said. */
  readonly begin: (form: TenantInvitationForm) => void;
  readonly invite: () => void;
  readonly mint: () => void;
}

/** One person invited, over once the list and the abilities have answered
 * again; an absent answer leaves them to be read again behind it. */
function tenantInvitationWrite(
  tenant: string,
): ConsoleWrite<TenantInvitationForm, AccessInvited> {
  return {
    mutationKey: consoleWriteKey("tenant-invitation", tenant),
    write: async (ports, form, client) => {
      const answered = await apiInviteTenantPerson(
        ports,
        tenant,
        tenantInvitationBody(form),
      );
      if (answered.outcome !== "Ok" && tenantInvitationRefusalRereads(answered))
        void tenantPeopleReread(client, tenant);
      return answered;
    },
    refusal: accessFailureLabel,
    landed: (client) => tenantPeopleReread(client, tenant),
  };
}

/** One link made, over once the links have answered again; an absent answer
 * leaves them and the people to be read again behind it. */
function tenantInviteLinkWrite(
  tenant: string,
): ConsoleWrite<TenantInvitationForm, AccessInviteLinkMinted> {
  return {
    mutationKey: consoleWriteKey("tenant-invite-link", tenant),
    write: async (ports, form, client) => {
      const answered = await apiMintTenantInviteLink(
        ports,
        tenant,
        tenantInvitationGrantsBody(form),
      );
      if (
        answered.outcome !== "Ok" &&
        tenantInvitationRefusalRereads(answered)
      ) {
        void tenantInviteLinksReread(client, tenant);
        void tenantPeopleReread(client, tenant);
      }
      return answered;
    },
    refusal: accessFailureLabel,
    landed: (client) => tenantInviteLinksReread(client, tenant),
  };
}

/** One opening of the dialog, from its start to it closing, the line a
 * refusal leaves, or the link it made. */
function useTenantInvite(
  tenant: string,
  blank: TenantInvitationForm,
  onInvited: () => void,
): TenantInviting {
  const [form, setForm] = useState(blank);
  const [mode, setMode] = useState<InviteMode>("Person");
  const inviting = useConsoleWrite(tenantInvitationWrite(tenant));
  const minting = useConsoleWrite(tenantInviteLinkWrite(tenant));
  const quiet = (): void => {
    inviting.reset();
    minting.reset();
  };
  return {
    form,
    mode,
    made: minting.isSuccess ? minting.data : undefined,
    busy: inviting.isPending || minting.isPending,
    status: (inviting.error ?? minting.error)?.message,
    change: setForm,
    choose: (chosen) => {
      setMode(chosen);
      quiet();
    },
    begin: (opened) => {
      setForm(opened);
      setMode("Person");
      quiet();
    },
    invite: () => {
      minting.reset();
      inviting.mutate(form, { onSuccess: onInvited });
    },
    mint: () => {
      inviting.reset();
      minting.mutate(form);
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

/** Who a person's invitation names, which a link's form does not hold. */
function TenantInvitePerson(props: {
  readonly abilities: AccessTenantAbilities;
  readonly inviting: TenantInviting;
}): ReactNode {
  const { form, change } = props.inviting;
  return (
    <>
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
    </>
  );
}

function TenantInviteFields(props: {
  readonly abilities: AccessTenantAbilities;
  readonly offered: ReturnType<typeof tenantInvitationProjects>;
  readonly inviting: TenantInviting;
  readonly links: boolean;
}): ReactNode {
  const { form, change, mode } = props.inviting;
  return (
    <div className="grid gap-4">
      {props.links ? (
        <InviteModes
          mode={mode}
          busy={props.inviting.busy}
          onChoose={props.inviting.choose}
        />
      ) : null}
      {mode === "Person" ? (
        <TenantInvitePerson
          abilities={props.abilities}
          inviting={props.inviting}
        />
      ) : null}
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

/** What sending the form is called in each mode, and while it is unanswered. */
const tenantInviteSendWords: Record<
  InviteMode,
  { readonly idle: string; readonly busy: string }
> = {
  Person: { idle: "Invite", busy: "Inviting…" },
  Link: inviteLinkSendWords,
};

function TenantInviteFoot(props: {
  readonly inviting: TenantInviting;
  readonly onClose: () => void;
}): ReactNode {
  const inviting = props.inviting;
  const person = inviting.mode === "Person";
  return (
    <InviteFoot
      made={inviting.made !== undefined}
      busy={inviting.busy}
      sendable={
        person
          ? tenantInvitationSendable(inviting.form)
          : tenantInviteLinkSendable(inviting.form)
      }
      words={tenantInviteSendWords[inviting.mode]}
      onSend={person ? inviting.invite : inviting.mint}
      onClose={props.onClose}
    />
  );
}

function TenantInviteDialog(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities;
  readonly opening: AccessTenantRole;
  readonly links: boolean;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const offered = tenantInvitationProjects(props.abilities, props.projects);
  const blank = tenantInvitationBlank(props.opening, offered);
  const inviting = useTenantInvite(props.tenant, blank, () => {
    setOpen(false);
  });
  const moved = (opened: boolean): void => {
    inviting.begin(blank);
    setOpen(opened);
  };
  return (
    <Dialog
      wide
      title={`Invite to ${props.tenant}`}
      trigger="Invite"
      open={open}
      onOpenChange={moved}
      busy={inviting.busy}
      kept={inviting.made !== undefined}
      note={inviting.status}
      foot={
        <TenantInviteFoot
          inviting={inviting}
          onClose={() => {
            moved(false);
          }}
        />
      }
    >
      {inviting.made === undefined ? (
        <TenantInviteFields
          abilities={props.abilities}
          offered={offered}
          inviting={inviting}
          links={props.links}
        />
      ) : (
        <TenantInviteLinkMade minted={inviting.made} />
      )}
    </Dialog>
  );
}

/** Drawn only where the reader may grant some workspace role, the one the
 * form opens on. */
export function TenantInvite(props: {
  readonly tenant: string;
  readonly projects: readonly string[];
  readonly abilities: AccessTenantAbilities;
  /** Whether the workspace keeps invite links, which is whether one may be made here. */
  readonly links: boolean;
}): ReactNode {
  const opening = tenantInvitationRoleOpening(props.abilities);
  if (opening === undefined) return null;
  return (
    <TenantInviteDialog
      tenant={props.tenant}
      projects={props.projects}
      abilities={props.abilities}
      opening={opening}
      links={props.links}
    />
  );
}
