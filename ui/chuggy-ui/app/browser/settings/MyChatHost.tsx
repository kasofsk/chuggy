/**
 * The reader's chat host in this workspace, the one machine of theirs their
 * questions run on and their threads run on first: a row saying when it
 * registered and last polled, whether it is live and what the threads it hosts
 * may do, and taking it off; and the
 * registration of a host on the machine the reader chooses, which replaces the
 * one they hold: on Linux the line that has Claude Code make the machine it,
 * and on either machine the steps that do it by hand.
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
import {
  claudeCodeChatHostLine,
  claudeCodeChatHostLineAbout,
  claudeCodeLineCopy,
} from "../../core/claudeCodeLine.ts";
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
import type { RunnerPackageName } from "../../core/runners.ts";
import { sessionCapabilitiesSaid } from "../../core/sessionCapabilities.ts";
import { chatHostQuery } from "../../core/tenantQueries.ts";
import { runnerStandingTone } from "../../core/tones.ts";
import { usePanelState } from "../api.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import type { ConsoleWriting } from "../consoleWrite.tsx";
import { useNowMs } from "../Freshness.tsx";
import { currentOrigin } from "../ports.ts";
import { RunnerMachine } from "../RunnerAsk.tsx";
import { RunnerSteps, useFocusedUnheld } from "../RunnerSteps.tsx";
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

/** The token a host registers with, for the machine it is handed over for,
 * which changes nothing a read draws until a host registers with it. */
function chatHostMintWrite(
  tenant: string,
): ConsoleWrite<RunnerPackageName, WorkerPoolTokenResponse> {
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

/** What the threads the host runs may do, as its newest poll named it. */
function ChatHostThreadsMay(props: {
  readonly host: ChatHostResponse;
}): ReactNode {
  const text = useCopyText();
  const named = props.host.sessionCapabilities;
  return (
    <span className="block text-sm text-ink-3">
      {named === undefined
        ? text({ id: "runners-chat-host-threads-whole" })
        : text({
            id: "runners-chat-host-threads",
            args: { capabilities: sessionCapabilitiesSaid(text, named) },
          })}
    </span>
  );
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
        <ChatHostThreadsMay host={host} />
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
export function HostListingHead(props: {
  readonly name: string;
  /** The column what a host is running is drawn in, beside its name, where it has one. */
  readonly running?: string;
}): ReactNode {
  const text = useCopyText();
  return (
    <thead>
      <tr>
        <th scope="col">{props.name}</th>
        {props.running === undefined ? null : (
          <th scope="col">{props.running}</th>
        )}
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

/** The line that has Claude Code make the machine it is pasted on the reader's chat host. */
function ChatHostClaudeCode(props: { readonly tenant: string }): ReactNode {
  const text = useCopyText();
  return (
    <div className="w-full max-w-aside">
      <CopyBox
        about={text(claudeCodeChatHostLineAbout)}
        text={claudeCodeChatHostLine(currentOrigin(), props.tenant)}
        copyLabel={text(claudeCodeLineCopy)}
        breaks="words"
      />
    </div>
  );
}

/** The machine chosen before the token is minted, and why a mint was refused. */
function ChatHostAsk(props: { readonly writing: ChatHostWriting }): ReactNode {
  const [chosen, setChosen] = useState<RunnerPackageName>("linux");
  const { minting } = props.writing;
  const form = useFocusedUnheld<HTMLFormElement>();
  const text = useCopyText();
  return (
    <form
      ref={form}
      tabIndex={-1}
      aria-label={text({ id: "runners-chat-host-title" })}
      className="border-edge grid min-w-0 justify-items-start gap-3 border-b pt-3 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        minting.mutate(chosen);
      }}
    >
      <RunnerMachine chosen={chosen} onChoose={setChosen} />
      {minting.error === null ? null : (
        <Notice tone="danger" inline>
          <ConsoleWriteRefusedWords refused={minting.error} />
        </Notice>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          type="submit"
          busy={minting.isPending}
          disabled={minting.isPending}
        >
          {text({ id: "runners-ask-create" })}
        </Button>
        <Button
          size="sm"
          disabled={minting.isPending}
          onClick={props.writing.done}
        >
          {text({ id: "runners-ask-cancel" })}
        </Button>
      </div>
    </form>
  );
}

/** The token handed over for the machine chosen: on Linux the line first,
 * then the steps that do it by hand. */
function ChatHostMinted(props: {
  readonly tenant: string;
  readonly minted: WorkerPoolTokenResponse;
  readonly chosen: RunnerPackageName;
  /** The short id of the host the reader holds, where they hold one. */
  readonly short: string | undefined;
  readonly onDone: () => void;
}): ReactNode {
  const text = useCopyText();
  return (
    <div className="grid min-w-0 gap-2">
      {props.chosen === "linux" ? (
        <ChatHostClaudeCode tenant={props.tenant} />
      ) : null}
      {props.short === undefined ? null : (
        <p className="text-sm text-ink-3">
          {text({
            id: "runners-chat-host-replaces",
            args: { short: props.short },
          })}
        </p>
      )}
      <RunnerSteps
        minted={props.minted}
        ask={{ package: props.chosen, host: false, capabilities: [] }}
        kind="ChatHost"
        onDone={props.onDone}
      />
    </div>
  );
}

/** What the last change left: the machine asked for, the token minted for it, the question a removal waits on, or why it was refused. */
function ChatHostWritten(props: {
  readonly tenant: string;
  readonly writing: ChatHostWriting;
  /** The short id of the host the reader holds, where they hold one. */
  readonly short: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const { writing, short } = props;
  const { data: minted, variables: chosen } = writing.minting;
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
  if (minted !== undefined && chosen !== undefined)
    return (
      <ChatHostMinted
        tenant={props.tenant}
        minted={minted}
        chosen={chosen}
        short={short}
        onDone={writing.done}
      />
    );
  if (writing.choosing) return <ChatHostAsk writing={writing} />;
  return writing.refused === undefined ? null : (
    <Notice tone="danger" inline>
      <ConsoleWriteRefusedWords refused={writing.refused} />
    </Notice>
  );
}

/** One change at a time: a token minted for the machine chosen, or the host
 * taken off once asked, and the refusal of the last pressed. */
interface ChatHostWriting {
  readonly minting: ConsoleWriting<RunnerPackageName, WorkerPoolTokenResponse>;
  /** Whether the machine a token is minted for is being chosen. */
  readonly choosing: boolean;
  readonly asking: boolean;
  readonly refused: ConsoleWriteRefused | undefined;
  readonly busy: boolean;
  readonly choose: () => void;
  readonly ask: () => void;
  readonly remove: () => void;
  readonly done: () => void;
}

function useChatHostWriting(tenant: string): ChatHostWriting {
  const client = useQueryClient();
  const [choosing, setChoosing] = useState(false);
  const [asking, setAsking] = useState(false);
  const minting = useConsoleWrite(chatHostMintWrite(tenant), { drawn: true });
  const removing = useConsoleWrite(chatHostRemovalWrite(tenant), {
    drawn: true,
  });
  return {
    minting,
    choosing,
    asking,
    refused: minting.error ?? removing.error ?? undefined,
    busy:
      choosing ||
      asking ||
      minting.isPending ||
      minting.isSuccess ||
      removing.isPending,
    choose: () => {
      minting.reset();
      removing.reset();
      setChoosing(true);
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
      setChoosing(false);
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
            onClick={writing.choose}
          >
            {text({ id: "runners-chat-host-register" })}
          </Button>
        ) : null
      }
    >
      <ChatHostWritten
        tenant={props.tenant}
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
