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
 *
 * Where the site keeps workspace links the same dialog makes one: the box and
 * a note, and no workspace and no person, since whoever opens the link names
 * the workspace and owns it. A link made replaces the form with its address,
 * which only `Done` or Escape puts away, because the address is shown this
 * once. The dialog's state is the one place that link's token is, and
 * closing the dialog drops it.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessInviteLinkMinted,
  AccessSiteAbilities,
} from "../../../../../src/contract/accessPlane.ts";
import {
  apiInviteSiteOwner,
  apiMintSiteWorkspaceLink,
} from "../../core/accessRoutes.ts";
import { inviteLinkSendWords } from "../../core/inviteLinks.ts";
import type { InviteMode } from "../../core/inviteLinks.ts";
import {
  siteWorkspaceLinkBody,
  siteWorkspaceLinkNoteFault,
  siteWorkspaceLinkOutcome,
  siteWorkspaceLinkSendable,
  siteWorkspaceLinkWords,
} from "../../core/siteWorkspaceLinks.ts";
import {
  siteWorkspaceBlank,
  siteWorkspaceCreateAccountsLabel,
  siteWorkspaceHeld,
  siteWorkspaceNameFault,
  siteWorkspaceOutcome,
  siteWorkspaceSendable,
} from "../../core/siteWorkspaces.ts";
import type { SiteWorkspaceForm } from "../../core/siteWorkspaces.ts";
import { useApiPorts } from "../api.ts";
import { Checkbox } from "../ui/Checkbox.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import {
  InvitationEmail,
  InvitationGithub,
  InvitationText,
} from "./InvitationFields.tsx";
import { InviteFoot, InviteModes } from "./InviteDialog.tsx";
import {
  siteWorkspaceLinksReread,
  siteWorkspacesReread,
} from "./siteWorkspacesResource.ts";
import { TenantInviteLinkMade } from "./TenantInviteLinkMade.tsx";

interface SiteWorkspaceCreating {
  readonly form: SiteWorkspaceForm;
  /** The note a link is made with, which a person's invitation does not carry. */
  readonly note: string;
  readonly mode: InviteMode;
  /** The link this opening made, which is the one place its token is. */
  readonly made: AccessInviteLinkMinted | undefined;
  readonly busy: boolean;
  /** The line the last refusal left, until the form is changed or sent again. */
  readonly refused: string | undefined;
  readonly change: (form: SiteWorkspaceForm) => void;
  readonly annotate: (note: string) => void;
  readonly choose: (mode: InviteMode) => void;
  /** The dialog opening: nothing typed, a person to invite, and nothing said yet. */
  readonly begin: () => void;
  /** The dialog closing, which is where a link it made is dropped, its token with it. */
  readonly forget: () => void;
  readonly create: () => void;
  readonly mint: () => void;
}

/** One request from its press to its answer, and the line a refusal leaves. */
function useSiteWorkspaceSent(): {
  readonly busy: boolean;
  readonly refused: string | undefined;
  readonly quiet: () => void;
  readonly send: (asked: () => Promise<string | undefined>) => void;
} {
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  return {
    busy,
    refused,
    quiet: () => {
      setRefused(undefined);
    },
    send: (asked) => {
      setBusy(true);
      setRefused(undefined);
      void (async () => {
        const line = await asked();
        setBusy(false);
        setRefused(line);
      })();
    },
  };
}

/** One opening of the dialog under the site abilities now read, from its start
 * to the line a creation hands on, the one a refusal leaves, or the link it made. */
function useSiteWorkspaceCreation(
  tenant: string,
  abilities: AccessSiteAbilities,
  onCreated: (line: string) => void,
): SiteWorkspaceCreating {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [typed, setTyped] = useState(() => siteWorkspaceBlank(abilities));
  const [note, setNote] = useState("");
  const [mode, setMode] = useState<InviteMode>("Person");
  const [made, setMade] = useState<AccessInviteLinkMinted>();
  const { busy, refused, quiet, send } = useSiteWorkspaceSent();
  const form = siteWorkspaceHeld(typed, abilities);
  const quieted =
    <Held,>(hold: (held: Held) => void) =>
    (held: Held): void => {
      hold(held);
      quiet();
    };
  const created = async (): Promise<string | undefined> => {
    const outcome = siteWorkspaceOutcome(
      form,
      await apiInviteSiteOwner(ports, form),
    );
    if (outcome.outcome === "Refused") return outcome.line;
    onCreated(outcome.line);
    void siteWorkspacesReread(client, tenant);
    return undefined;
  };
  const minted = async (): Promise<string | undefined> => {
    const outcome = siteWorkspaceLinkOutcome(
      await apiMintSiteWorkspaceLink(
        ports,
        siteWorkspaceLinkBody(form.createAccounts, note),
      ),
    );
    if (outcome.outcome === "Refused") return outcome.line;
    setMade(outcome.minted);
    void siteWorkspaceLinksReread(client, tenant);
    return undefined;
  };
  return {
    form,
    note,
    mode,
    made,
    busy,
    refused,
    change: quieted(setTyped),
    annotate: quieted(setNote),
    choose: quieted(setMode),
    begin: () => {
      setTyped(siteWorkspaceBlank(abilities));
      setNote("");
      setMode("Person");
      quiet();
    },
    forget: () => {
      setMade(undefined);
    },
    create: () => {
      send(created);
    },
    mint: () => {
      send(minted);
    },
  };
}

interface SiteWorkspaceDrawn {
  readonly abilities: AccessSiteAbilities;
  readonly creating: SiteWorkspaceCreating;
}

/** The box that hands account creation on, the same under a person's fields and in a link's. */
function SiteWorkspaceCreateAccounts(props: SiteWorkspaceDrawn): ReactNode {
  const { form, busy, change } = props.creating;
  return (
    <Checkbox
      label={siteWorkspaceCreateAccountsLabel}
      checked={form.createAccounts}
      disabled={!props.abilities.manageAuthorities}
      held={busy}
      onChange={(createAccounts) => {
        change({ ...form, createAccounts });
      }}
    />
  );
}

/** The workspace an invitation makes and the person it names, neither of which a link's form holds. */
function SiteWorkspacePerson(props: SiteWorkspaceDrawn): ReactNode {
  const { form, busy, change } = props.creating;
  const owner = useId();
  return (
    <>
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
        <SiteWorkspaceCreateAccounts {...props} />
      </div>
    </>
  );
}

function SiteWorkspaceLink(props: SiteWorkspaceDrawn): ReactNode {
  const { note, busy, annotate } = props.creating;
  return (
    <>
      <SiteWorkspaceCreateAccounts {...props} />
      <InvitationText
        label={siteWorkspaceLinkWords.note}
        value={note}
        fault={siteWorkspaceLinkNoteFault(note)}
        disabled={busy}
        onChange={annotate}
      />
    </>
  );
}

function SiteWorkspaceFields(
  props: SiteWorkspaceDrawn & { readonly links: boolean },
): ReactNode {
  const { abilities, creating } = props;
  return (
    <div className="grid gap-5">
      {props.links ? (
        <InviteModes
          mode={creating.mode}
          busy={creating.busy}
          onChoose={creating.choose}
        />
      ) : null}
      {creating.mode === "Person" ? (
        <SiteWorkspacePerson abilities={abilities} creating={creating} />
      ) : (
        <SiteWorkspaceLink abilities={abilities} creating={creating} />
      )}
    </div>
  );
}

/** What sending the form is called in each mode, and while it is unanswered. */
const siteWorkspaceSendWords: Record<
  InviteMode,
  { readonly idle: string; readonly busy: string }
> = {
  Person: { idle: "Create", busy: "Creating…" },
  Link: inviteLinkSendWords,
};

function SiteWorkspaceFoot(props: {
  readonly creating: SiteWorkspaceCreating;
  readonly onClose: () => void;
}): ReactNode {
  const creating = props.creating;
  const person = creating.mode === "Person";
  return (
    <InviteFoot
      made={creating.made !== undefined}
      busy={creating.busy}
      sendable={
        person
          ? siteWorkspaceSendable(creating.form)
          : siteWorkspaceLinkSendable(
              siteWorkspaceLinkBody(
                creating.form.createAccounts,
                creating.note,
              ),
            )
      }
      words={siteWorkspaceSendWords[creating.mode]}
      onSend={person ? creating.create : creating.mint}
      onClose={props.onClose}
    />
  );
}

/** The action over the list and the dialog it opens, `onSaid` given a
 * creation's line, and nothing as the dialog opens again. */
export function SiteWorkspaceNew(props: {
  readonly tenant: string;
  readonly abilities: AccessSiteAbilities;
  /** Whether the site keeps workspace links, which is whether one may be made here. */
  readonly links: boolean;
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
  const moved = (opened: boolean): void => {
    if (opened) {
      creating.begin();
      props.onSaid(undefined);
    } else creating.forget();
    setOpen(opened);
  };
  return (
    <Dialog
      wide
      title="New workspace"
      trigger="New workspace"
      open={open}
      onOpenChange={moved}
      busy={creating.busy}
      kept={creating.made !== undefined}
      note={creating.refused}
      foot={
        <SiteWorkspaceFoot
          creating={creating}
          onClose={() => {
            moved(false);
          }}
        />
      }
    >
      {creating.made === undefined ? (
        <SiteWorkspaceFields
          abilities={props.abilities}
          creating={creating}
          links={props.links}
        />
      ) : (
        <TenantInviteLinkMade minted={creating.made} />
      )}
    </Dialog>
  );
}
