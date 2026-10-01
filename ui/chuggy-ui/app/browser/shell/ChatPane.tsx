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
  chatPaneHeaderDoor,
  chatPaneHolding,
  chatPaneRestored,
  chatPaneStripped,
  chatPaneToggled,
} from "../../core/chatPane.ts";
import type {
  ChatPaneHeaderDoor,
  ChatPaneStart,
  ChatPaneState,
} from "../../core/chatPane.ts";
import { panelReason } from "../../core/freshness.ts";
import { leadSessionNamed } from "../../core/leadTranscript.ts";
import {
  projectListReread,
  projectListRereadNamed,
} from "../../core/projectQueryKeys.ts";
import {
  threadAnswering,
  threadDoorUnhosted,
  threadMine,
  threadUnhosted,
} from "../../core/threads.ts";
import { sessionRefusedNoRunner } from "../../core/sessionRunners.ts";
import { useApiPorts, usePanelList } from "../api.ts";
import { PanelUnready } from "../DataPanel.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { ThreadConversation } from "../thread/ThreadConversation.tsx";
import { SessionRunnerNotice } from "../sessionPlacement.tsx";
import {
  ThreadUnhostedNotice,
  useThreadDoor,
  useThreadSend,
} from "../thread/threadSend.tsx";
import { threadsListName, useThread } from "../thread/threadRead.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useChatPane } from "./chatPaneHeld.tsx";
import { ChatPaneIconButton } from "./chatPaneIcons.tsx";
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
 * reopened where they have one — the open asked first, which answers that
 * thread, so the hosted grant or the runner a close does not ask refuses before
 * anything is closed — and withheld while the one they have is still answering.
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
  readonly onRefused: (answer: "Unhosted" | "NoRunner") => void;
  /** What the door would answer that nothing under the header says. */
  readonly header: ChatPaneHeaderDoor;
}): ReactNode {
  const start = props.start;
  const ports = useApiPorts();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  if (start.start === "Unknown") return null;
  return (
    <>
      <ChatPaneIconButton
        glyph="new"
        label={start.start === "Answering" ? "Answering" : "New"}
        busy={busy}
        disabled={start.start === "Answering" || busy}
        onClick={() => {
          setBusy(true);
          setRefused(undefined);
          const closes = start.start === "Offered" ? start.closes : undefined;
          const opened = apiOpenThread(ports, props.partition).then((asked) =>
            closes === undefined || asked.outcome !== "Ok"
              ? asked
              : apiCloseThread(ports, props.partition, closes).then((closed) =>
                  closed.outcome === "Ok"
                    ? apiOpenThread(ports, props.partition)
                    : closed,
                ),
          );
          void opened.then((result) => {
            setBusy(false);
            if (threadUnhosted(result)) {
              props.onRefused("Unhosted");
              return;
            }
            if (sessionRefusedNoRunner(result)) {
              props.onRefused("NoRunner");
              return;
            }
            if (result.outcome !== "Ok") {
              setRefused(panelReason(result));
              return;
            }
            props.onOpened(result.value.session);
          });
        }}
      />
      {refused === undefined ? null : (
        <Notice tone="danger" inline detail={`Refused · ${refused}`} />
      )}
      {props.header.runner === undefined ? null : (
        <SessionRunnerNotice
          partition={props.partition}
          short={props.header.runner}
        />
      )}
      {props.header.unhosted ? <ThreadUnhostedNotice /> : null}
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
        <ChatPaneIconButton
          glyph="restore"
          label="Exit full screen"
          onClick={() => {
            held.moveTo(chatPaneRestored(state));
          }}
        />
      ) : (
        <ChatPaneIconButton
          glyph="fill"
          label="Full screen"
          onClick={() => {
            held.moveTo(chatPaneFilled(state));
          }}
        />
      )}
      <ChatPaneIconButton
        glyph="collapse"
        label="Collapse"
        onClick={() => {
          held.moveTo(chatPaneToggled(state));
        }}
      />
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

/** What stands where the composer would, for a reader whose thread door asks a
 * hosted grant the tenant does not give them: no thread they open could run. */
function ChatPaneUnhosted(): ReactNode {
  return (
    <div
      role="region"
      aria-label="Conversation"
      className="grid min-h-0 min-w-0 flex-1 content-end px-4 pb-4"
    >
      <ThreadUnhostedNotice />
    </div>
  );
}

/**
 * The composer a reader with no thread types in, whose first press opens one.
 * It stays drawn until that message is sent, so the thread it opened arriving
 * in the listing mid-send does not take the text away with it, and while it
 * holds text a door read as `unhosted` holds that text read-only.
 */
function ChatPaneFirst(props: {
  readonly partition: PartitionIdentity;
  readonly unhosted: boolean;
  readonly onStarting: () => void;
  readonly onStarted: (session: string) => void;
}): ReactNode {
  const [typed, setTyped] = useState(false);
  const composer = useThreadSend({
    partition: props.partition,
    session: undefined,
    takes: true,
    onStarted: props.onStarted,
  });
  if (props.unhosted && !typed) return <ChatPaneUnhosted />;
  return (
    <div
      role="region"
      aria-label="Conversation"
      className="min-h-0 min-w-0 flex-1"
    >
      <Conversation
        exchanges={[]}
        composer={{
          ...composer,
          onSend: (text) => {
            props.onStarting();
            return composer.onSend(text);
          },
          onEdit: (text) => {
            setTyped(text !== "");
            composer.onEdit?.(text);
          },
        }}
        pane
      />
    </div>
  );
}

/** The collapsed pane: the one control that brings it back, and nothing that
 * reads. */
function ChatPaneStrip(): ReactNode {
  const held = useChatPane();
  return (
    <div className="grid content-start justify-center bg-surface-1 py-2">
      <ChatPaneIconButton
        glyph="chat"
        label="Expand chat"
        onClick={() => {
          held.moveTo(chatPaneToggled(held.state));
        }}
      />
    </div>
  );
}

/** Whether the pane's body is a thread, rather than the composer whose first
 * press opens one or what refused opening one. */
function chatPaneThreadDrawn(
  session: string | undefined,
  starting: boolean,
): session is string {
  return session !== undefined && !starting;
}

/** What the pane holds under its header: the thread, the composer whose first
 * press opens one, or what refused opening one. */
function ChatPaneBody(props: {
  readonly partition: PartitionIdentity;
  readonly session: string | undefined;
  readonly named: boolean;
  readonly starting: boolean;
  readonly unhosted: boolean;
  readonly onStarting: () => void;
  readonly onStarted: (session: string) => void;
}): ReactNode {
  if (chatPaneThreadDrawn(props.session, props.starting))
    return (
      <ChatPaneThread
        key={props.session}
        partition={props.partition}
        session={props.session}
        named={props.named}
      />
    );
  return (
    <ChatPaneFirst
      partition={props.partition}
      unhosted={props.unhosted}
      onStarting={props.onStarting}
      onStarted={props.onStarted}
    />
  );
}

function ChatPaneOpen(props: {
  readonly partition: PartitionIdentity;
}): ReactNode {
  const threads = useChatPaneThreads(props.partition);
  const mine = threads === undefined ? undefined : threadMine(threads);
  const answering = useChatPaneAnswering(props.partition, mine?.session);
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [starting, setStarting] = useState(false);
  const door = useThreadDoor(props.partition);
  const holding = chatPaneHolding(threads, answering, chosen);
  /** New refused, which is the newest word on what the door asks. */
  const refuse = (answer: "Unhosted" | "NoRunner"): void => {
    if (answer === "Unhosted") door.learnt(false);
    void door.refused();
    setStarting(false);
  };
  /** A thread that opened, which the grant had to allow only where the route
   * was read as hosted. */
  const holdOpened = (session: string): void => {
    setChosen(session);
    setStarting(false);
    if (door.door.route === "InCluster") door.learnt(true);
  };
  const held = threads?.find((thread) => thread.session === holding.session);
  const drawn = chatPaneThreadDrawn(holding.session, starting);
  return (
    <section
      aria-label="Chat"
      className="bg-surface-1 relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden"
    >
      <header className="border-edge grid min-w-0 border-b">
        <div className="flex min-w-0 flex-wrap items-center justify-evenly gap-1 px-3 py-2">
          <ChatPaneStartControl
            partition={props.partition}
            start={holding.start}
            onOpened={holdOpened}
            onRefused={refuse}
            header={chatPaneHeaderDoor(door.door, drawn, held)}
          />
          {threads === undefined ? null : (
            <ChatPaneHistory
              threads={threads}
              session={holding.session}
              onChoose={(session) => {
                setChosen(session);
                setStarting(false);
              }}
            />
          )}
          <ChatPaneControls />
        </div>
        {held === undefined ? null : (
          <div className="border-edge grid min-w-0 gap-1 border-t px-3 py-2">
            <ChatPaneThreadActions partition={props.partition} thread={held} />
          </div>
        )}
      </header>
      <div className="bg-surface-0 grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        <ChatPaneBody
          partition={props.partition}
          session={holding.session}
          named={chosen !== undefined}
          starting={starting}
          unhosted={threadDoorUnhosted(door.door)}
          onStarting={() => {
            setStarting(true);
          }}
          onStarted={holdOpened}
        />
      </div>
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
