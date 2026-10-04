/**
 * The console's one conversation surface: exchanges drawn as a thread, and a
 * composer where the page hands one in.
 *
 * IT REACHES NO API AND NO ROUTER. Everything it draws arrives as props and
 * everything it sends leaves through `onSend`, so it mounts in a suite with
 * `render()` and no provider, and the three pages that adopt it keep their own
 * reads.
 *
 * THE MAILBOX IS THE QUEUE. Without a queue adapter the library refuses a send
 * while a turn is pending; the mailbox already queues, so the adapter holds no
 * items of its own and both lanes post.
 *
 * NOTHING HERE STACKS WITH A GRID. Every stack is a column flex, whose
 * automatic minimum size falls on the block axis: a report holding a wide table
 * overflows its own box and the column keeps the width its container gave it. A
 * grid track sized `auto` does the opposite — it grows to its content's
 * min-content width — so one such track above the text pushes the whole thread
 * past the pane holding it.
 *
 * AN EXCHANGE THAT DID NOT CHANGE IS NOT DRAWN AGAIN. The library keeps what it
 * made of a message for as long as it is handed the same one, so each
 * exchange's two messages are made once and a page redrawing one exchange a
 * frame redraws that one.
 *
 * ONE THING MOVES WHILE A TURN IS OUT, and `conversationIndicator` says where:
 * in that turn's own exchange, and at the foot of the column for a send no
 * exchange stands for yet. A turn heard to end is out no longer, whatever the
 * mailbox still says of it, and nothing moves for it.
 *
 * NOTHING STANDS BETWEEN THE COLUMN AND THE COMPOSER BUT WHAT A READER NEEDS
 * THERE. The engine runs where the answer is about to be and not on a strip of
 * its own, so the column ends where the composer begins.
 *
 * A READER WHO HAS SCROLLED AWAY IS OFFERED THE WAY BACK, on a band of its own
 * under the column, which is there only while they are away from its foot and
 * so never stands over a line of text. The library keeps the column pinned to
 * its foot only while the reader is at it, and its own control returns them
 * there and pins it again.
 *
 * HOW WIDE THE COLUMN IS AND HOW LARGE ITS TEXT ARE THE MOUNT'S TO SAY, through
 * the custom properties `conversation.css` reads, so a pane that gives the
 * conversation the whole frame sets it as a column to read and this file knows
 * nothing of where it is mounted.
 */

import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
  useThreadViewport,
} from "@assistant-ui/react";
import type {
  AppendMessage,
  AssistantRuntime,
  ExternalThreadQueueAdapter,
  MessageState,
  MessageStatus,
  ThreadMessageLike,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  conversationExchangeParts,
  conversationIndicator,
} from "../../core/conversation.ts";
import type {
  ConversationExchange,
  ConversationIndicator,
} from "../../core/conversation.ts";
import type { RunPrompt } from "../../core/runConfiguration.ts";
import { ConversationComposer } from "./ConversationComposer.tsx";
import type { ConversationComposerProps } from "./ConversationComposer.tsx";
import {
  ConversationAnswerMessage,
  ConversationAskMessage,
  ConversationIndicated,
  ConversationLettingHeld,
  ConversationPaced,
  ConversationWorkOpen,
} from "./ConversationExchange.tsx";
import {
  ConversationEarlier,
  ConversationPrompt,
} from "./ConversationPrompt.tsx";
import type { ConversationEarlierProps } from "./ConversationPrompt.tsx";
import { ConversationWaiting } from "./ConversationWaiting.tsx";
import { Notice } from "../ui/Notice.tsx";

export type {
  ConversationComposerProps,
  ConversationSent,
} from "./ConversationComposer.tsx";
export type { ConversationEarlierProps } from "./ConversationPrompt.tsx";

function conversationStatus(exchange: ConversationExchange): MessageStatus {
  const standing = exchange.standing;
  switch (standing.standing) {
    case "Running":
      return { type: "running" };
    case "Answered":
      return { type: "complete", reason: "stop" };
    case "Failed":
      return {
        type: "incomplete",
        reason: "error",
        error: standing.failure ?? null,
      };
    case "Abandoned":
      return { type: "incomplete", reason: "cancelled" };
    case "Open":
    case "Markers":
      return { type: "incomplete", reason: "other" };
  }
}

/**
 * One exchange as the two messages the library holds a turn as: the ask, and
 * the answer it is still waiting for or already has, which holds each text of
 * the answer in the order it was written. They are named by the exchange's
 * turn where it has one, because that is the name that stays while the
 * transcript comes to hold the turn, and the library begins a message again
 * when its name changes.
 */
function conversationExchangeMessages(
  exchange: ConversationExchange,
): readonly ThreadMessageLike[] {
  const named = exchange.turn ?? exchange.id;
  return [
    {
      id: `${named}-ask`,
      role: exchange.ask?.ask === "Message" ? "user" : "system",
      content: [
        {
          type: "text",
          text: exchange.ask?.ask === "Message" ? exchange.ask.text : "",
        },
      ],
      metadata: { custom: { exchange, side: "Ask" } },
    },
    {
      id: `${named}-answer`,
      role: "assistant",
      content: conversationExchangeParts(exchange).flatMap((part) =>
        part.part === "Text"
          ? [{ type: "text" as const, text: part.text }]
          : [],
      ),
      status: conversationStatus(exchange),
      metadata: { custom: { exchange, side: "Answer" } },
    },
  ];
}

const conversationMessagesMade = new WeakMap<
  ConversationExchange,
  readonly ThreadMessageLike[]
>();

function conversationMessages(
  exchanges: readonly ConversationExchange[],
): readonly ThreadMessageLike[] {
  return exchanges.flatMap((exchange) => {
    const made =
      conversationMessagesMade.get(exchange) ??
      conversationExchangeMessages(exchange);
    conversationMessagesMade.set(exchange, made);
    return made;
  });
}

function conversationMessageKept(
  message: ThreadMessageLike,
): ThreadMessageLike {
  return message;
}

/** Whether any exchange is still being worked, which is what the library's own
 * affordances watch. */
function conversationRunning(
  exchanges: readonly ConversationExchange[],
): boolean {
  return exchanges.some((exchange) => exchange.standing.standing === "Running");
}

function conversationAppendedText(message: AppendMessage): string {
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

interface ConversationHeld {
  readonly runtime: AssistantRuntime;
  readonly sending: boolean;
}

function useConversationRuntime(props: {
  readonly exchanges: readonly ConversationExchange[];
  readonly composer: ConversationComposerProps | undefined;
}): ConversationHeld {
  const [sending, setSending] = useState(false);
  const dispatchRef = useRef<(message: AppendMessage) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const restoreRef = useRef<(text: string) => void>(() => undefined);
  const queue = useMemo<ExternalThreadQueueAdapter>(
    () => ({
      items: [],
      steerItems: [],
      enqueue: (message) => void dispatchRef.current(message),
      steer: (message) => void dispatchRef.current(message),
      move: () => undefined,
      edit: () => undefined,
      remove: () => undefined,
    }),
    [],
  );
  const dispatch = async (message: AppendMessage): Promise<void> => {
    const composer = props.composer;
    if (composer === undefined) return;
    const text = conversationAppendedText(message);
    setSending(true);
    const sent = await composer.onSend(text);
    setSending(false);
    if (sent === "Kept") restoreRef.current(text);
  };
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    queue,
    messages: conversationMessages(props.exchanges),
    isRunning: conversationRunning(props.exchanges),
    isSendDisabled: props.composer === undefined || !props.composer.takes,
    convertMessage: conversationMessageKept,
    onNew: dispatch,
  });
  useEffect(() => {
    dispatchRef.current = dispatch;
    restoreRef.current = (text) => {
      const box = runtime.thread.composer;
      if (box.getState().text.trim().length > 0) return;
      box.setText(text);
    };
  });
  return { runtime, sending };
}

function conversationMessageDrawn(value: {
  readonly message: MessageState;
}): ReactNode {
  return value.message.role === "assistant" ? (
    <ConversationAnswerMessage />
  ) : (
    <ConversationAskMessage />
  );
}

/** The way back to the newest words, on a band under the column for as long
 * as the reader is not at its foot. */
function ConversationBottom(): ReactNode {
  const atBottom = useThreadViewport((viewport) => viewport.isAtBottom);
  if (atBottom) return null;
  return (
    <div className="conversation-bottom-band">
      <ThreadPrimitive.ScrollToBottom
        className="conversation-bottom"
        aria-label="Scroll to bottom"
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="size-3">
          <path
            d="M8 3 L8 13 M4 9 L8 13 L12 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </ThreadPrimitive.ScrollToBottom>
    </div>
  );
}

/** Nothing said yet: the column's own name and one line about it, held in the
 * middle of the empty space above the composer. */
function ConversationEmpty(props: {
  readonly title: string | undefined;
  readonly sentence: string;
}): ReactNode {
  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-2 text-center">
      {props.title === undefined ? null : <h2>{props.title}</h2>}
      <p className="text-ink-3">{props.sentence}</p>
    </div>
  );
}

/** What the scrolling column holds: what it is still reading, what it has
 * nothing to draw, or the thread itself. A caller that worded no empty state
 * gets none, which is what a chat nobody has typed in yet wants. */
function ConversationBody(props: {
  readonly reading: boolean;
  readonly empty: boolean;
  readonly emptyTitle: string | undefined;
  readonly sentence: string | undefined;
}): ReactNode {
  if (props.reading) return <Notice tone="info" inline detail="Loading…" />;
  if (props.empty)
    return props.sentence === undefined ? null : (
      <ConversationEmpty title={props.emptyTitle} sentence={props.sentence} />
    );
  return (
    <ThreadPrimitive.Messages>
      {conversationMessageDrawn}
    </ThreadPrimitive.Messages>
  );
}

/** How every exchange under it is drawn: its work open or not, its text paced
 * or not, which of them holds the one thing that moves, whether an engine is
 * what runs for a turn nothing is drawn of, and whether text of any of them is
 * still being let out. */
function ConversationDrawn(props: {
  readonly workOpen: boolean;
  readonly paced: boolean;
  readonly indicator: ConversationIndicator;
  readonly engine: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { indicator, engine } = props;
  const id = indicator.indicator === "Exchange" ? indicator.id : undefined;
  const indicated = useMemo(() => ({ id, engine }), [id, engine]);
  return (
    <ConversationWorkOpen.Provider value={props.workOpen}>
      <ConversationPaced.Provider value={props.paced}>
        <ConversationIndicated.Provider value={indicated}>
          <ConversationLettingHeld>{props.children}</ConversationLettingHeld>
        </ConversationIndicated.Provider>
      </ConversationPaced.Provider>
    </ConversationWorkOpen.Provider>
  );
}

/**
 * The conversation as a page holds it: a column of exchanges that scrolls, and
 * the composer beneath it. A bounded height pins the composer to the foot of
 * it, and an unbounded one — a transcript inside a panel — leaves both in
 * normal flow.
 */
export function Conversation(props: {
  readonly exchanges: readonly ConversationExchange[];
  readonly composer?: ConversationComposerProps;
  /** The one line a column with nothing in it says. A caller that words none
   * draws nothing at all, which is what a chat nobody has typed in yet wants:
   * the composer under it already says what to do. */
  readonly empty?: string;
  readonly emptyTitle?: string;
  /** Whether the exchanges are still being read, which the column says in
   * their place and the composer below it does not wait on. */
  readonly reading?: boolean;
  /** Whether this mount is the pane's own scroller — lead, thread and chat,
   * whose wrapper gave up its inset for it — rather than a panel that already
   * pads itself. */
  readonly pane?: boolean;
  /** What a run was handed, drawn as the first message of its thread. */
  readonly prompt?: RunPrompt;
  /** The read of earlier records a page can make, offered at the top. */
  readonly earlier?: ConversationEarlierProps;
  /** Whether each exchange's work draws open, which is how a run is read:
   * its steps are the conversation rather than the way to an answer. */
  readonly workOpen?: boolean;
  /** Whether an answer still being written is let out at an even pace, which
   * is what a page that hears its turns as they are written asks for. */
  readonly paced?: boolean;
}): ReactNode {
  const reading = props.reading === true;
  const activeExchanges = reading ? [] : props.exchanges;
  const held = useConversationRuntime({
    exchanges: activeExchanges,
    composer: props.composer,
  });
  const indicator = conversationIndicator(activeExchanges, {
    drawn: props.composer !== undefined,
    sending: held.sending,
  });
  const composed = props.composer !== undefined;
  const inset = props.pane === true ? "px-4 py-4" : "";
  return (
    <AssistantRuntimeProvider runtime={held.runtime}>
      <ThreadPrimitive.Root className="conversation flex h-full min-h-0 flex-col">
        <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div
            className={`conversation-column mx-auto flex w-full flex-col gap-6 ${inset}`}
          >
            {props.prompt === undefined ? null : (
              <ConversationPrompt prompt={props.prompt} />
            )}
            {props.earlier === undefined ? null : (
              <ConversationEarlier {...props.earlier} />
            )}
            <ConversationDrawn
              workOpen={props.workOpen === true}
              paced={props.paced === true}
              indicator={indicator}
              engine={composed}
            >
              <ConversationBody
                reading={reading}
                empty={props.exchanges.length === 0}
                emptyTitle={props.emptyTitle}
                sentence={props.empty}
              />
            </ConversationDrawn>
            {indicator.indicator === "Engine" ? <ConversationWaiting /> : null}
          </div>
        </ThreadPrimitive.Viewport>
        <ConversationBottom />
        {props.composer === undefined ? null : (
          <div
            className={`conversation-column mx-auto w-full ${props.pane === true ? "conversation-foot" : "pt-4"}`}
          >
            <ConversationComposer {...props.composer} busy={held.sending} />
          </div>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
