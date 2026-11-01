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

import type { PartitionIdentity } from "../../../../../src/contract/http.ts";
import type { ThreadEntryResponse } from "../../../../../src/contract/responses.ts";
import { apiOpenThread } from "../../core/apiRoutes.ts";
import {
  chatPaneChosenIn,
  chatPaneDefaulted,
  chatPaneFilled,
  chatPaneHeaderDoor,
  chatPaneHolding,
  chatPaneRestored,
  chatPaneStripped,
  chatPaneToggled,
  chatPaneUnhosted,
} from "../../core/chatPane.ts";
import type {
  ChatPaneChosen,
  ChatPaneHeaderDoor,
  ChatPaneState,
} from "../../core/chatPane.ts";
import {
  conversationExchangeSent,
  conversationExchangesStopped,
} from "../../core/conversation.ts";
import { consoleWriteKey } from "../../core/consoleWrite.ts";
import type { ConsoleWrite } from "../../core/consoleWrite.ts";
import { failureWords } from "../../core/failureWords.ts";
import { projectAbilityRefused } from "../../core/projectAbilities.ts";
import {
  hostedRunsQuery,
  sessionPlacementQuery,
} from "../../core/projectQueries.ts";
import {
  threadKeptClosed,
  threadKeptWith,
  threadKeptWithout,
  threadLimitWord,
  threadOpenAtLimit,
  threadOpenKeyBytesCount,
  threadOpenKeyMinted,
  threadTurnsEnded,
  threadUnhosted,
} from "../../core/threads.ts";
import type {
  ThreadDoor,
  ThreadKeptHeld,
  ThreadSend,
} from "../../core/threads.ts";
import { threadsQuery } from "../../core/sessionQueries.ts";
import { sessionRefusedNoRunner } from "../../core/sessionRunners.ts";
import { threadHomeOf } from "../../core/threadHome.ts";
import { usePanelState } from "../api.ts";
import { useConsoleWrite } from "../consoleWrite.tsx";
import { drawBytes } from "../ports.ts";
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
import type { ThreadKeptAway } from "../thread/threadSend.tsx";
import { useThread } from "../thread/threadRead.ts";
import { Button } from "../ui/Button.tsx";
import { Notice } from "../ui/Notice.tsx";
import type { ChatPanePlacement } from "../../core/chatPane.ts";
import { useChatPane } from "./chatPaneHeld.tsx";
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
  const hosted = hostedRunsQuery(partition).queryKey;
  const placement = sessionPlacementQuery(partition).queryKey;
  switch (opened.opened) {
    case "Opened":
      if (client.getQueryData(placement)?.thread.route === "InCluster")
        client.setQueryData(hosted, { granted: true });
      return;
    case "Unhosted":
      client.setQueryData(hosted, { granted: false });
      await client.invalidateQueries({ queryKey: placement });
      return;
    case "NoRunner":
      await client.invalidateQueries({ queryKey: placement });
      return;
  }
}

/** One open from New, under the key the control holds, its refusal said as
 * the header's row says it. The thread it opened is chosen in the shell, which
 * outlives the pane, whether or not the pane is still drawn. */
function chatPaneOpenWrite(
  partition: PartitionIdentity,
  choose: (chosen: ChatPaneChosen) => void,
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
        choose({ partition, session: opened.session });
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
  const opening = useConsoleWrite(
    chatPaneOpenWrite(props.partition, useChatPane().choose),
    { drawn: true },
  );
  const [key, setKey] = useState(chatPaneOpenKey);
  const answered = (opened: ChatPaneOpened): void => {
    switch (opened.opened) {
      case "Opened":
        setKey(chatPaneOpenKey());
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
          opening.mutate(key, { onSuccess: answered });
        }}
      />
      {opening.error === null ? null : (
        <ChatPaneHeaderRow>
          <Notice tone="danger" inline detail={opening.error.message} />
        </ChatPaneHeaderRow>
      )}
      <ChatPaneStartDoor partition={props.partition} header={props.header} />
    </>
  );
}

/** A key no open has been asked under. */
function chatPaneOpenKey(): string {
  return threadOpenKeyMinted(drawBytes(threadOpenKeyBytesCount));
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
  readonly away: ThreadKeptAway;
}): ReactNode {
  const state = useThread(props.partition, props.session);
  if (state.state !== "Ready") return <PanelUnready state={state} />;
  return (
    <ThreadConversation
      partition={props.partition}
      thread={state.value}
      named={props.named}
      away={props.away}
    />
  );
}

const chatPaneKeptNothing: ThreadKeptHeld = new Map();

/**
 * The messages a thread's door handed back while the pane drew another, one
 * text a thread: each is held until that thread's box takes it or the listing
 * says the thread takes nothing more, and all of it goes with the pane.
 */
function useChatPaneKept(
  threads: readonly ThreadEntryResponse[] | undefined,
): (session: string) => ThreadKeptAway {
  const [held, setHeld] = useState(chatPaneKeptNothing);
  const closed = threadKeptClosed(held, threads ?? []);
  if (closed.length > 0) setHeld(threadKeptWithout(held, closed));
  return (session) => ({
    kept: held.get(session),
    keep: (kept) => {
      setHeld((before) => threadKeptWith(before, session, kept));
    },
    taken: () => {
      setHeld((before) => threadKeptWithout(before, [session]));
    },
  });
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
 * The composer a reader with no thread types in, whose first press opens one.
 * It stays drawn until that message is sent and the thread it opened has been
 * read, so neither the thread arriving in the listing mid-send nor the read of
 * it takes away the text or the message drawn above it, and while it holds
 * text a door read as `unhosted` holds that text read-only.
 */
function ChatPaneFirst(props: {
  readonly partition: PartitionIdentity;
  readonly unhosted: boolean;
  /** The thread a first message opened, while its read is awaited. */
  readonly opening: string | undefined;
  readonly onStarting: () => void;
  readonly onStarted: (session: string) => void;
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
          onSend: (text, attached) => {
            props.onStarting();
            return composer.onSend(text, attached);
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
  readonly kept: (session: string) => ThreadKeptAway;
  readonly onStarting: () => void;
  readonly onStarted: (session: string) => void;
  readonly onRead: () => void;
}): ReactNode {
  if (chatPaneThreadDrawn(props.session, props.starting))
    return (
      <ChatPaneThread
        key={props.session}
        partition={props.partition}
        session={props.session}
        named={props.named}
        away={props.kept(props.session)}
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
      partition={props.partition}
      unhosted={props.unhosted}
      opening={props.opening}
      onStarting={props.onStarting}
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
  readonly opened: () => void;
} {
  const door = useThreadDoor(partition);
  const [refusal, setRefusal] = useState<ThreadSend>({ send: "Idle" });
  return {
    door: door.door,
    refusal,
    met: setRefusal,
    /** The grant had to allow the open only where the route was read as hosted. */
    opened: () => {
      setRefusal({ send: "Idle" });
      if (door.door.route === "InCluster") door.learnt(true);
    },
  };
}

/**
 * Which thread the open pane draws: the one the reader chose, or the one the
 * pane holds for them, both held by the shell so they outlive the pane, kept off
 * the screen while a first message is being sent and until the thread that
 * message opened has been read.
 */
function useChatPaneOpenHeld(partition: PartitionIdentity): {
  readonly threads: readonly ThreadEntryResponse[] | undefined;
  readonly holding: string | undefined;
  readonly named: boolean;
  readonly starting: boolean;
  /** The thread a first message opened, while its read is awaited. */
  readonly opening: string | undefined;
  readonly chose: (session: string) => void;
  readonly began: () => void;
  readonly stayed: () => void;
  readonly sent: (session: string) => void;
  readonly read: () => void;
} {
  const threads = useChatPaneThreads(partition);
  const [named, setNamed] = useState(false);
  const [starting, setStarting] = useState(false);
  const [opening, setOpening] = useState<string | undefined>(undefined);
  const read = useCallback(() => {
    setStarting(false);
    setOpening(undefined);
  }, []);
  const {
    chosen: picked,
    choose,
    defaulted: kept,
    holdDefault,
  } = useChatPane();
  const chosen = chatPaneChosenIn(picked, partition);
  const held = chatPaneChosenIn(kept, partition);
  const defaulted = chatPaneDefaulted(threads, held);
  useEffect(() => {
    if (defaulted === held) return;
    holdDefault(
      defaulted === undefined ? undefined : { partition, session: defaulted },
    );
  }, [defaulted, held, holdDefault, partition]);
  return {
    threads,
    holding: chatPaneHolding(threads, chosen, held),
    named,
    starting,
    opening,
    chose: (session) => {
      choose({ partition, session });
      setNamed(true);
      read();
    },
    began: () => {
      setStarting(true);
    },
    stayed: () => {
      setStarting(false);
    },
    sent: (session) => {
      choose({ partition, session });
      setNamed(true);
      setOpening(session);
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
  const kept = useChatPaneKept(threads);
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
          kept={kept}
          onStarting={pane.began}
          onStarted={(session) => {
            pane.sent(session);
            door.opened();
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
    <ChatPaneOpen partition={props.partition} chat={props.chat} />
  );
}
