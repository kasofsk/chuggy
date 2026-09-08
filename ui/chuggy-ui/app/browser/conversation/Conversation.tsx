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

function conversationAppendedText(message: AppendMessage): string {
  return message.content
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("");
}

interface ConversationHeld {
  readonly runtime: AssistantRuntime;
  readonly sending: boolean;
  readonly running: boolean;
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
  const running = props.exchanges.some(
    (exchange) => exchange.standing.standing === "Running",
  );
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    queue,
    messages: conversationMessages(props.exchanges),
    isRunning: running,
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
  return { runtime, sending, running };
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
    <div className="grid min-h-full place-content-center justify-items-center gap-2 text-center">
      {props.title === undefined ? null : <h2>{props.title}</h2>}
      <p className="text-ink-3">{props.sentence}</p>
    </div>
  );
}

/**
 * The conversation as a page holds it: a column of exchanges that scrolls, and
 * the composer beneath it. The two rows are one grid so that a bounded height
 * pins the composer to the bottom of it, and an unbounded one — a transcript
 * pane inside a panel — leaves both in normal flow.
 */
export function Conversation(props: {
  readonly exchanges: readonly ConversationExchange[];
  readonly composer?: ConversationComposerProps;
  readonly empty: string;
  readonly emptyTitle?: string;
  /** Whether the exchanges are still being read, which the column says in
   * their place and the composer below it does not wait on. */
  readonly reading?: boolean;
  /** Whether this mount is the pane's own scroller — lead and thread pages,
   * whose `DetailsPane` wrapper gave up its inset for it — rather than a
   * panel that already pads itself. */
  readonly pane?: boolean;
}): ReactNode {
  const reading = props.reading === true;
  const held = useConversationRuntime({
    exchanges: reading ? [] : props.exchanges,
    composer: props.composer,
  });
  /** Whether the conversation is waiting on the fabric: an exchange standing
   * `Running`, or a send out and not yet answered. */
  const waiting = held.running || held.sending;
  const inset = props.pane === true;
  return (
    <AssistantRuntimeProvider runtime={held.runtime}>
      <ThreadPrimitive.Root className="grid h-full min-h-0 grid-rows-[1fr_auto] gap-4">
        {/* The column centers inside the scroller; only a pane caller carries the inset the pane gave up. */}
        <ThreadPrimitive.Viewport className="min-h-0 overflow-y-auto">
          <div
            className={`max-w-column mx-auto grid min-w-0 gap-6${inset ? " px-4 py-4" : ""}`}
          >
            {reading ? (
              <Notice tone="info" inline detail="Loading…" />
            ) : props.exchanges.length === 0 ? (
              <ConversationEmpty
                title={props.emptyTitle}
                sentence={props.empty}
              />
            ) : (
              <ThreadPrimitive.Messages>
                {conversationMessageDrawn}
              </ThreadPrimitive.Messages>
            )}
          </div>
        </ThreadPrimitive.Viewport>
        {props.composer === undefined ? null : (
          <div
            className={`max-w-column mx-auto w-full min-w-0${inset ? " px-4 pb-4" : ""}`}
          >
            <ConversationWaiting waiting={waiting} />
            <ConversationComposer {...props.composer} busy={held.sending} />
          </div>
        )}
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}
