/**
 * Inviting a person into a workspace of their own, as the parts a form of it
 * is made from: the one request and what it left, the fields, the action that
 * sends them, and the line the last answer left.
 *
 * Nothing here is a card or a dialog, so whatever frames the form places the
 * fields in its body and the action and the line at its foot. The workspace
 * is named first and its owner's fields stand together under their own word,
 * so no field has to say whose it is. Each field's
 * fault stands under it before anything is sent, and while a request is
 * unanswered no field and no action takes a press. A creation leaves the form
 * as it started and its line in the passing tone; a refusal leaves everything
 * typed and its own line; either line stands until the form is changed or
 * sent again.
 */

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
import type {
  SiteWorkspaceForm,
  SiteWorkspaceOutcome,
} from "../../core/siteWorkspaces.ts";
import { useApiPorts } from "../api.ts";
import { Button } from "../ui/Button.tsx";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Notice } from "../ui/Notice.tsx";
import {
  InvitationEmail,
  InvitationGithub,
  InvitationText,
} from "./InvitationFields.tsx";

export interface SiteWorkspaceCreating {
  readonly form: SiteWorkspaceForm;
  readonly busy: boolean;
  /** What the last answer came to, until the form is changed or sent again. */
  readonly answered: SiteWorkspaceOutcome | undefined;
  readonly change: (form: SiteWorkspaceForm) => void;
  readonly create: () => void;
}

/** One form's state under the site abilities now read, from nothing typed to
 * the line its last answer left. */
export function useSiteWorkspaceCreation(
  abilities: AccessSiteAbilities,
): SiteWorkspaceCreating {
  const ports = useApiPorts();
  const [typed, setTyped] = useState(() => siteWorkspaceBlank(abilities));
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<SiteWorkspaceOutcome | undefined>(
    undefined,
  );
  const form = siteWorkspaceHeld(typed, abilities);
  return {
    form,
    busy,
    answered,
    change: (changed) => {
      setTyped(changed);
      setAnswered(undefined);
    },
    create: () => {
      setBusy(true);
      setAnswered(undefined);
      void (async () => {
        const outcome = siteWorkspaceOutcome(
          form,
          await apiInviteSiteOwner(ports, form),
        );
        setBusy(false);
        setAnswered(outcome);
        if (outcome.outcome === "Created")
          setTyped(siteWorkspaceBlank(abilities));
      })();
    },
  };
}

export function SiteWorkspaceFields(props: {
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
          disabled={busy || !props.abilities.manageAuthorities}
          onChange={(createAccounts) => {
            change({ ...form, createAccounts });
          }}
        />
      </div>
    </div>
  );
}

/** The line the last answer left, in the tone of how it went. */
export function SiteWorkspaceAnswered(props: {
  readonly creating: SiteWorkspaceCreating;
}): ReactNode {
  const answered = props.creating.answered;
  if (answered === undefined) return null;
  return (
    <Notice
      tone={answered.outcome === "Created" ? "pass" : "danger"}
      inline
      role="status"
      detail={answered.line}
    />
  );
}

export function SiteWorkspaceCreate(props: {
  readonly creating: SiteWorkspaceCreating;
}): ReactNode {
  const creating = props.creating;
  return (
    <Button
      variant="primary"
      size="sm"
      disabled={!siteWorkspaceSendable(creating.form) || creating.busy}
      busy={creating.busy}
      onClick={creating.create}
    >
      {creating.busy ? "Creating…" : "Create"}
    </Button>
  );
}
