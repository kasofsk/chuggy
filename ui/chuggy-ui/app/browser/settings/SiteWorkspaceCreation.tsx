/**
 * Inviting a person into a workspace of their own, in a dialog: the
 * workspace's name first, then its owner's fields together under their own
 * word, so no field has to say whose it is, and the box that hands account
 * creation on, the reader's to change only where they manage the site's
 * permissions.
 *
 * Each field's fault stands under it before anything is sent, and while the
 * request is unanswered no field and no action takes a press and nothing
 * closes the dialog. A refusal is one line beside the actions with everything
 * typed still there, standing until the form is changed or sent again. A
 * creation closes the dialog, reads the list again and hands its line to the
 * page, which is where it is drawn. Every opening starts from nothing typed
 * and nothing said.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import type { AccessSiteAbilities } from "../../../../../src/contract/accessPlane.ts";
import { apiInviteSiteOwner } from "../../core/accessRoutes.ts";
import {
  siteWorkspaceBlank,
  siteWorkspaceHeld,
  siteWorkspaceNameFault,
  siteWorkspaceOutcome,
  siteWorkspaceSendable,
} from "../../core/siteWorkspaces.ts";
import type { SiteWorkspaceForm } from "../../core/siteWorkspaces.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import {
  InvitationEmail,
  InvitationGithub,
  InvitationText,
} from "./InvitationFields.tsx";
import { siteWorkspacesReread } from "./siteWorkspacesResource.ts";

interface SiteWorkspaceCreating {
  readonly form: SiteWorkspaceForm;
  readonly busy: boolean;
  /** The line the last refusal left, until the form is changed or sent again. */
  readonly refused: string | undefined;
  readonly change: (form: SiteWorkspaceForm) => void;
  /** The dialog opening: nothing typed, and nothing said yet. */
  readonly begin: () => void;
  readonly create: () => void;
}

/** One creation under the site abilities now read, from the dialog opening to
 * the line a creation hands on or the one a refusal leaves. */
function useSiteWorkspaceCreation(
  tenant: string,
  abilities: AccessSiteAbilities,
  onCreated: (line: string) => void,
): SiteWorkspaceCreating {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [typed, setTyped] = useState(() => siteWorkspaceBlank(abilities));
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const form = siteWorkspaceHeld(typed, abilities);
  return {
    form,
    busy,
    refused,
    change: (changed) => {
      setTyped(changed);
      setRefused(undefined);
    },
    begin: () => {
      setTyped(siteWorkspaceBlank(abilities));
      setRefused(undefined);
    },
    create: () => {
      setBusy(true);
      setRefused(undefined);
      void (async () => {
        const outcome = siteWorkspaceOutcome(
          form,
          await apiInviteSiteOwner(ports, form),
        );
        setBusy(false);
        if (outcome.outcome === "Refused") {
          setRefused(outcome.line);
          return;
        }
        onCreated(outcome.line);
        await siteWorkspacesReread(client, tenant);
      })();
    },
  };
}

function SiteWorkspaceFields(props: {
  readonly abilities: AccessSiteAbilities;
  readonly creating: SiteWorkspaceCreating;
}): ReactNode {
  const { form, busy, change } = props.creating;
  const owner = useId();
  return (
    <div className="grid gap-5">
      <InvitationText
        label="Name"
        value={form.tenant}
        fault={siteWorkspaceNameFault(form.tenant)}
        disabled={busy}
        onChange={(tenant) => {
          change({ ...form, tenant });
        }}
      />
      <div role="group" aria-labelledby={owner} className="grid gap-4">
        <span id={owner} className="text-md font-strong text-ink-1">
          Owner
        </span>
        <InvitationGithub
          value={form.github}
          abilities={props.abilities}
          disabled={busy}
          onChange={(github) => {
            change({ ...form, github });
          }}
        />
        <InvitationEmail
          value={form.email}
          disabled={busy}
          onChange={(email) => {
            change({ ...form, email });
          }}
        />
        <Checkbox
          label="Can invite new people"
          checked={form.createAccounts}
          disabled={!props.abilities.manageAuthorities}
          held={busy}
          onChange={(createAccounts) => {
            change({ ...form, createAccounts });
          }}
        />
      </div>
    </div>
  );
}

/** The two actions as one, so a refusal's line too long to stand beside them
 * puts both under it and neither alone. */
function SiteWorkspaceFoot(props: {
  readonly creating: SiteWorkspaceCreating;
  readonly onCancel: () => void;
}): ReactNode {
  const creating = props.creating;
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        disabled={creating.busy}
        onClick={props.onCancel}
      >
        Cancel
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={!siteWorkspaceSendable(creating.form) || creating.busy}
        busy={creating.busy}
        onClick={creating.create}
      >
        {creating.busy ? "Creating…" : "Create"}
      </Button>
    </>
  );
}

/** The action over the list and the dialog it opens, `onSaid` given a
 * creation's line, and nothing as the dialog opens again. */
export function SiteWorkspaceNew(props: {
  readonly tenant: string;
  readonly abilities: AccessSiteAbilities;
  readonly onSaid: (line: string | undefined) => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const creating = useSiteWorkspaceCreation(
    props.tenant,
    props.abilities,
    (line) => {
      setOpen(false);
      props.onSaid(line);
    },
  );
  return (
    <Dialog
      wide
      title="New workspace"
      trigger="New workspace"
      open={open}
      onOpenChange={(opened) => {
        if (opened) {
          creating.begin();
          props.onSaid(undefined);
        }
        setOpen(opened);
      }}
      busy={creating.busy}
      note={creating.refused}
      foot={
        <SiteWorkspaceFoot
          creating={creating}
          onCancel={() => {
            setOpen(false);
          }}
        />
      }
    >
      <SiteWorkspaceFields abilities={props.abilities} creating={creating} />
    </Dialog>
  );
}
