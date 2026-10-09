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

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessInviteLinkMinted,
  AccessTenantAbilities,
  AccessTenantRole,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiInviteTenantPerson,
  apiMintTenantInviteLink,
} from "../../core/accessRoutes.ts";
import {
  tenantInviteLinkOutcome,
  tenantInviteLinkSendable,
  tenantInviteModes,
} from "../../core/inviteLinks.ts";
import type { TenantInviteMode } from "../../core/inviteLinks.ts";
import {
  projectRoleOffered,
  tenantInvitationBlank,
  tenantInvitationBody,
  tenantInvitationGrantsBody,
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
import type {
  TenantInvitationForm,
  TenantInvitationRefused,
} from "../../core/tenantPeople.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { RadioGroup } from "../ui/RadioGroup.tsx";
import { ToggleGroup } from "../ui/ToggleGroup.tsx";
import {
  InvitationEmail,
  InvitationFault,
  InvitationGithub,
  invitationLabelClassName,
} from "./InvitationFields.tsx";
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
  readonly mode: TenantInviteMode;
  /** The link this opening made, which is the one place its token is. */
  readonly made: AccessInviteLinkMinted | undefined;
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly change: (form: TenantInvitationForm) => void;
  readonly choose: (mode: TenantInviteMode) => void;
  /** The dialog opening or closing: the form it starts from, a person to invite, and nothing made or said. */
  readonly begin: (form: TenantInvitationForm) => void;
  readonly invite: () => void;
  readonly mint: () => void;
}

/** One request from its press to its answer, and the line a refusal leaves. */
function useTenantInviteSent(): {
  readonly busy: boolean;
  readonly status: string | undefined;
  readonly quiet: () => void;
  readonly send: (
    asked: () => Promise<TenantInvitationRefused | undefined>,
  ) => void;
} {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | undefined>(undefined);
  return {
    busy,
    status,
    quiet: () => {
      setStatus(undefined);
    },
    send: (asked) => {
      setBusy(true);
      setStatus(undefined);
      void (async () => {
        const refused = await asked();
        setBusy(false);
        setStatus(refused?.status);
      })();
    },
  };
}

/** One opening of the dialog, from its start to it closing, the line a
 * refusal leaves, or the link it made. */
function useTenantInvite(
  tenant: string,
  blank: TenantInvitationForm,
  onInvited: () => void,
): TenantInviting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [form, setForm] = useState(blank);
  const [mode, setMode] = useState<TenantInviteMode>("Person");
  const [made, setMade] = useState<AccessInviteLinkMinted>();
  const { busy, status, quiet, send } = useTenantInviteSent();
  const invited = async (): Promise<TenantInvitationRefused | undefined> => {
    const outcome = tenantInvitationOutcome(
      await apiInviteTenantPerson(ports, tenant, tenantInvitationBody(form)),
    );
    if (outcome.outcome === "Invited") onInvited();
    if (outcome.outcome === "Invited" || outcome.reread)
      void tenantPeopleReread(client, tenant);
    return outcome.outcome === "Refused" ? outcome : undefined;
  };
  const minted = async (): Promise<TenantInvitationRefused | undefined> => {
    const outcome = tenantInviteLinkOutcome(
      await apiMintTenantInviteLink(
        ports,
        tenant,
        tenantInvitationGrantsBody(form),
      ),
    );
    if (outcome.outcome === "Made") setMade(outcome.minted);
    if (outcome.outcome === "Made" || outcome.reread)
      void tenantInviteLinksReread(client, tenant);
    if (outcome.outcome === "Refused" && outcome.reread)
      void tenantPeopleReread(client, tenant);
    return outcome.outcome === "Refused" ? outcome : undefined;
  };
  return {
    form,
    mode,
    made,
    busy,
    status,
    change: setForm,
    choose: (chosen) => {
      setMode(chosen);
      quiet();
    },
    begin: (opened) => {
      setForm(opened);
      setMode("Person");
      setMade(undefined);
      quiet();
    },
    invite: () => {
      send(invited);
    },
    mint: () => {
      send(minted);
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

/** Which of the two the dialog makes, drawn only where the workspace keeps links. */
function TenantInviteModes(props: {
  readonly inviting: TenantInviting;
}): ReactNode {
  const inviting = props.inviting;
  return (
    <div>
      <ToggleGroup
        label="Invite by"
        options={tenantInviteModes}
        value={inviting.mode}
        onChange={(value) => {
          const mode = tenantInviteModes.find((known) => known === value);
          if (mode !== undefined && !inviting.busy) inviting.choose(mode);
        }}
      />
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
      {props.links ? <TenantInviteModes inviting={props.inviting} /> : null}
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
  TenantInviteMode,
  { readonly idle: string; readonly busy: string }
> = {
  Person: { idle: "Invite", busy: "Inviting…" },
  Link: { idle: "Create link", busy: "Creating…" },
};

function TenantInviteFoot(props: {
  readonly inviting: TenantInviting;
  readonly onClose: () => void;
}): ReactNode {
  const inviting = props.inviting;
  if (inviting.made !== undefined)
    return (
      <Button variant="primary" size="sm" onClick={props.onClose}>
        Done
      </Button>
    );
  const person = inviting.mode === "Person";
  const sendable = person
    ? tenantInvitationSendable(inviting.form)
    : tenantInviteLinkSendable(inviting.form);
  const words = tenantInviteSendWords[inviting.mode];
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        disabled={inviting.busy}
        onClick={props.onClose}
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!sendable || inviting.busy}
        busy={inviting.busy}
        onClick={person ? inviting.invite : inviting.mint}
      >
        {inviting.busy ? words.busy : words.idle}
      </Button>
    </>
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
