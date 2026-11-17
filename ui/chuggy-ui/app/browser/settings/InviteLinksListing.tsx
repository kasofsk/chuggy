/**
 * What became of each invite link a list holds, a workspace's or the site's:
 * one row a link, in the plane's order, saying where it stands and who made
 * it, and offering its revocation where it is open and the reader's to end.
 *
 * The two lists differ in what a row is headed by and in what its third
 * column says, in which revocation is sent and in which read follows it, so
 * those are what a caller hands this, and everything else is drawn once. The
 * plane decides a revocation: a link that ended while the row stood is read
 * again and nothing is said, and any other refusal is one line under its row.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type { AccessInviteLink } from "../../../../../src/contract/accessPlane.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import type { ApiPorts, ApiResult } from "../../core/apiRequest.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import type { Copy, CopyText } from "../../core/copy.ts";
import { instantFigureAtMs } from "../../core/figures.ts";
import {
  inviteLinkRevocationNote,
  inviteLinkRevocationQuestion,
  inviteLinkStateLabel,
  inviteLinksWords,
} from "../../core/inviteLinks.ts";
import {
  accessFailureLabel,
  tenantPersonName,
} from "../../core/tenantPeople.ts";
import type { TenantSubject } from "../../core/tenantPeople.ts";
import { inviteLinkStateTone } from "../../core/tones.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { useNowMs } from "../Freshness.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import type { TableColumn, TableRow } from "../ui/Table.tsx";
import {
  SettingsListingNone,
  SettingsListingSection,
  SettingsListingStacked,
} from "./SettingsListing.tsx";

import "./tenantPeople.css";
import { Tooltip } from "../ui/Tooltip.tsx";

/** What a link holds whichever list it is in. */
export type InviteLinkListed = Pick<
  AccessInviteLink,
  "link" | "state" | "mintedBy" | "mintedAtMs" | "expiresAtMs"
>;

/** A column a list draws its own way: its word, and what it draws of one link, which is nothing where the link has nothing there. */
export interface InviteLinkColumn<Link> {
  readonly heading: Copy;
  readonly cell: (link: Link, nowMs: number) => ReactNode;
}

/** What one list hands the frame: its two columns, which links it may revoke, and the write that revokes one. */
export interface InviteLinksListed<Link extends InviteLinkListed> {
  readonly links: readonly Link[];
  /** What the list is headed, where it names its links for what they are for. */
  readonly heading?: Copy;
  readonly first: InviteLinkColumn<Link>;
  readonly third: InviteLinkColumn<Link>;
  readonly revocable: (link: Link) => boolean;
  readonly revocation: ConsoleWrite<string, undefined>;
}

/** One list's revocation of a link, keyed under `named`: one done or of a
 * link already ended is over once the list has answered again, and any other
 * refusal lands once the list has answered again, so it is asked whether it is
 * drawn of the list that reread left. */
export function inviteLinkRevocationWrite(
  named: readonly string[],
  revoke: (ports: ApiPorts, link: string) => Promise<ApiResult<undefined>>,
  reread: (client: QueryClient) => Promise<void>,
  text: CopyText,
): ConsoleWrite<string, undefined> {
  return {
    mutationKey: consoleWriteKey(...named),
    write: async (ports, link, client) => {
      const answered = await revoke(ports, link);
      if (inviteLinkRevocationNote(answered) === undefined)
        return { outcome: "Ok", value: undefined };
      await reread(client);
      return answered;
    },
    refusal: (failure) => text(accessFailureLabel(failure)),
    landed: (client) => reread(client),
  };
}

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
 * answer, whose refusal is drawn under its row while `links` holds it. */
function useInviteLinkRevoking(
  revocation: ConsoleWrite<string, undefined>,
  links: readonly InviteLinkListed[],
): InviteLinkRevoking {
  const revoking = useConsoleWrite(revocation, {
    drawn: (_, revoked) => links.some((link) => link.link === revoked),
  });
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const refused = revoking.error;
  const revoked = revoking.variables;
  return {
    asking,
    busy: revoking.isPending,
    note:
      refused === null || revoked === undefined
        ? undefined
        : { link: revoked, words: refused.message },
    press: (link) => {
      revoking.reset();
      setAsking(link);
    },
    cancel: () => {
      setAsking(undefined);
    },
    send: (link) => {
      revoking.mutate(link, {
        onSettled: () => {
          setAsking(undefined);
        },
      });
    },
  };
}

/** Who made or used a link and when, down a narrow column: the name cut short
 * on a line as a person's row cuts it. */
export function InviteLinkWho(props: {
  readonly person: TenantSubject;
  readonly atMs: number;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const named = tenantPersonName(props.person);
  return (
    <div className="grid min-w-0">
      {named.subject ? (
        <span className="tabular-cut">
          <Identity label={{ text: named.name, title: named.name }} />
        </span>
      ) : (
        <Tooltip trigger="abbreviation" text={named.name}>
          <span className="tabular-cut">{named.name}</span>
        </Tooltip>
      )}
      {named.githubLogin === undefined ? null : (
        <span className="truncate text-sm text-ink-3">{named.githubLogin}</span>
      )}
      {named.noAccount ? (
        <span className="text-sm text-ink-3">
          {text({ id: "permissions-person-unaccounted" })}
        </span>
      ) : null}
      <span className="text-sm text-ink-3">
        <Figure figure={instantFigureAtMs(props.atMs, props.nowMs)} />
      </span>
    </div>
  );
}

function InviteLinkStatus(props: {
  readonly link: InviteLinkListed;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const link = props.link;
  return (
    <div className="grid justify-items-start gap-1">
      <StatusBadge tone={inviteLinkStateTone(link.state)} size="small">
        {text(inviteLinkStateLabel(link.state))}
      </StatusBadge>
      {link.state === "Open" ? (
        <span className="text-sm text-ink-3">
          {text(inviteLinksWords.expires)}{" "}
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
  readonly revoking: InviteLinkRevoking;
}): ReactNode {
  const text = useCopyText();
  const { link, revoking } = props;
  const words = revoking.note?.link === link ? revoking.note.words : undefined;
  const asked = revoking.asking === link;
  return (
    <div className="ms-auto grid max-w-aside gap-2">
      {words === undefined ? null : (
        <Notice tone="danger" inline role="status" detail={words} />
      )}
      {asked ? (
        <Confirm
          question={text(inviteLinkRevocationQuestion.question)}
          confirm={text(inviteLinksWords.revoke)}
          busy={revoking.busy}
          onConfirm={() => {
            revoking.send(link);
          }}
          onCancel={revoking.cancel}
        >
          {text(inviteLinkRevocationQuestion.line)}
        </Confirm>
      ) : null}
    </div>
  );
}

type InviteLinkColumnKey = "first" | "status" | "third" | "made" | "revoke";

/** The columns a list draws, its revocations last where the reader has any. */
function inviteLinkColumns(
  first: Copy,
  third: Copy,
  revocations: boolean,
  text: CopyText,
): readonly TableColumn<InviteLinkColumnKey>[] {
  const columns: TableColumn<InviteLinkColumnKey>[] = [
    { key: "first", label: text(first), rowHeader: true },
    {
      key: "status",
      label: text(inviteLinksWords.status),
      headClassName: "people-col-status",
    },
    { key: "third", label: text(third), headClassName: "people-col-who" },
    {
      key: "made",
      label: text(inviteLinksWords.madeBy),
      headClassName: "people-col-who",
    },
  ];
  if (revocations)
    columns.push({
      key: "revoke",
      label: text(inviteLinksWords.revoke),
      actions: true,
      headClassName: "people-col-revoke",
    });
  return columns;
}

function inviteLinkRow<Link extends InviteLinkListed>(
  link: Link,
  drawn: {
    readonly listed: InviteLinksListed<Link>;
    readonly revocable: boolean;
    readonly revoking: InviteLinkRevoking;
    readonly nowMs: number;
    readonly text: CopyText;
  },
): TableRow<InviteLinkColumnKey> {
  const { listed, revoking, nowMs, text } = drawn;
  const third = listed.third.cell(link, nowMs);
  return {
    key: link.link,
    cells: {
      first: listed.first.cell(link, nowMs),
      status: <InviteLinkStatus link={link} nowMs={nowMs} />,
      third: third === undefined ? <SettingsListingNone /> : third,
      made: (
        <InviteLinkWho
          person={link.mintedBy}
          atMs={link.mintedAtMs}
          nowMs={nowMs}
        />
      ),
      revoke: drawn.revocable ? (
        <Button
          variant="quiet"
          size="sm"
          disabled={revoking.busy || revoking.asking !== undefined}
          onClick={() => {
            revoking.press(link.link);
          }}
        >
          {text(inviteLinksWords.revoke)}
        </Button>
      ) : null,
    },
    empty: [
      ...(third === undefined ? (["third"] as const) : []),
      ...(drawn.revocable ? [] : (["revoke"] as const)),
    ],
    below:
      revoking.asking === link.link || revoking.note?.link === link.link ? (
        <InviteLinkAsked link={link.link} revoking={revoking} />
      ) : undefined,
  };
}

/** Drawn only where the list has a link in it. */
export function InviteLinksListing<Link extends InviteLinkListed>(
  props: InviteLinksListed<Link>,
): ReactNode {
  const text = useCopyText();
  const revoking = useInviteLinkRevoking(props.revocation, props.links);
  const nowMs = useNowMs();
  if (props.links.length === 0) return null;
  const revocable = props.links.filter((link) => props.revocable(link));
  const heading = text(props.heading ?? inviteLinksWords.heading);
  return (
    <SettingsListingSection heading={heading}>
      <SettingsListingStacked
        className="people-table"
        caption={heading}
        columns={inviteLinkColumns(
          props.first.heading,
          props.third.heading,
          revocable.length > 0,
          text,
        )}
        rows={props.links.map((link) =>
          inviteLinkRow(link, {
            listed: props,
            revocable: revocable.includes(link),
            revoking,
            nowMs,
            text,
          }),
        )}
      />
    </SettingsListingSection>
  );
}
