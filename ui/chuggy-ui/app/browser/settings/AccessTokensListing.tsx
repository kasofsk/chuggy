/**
 * A project's access tokens as the reader may see them, newest first as the
 * API lists them: one row a token, saying what it may do, when it was made,
 * when it expires and where it stands, who made it to a reader who
 * administers the project, and its deletion.
 *
 * Every row offers Delete, because a reader is listed only the tokens they
 * made unless they administer the project, and either may delete. The API
 * decides a deletion: a token already gone is read again and nothing is said,
 * and any other refusal is one line under its row.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { AccessTokenResponse } from "../../../../../src/contract/accessToken.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  accessTokenAccessLabel,
  accessTokenDaysLeft,
  accessTokenDaysLeftLabel,
  accessTokenDeletionNote,
  accessTokenDeletionQuestion,
  accessTokenStatusAt,
  accessTokenStatusLabel,
  accessTokensWords,
} from "../../core/accessTokens.ts";
import { apiDeleteAccessToken } from "../../core/apiRoutes.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import type { CopyText } from "../../core/copy.ts";
import { instantFigure } from "../../core/figures.ts";
import { creatorLabel } from "../../core/labels.ts";
import { accessFailureLabel } from "../../core/tenantPeople.ts";
import { accessTokenStatusTone } from "../../core/tones.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { useCreatorNames } from "../creatorNames.ts";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Identity } from "../ui/Identity.tsx";
import { Notice } from "../ui/Notice.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import type { TableColumn, TableRow } from "../ui/Table.tsx";
import { accessTokensReread } from "./accessTokensResource.ts";
import { SettingsListingStacked } from "./SettingsListing.tsx";

import "./tenantPeople.css";

/** One token deleted: one done or already gone is over once the list has
 * answered again, and any other refusal lands once it has. */
function accessTokenDeletionWrite(
  partition: PartitionIdentity,
  text: CopyText,
): ConsoleWrite<string, undefined> {
  return {
    mutationKey: consoleWriteKey(
      "access-token-deletion",
      partition.tenant,
      partition.project,
    ),
    write: async (ports, token, client) => {
      const answered = await apiDeleteAccessToken(ports, partition, token);
      if (accessTokenDeletionNote(answered) === undefined)
        return { outcome: "Ok", value: undefined };
      await accessTokensReread(client, partition);
      return answered;
    },
    refusal: (failure) => text(accessFailureLabel(failure)),
    landed: (client) => accessTokensReread(client, partition),
  };
}

interface AccessTokenDeleting {
  /** The token whose deletion is asked and not yet sent or answered. */
  readonly asking: string | undefined;
  readonly busy: boolean;
  /** The line the last refused deletion left, and the token it was of. */
  readonly note: { readonly token: string; readonly words: string } | undefined;
  readonly press: (token: string) => void;
  readonly cancel: () => void;
  readonly send: (token: string) => void;
}

/** One deletion at a time, from its press through its Confirm to its answer,
 * whose refusal is drawn under its row while `tokens` holds it. */
function useAccessTokenDeleting(
  partition: PartitionIdentity,
  tokens: readonly AccessTokenResponse[],
): AccessTokenDeleting {
  const text = useCopyText();
  const deleting = useConsoleWrite(accessTokenDeletionWrite(partition, text), {
    drawn: (_, deleted) => tokens.some((token) => token.token === deleted),
  });
  const [asking, setAsking] = useState<string | undefined>(undefined);
  const refused = deleting.error;
  const deleted = deleting.variables;
  return {
    asking,
    busy: deleting.isPending,
    note:
      refused === null || deleted === undefined
        ? undefined
        : { token: deleted, words: refused.message },
    press: (token) => {
      deleting.reset();
      setAsking(token);
    },
    cancel: () => {
      setAsking(undefined);
    },
    send: (token) => {
      deleting.mutate(token, {
        onSettled: () => {
          setAsking(undefined);
        },
      });
    },
  };
}

function AccessTokenExpires(props: {
  readonly token: AccessTokenResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const days = accessTokenDaysLeft(props.token.expiresAt, props.nowMs);
  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      <Figure figure={instantFigure(props.token.expiresAt, props.nowMs)} />
      {days === undefined ? null : (
        <span className="text-sm text-ink-3">
          {text(accessTokenDaysLeftLabel(days))}
        </span>
      )}
    </div>
  );
}

function AccessTokenMaker(props: {
  readonly partition: PartitionIdentity;
  readonly maker: string;
}): ReactNode {
  const names = useCreatorNames(props.partition);
  return (
    <span className="tabular-cut">
      <Identity label={creatorLabel(props.maker, names)} />
    </span>
  );
}

/** Under a token's row: the line a refused deletion left, and the Confirm a
 * deletion waits on. */
function AccessTokenAsked(props: {
  readonly token: AccessTokenResponse;
  readonly deleting: AccessTokenDeleting;
}): ReactNode {
  const text = useCopyText();
  const { token, deleting } = props;
  const words =
    deleting.note?.token === token.token ? deleting.note.words : undefined;
  const asked = deleting.asking === token.token;
  return (
    <div className="ms-auto grid max-w-aside gap-2">
      {words === undefined ? null : (
        <Notice tone="danger" inline role="status" detail={words} />
      )}
      {asked ? (
        <Confirm
          question={text(accessTokenDeletionQuestion(token.name))}
          confirm={text(accessTokensWords.delete)}
          busy={deleting.busy}
          onConfirm={() => {
            deleting.send(token.token);
          }}
          onCancel={deleting.cancel}
        >
          {text(accessTokensWords.deleteLine)}
        </Confirm>
      ) : null}
    </div>
  );
}

type AccessTokenColumnKey =
  "name" | "access" | "created" | "expires" | "status" | "maker" | "delete";

/** The columns a list draws, Made by among them to a reader who administers
 * the project. */
function accessTokenColumns(
  administer: boolean,
  text: CopyText,
): readonly TableColumn<AccessTokenColumnKey>[] {
  return [
    { key: "name", label: text(accessTokensWords.name), rowHeader: true },
    {
      key: "access",
      label: text(accessTokensWords.access),
      headClassName: "people-col-access",
    },
    {
      key: "created",
      label: text(accessTokensWords.created),
      headClassName: "people-col-when",
    },
    {
      key: "expires",
      label: text(accessTokensWords.expires),
      headClassName: "people-col-when",
    },
    {
      key: "status",
      label: text(accessTokensWords.status),
      headClassName: "people-col-status",
    },
    ...(administer
      ? [{ key: "maker", label: text(accessTokensWords.maker) } as const]
      : []),
    {
      key: "delete",
      label: text(accessTokensWords.delete),
      actions: true,
      headClassName: "people-col-revoke",
    },
  ];
}

interface AccessTokenRowDrawn {
  readonly partition: PartitionIdentity;
  readonly deleting: AccessTokenDeleting;
  readonly nowMs: number;
  readonly text: CopyText;
}

function accessTokenRow(
  token: AccessTokenResponse,
  drawn: AccessTokenRowDrawn,
): TableRow<AccessTokenColumnKey> {
  const { deleting, nowMs, text } = drawn;
  const status = accessTokenStatusAt(token.expiresAt, nowMs);
  return {
    key: token.token,
    cells: {
      name: (
        <span className="tabular-cut" title={token.name}>
          {token.name}
        </span>
      ),
      access: text(accessTokenAccessLabel(token.access)),
      created: <Figure figure={instantFigure(token.createdAt, nowMs)} />,
      expires: <AccessTokenExpires token={token} nowMs={nowMs} />,
      status: (
        <StatusBadge tone={accessTokenStatusTone(status)} size="small">
          {text(accessTokenStatusLabel(status))}
        </StatusBadge>
      ),
      maker: (
        <AccessTokenMaker partition={drawn.partition} maker={token.maker} />
      ),
      delete: (
        <Button
          variant="quiet"
          size="sm"
          disabled={deleting.busy || deleting.asking !== undefined}
          onClick={() => {
            deleting.press(token.token);
          }}
        >
          {text(accessTokensWords.delete)}
        </Button>
      ),
    },
    below:
      deleting.asking === token.token ||
      deleting.note?.token === token.token ? (
        <AccessTokenAsked token={token} deleting={deleting} />
      ) : undefined,
  };
}

/** Drawn only where the list has a token in it. */
export function AccessTokensListing(props: {
  readonly partition: PartitionIdentity;
  readonly tokens: readonly AccessTokenResponse[];
  /** Whether the reader administers the project, which is whether Maker is drawn. */
  readonly administer: boolean;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const deleting = useAccessTokenDeleting(props.partition, props.tokens);
  return (
    <SettingsListingStacked
      className="people-table"
      caption={text(accessTokensWords.title)}
      columns={accessTokenColumns(props.administer, text)}
      rows={props.tokens.map((token) =>
        accessTokenRow(token, {
          partition: props.partition,
          deleting,
          nowMs: props.nowMs,
          text,
        }),
      )}
    />
  );
}
