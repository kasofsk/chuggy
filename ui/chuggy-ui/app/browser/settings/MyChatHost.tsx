/**
 * The reader's chat host in this workspace, the one machine of theirs their
 * questions run on and their threads run on first: a row saying when it
 * registered and last polled and whether it is live, and taking it off; and the
 * token a host registers with, which replaces the one they hold.
 *
 * A HOST THE READER HOLDS IS DRAWN WHETHER OR NOT THEY MAY REGISTER ONE NOW, as
 * their runners are, so a member whose permission was taken away can still see
 * and remove theirs.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  ChatHostResponse,
  WorkerPoolTokenResponse,
} from "../../../../../src/contract/responses.ts";
import { useCopyText } from "../../copy/CopyProvider.tsx";
import {
  apiDeregisterChatHost,
  apiMintChatHostToken,
} from "../../core/apiRoutes.ts";
import type { ApiFailure, ApiResult } from "../../core/apiRequest.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteRefused,
} from "../../core/consoleWrite.ts";
import { instantFigure } from "../../core/figures.ts";
import type { Copy } from "../../core/copy.ts";
import { failureWords } from "../../core/failureWords.ts";
import type { PanelState } from "../../core/freshness.ts";
import { myRunnerShort } from "../../core/myRunner.ts";
import {
  runnerStandingLabel,
  runnerTokenLifetimeSecs,
} from "../../core/runners.ts";
import { chatHostQuery } from "../../core/tenantQueries.ts";
import { runnerStandingTone } from "../../core/tones.ts";
import { usePanelState } from "../api.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { useNowMs } from "../Freshness.tsx";
import { RunnerVersion } from "../RunnerVersion.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { CopyBox } from "../ui/CopyBox.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { Pill } from "../ui/Pill.tsx";
import {
  settingsListingNone,
  SettingsListingSection,
  SettingsListingTable,
  SettingsListingUnread,
} from "./SettingsListing.tsx";

/** Answered as absent where the reader registers none. */
export function useChatHost(tenant: string): PanelState<ChatHostResponse> {
  return usePanelState(chatHostQuery(tenant));
}

/** The host read again, after a change to it. */
async function chatHostReread(
  client: QueryClient,
  tenant: string,
): Promise<void> {
  await client.invalidateQueries({
    queryKey: chatHostQuery(tenant).queryKey,
  });
}

function chatHostRefusal(failure: ApiFailure): Copy {
  return failureWords(failure).word;
}

/** The token a host registers with, which changes nothing a read draws until
 * a host registers with it. */
function chatHostMintWrite(
  tenant: string,
): ConsoleWrite<undefined, WorkerPoolTokenResponse> {
  return {
    mutationKey: consoleWriteKey("chat-host-token-mint", tenant),
    write: (ports) =>
      apiMintChatHostToken(ports, tenant, {
        lifetimeSecs: runnerTokenLifetimeSecs,
      }),
    refusal: chatHostRefusal,
  };
}

/** The host taken off, a 404 taken as done already, and read again whatever
 * the removal answered. */
function chatHostRemovalWrite(
  tenant: string,
): ConsoleWrite<undefined, undefined> {
  return {
    mutationKey: consoleWriteKey("chat-host-removal", tenant),
    write: async (ports, _variables, client): Promise<ApiResult<undefined>> => {
      const removed = await apiDeregisterChatHost(ports, tenant);
      await chatHostReread(client, tenant);
      return removed.outcome === "Absent"
        ? { outcome: "Ok", value: undefined }
        : removed;
    },
    refusal: chatHostRefusal,
  };
}

function ChatHostRow(props: {
  readonly host: ChatHostResponse;
  readonly busy: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const text = useCopyText();
  const { host } = props;
  const nowMs = useNowMs();
  const short = myRunnerShort(host.id);
  const standing = host.live ? "Live" : "Offline";
  return (
    <tr>
      <th scope="row">
        <span className="people-name block font-strong text-ink-1">
          <span title={host.id}>{short}</span>
        </span>
      </th>
      <td data-none={settingsListingNone(host.runner === undefined)}>
        <span className="people-stacked-label">
          {text({ id: "runners-col-version" })}
        </span>
        <RunnerVersion runner={host.runner} named />
      </td>
      <td>
        <span className="people-stacked-label">
          {text({ id: "runners-col-registered" })}
        </span>
        <Figure figure={instantFigure(host.registeredAt, nowMs)} />
      </td>
      <td>
        <span className="people-stacked-label">
          {text({ id: "runners-col-last-polled" })}
        </span>
        {host.polledAt === undefined ? (
          text({ id: "runners-never" })
        ) : (
          <Figure figure={instantFigure(host.polledAt, nowMs)} />
        )}
      </td>
      <td>
        <Pill tone={runnerStandingTone(standing)}>
          {text(runnerStandingLabel(standing))}
        </Pill>
      </td>
      <td className="people-edit">
        <Button
          variant="quiet"
          size="sm"
          named={text({
            id: "runners-chat-host-remove-named",
            args: { short },
          })}
          disabled={props.busy}
          onClick={props.onRemove}
        >
          {text({ id: "runners-remove" })}
        </Button>
      </td>
    </tr>
  );
}

/** The head of a listing of a member's registered hosts: runners, or a chat host. */
export function HostListingHead(props: { readonly name: string }): ReactNode {
  const text = useCopyText();
  return (
    <thead>
      <tr>
        <th scope="col">{props.name}</th>
        <th scope="col">{text({ id: "runners-col-version" })}</th>
        <th scope="col" className="w-[9em]">
          {text({ id: "runners-col-registered" })}
        </th>
        <th scope="col" className="w-[9em]">
          {text({ id: "runners-col-last-polled" })}
        </th>
        <th scope="col" className="people-col-status">
          {text({ id: "runners-col-status" })}
        </th>
        <th scope="col" className="w-[8em]">
          <span className="visually-hidden">
            {text({ id: "runners-col-remove" })}
          </span>
        </th>
      </tr>
    </thead>
  );
}

function ChatHostTable(props: {
  readonly host: ChatHostResponse;
  readonly busy: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const text = useCopyText();
  const title = text({ id: "runners-chat-host-title" });
  return (
    <SettingsListingTable caption={title}>
      <HostListingHead name={title} />
      <tbody>
        <ChatHostRow
          host={props.host}
          busy={props.busy}
          onRemove={props.onRemove}
        />
      </tbody>
    </SettingsListingTable>
  );
}

function ChatHostMinted(props: {
  readonly minted: WorkerPoolTokenResponse;
  /** The short id of the host the reader holds, where they hold one. */
  readonly short: string | undefined;
  readonly onDone: () => void;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  return (
    <div className="grid min-w-0 gap-2">
      <CopyBox
        about={
          <>
            {text({ id: "runners-chat-host-token-about" })}{" "}
            <Figure
              figure={instantFigure(
                new Date(props.minted.expiresAtMs).toISOString(),
                nowMs,
              )}
            />
          </>
        }
        text={props.minted.token}
        copyLabel={text({ id: "runners-chat-host-copy-token" })}
      />
      {props.short === undefined ? null : (
        <p className="text-sm text-ink-3">
          {text({
            id: "runners-chat-host-replaces",
            args: { short: props.short },
          })}
        </p>
      )}
      <div>
        <Button size="sm" onClick={props.onDone}>
          {text({ id: "runners-done" })}
        </Button>
      </div>
    </div>
  );
}

/** What the last change left: the token minted with its expiry, the question a removal waits on, or why it was refused. */
function ChatHostWritten(props: {
  readonly writing: ChatHostWriting;
  /** The short id of the host the reader holds, where they hold one. */
  readonly short: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const { writing, short } = props;
  const minted = writing.minting.data;
  if (writing.asking)
    return (
      <Confirm
        question={text({
          id: "runners-chat-host-remove-question",
          args: { short: short ?? "" },
        })}
        confirm={text({ id: "runners-remove" })}
        busy={false}
        onConfirm={writing.remove}
        onCancel={writing.done}
      >
        {text({
          id: "runners-chat-host-removal",
          args: { short: short ?? "" },
        })}
      </Confirm>
    );
  if (minted !== undefined)
    return (
      <ChatHostMinted minted={minted} short={short} onDone={writing.done} />
    );
  return writing.refused === undefined ? null : (
    <Notice tone="danger" inline>
      <ConsoleWriteRefusedWords refused={writing.refused} />
    </Notice>
  );
}

/** One change at a time: a token minted, or the host taken off once asked,
 * and the refusal of the last pressed. */
interface ChatHostWriting {
  readonly minting: ConsoleWriting<undefined, WorkerPoolTokenResponse>;
  readonly asking: boolean;
  readonly refused: ConsoleWriteRefused | undefined;
  readonly busy: boolean;
  readonly mint: () => void;
  readonly ask: () => void;
  readonly remove: () => void;
  readonly done: () => void;
}

function useChatHostWriting(tenant: string): ChatHostWriting {
  const client = useQueryClient();
  const [asking, setAsking] = useState(false);
  const minting = useConsoleWrite(chatHostMintWrite(tenant), { drawn: true });
  const removing = useConsoleWrite(chatHostRemovalWrite(tenant), {
    drawn: true,
  });
  return {
    minting,
    asking,
    refused: minting.error ?? removing.error ?? undefined,
    busy:
      asking || minting.isPending || minting.isSuccess || removing.isPending,
    mint: () => {
      removing.reset();
      minting.mutate(undefined);
    },
    ask: () => {
      minting.reset();
      removing.reset();
      setAsking(true);
    },
    remove: () => {
      setAsking(false);
      removing.mutate(undefined);
    },
    done: () => {
      minting.reset();
      setAsking(false);
      void chatHostReread(client, tenant);
    },
  };
}

/** The reader's chat host, and its registration where the workspace lets them register one. */
export function MyChatHost(props: {
  readonly tenant: string;
  readonly host: PanelState<ChatHostResponse>;
  readonly granted: boolean;
}): ReactNode {
  const text = useCopyText();
  const writing = useChatHostWriting(props.tenant);
  const { host } = props;
  const held = host.state === "Ready" ? host.value : undefined;
  const empty = text({ id: "runners-chat-host-empty" });
  return (
    <SettingsListingSection
      heading={text({ id: "runners-chat-host-title" })}
      about={text({ id: "runners-chat-host-about" })}
      action={
        props.granted ? (
          <Button
            size="sm"
            variant={host.state === "Absent" ? "primary" : "default"}
            disabled={writing.busy}
            onClick={writing.mint}
          >
            {text({ id: "runners-chat-host-register" })}
          </Button>
        ) : null
      }
    >
      <ChatHostWritten
        writing={writing}
        short={held === undefined ? undefined : myRunnerShort(held.id)}
      />
      {held !== undefined ? (
        <ChatHostTable host={held} busy={writing.busy} onRemove={writing.ask} />
      ) : host.state === "Absent" ? (
        <EmptyState label={empty} />
      ) : (
        <SettingsListingUnread state={host} withheld={empty} />
      )}
    </SettingsListingSection>
  );
}
