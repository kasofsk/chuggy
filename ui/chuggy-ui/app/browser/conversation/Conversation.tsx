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
 */

import {
  AssistantRuntimeProvider,
  ThreadPrimitive,
  useExternalStoreRuntime,
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

import type { ConversationExchange } from "../../core/conversation.ts";
import { ConversationComposer } from "./ConversationComposer.tsx";
import type { ConversationComposerProps } from "./ConversationComposer.tsx";
import {
  ConversationAnswerMessage,
  ConversationAskMessage,
} from "./ConversationExchange.tsx";
import { ConversationWaiting } from "./ConversationWaiting.tsx";
import { Notice } from "../ui/Notice.tsx";

export type {
  ConversationComposerProps,
  ConversationSent,
} from "./ConversationComposer.tsx";

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

/** One exchange as the two messages the library holds a turn as: the ask, and
 * the answer it is still waiting for or already has. */
function conversationMessages(
  exchanges: readonly ConversationExchange[],
): readonly ThreadMessageLike[] {
  return exchanges.flatMap((exchange): ThreadMessageLike[] => [
    {
      id: `${exchange.id}-ask`,
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
      id: `${exchange.id}-answer`,
      role: "assistant",
      content:
        exchange.answer === undefined
          ? []
          : [{ type: "text", text: exchange.answer }],
      status: conversationStatus(exchange),
      metadata: { custom: { exchange, side: "Answer" } },
    },
  ]);
}

/** Whether any exchange is still being worked, the mailbox's own state: true
 * for a turn in `Queued` or `Claimed`, whatever the transcript already holds.
 * This is what `useExternalStoreRuntime`'s `isRunning` follows, so the
 * library's own affordances stay bound to the mailbox rather than the
 * transcript. */
function conversationRunning(
  exchanges: readonly ConversationExchange[],
): boolean {
  return exchanges.some((exchange) => exchange.standing.standing === "Running");
}

/** Whether a turn is out and nothing has been said for it yet — the strip's
 * own half of the waiting predicate, distinct from `conversationRunning`
 * because an exchange can be `Running` in the mailbox while its answer is
 * already on the transcript. `conversationWorked` demotes a text out of
 * `answer` the moment further work arrives, so an agent that speaks and then
 * keeps working reopens this without help from here. */
function conversationUnanswered(
  exchanges: readonly ConversationExchange[],
): boolean {
  return exchanges.some(
    (exchange) =>
      exchange.standing.standing === "Running" && exchange.answer === undefined,
  );
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
    convertMessage: (message) => message,
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
}): ReactNode {
  const reading = props.reading === true;
  const activeExchanges = reading ? [] : props.exchanges;
  const held = useConversationRuntime({
    exchanges: activeExchanges,
    composer: props.composer,
  });
  const waiting = held.sending || conversationUnanswered(activeExchanges);
  const inset = props.pane === true ? "px-4 py-4" : "";
  return (
    <AssistantRuntimeProvider runtime={held.runtime}>
      <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col gap-4">
        <ThreadPrimitive.Viewport className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div
            className={`max-w-column mx-auto flex w-full flex-col gap-6 ${inset}`}
          >
            <ConversationBody
              reading={reading}
              empty={props.exchanges.length === 0}
              emptyTitle={props.emptyTitle}
              sentence={props.empty}
            />
          </div>
        </ThreadPrimitive.Viewport>
        {props.composer === undefined ? null : (
          <div
            className={`max-w-column mx-auto w-full ${props.pane === true ? "px-4 pb-4" : ""}`}
          >
            <ConversationWaiting waiting={waiting} />
            <ConversationComposer {...props.composer} busy={held.sending} />
          </div>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
