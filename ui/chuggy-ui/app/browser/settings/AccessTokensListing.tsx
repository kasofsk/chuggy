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
import type { Copy, CopyText } from "../../core/copy.ts";
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
import { Pill } from "../ui/Pill.tsx";
import { accessTokensReread } from "./accessTokensResource.ts";
import { SettingsListingTable } from "./SettingsListing.tsx";

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

/** A cell's words over what it holds, drawn only where the row is stacked. */
function AccessTokenCell(props: {
  readonly label: Copy;
  readonly children: ReactNode;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="grid min-w-0 justify-items-start gap-1">
      <span className="people-stacked-label">{text(props.label)}</span>
      {props.children}
    </div>
  );
}

function AccessTokenExpires(props: {
  readonly token: AccessTokenResponse;
  readonly nowMs: number;
}): ReactNode {
  const text = useCopyText();
  const days = accessTokenDaysLeft(props.token.expiresAt, props.nowMs);
  return (
    <AccessTokenCell label={accessTokensWords.expires}>
      <Figure figure={instantFigure(props.token.expiresAt, props.nowMs)} />
      {days === undefined ? null : (
        <span className="text-sm text-ink-3">
          {text(accessTokenDaysLeftLabel(days))}
        </span>
      )}
    </AccessTokenCell>
  );
}

function AccessTokenMaker(props: {
  readonly partition: PartitionIdentity;
  readonly maker: string;
}): ReactNode {
  const names = useCreatorNames(props.partition);
  return (
    <AccessTokenCell label={accessTokensWords.maker}>
      <span className="people-name">
        <Identity label={creatorLabel(props.maker, names)} />
      </span>
    </AccessTokenCell>
  );
}

interface AccessTokenRowDrawn {
  readonly partition: PartitionIdentity;
  readonly token: AccessTokenResponse;
  readonly administer: boolean;
  readonly deleting: AccessTokenDeleting;
  readonly nowMs: number;
}

function AccessTokenRow(props: AccessTokenRowDrawn): ReactNode {
  const text = useCopyText();
  const { token, deleting, nowMs } = props;
  const status = accessTokenStatusAt(token.expiresAt, nowMs);
  return (
    <tr>
      <th scope="row">
        <span className="people-name block" title={token.name}>
          {token.name}
        </span>
      </th>
      <td>
        <AccessTokenCell label={accessTokensWords.access}>
          {text(accessTokenAccessLabel(token.access))}
        </AccessTokenCell>
      </td>
      <td>
        <AccessTokenCell label={accessTokensWords.created}>
          <Figure figure={instantFigure(token.createdAt, nowMs)} />
        </AccessTokenCell>
      </td>
      <td>
        <AccessTokenExpires token={token} nowMs={nowMs} />
      </td>
      <td>
        <Pill tone={accessTokenStatusTone(status)}>
          {text(accessTokenStatusLabel(status))}
        </Pill>
      </td>
      {props.administer ? (
        <td>
          <AccessTokenMaker partition={props.partition} maker={token.maker} />
        </td>
      ) : null}
      <td className="people-edit">
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
      </td>
    </tr>
  );
}

/** Under a token's row: the line a refused deletion left, and the Confirm a
 * deletion waits on. */
function AccessTokenAsked(props: {
  readonly token: AccessTokenResponse;
  readonly columns: number;
  readonly deleting: AccessTokenDeleting;
}): ReactNode {
  const text = useCopyText();
  const { token, deleting } = props;
  const words =
    deleting.note?.token === token.token ? deleting.note.words : undefined;
  const asked = deleting.asking === token.token;
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
      </td>
    </tr>
  );
}

function AccessTokensHead(props: { readonly administer: boolean }): ReactNode {
  const text = useCopyText();
  return (
    <thead>
      <tr>
        <th scope="col">{text(accessTokensWords.name)}</th>
        <th scope="col">{text(accessTokensWords.access)}</th>
        <th scope="col">{text(accessTokensWords.created)}</th>
        <th scope="col">{text(accessTokensWords.expires)}</th>
        <th scope="col" className="people-col-status">
          {text(accessTokensWords.status)}
        </th>
        {props.administer ? (
          <th scope="col">{text(accessTokensWords.maker)}</th>
        ) : null}
        <th scope="col" className="people-col-revoke">
          <span className="visually-hidden">
            {text(accessTokensWords.delete)}
          </span>
        </th>
      </tr>
    </thead>
  );
}

/** The columns every list has, beside Maker. */
const accessTokenColumnsCount = 6;

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
  const columns = accessTokenColumnsCount + (props.administer ? 1 : 0);
  return (
    <SettingsListingTable caption={text(accessTokensWords.title)}>
      <AccessTokensHead administer={props.administer} />
      <tbody>
        {props.tokens.map((token) => (
          <AccessTokenRows
            key={token.token}
            partition={props.partition}
            token={token}
            administer={props.administer}
            deleting={deleting}
            nowMs={props.nowMs}
            columns={columns}
          />
        ))}
      </tbody>
    </SettingsListingTable>
  );
}

function AccessTokenRows(
  props: AccessTokenRowDrawn & { readonly columns: number },
): ReactNode {
  return (
    <>
      <AccessTokenRow {...props} />
      <AccessTokenAsked
        token={props.token}
        columns={props.columns}
        deleting={props.deleting}
      />
    </>
  );
}
