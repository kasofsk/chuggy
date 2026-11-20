/**
 * The reader's chat host in this workspace, the one machine of theirs their
 * questions run on and their threads run on first: a row saying when it
 * registered and last polled, whether it is live and what the threads it hosts
 * may do, and taking it off; and the
 * registration of a host, which replaces the one they hold: the line that has
 * their coding agent make the machine it is pasted on their host, and folded
 * under it the steps that do it by hand on the machine they choose.
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
import { claudeCodeChatHostLine } from "../../core/claudeCodeLine.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type {
  ConsoleWrite,
  ConsoleWriteRefused,
} from "../../core/consoleWrite.ts";
import { instantFigure } from "../../core/figures.ts";
import type { Copy, CopyText } from "../../core/copy.ts";
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
import { RunnerRegister } from "../RunnerRegister.tsx";
import { RunnerSteps } from "../RunnerSteps.tsx";
import { RunnerVersion } from "../RunnerVersion.tsx";
import { Button } from "../ui/Button.tsx";
import { Confirm } from "../ui/Confirm.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Figure } from "../ui/Figure.tsx";
import { Notice } from "../ui/Notice.tsx";
import { StatusBadge } from "../ui/StatusBadge.tsx";
import {
  SettingsListingSection,
  SettingsListingStacked,
  SettingsListingUnread,
} from "./SettingsListing.tsx";

import "./tenantPeople.css";
import { Tooltip } from "../ui/Tooltip.tsx";

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
    <span className="block text-sm font-regular text-ink-3">
      {named === undefined
        ? text({ id: "runners-chat-host-threads-whole" })
        : text({
            id: "runners-chat-host-threads",
            args: { capabilities: sessionCapabilitiesSaid(text, named) },
          })}
    </span>
  );
}

type ChatHostColumn =
  "host" | "version" | "registered" | "polled" | "status" | "remove";

function chatHostCells(
  host: ChatHostResponse,
  removal: { readonly busy: boolean; readonly onRemove: () => void },
  nowMs: number,
  text: CopyText,
): Readonly<Record<ChatHostColumn, ReactNode>> {
  const short = myRunnerShort(host.id);
  const standing = host.live ? "Live" : "Offline";
  return {
    host: (
      <>
        <span className="tabular-cut block font-strong text-ink-1">
          <Tooltip trigger="abbreviation" text={host.id}>
            <span>{short}</span>
          </Tooltip>
        </span>
        <ChatHostThreadsMay host={host} />
      </>
    ),
    version: <RunnerVersion runner={host.runner} named />,
    registered: <Figure figure={instantFigure(host.registeredAt, nowMs)} />,
    polled:
      host.polledAt === undefined ? (
        text({ id: "runners-never" })
      ) : (
        <Figure figure={instantFigure(host.polledAt, nowMs)} />
      ),
    status: (
      <StatusBadge tone={runnerStandingTone(standing)} size="small">
        {text(runnerStandingLabel(standing))}
      </StatusBadge>
    ),
    remove: (
      <Button
        variant="quiet"
        size="sm"
        named={text({ id: "runners-chat-host-remove-named", args: { short } })}
        disabled={removal.busy}
        onClick={removal.onRemove}
      >
        {text({ id: "runners-remove" })}
      </Button>
    ),
  };
}

function ChatHostTable(props: {
  readonly host: ChatHostResponse;
  readonly busy: boolean;
  readonly onRemove: () => void;
}): ReactNode {
  const text = useCopyText();
  const nowMs = useNowMs();
  const { host } = props;
  const title = text({ id: "runners-chat-host-title" });
  return (
    <SettingsListingStacked
      className="people-table"
      caption={title}
      columns={[
        { key: "host", label: title, rowHeader: true },
        { key: "version", label: text({ id: "runners-col-version" }) },
        {
          key: "registered",
          label: text({ id: "runners-col-registered" }),
          headClassName: "w-[9em]",
        },
        {
          key: "polled",
          label: text({ id: "runners-col-last-polled" }),
          headClassName: "w-[9em]",
        },
        {
          key: "status",
          label: text({ id: "runners-col-status" }),
          headClassName: "people-col-status",
        },
        {
          key: "remove",
          label: text({ id: "runners-col-remove" }),
          actions: true,
          headClassName: "w-[8em]",
        },
      ]}
      rows={[
        {
          key: host.id,
          cells: chatHostCells(host, props, nowMs, text),
          empty: host.runner === undefined ? ["version"] : [],
        },
      ]}
    />
  );
}

/** The machine chosen before the token is minted, and why a mint was refused. */
function ChatHostAsk(props: { readonly writing: ChatHostWriting }): ReactNode {
  const [chosen, setChosen] = useState<RunnerPackageName>("linux");
  const { minting } = props.writing;
  const text = useCopyText();
  return (
    <form
      aria-label={text({ id: "runners-chat-host-title" })}
      className="grid min-w-0 justify-items-start gap-3"
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
      <Button
        size="sm"
        variant="primary"
        type="submit"
        busy={minting.isPending}
        disabled={minting.isPending}
      >
        {text({ id: "runners-ask-create" })}
      </Button>
    </form>
  );
}

/** The panel a host is registered in: what it replaces, where the reader
 * holds one, the line, and by hand the machine chosen and then the steps its
 * token is handed over in. */
function ChatHostRegistering(props: {
  readonly tenant: string;
  readonly writing: ChatHostWriting;
  /** The short id of the host the reader holds, where they hold one. */
  readonly short: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const { data: minted, variables: chosen } = props.writing.minting;
  return (
    <RunnerRegister
      label={text({ id: "runners-chat-host-register" })}
      lead={
        props.short === undefined ? null : (
          <p className="text-sm text-ink-3">
            {text({
              id: "runners-chat-host-replaces",
              args: { short: props.short },
            })}
          </p>
        )
      }
      line={claudeCodeChatHostLine(currentOrigin(), props.tenant)}
      byHand={
        minted !== undefined && chosen !== undefined ? (
          <RunnerSteps
            minted={minted}
            ask={{ package: chosen, host: false, capabilities: [] }}
            kind="ChatHost"
          />
        ) : (
          <ChatHostAsk writing={props.writing} />
        )
      }
      onDone={props.writing.done}
    />
  );
}

/** What the last change left: the panel a host is registered in, the question a removal waits on, or why it was refused. */
function ChatHostWritten(props: {
  readonly tenant: string;
  readonly writing: ChatHostWriting;
  /** The short id of the host the reader holds, where they hold one. */
  readonly short: string | undefined;
}): ReactNode {
  const text = useCopyText();
  const { writing, short } = props;
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
  if (writing.choosing)
    return (
      <ChatHostRegistering
        tenant={props.tenant}
        writing={writing}
        short={short}
      />
    );
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
  /** Whether the panel a host is registered in is drawn. */
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
