/**
 * The console's chat pane: every thread the reader can reach, beside every page
 * rather than on one.
 *
 * A THREAD IS READ HERE AND NOWHERE ELSE. There is no screen for one, so the
 * pane holds the reader's own open thread by default and its history is how any
 * other is reached — a listing that was a page of its own while a thread was
 * also a page, and is a control now that neither is. Collapsing it leaves the
 * strip its own control expands, rather than nothing — a pane that vanished
 * would leave the reader hunting the bar for where it went.
 *
 * THE COLLAPSED PANE READS NOTHING. The strip mounts none of the reads, so a
 * reader who put the chat away is not paying for a thread they cannot see on
 * every frame the project sends.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type {
  ThreadEntryResponse,
  ThreadsResponse,
} from "../../../../../src/contract/responses.ts";
import {
  apiCloseThread,
  apiOpenThread,
  apiThread,
  apiThreads,
} from "../../core/apiRoutes.ts";
import {
  chatPaneFilled,
  chatPaneHolding,
  chatPaneRestored,
  chatPaneStripped,
  chatPaneToggled,
} from "../../core/chatPane.ts";
import type { ChatPaneStart, ChatPaneState } from "../../core/chatPane.ts";
import { panelReason } from "../../core/freshness.ts";
import { leadSessionNamed } from "../../core/leadTranscript.ts";
import {
  projectListReread,
  projectListRereadNamed,
} from "../../core/projectQueryKeys.ts";
import {
  threadAnswering,
  threadLabel,
  threadMine,
} from "../../core/threads.ts";
import { useApiPorts, usePanelList } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { ThreadConversation } from "../thread/ThreadConversation.tsx";
import { threadsListName, useThread } from "../thread/threadRead.ts";
import { Button } from "../ui/Button.tsx";
import { EmptyState } from "../ui/EmptyState.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useChatPane } from "./chatPaneHeld.tsx";
import { ChatPaneHistory, ChatPaneThreadActions } from "./ChatPaneHistory.tsx";

/** The list entry the pane keeps its answering read under, distinct from the
 * thread read's own so the two never share a cache slot over different
 * shapes. */
function chatPaneAnsweringListName(session: string): string {
  return `chat-answering-${session}`;
}

/** Whether the reader's own open thread has a turn the mailbox has not
 * settled, which is what starting another is withheld for. */
function useChatPaneAnswering(
  partition: PartitionIdentity,
  session: string | undefined,
): boolean {
  const state = usePanelList(
    projectListRereadNamed<boolean>(
      partition,
      "Session",
      session === undefined
        ? "chat-answering"
        : chatPaneAnsweringListName(session),
      (change) =>
        session !== undefined && leadSessionNamed(change.resource) === session,
    ),
    async (ports) => {
      if (session === undefined) return { outcome: "Ok", value: false };
      const result = await apiThread(ports, partition, session);
      return result.outcome === "Ok"
        ? { outcome: "Ok", value: threadAnswering(result.value) }
        : result;
    },
  );
  return state.state === "Ready" && state.value;
}

function useChatPaneThreads(
  partition: PartitionIdentity,
): readonly ThreadEntryResponse[] | undefined {
  const state = usePanelList(
    projectListReread<ThreadsResponse>(partition, "Session", threadsListName),
    (ports) => apiThreads(ports, partition),
  );
  return state.state === "Ready" ? state.value.threads : undefined;
}

/**
 * The offer to start a thread: opened where the reader has none, closed and
 * reopened where they have one, and withheld while the one they have is still
 * answering.
 *
 * IT NAVIGATES NOWHERE — the pane is where a thread is read, so opening one and
 * then going to its page would draw the same conversation twice, once under the
 * bar and once beside it; the open writes a `Session` frame, the frame stales
 * the listing this pane holds, and the pane answers the new thread.
 */
function ChatPaneStartControl(props: {
  readonly partition: PartitionIdentity;
  readonly start: ChatPaneStart;
  readonly onOpened: (session: string) => void;
}): ReactNode {
  const start = props.start;
  const ports = useApiPorts();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  if (start.start === "Unknown") return null;
  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        busy={busy}
        disabled={start.start === "Answering" || busy}
        onClick={() => {
          setBusy(true);
          setRefused(undefined);
          const closes = start.start === "Offered" ? start.closes : undefined;
          const opened =
            closes === undefined
              ? apiOpenThread(ports, props.partition)
              : apiCloseThread(ports, props.partition, closes).then((closed) =>
                  closed.outcome === "Ok"
                    ? apiOpenThread(ports, props.partition)
                    : closed,
                );
          void opened.then((result) => {
            setBusy(false);
            if (result.outcome !== "Ok") {
              setRefused(panelReason(result));
              return;
            }
            props.onOpened(result.value.session);
          });
        }}
      >
        {start.start === "Answering" ? "Answering" : "New"}
      </Button>
      {refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${refused}`} />
      )}
    </>
  );
}

/** How much of the frame the pane takes, which is the move a reader makes
 * while reading. Where it sits is set once and lives in the bar's settings
 * menu instead. */
function ChatPaneControls(): ReactNode {
  const held = useChatPane();
  const state = held.state;
  return (
    <>
      {state.presentation === "Full" ? (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            held.moveTo(chatPaneRestored(state));
          }}
        >
          Exit full screen
        </Button>
      ) : (
        <Button
          variant="quiet"
          size="sm"
          onClick={() => {
            held.moveTo(chatPaneFilled(state));
          }}
        >
          Full screen
        </Button>
      )}
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          held.moveTo(chatPaneToggled(state));
        }}
      >
        Collapse
      </Button>
    </>
  );
}

/** The thread the pane holds, keyed by its session so choosing another out of
 * the history mounts a read of its own rather than reusing this one's. */
function ChatPaneThread(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly named: boolean;
}): ReactNode {
  const state = useThread(props.partition, props.session);
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <ThreadConversation
      partition={props.partition}
      thread={state.value}
      named={props.named}
    />
  );
}

/** The collapsed pane: the one control that brings it back, and nothing that
 * reads. */
function ChatPaneStrip(): ReactNode {
  const held = useChatPane();
  return (
    <div className="grid content-start justify-center bg-surface-1 py-2">
      <Button
        variant="quiet"
        size="sm"
        onClick={() => {
          held.moveTo(chatPaneToggled(held.state));
        }}
      >
        <svg
          aria-hidden="true"
          className="size-4"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4h11v6.5h-6L4.5 13v-2.5h-2z" />
        </svg>
        <span className="visually-hidden">Expand chat</span>
      </Button>
    </div>
  );
}

function ChatPaneOpen(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const threads = useChatPaneThreads(props.partition);
  const mine = threads === undefined ? undefined : threadMine(threads);
  const answering = useChatPaneAnswering(props.partition, mine?.session);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const holding = chatPaneHolding(threads, answering, chosen);
  const held = threads?.find((thread) => thread.session === holding.session);
  return (
    <section
      aria-label="Chat"
      className="bg-surface-1 relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2 px-3 py-2">
        <div className="group flex w-full min-w-0 items-center gap-2">
          <h2 className="text-ink-2 font-strong min-w-0 flex-1 truncate text-sm">
            {held === undefined ? "Chat" : threadLabel(held)}
          </h2>
          {held === undefined ? null : (
            <ChatPaneThreadActions partition={props.partition} thread={held} />
          )}
        </div>
        <ChatPaneStartControl
          partition={props.partition}
          start={holding.start}
          onOpened={setChosen}
        />
        {threads === undefined ? null : (
          <ChatPaneHistory
            threads={threads}
            session={holding.session}
            onChoose={setChosen}
          />
        )}
        <ChatPaneControls />
      </header>
      {holding.session === undefined ? (
        <EmptyState label="No thread" />
      ) : (
        <ChatPaneThread
          key={holding.session}
          partition={props.partition}
          session={holding.session}
          named={chosen !== undefined}
        />
      )}
    </section>
  );
}

export function ChatPane(props: {
  readonly partition: PartitionIdentity;
  readonly chat: ChatPaneState;
}): ReactNode {
  return chatPaneStripped(props.chat) ? (
    <ChatPaneStrip />
  ) : (
    <ChatPaneOpen partition={props.partition} />
  );
}

/** What puts the pane away and brings it back, drawn in the bar above every
 * page. */
export function ChatPaneToggle(): ReactNode {
  const held = useChatPane();
  return (
    <Button
      variant="quiet"
      size="sm"
      pressed={held.state.presentation !== "Collapsed"}
      onClick={() => {
        held.moveTo(chatPaneToggled(held.state));
      }}
    >
      Chat
    </Button>
  );
}
