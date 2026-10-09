/**
 * What became of each of a workspace's invite links: one row a link, newest
 * first as the plane lists them, saying what it carries, where it stands, who
 * used it and who made it, and offering its revocation where it is open and
 * the reader's to end.
 *
 * A link has no name and its token is not in the list, so a row is headed by
 * what the link grants, drawn as a person's row draws what they hold. The
 * plane decides a revocation: a link that ended while the row stood is read
 * again and nothing is said, and any other refusal is one line under its row.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  AccessInviteLink,
  AccessTenantAbilities,
} from "../../../../../src/contract/accessPlane.ts";
import { apiRevokeTenantInviteLink } from "../../core/accessRoutes.ts";
import { instantFigureAtMs } from "../../core/figures.ts";
import {
  inviteLinkAccess,
  inviteLinkRevocable,
  inviteLinkRevocationNote,
  inviteLinkRevocationQuestion,
  inviteLinkStateLabel,
  inviteLinksWords,
} from "../../core/inviteLinks.ts";
import { tenantPersonName } from "../../core/tenantPeople.ts";
import type { TenantSubject } from "../../core/tenantPeople.ts";
import { inviteLinkStateTone } from "../../core/tones.ts";
import { useApiPorts } from "../api.ts";
import { useNowMs } from "../Freshness.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import {
  SettingsListingNone,
  settingsListingNone,
  SettingsListingSection,
  SettingsListingTable,
} from "./SettingsListing.tsx";
import { tenantInviteLinksReread } from "./tenantPeopleResource.ts";
import { TenantHeldProjects, TenantHeldWords } from "./TenantPersonRow.tsx";

import "./tenantPeople.css";

interface InviteLinkRevoking {
  /** The link whose revocation is asked and not yet sent or answered. */
  readonly asking: string | undefined;
  readonly busy: boolean;
  /** The line the last refused revocation left, and the link it was of. */
  readonly note: { readonly link: string; readonly words: string } | undefined;
  readonly press: (link: string) => void;
  readonly cancel: () => void;
  readonly send: (link: string) => void;
}

/** One revocation at a time, from its press through its question to its
 * answer, after which the list is read again whatever the answer was. */
function useInviteLinkRevoking(tenant: string): InviteLinkRevoking {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<InviteLinkRevoking["note"]>(undefined);
  return {
    asking,
    busy,
    note,
    press: (link) => {
      setNote(undefined);
      setAsking(link);
    },
    cancel: () => {
      setAsking(undefined);
    },
    send: (link) => {
      setBusy(true);
      void (async () => {
        const words = inviteLinkRevocationNote(
          await apiRevokeTenantInviteLink(ports, tenant, link),
        );
        setBusy(false);
        setAsking(undefined);
        setNote(words === undefined ? undefined : { link, words });
        await tenantInviteLinksReread(client, tenant);
      })();
    },
  };
}

/** Who made or used a link and when, down a narrow column: the name cut short
 * on a line as a person's row cuts it, under the column's words where the row is stacked. */
function InviteLinkWho(props: {
  readonly label: string;
  readonly person: TenantSubject;
  readonly atMs: number;
  readonly nowMs: number;
}): ReactNode {
  const named = tenantPersonName(props.person);
  return (
    <div className="grid min-w-0">
      <span className="people-stacked-label">{props.label}</span>
      <span className="people-name" title={named.name}>
        {named.subject ? (
          <Identity label={{ text: named.name, title: named.name }} />
        ) : (
          named.name
        )}
      </span>
      {named.githubLogin === undefined ? null : (
        <span className="truncate text-sm text-ink-3">{named.githubLogin}</span>
      )}
      {named.noAccount ? (
        <span className="text-sm text-ink-3">No account</span>
      ) : null}
      <span className="text-sm text-ink-3">
        <Figure figure={instantFigureAtMs(props.atMs, props.nowMs)} />
      </span>
    </div>
  );
}

function InviteLinkStatus(props: {
  readonly link: AccessInviteLink;
  readonly nowMs: number;
}): ReactNode {
  const link = props.link;
  return (
    <div className="grid justify-items-start gap-1">
      <Pill tone={inviteLinkStateTone(link.state)}>
        {inviteLinkStateLabel(link.state)}
      </Pill>
      {link.state === "Open" ? (
        <span className="text-sm text-ink-3">
          {inviteLinksWords.expires}{" "}
          <Figure figure={instantFigureAtMs(link.expiresAtMs, props.nowMs)} />
        </span>
      ) : null}
    </div>
  );
}

/** Under a link's row: the line a refused revocation left, and the question a
 * revocation waits on. */
function InviteLinkAsked(props: {
  readonly link: string;
  readonly columns: number;
  readonly revoking: InviteLinkRevoking;
}): ReactNode {
  const { link, revoking } = props;
  const words = revoking.note?.link === link ? revoking.note.words : undefined;
  const asked = revoking.asking === link;
  if (words === undefined && !asked) return null;
  return (
    <tr className="people-asked">
      <td colSpan={props.columns}>
        <div className="ms-auto grid max-w-aside gap-2">
          {words === undefined ? null : (
            <Notice tone="danger" inline role="status" detail={words} />
          )}
          {asked ? (
            <Confirm
              question={inviteLinkRevocationQuestion.question}
              confirm={inviteLinksWords.revoke}
              busy={revoking.busy}
              onConfirm={() => {
                revoking.send(link);
              }}
              onCancel={revoking.cancel}
            >
              {inviteLinkRevocationQuestion.line}
            </Confirm>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function InviteLinkRow(props: {
  readonly link: AccessInviteLink;
  readonly revocable: boolean;
  /** Whether the table has a column of revocations, which is the reader's to have and not this link's. */
  readonly revocations: boolean;
  readonly revoking: InviteLinkRevoking;
  readonly nowMs: number;
}): ReactNode {
  const { link, revoking, nowMs } = props;
  const access = inviteLinkAccess(link);
  return (
    <tr>
      <th scope="row">
        <div className="grid min-w-0 justify-items-start gap-1">
          <TenantHeldWords held={access.held} />
          {access.every || access.lines.length > 0 ? (
            <TenantHeldProjects every={access.every} lines={access.lines} />
          ) : null}
        </div>
      </th>
      <td>
        <InviteLinkStatus link={link} nowMs={nowMs} />
      </td>
      <td data-none={settingsListingNone(link.state !== "Used")}>
        {link.state === "Used" ? (
          <InviteLinkWho
            label={inviteLinksWords.usedBy}
            person={link.usedBy}
            atMs={link.usedAtMs}
            nowMs={nowMs}
          />
        ) : (
          <SettingsListingNone />
        )}
      </td>
      <td>
        <InviteLinkWho
          label={inviteLinksWords.madeBy}
          person={link.mintedBy}
          atMs={link.mintedAtMs}
          nowMs={nowMs}
        />
      </td>
      {props.revocations ? (
        <td className="people-edit">
          {props.revocable ? (
            <Button
              variant="quiet"
              size="sm"
              disabled={revoking.busy || revoking.asking !== undefined}
              onClick={() => {
                revoking.press(link.link);
              }}
            >
              {inviteLinksWords.revoke}
            </Button>
          ) : null}
        </td>
      ) : null}
    </tr>
  );
}

const inviteLinkColumnsCount = 4;

function InviteLinksHead(props: { readonly revocations: boolean }): ReactNode {
  return (
    <thead>
      <tr>
        <th scope="col">{inviteLinksWords.access}</th>
        <th scope="col" className="people-col-status">
          {inviteLinksWords.status}
        </th>
        <th scope="col" className="people-col-who">
          {inviteLinksWords.usedBy}
        </th>
        <th scope="col" className="people-col-who">
          {inviteLinksWords.madeBy}
        </th>
        {props.revocations ? (
          <th scope="col" className="people-col-revoke">
            <span className="visually-hidden">{inviteLinksWords.revoke}</span>
          </th>
        ) : null}
      </tr>
    </thead>
  );
}

/** Drawn only where the workspace has a link to list. */
export function TenantInviteLinks(props: {
  readonly tenant: string;
  readonly links: readonly AccessInviteLink[];
  readonly abilities: AccessTenantAbilities | undefined;
}): ReactNode {
  const revoking = useInviteLinkRevoking(props.tenant);
  const nowMs = useNowMs();
  if (props.links.length === 0) return null;
  const revocable = props.links.filter((link) =>
    inviteLinkRevocable(props.abilities, link),
  );
  const revocations = revocable.length > 0;
  return (
    <SettingsListingSection heading={inviteLinksWords.heading}>
      <SettingsListingTable caption={inviteLinksWords.heading}>
        <InviteLinksHead revocations={revocations} />
        <tbody>
          {props.links.map((link) => (
            <InviteLinkRows
              key={link.link}
              link={link}
              revocable={revocable.includes(link)}
              revocations={revocations}
              revoking={revoking}
              nowMs={nowMs}
            />
          ))}
        </tbody>
      </SettingsListingTable>
    </SettingsListingSection>
  );
}

/** A link's row, and under it what its revocation asks or was refused with. */
function InviteLinkRows(props: Parameters<typeof InviteLinkRow>[0]): ReactNode {
  return (
    <>
      <InviteLinkRow {...props} />
      <InviteLinkAsked
        link={props.link.link}
        columns={inviteLinkColumnsCount + (props.revocations ? 1 : 0)}
        revoking={props.revoking}
      />
    </>
  );
}
