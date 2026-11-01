/**
 * The console's chat pane: every thread the reader can reach, beside every page
 * rather than on one.
 *
 * The pane holds the reader's own open thread that moved last when it is first
 * read, and holds it until it closes, and its history is how any other is
 * reached, their own open ones among them.
 * Each thread also has a page of its own, which the pane links to and which
 * draws no pane, so no thread is drawn twice.
 * Collapsing it leaves the strip its own control expands, rather than nothing —
 * a pane that vanished would leave the reader hunting the bar for where it went.
 *
 * THE COLLAPSED PANE READS NOTHING. The strip mounts none of the reads, so a
 * reader who put the chat away is not paying for a thread they cannot see on
 * every frame the project sends.
 */

import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

import { partitionPath } from "../../../../../src/contract/http.ts";
import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import { apiOpenThread } from "../../core/apiRoutes.ts";
import {
  chatPaneDefaulted,
  chatPaneFilled,
  chatPaneHeaderDoor,
  chatPaneHolding,
  chatPaneRestored,
  chatPaneStripped,
  chatPaneToggled,
  chatPaneUnhosted,
} from "../../core/chatPane.ts";
import type { ChatPaneHeaderDoor, ChatPaneState } from "../../core/chatPane.ts";
import {
  conversationExchangeSent,
  conversationExchangesStopped,
} from "../../core/conversation.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import { sessionPlacementQuery } from "../../core/projectQueries.ts";
import {
  threadLimitWord,
  threadOpenAtLimit,
  threadTurnsEnded,
  threadUnhosted,
} from "../../core/threads.ts";
import type { ThreadDoor, ThreadSend } from "../../core/threads.ts";
import { threadsQuery } from "../../core/sessionQueries.ts";
import { sessionRefusedNoRunner } from "../../core/sessionRunners.ts";
import { threadHomeOf } from "../../core/threadHome.ts";
import { usePanelState } from "../api.ts";
import { ConsoleWriteRefusedWords, useConsoleWrite } from "../consoleWrite.tsx";
import { PanelUnready } from "../DataPanel.tsx";
import { Conversation } from "../conversation/Conversation.tsx";
import { useProjectAbilities, ViewOnlyNotice } from "../projectAbilities.tsx";
import { ThreadConversation } from "../thread/ThreadConversation.tsx";
import { SessionRunnerNotice } from "../sessionPlacement.tsx";
import {
  ThreadUnhostedNotice,
  useThreadDoor,
  useThreadSend,
} from "../thread/threadSend.tsx";
import {
  threadDoorGranted,
  threadDoorOpened,
  threadSendKeptListed,
} from "../thread/threadSends.ts";
import { useThread } from "../thread/threadRead.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import { useConsoleDispatch, useConsoleSelector } from "../store.ts";
import type { ConsoleDispatch } from "../store.ts";
import type { ChatPanePlacement } from "../../core/chatPane.ts";
import { useChatPane } from "./chatPaneHeld.ts";
import {
  chatPaneDefaultHeldAt,
  chatPaneOpenedAt,
  chatPaneOpenPressed,
  chatPanePickedAt,
  chatPaneReadAt,
  chatPaneRecordAt,
  chatPaneStayedAt,
} from "./chatPanes.ts";
import {
  ChatPaneHeaderRow,
  ChatPaneIcon,
  ChatPaneIconButton,
} from "./chatPaneIcons.tsx";
import { ChatPaneHistory, ChatPaneThreadActions } from "./ChatPaneHistory.tsx";

/** The listing the pane reads, which lists no lead session and so is not read
 * again on the frames of one. */
function useChatPaneThreads(
  partition: PartitionIdentity,
): readonly ThreadEntryResponse[] | undefined {
  const state = usePanelState(threadsQuery(partition));
  return state.state === "Ready" ? state.value.threads : undefined;
}

/** What the door would answer a start, said under the header's row. */
function ChatPaneStartDoor(props: {
  readonly partition: PartitionIdentity;
  readonly header: ChatPaneHeaderDoor;
}): ReactNode {
  return (
    <>
      {props.header.runner === undefined ? null : (
        <ChatPaneHeaderRow>
          <SessionRunnerNotice
            partition={props.partition}
            session="Thread"
            short={props.header.runner}
          />
        </ChatPaneHeaderRow>
      )}
      {props.header.unhosted ? (
        <ChatPaneHeaderRow>
          <ThreadUnhostedNotice />
        </ChatPaneHeaderRow>
      ) : null}
    </>
  );
}

/** What an open from New answered that the pane acts on: the thread it
 * opened, or the door it met, counting the placement reads before a refusal
 * over the hosted grant. */
type ChatPaneOpened =
  | { readonly opened: "Opened"; readonly session: string }
  | { readonly opened: "Unhosted"; readonly readsAt: number }
  | { readonly opened: "NoRunner" };

/** What an open changed of the door's reads: a refusal over the grant writes
 * it ungranted, either refusal reads the placement again, and an open on a
 * route read as hosted writes the grant given. */
async function chatPaneOpenLanded(
  client: QueryClient,
  partition: PartitionIdentity,
  opened: ChatPaneOpened,
): Promise<void> {
  const placement = sessionPlacementQuery(partition).queryKey;
  switch (opened.opened) {
    case "Opened":
      threadDoorOpened(client, partition);
      return;
    case "Unhosted":
      threadDoorGranted(client, partition, false);
      await client.invalidateQueries({ queryKey: placement });
      return;
    case "NoRunner":
      await client.invalidateQueries({ queryKey: placement });
      return;
  }
}

/** One open from New, under the key the project's record holds, its refusal
 * said as the header's row says it. The thread it opened is picked and the key
 * spent in the store, which outlives the pane, whether or not the pane is
 * still drawn. */
function chatPaneOpenWrite(
  partition: PartitionIdentity,
  dispatch: ConsoleDispatch,
): ConsoleWrite<string, ChatPaneOpened> {
  return {
    mutationKey: consoleWriteKey(
      "thread-open",
      partition.tenant,
      partition.project,
    ),
    write: async (ports, key, client) => {
      const answer = await apiOpenThread(ports, partition, key);
      if (threadUnhosted(answer)) {
        const placement = sessionPlacementQuery(partition).queryKey;
        const readsAt = client.getQueryState(placement)?.dataUpdateCount ?? 0;
        return { outcome: "Ok", value: { opened: "Unhosted", readsAt } };
      }
      if (sessionRefusedNoRunner(answer))
        return { outcome: "Ok", value: { opened: "NoRunner" } };
      if (answer.outcome !== "Ok") return answer;
      return {
        outcome: "Ok",
        value: { opened: "Opened", session: answer.value.session },
      };
    },
    refusal: (failure) =>
      threadOpenAtLimit(failure)
        ? `Refused · ${threadLimitWord}`
        : failureWords(failure).word,
    landed: (client, opened) => {
      if (opened.opened === "Opened")
        dispatch(chatPaneOpenedAt({ partition, session: opened.session }));
      return chatPaneOpenLanded(client, partition, opened);
    },
  };
}

/**
 * The offer to start a thread beside those the reader holds, opened under a key
 * held until an open answers, so a press after one that failed reaches the
 * thread that one may have opened. It navigates nowhere: the open's `Session`
 * frame stales the listing this pane holds, and the pane answers the thread.
 */
function ChatPaneStartControl(props: {
  readonly partition: PartitionIdentity;
  readonly onOpened: (session: string) => void;
  /** What the door met, newer than the reads of it. */
  readonly onRefused: (refusal: ThreadSend) => void;
  /** What the door would answer that nothing under the header says. */
  readonly header: ChatPaneHeaderDoor;
}): ReactNode {
  const dispatch = useConsoleDispatch();
  const opening = useConsoleWrite(
    chatPaneOpenWrite(props.partition, dispatch),
    { drawn: true },
  );
  const answered = (opened: ChatPaneOpened): void => {
    switch (opened.opened) {
      case "Opened":
        props.onOpened(opened.session);
        return;
      case "Unhosted":
        props.onRefused({ send: "Unhosted", readsAt: opened.readsAt });
        return;
      case "NoRunner":
        props.onRefused({ send: "Idle" });
        return;
    }
  };
  return (
    <>
      <ChatPaneIconButton
        glyph="new"
        label="New"
        busy={opening.isPending}
        disabled={opening.isPending}
        onClick={() => {
          opening.mutate(dispatch(chatPaneOpenPressed(props.partition)), {
            onSuccess: answered,
          });
        }}
      />
      {opening.error === null ? null : (
        <ChatPaneHeaderRow>
          <Notice tone="danger" inline>
            <ConsoleWriteRefusedWords refused={opening.error} />
          </Notice>
        </ChatPaneHeaderRow>
      )}
      <ChatPaneStartDoor partition={props.partition} header={props.header} />
    </>
  );
}

/** How much of the frame the pane takes, which is the move a reader makes
 * while reading, and only collapsing where the viewport does not divide. Where
 * it sits is set once and lives in the bar's settings menu instead. */
function ChatPaneControls(props: {
  readonly placement: ChatPanePlacement;
}): ReactNode {
  const held = useChatPane();
  const state = held.state;
  return (
    <>
      {!held.twoColumn ? null : state.presentation === "Full" ? (
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
        glyph={`collapse${props.placement}`}
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

/** The one line that stands where the composer would, for a reader no thread
 * could run for or one who may send nothing. */
function ChatPaneUnsendable(props: {
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div
      role="region"
      aria-label="Conversation"
      className="grid min-h-0 min-w-0 flex-1 content-end px-4 pb-4"
    >
      {props.children}
    </div>
  );
}

/**
 * The read of a thread a first message opened, which says once it has
 * answered and draws nothing: the pane draws the thread from then, in place of
 * the composer that message was typed in. A turn stopped in that composer is
 * waited for until the read lists it ended, so the thread is never drawn
 * saying a turn drawn stopped is out.
 */
function ChatPaneOpening(props: {
  readonly partition: PartitionIdentity;
  readonly session: string;
  readonly stopping: ReadonlySet<string>;
  readonly onRead: () => void;
}): ReactNode {
  const state = useThread(props.partition, props.session);
  const ended = state.state === "Ready" ? threadTurnsEnded(state.value) : [];
  const awaited = [...props.stopping].some((turn) => !ended.includes(turn));
  const read = state.state !== "Pending" && !awaited;
  const onRead = props.onRead;
  useEffect(() => {
    if (read) onRead();
  }, [read, onRead]);
  return null;
}

/**
 * The composer a reader with no thread types in, whose first press opens one,
 * mounted afresh in each project so its text does not cross, and drawing the
 * project's own first record, so neither does that thread. It stays drawn
 * until that message is sent and the thread it opened has been read, so
 * neither the thread arriving in the listing mid-send nor the read of it takes
 * away the text or the message drawn above it, and while it holds text a door
 * read as `unhosted` holds that text read-only.
 */
function ChatPaneFirst(props: {
  readonly partition: PartitionIdentity;
  readonly unhosted: boolean;
  /** The thread a first message opened, while its read is awaited. */
  readonly opening: string | undefined;
  readonly onStarted: () => void;
  readonly onRead: () => void;
}): ReactNode {
  const [typed, setTyped] = useState(false);
  const sends = useThreadSend({
    partition: props.partition,
    session: undefined,
    takes: true,
    onStarted: props.onStarted,
  });
  const composer = sends.composer;
  if (composer.back !== undefined && !typed) setTyped(true);
  const sent = useMemo(
    () => sends.sending.map(conversationExchangeSent),
    [sends.sending],
  );
  const opening =
    props.opening === undefined ? null : (
      <ChatPaneOpening
        partition={props.partition}
        session={props.opening}
        stopping={sends.stopping}
        onRead={props.onRead}
      />
    );
  if (props.unhosted && !typed)
    return (
      <>
        {opening}
        <ChatPaneUnsendable>
          <ThreadUnhostedNotice />
        </ChatPaneUnsendable>
      </>
    );
  return (
    <div
      role="region"
      aria-label="Conversation"
      className="min-h-0 min-w-0 flex-1"
    >
      {opening}
      <Conversation
        exchanges={conversationExchangesStopped(sent, sends.stopping)}
        composer={{
          ...composer,
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

/** The collapsed pane: the one control that brings it back, named on its
 * face, and nothing that reads. */
function ChatPaneStrip(props: {
  readonly placement: ChatPanePlacement;
}): ReactNode {
  const held = useChatPane();
  return (
    <div
      className="chat-strip bg-surface-1"
      data-placement={props.placement.toLowerCase()}
    >
      <Button
        variant="quiet"
        size="sm"
        expanded={false}
        onClick={() => {
          held.moveTo(chatPaneToggled(held.state));
        }}
      >
        <ChatPaneIcon glyph={`expand${props.placement}`} label="Expand chat" />
        <span aria-hidden="true" className="chat-strip-name">
          Chat
        </span>
      </Button>
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
  /** The reader may open no thread, which is said before anything a door asks. */
  readonly viewOnly: boolean;
  readonly unhosted: boolean;
  readonly opening: string | undefined;
  readonly onStarted: () => void;
  readonly onRead: () => void;
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
  if (props.viewOnly)
    return (
      <ChatPaneUnsendable>
        <ViewOnlyNotice />
      </ChatPaneUnsendable>
    );
  return (
    <ChatPaneFirst
      key={partitionPath(props.partition)}
      partition={props.partition}
      unhosted={props.unhosted}
      opening={props.opening}
      onStarted={props.onStarted}
      onRead={props.onRead}
    />
  );
}

/** The reader's thread door as the pane holds it: as read, and as New last
 * met it, which is newer than the read until a read after it answers. */
function useChatPaneDoor(partition: PartitionIdentity): {
  readonly door: ThreadDoor;
  readonly refusal: ThreadSend;
  readonly met: (refusal: ThreadSend) => void;
} {
  const door = useThreadDoor(partition);
  const [refusal, setRefusal] = useState<ThreadSend>({ send: "Idle" });
  return { door, refusal, met: setRefusal };
}

/**
 * Which thread the open pane draws: the one the reader chose or the one the
 * pane holds for them, both in the project's record, so they outlive the pane
 * and a send that answers after the project changed lands in its own. Neither
 * is drawn from a first press until the pane's start ends, which keeps a
 * refused first message's box over the thread its open answered through any
 * collapse, and what is kept for a thread the listing says takes nothing more
 * goes, drawn or not, since its box would hold it read-only.
 */
function useChatPaneOpenHeld(partition: PartitionIdentity): {
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly holding: string | undefined;
  readonly named: boolean;
  readonly starting: boolean;
  /** The thread a first message opened, while its read is awaited. */
  readonly opening: string | undefined;
  readonly chose: (session: string) => void;
  readonly stayed: () => void;
  readonly read: () => void;
} {
  const threads = useChatPaneThreads(partition);
  const [named, setNamed] = useState(false);
  const dispatch = useConsoleDispatch();
  const record = useConsoleSelector((state) =>
    chatPaneRecordAt(state, partition),
  );
  if (record.opening !== undefined && !named) setNamed(true);
  const { tenant, project } = partition;
  useEffect(() => {
    if (threads === undefined) return;
    const home = threadHomeOf({ tenant, project });
    dispatch(threadSendKeptListed(home, threads));
  }, [threads, dispatch, tenant, project]);
  const held = record.defaulted;
  const defaulted = chatPaneDefaulted(threads, held);
  useEffect(() => {
    if (defaulted === held) return;
    dispatch(chatPaneDefaultHeldAt({ partition, session: defaulted }));
  }, [defaulted, held, dispatch, partition]);
  const read = useCallback(() => {
    dispatch(chatPaneReadAt({ tenant, project }));
  }, [dispatch, tenant, project]);
  return {
    threads,
    holding: chatPaneHolding(threads, record.picked, held),
    named,
    starting: record.starting,
    opening: record.opening,
    chose: (session) => {
      dispatch(chatPanePickedAt({ partition, session }));
      setNamed(true);
    },
    stayed: () => {
      dispatch(chatPaneStayedAt(partition));
    },
    read,
  };
}

/** The thread the pane holds, at the start of its header's row, or the room
 * one would take. */
function ChatPaneHeld(props: {
  readonly partition: PartitionIdentity;
  readonly thread: ThreadEntryResponse | undefined;
  readonly viewOnly: boolean;
}): ReactNode {
  if (props.thread === undefined) return <span className="flex-1" />;
  return (
    <ChatPaneThreadActions
      home={threadHomeOf(props.partition)}
      thread={props.thread}
      viewOnly={props.viewOnly}
      at="Pane"
    />
  );
}

function ChatPaneOpen(props: {
  readonly partition: PartitionIdentity;
  /** Where the pane is drawn, and whether it has the whole frame and so sets
   * its conversation as a column to read. */
  readonly chat: ChatPaneState;
}): ReactNode {
  const pane = useChatPaneOpenHeld(props.partition);
  const door = useChatPaneDoor(props.partition);
  const { threads, holding } = pane;
  const held = threads?.find((thread) => thread.session === holding);
  const drawn = chatPaneThreadDrawn(holding, pane.starting);
  const viewOnly = projectAbilityRefused(
    useProjectAbilities(props.partition),
    "mutate",
  );
  return (
    <section
      aria-label="Chat"
      className={`chat-open bg-surface-1 relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden ${props.chat.presentation === "Full" ? "chat-reading" : ""}`}
    >
      <header className="border-edge flex min-w-0 flex-wrap items-center border-b px-1 py-1">
        <ChatPaneHeld
          partition={props.partition}
          thread={held}
          viewOnly={viewOnly}
        />
        {viewOnly ? null : (
          <ChatPaneStartControl
            partition={props.partition}
            onOpened={(session) => {
              pane.chose(session);
              door.met({ send: "Idle" });
            }}
            onRefused={(refusal) => {
              door.met(refusal);
              pane.stayed();
            }}
            header={chatPaneHeaderDoor(door.door, drawn, held, door.refusal)}
          />
        )}
        {threads === undefined ? null : (
          <ChatPaneHistory
            threads={threads}
            session={holding}
            onChoose={pane.chose}
          />
        )}
        <ChatPaneControls placement={props.chat.placement} />
      </header>
      <div className="bg-surface-0 grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        <ChatPaneBody
          partition={props.partition}
          session={holding}
          named={pane.named}
          starting={pane.starting}
          viewOnly={viewOnly}
          unhosted={chatPaneUnhosted(door.door, door.refusal)}
          opening={pane.opening}
          onStarted={() => {
            door.met({ send: "Idle" });
          }}
          onRead={pane.read}
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
    <ChatPaneStrip placement={props.chat.placement} />
  ) : (
    <ChatPaneOpen
      key={partitionPath(props.partition)}
      partition={props.partition}
      chat={props.chat}
    />
  );
}
