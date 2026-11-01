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
import {
  apiDeregisterChatHost,
  apiMintChatHostToken,
} from "../../core/apiRoutes.ts";
import { instantFigure } from "../../core/figures.ts";
import type { PanelState } from "../../core/freshness.ts";
import { panelReason } from "../../core/freshness.ts";
import { myRunnerShort } from "../../core/myRunner.ts";
import {
  runnerStandingLabel,
  runnerTokenLifetimeSecs,
} from "../../core/runners.ts";
import { chatHostQuery } from "../../core/tenantQueries.ts";
import { runnerStandingTone } from "../../core/tones.ts";
import { useApiPorts, usePanelState } from "../api.ts";
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

/** Where a change to the host got to: a token minted, the host taken off, or refused with why. */
type ChatHostWrite =
  | { readonly write: "Idle" }
  | { readonly write: "Writing" }
  | { readonly write: "Minted"; readonly minted: WorkerPoolTokenResponse }
  | { readonly write: "Removing" }
  | { readonly write: "Failed"; readonly reason: string };

function ChatHostRow(props: {
  readonly host: ChatHostResponse;
  readonly busy: boolean;
  readonly onRemove: () => void;
}): ReactNode {
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
        <span className="people-stacked-label">Version</span>
        <RunnerVersion runner={host.runner} named />
      </td>
      <td>
        <span className="people-stacked-label">Registered</span>
        <Figure figure={instantFigure(host.registeredAt, nowMs)} />
      </td>
      <td>
        <span className="people-stacked-label">Last polled</span>
        {host.polledAt === undefined ? (
          "Never"
        ) : (
          <Figure figure={instantFigure(host.polledAt, nowMs)} />
        )}
      </td>
      <td>
        <Pill tone={runnerStandingTone(standing)}>
          {runnerStandingLabel(standing)}
        </Pill>
      </td>
      <td className="people-edit">
        <Button
          variant="quiet"
          size="sm"
          named={`Remove chat host ${short}`}
          disabled={props.busy}
          onClick={props.onRemove}
        >
          Remove
        </Button>
      </td>
    </tr>
  );
}

/** The head of a listing of a member's registered hosts: runners, or a chat host. */
export function HostListingHead(props: { readonly name: string }): ReactNode {
  return (
    <thead>
      <tr>
        <th scope="col">{props.name}</th>
        <th scope="col">Version</th>
        <th scope="col" className="w-[9em]">
          Registered
        </th>
        <th scope="col" className="w-[9em]">
          Last polled
        </th>
        <th scope="col" className="people-col-status">
          Status
        </th>
        <th scope="col" className="w-[8em]">
          <span className="visually-hidden">Remove</span>
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
  return (
    <SettingsListingTable caption="Chat host">
      <HostListingHead name="Chat host" />
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

/** What the last change left: the token minted with its expiry, the question a removal waits on, or why it was refused. */
function ChatHostWritten(props: {
  readonly write: ChatHostWrite;
  /** The short id of the host the reader holds, where they hold one. */
  readonly short: string | undefined;
  readonly onRemove: () => void;
  readonly onDone: () => void;
}): ReactNode {
  const nowMs = useNowMs();
  const { write } = props;
  switch (write.write) {
    case "Idle":
    case "Writing":
      return null;
    case "Minted":
      return (
        <div className="grid min-w-0 gap-2">
          <CopyBox
            about={
              <>
                Registers your chat host once · expires{" "}
                <Figure
                  figure={instantFigure(
                    new Date(write.minted.expiresAtMs).toISOString(),
                    nowMs,
                  )}
                />
              </>
            }
            text={write.minted.token}
            copyLabel="Copy token"
          />
          {props.short === undefined ? null : (
            <p className="text-sm text-ink-3">
              {`Registering with it replaces chat host ${props.short} and ends the sessions it is running.`}
            </p>
          )}
          <div>
            <Button size="sm" onClick={props.onDone}>
              Done
            </Button>
          </div>
        </div>
      );
    case "Removing":
      return (
        <Confirm
          question={`Remove chat host ${props.short ?? ""}?`}
          confirm="Remove"
          busy={false}
          onConfirm={props.onRemove}
          onCancel={props.onDone}
        >
          {`Chat host ${props.short ?? ""} stops taking your chats and questions in this workspace, and the sessions it is running now end.`}
        </Confirm>
      );
    case "Failed":
      return (
        <Notice tone="danger" inline detail={`Refused · ${write.reason}`} />
      );
  }
}

interface ChatHostWriting {
  readonly write: ChatHostWrite;
  readonly busy: boolean;
  readonly mint: () => void;
  readonly ask: () => void;
  readonly remove: () => void;
  readonly done: () => void;
}

/** One change at a time, the host read again once it has landed. */
function useChatHostWriting(tenant: string): ChatHostWriting {
  const ports = useApiPorts();
  const client = useQueryClient();
  const [write, setWrite] = useState<ChatHostWrite>({ write: "Idle" });
  const mint = async (): Promise<void> => {
    setWrite({ write: "Writing" });
    const minted = await apiMintChatHostToken(ports, tenant, {
      lifetimeSecs: runnerTokenLifetimeSecs,
    });
    setWrite(
      minted.outcome === "Ok"
        ? { write: "Minted", minted: minted.value }
        : { write: "Failed", reason: panelReason(minted) },
    );
  };
  const remove = async (): Promise<void> => {
    setWrite({ write: "Writing" });
    const removed = await apiDeregisterChatHost(ports, tenant);
    const done = removed.outcome === "Ok" || removed.outcome === "Absent";
    await chatHostReread(client, tenant);
    setWrite(
      done
        ? { write: "Idle" }
        : { write: "Failed", reason: panelReason(removed) },
    );
  };
  return {
    write,
    busy: write.write !== "Idle" && write.write !== "Failed",
    mint: () => void mint(),
    ask: () => {
      setWrite({ write: "Removing" });
    },
    remove: () => void remove(),
    done: () => {
      setWrite({ write: "Idle" });
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
  const writing = useChatHostWriting(props.tenant);
  const { host } = props;
  const held = host.state === "Ready" ? host.value : undefined;
  return (
    <SettingsListingSection
      heading="Chat host"
      about="The machine of yours your threads and questions run on."
      action={
        props.granted ? (
          <Button
            size="sm"
            variant={host.state === "Absent" ? "primary" : "default"}
            disabled={writing.busy}
            onClick={writing.mint}
          >
            Register chat host
          </Button>
        ) : null
      }
    >
      <ChatHostWritten
        write={writing.write}
        short={held === undefined ? undefined : myRunnerShort(held.id)}
        onRemove={writing.remove}
        onDone={writing.done}
      />
      {held !== undefined ? (
        <ChatHostTable host={held} busy={writing.busy} onRemove={writing.ask} />
      ) : host.state === "Absent" ? (
        <EmptyState label="No chat host yet" />
      ) : (
        <SettingsListingUnread state={host} withheld="No chat host yet" />
      )}
    </SettingsListingSection>
  );
}
